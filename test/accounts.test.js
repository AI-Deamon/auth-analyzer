// Tests for multi-account selection and per-account identity. All accounts, emails and apps are SYNTHETIC (example.com).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseAccountLabel, pickAccountLabel, uniqueAccounts, withAuthUser, accountLabel, accountKey, resolveSelection, verifyAccount,
  analyzeRecord, analyzeAll, explain, buildReport
} from '../core/index.js';

const T = (text, tag = 'text') => ({ text, tag });
const A = { authuser: 0, email: 'alex@example.com', name: 'Alex Example' };
const B = { authuser: 1, email: 'sam@example.com', name: 'Sam Example' };
const page = (account, name, id, ...perms) => ({
  account, name, nameSource: 'list_link_first_line', href: 'https://myaccount.google.com/linkedapps/overview/' + id,
  extraction: { sections: [
    { heading: 'Keep track of your Google Account data', items: [] },
    { heading: `${name} has some access to your Google Account`, items: [T('account_circle'), T('See your profile info'), ...perms.flatMap((p) => [T('pentagon'), T(p)]), T('See something suspicious?')] }
  ] }
});
const DRV = 'See and download all your Google Drive files';

// ---- account helpers ----
test('parseAccountLabel reads email and name from the avatar label formats', () => {
  assert.deepEqual(parseAccountLabel('Google Account: Alex Example\n(alex@example.com)'), { email: 'alex@example.com', name: 'Alex Example' });
  assert.deepEqual(parseAccountLabel('Google Account: Sam@Example.com'), { email: 'sam@example.com', name: null });
  assert.equal(parseAccountLabel('Google Account: no email here'), null);
  assert.equal(parseAccountLabel(null), null);
});

test('pickAccountLabel prefers the explicit "Google Account" label and ignores labels without an email', () => {
  assert.equal(pickAccountLabel(['Search', 'Support: help@example.com', 'Google Account: Alex (alex@example.com)']), 'Google Account: Alex (alex@example.com)');
  assert.equal(pickAccountLabel(['Search', 'Menu']), null);
  assert.equal(pickAccountLabel(undefined), null);
});

test('uniqueAccounts keeps the first occurrence of each email, case-insensitively, and drops invalid entries', () => {
  const out = uniqueAccounts([A, { ...B, authuser: 1 }, { authuser: 2, email: 'ALEX@example.com' }, null, { email: 'x@example.com' }]);
  assert.deepEqual(out.map((a) => a.authuser), [0, 1]);
});

test('withAuthUser sets or replaces only the authuser parameter', () => {
  assert.equal(withAuthUser('https://myaccount.google.com/connections', 2), 'https://myaccount.google.com/connections?authuser=2');
  assert.equal(withAuthUser('https://myaccount.google.com/linkedapps/overview/abc?authuser=0&hl=en', 1), 'https://myaccount.google.com/linkedapps/overview/abc?authuser=1&hl=en');
  assert.equal(new URL(withAuthUser('https://myaccount.google.com/x', 3)).host, 'myaccount.google.com');
  assert.throws(() => withAuthUser('not a url', 1));
});

test('selection: unset means all, stale choices drop out, order follows the account list', () => {
  const list = [A, B];
  assert.deepEqual(resolveSelection(list, undefined), [accountKey(A), accountKey(B)]);
  assert.deepEqual(resolveSelection(list, [accountKey(B), 'gone@example.com']), [accountKey(B)]);
  assert.deepEqual(resolveSelection(list, []), []);
  assert.equal(accountLabel({ authuser: 1 }), 'Account 2');
  assert.equal(accountLabel(A), 'alex@example.com');
});

// ---- the safeguard: never file apps under an account we cannot prove ----
test('verifyAccount fails safe: unreadable or different account is not scanned', () => {
  assert.equal(verifyAccount(A, ['Google Account: Alex Example (alex@example.com)']).ok, true);
  assert.deepEqual(verifyAccount(A, ['Google Account: Sam (sam@example.com)']), { ok: false, reason: 'account_mismatch', sawEmail: 'sam@example.com' });
  assert.deepEqual(verifyAccount(A, []), { ok: false, reason: 'account_not_verified' });
  assert.deepEqual(verifyAccount(A, ['Menu', 'Search']), { ok: false, reason: 'account_not_verified' });
  assert.equal(verifyAccount({ authuser: 0 }, ['Google Account: Alex (alex@example.com)']).ok, true); // no expected email: only requires one to be readable
});

test('the worker verifies the account before reading any app (static guarantee)', () => {
  const src = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const scan = src.slice(src.indexOf('async function scan('));
  assert.ok(scan.indexOf('verifyAccount(') > 0);
  assert.ok(scan.indexOf('verifyAccount(') < scan.indexOf('run(tabId, listExtract)'), 'verification must come before the app list is read');
  assert.match(scan, /withAuthUser\(app\.href, acct\.authuser\)/, 'detail pages are opened for the same account');
});

// ---- identity across accounts ----
test('the same app id in two accounts is two separate records and is never merged', () => {
  const res = analyzeAll([page(A, 'Example Drive App', 'same-id', DRV), page(B, 'Example Drive App', 'same-id', DRV)]);
  assert.equal(res.length, 2);
  assert.ok(res.every((r) => r.identity.duplicateCount === 1 && !r.identity.flags.includes('conflicting_duplicate')));
  assert.deepEqual(res.map((r) => r.identity.account.email).sort(), ['alex@example.com', 'sam@example.com']);
  assert.notEqual(res[0].identity.key, res[1].identity.key);
});

test('the same name in different accounts is not flagged as a confusing duplicate; within one account it is', () => {
  const cross = analyzeAll([page(A, 'Notes App', 'n1'), page(B, 'Notes App', 'n2')]);
  assert.ok(cross.every((r) => !r.identity.flags.includes('same_name_other_record')));
  const within = analyzeAll([page(A, 'Notes App', 'n1'), page(A, 'Notes App', 'n3')]);
  assert.ok(within.every((r) => r.identity.flags.includes('same_name_other_record')));
});

test('identical evidence is classified identically in every account', () => {
  const a = analyzeRecord(page(A, 'Example Drive App', 'x1', DRV));
  const b = analyzeRecord(page(B, 'Example Drive App', 'x1', DRV));
  const sig = (r) => JSON.stringify([r.capabilities.map((c) => [c.resource, c.actions, c.breadth, c.sensitivity]), r.sensitivity, r.confidence, explain(r).summary]);
  assert.equal(sig(a), sig(b));
});

test('user answers are looked up per account: the context key includes the account', () => {
  const seen = [];
  analyzeAll([page(A, 'Example App', 'k1'), page(B, 'Example App', 'k1')], (key) => { seen.push(key); return {}; });
  assert.equal(new Set(seen).size, 2);
  assert.ok(seen.every((k) => /@example\.com\|/.test(k)), seen.join(' '));
});

test('records without an account (older scans, pasted scope IDs) still work', () => {
  const r = analyzeRecord({ name: 'Old Scan App', href: 'https://myaccount.google.com/linkedapps/overview/old1', extraction: page(A, 'Old Scan App', 'old1').extraction });
  assert.equal(r.identity.account, null);
  assert.equal(r.sensitivity.level, 'low');
  assert.equal(analyzeAll([{ name: 'x', scopeIds: ['email'] }]).length, 1);
});

// ---- privacy ----
test('"names hidden" export removes account emails and names as well as app names', () => {
  const inputs = [page(A, 'Secret Drive App', 'p1', DRV), page(B, 'Other Private App', 'p2')];
  const results = analyzeAll(inputs);
  const open = JSON.stringify(buildReport(inputs, results, {}));
  assert.match(open, /alex@example\.com/, 'the normal export keeps accounts so it can be reproduced');
  const hidden = JSON.stringify(buildReport(inputs, results, { redactNames: true }));
  for (const secret of ['alex@example.com', 'sam@example.com', 'Alex Example', 'Sam Example', 'Secret Drive App', 'Other Private App']) assert.ok(!hidden.includes(secret), secret);
  assert.match(hidden, /Account 1/);
});

test('account data never leaves the browser: no network calls anywhere in the extension or core', () => {
  for (const f of ['../extension/background.js', '../extension/popup.js', '../extension/results.js', '../core/accounts.js']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/, f);
  }
});
