// Regression tests for defects verified in the second exported report (103 records, 7 partially understood).
// Wording and line order are taken from that report; app names and ids are SYNTHETIC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRecord, explain, parseScopeInput } from '../core/index.js';

const I = (text, tag = 'text') => ({ text, tag });
const signIn = (n) => I(`When you use Sign in with Google to sign in to your ${n} account, you're sharing some sensitive info with ${n}`);
const accessMarker = (n) => I(`To use some ${n} features, you gave ${n} some access to your Google Account. This access might include sensitive info.`);
const boiler = (n) => I(`${n} has some access to your Google Account`); // the line behind 6 of the 7 partial records
const FOOTER = I('See something suspicious?');
const page = (name, id, ...items) => ({
  name, nameSource: 'list_link_first_line', href: 'https://myaccount.google.com/linkedapps/overview/' + id,
  extraction: { title: 'Linked app', h1: null, lineCount: items.length, sections: [{ heading: '', items: [I(name, 'a'), I('Remove access', 'button'), ...items] }] }
});
// Layout seen in the report for apps with both sections, including the boilerplate sub-heading.
const both = (name, id, ...perms) => page(name, id, signIn(name), I('account_circle'), I('See your profile info'), accessMarker(name), boiler(name), ...perms.flatMap((p) => [I('pentagon'), I(p)]), FOOTER);

const text = (r) => { const e = explain(r); return [...e.summary.access, e.summary.whyItMatters, e.summary.nextStep, e.summary.evidenceNote, e.summary.evidenceStatus].join(' | '); };
const unrec = (r) => r.evidence.items.filter((i) => i.kind === 'unrecognised');

// ---- 1. page boilerplate vs unknown permission text ----
test('boilerplate sub-heading is known page text, so a fully understood record is complete (6 of the 7 partial records)', () => {
  const r = analyzeRecord(both('Example Calendar App', 'b1', 'See and download any calendar that you can access using your Google Calendar'));
  assert.equal(unrec(r).length, 0);
  assert.equal(r.confidence.level, 'described');
  assert.equal(r.sensitivity.lowerBound, false);
  assert.equal(r.sensitivity.level, 'medium');
  assert.equal(explain(r).summary.evidenceStatus, 'All visible access text understood');
});

test('boilerplate and marker text are retained for traceability, not discarded', () => {
  const r = analyzeRecord(both('Example Calendar App', 'b2', 'See your Google Calendar events'));
  const kept = r.evidence.items.filter((i) => i.kind === 'boilerplate').map((i) => i.text);
  assert.ok(kept.includes('Example Calendar App has some access to your Google Account'));
  assert.ok(kept.some((t) => /^To use some Example Calendar App features/.test(t)));
});

test('a genuinely unknown permission next to the boilerplate stays unresolved (the 7th record)', () => {
  const r = analyzeRecord(both('Example Cloud Tool', 'b3', 'See, edit, configure and delete your Google Cloud data and see the email address for your Google Account.', 'Report logging information for Google apps'));
  assert.deepEqual(unrec(r).map((i) => i.text), ['Report logging information for Google apps']);
  assert.equal(r.confidence.level, 'partial');
  assert.equal(explain(r).summary.evidenceStatus, 'Partly understood');
  assert.match(explain(r).summary.nextStep, /review the access we could not read: "Report logging information for Google apps"/);
});

test('boilerplate pattern is narrow: permission-like text is never swallowed by it', () => {
  for (const line of ['Report logging information for Google apps', 'Example has some access to your Google Account and can send email', 'See your Google Calendar events', 'Read your email. Example has some access to your Google Account']) {
    const r = analyzeRecord(both('Example', 'n' + line.length, line));
    assert.ok(!r.evidence.items.some((i) => i.kind === 'boilerplate' && i.text === line), line);
  }
  const r = analyzeRecord(both('Example', 'n9', 'Example has some access to your Google Account and can send email'));
  // Text that only resembles the boilerplate is evaluated as a permission (here: it states "send email"), never ignored.
  assert.ok(!r.evidence.items.some((i) => i.kind === 'boilerplate' && /send email/.test(i.text)));
  assert.deepEqual(r.capabilities.find((c) => c.resource === 'gmail').actions, ['send']);
});

// ---- 2. evidence labels ----
test('evidence labels do not claim verification, and say what understanding does not prove', () => {
  const page1 = analyzeRecord(both('Example App', 'l1', 'See and download all your Google Drive files'));
  const e = explain(page1).summary;
  assert.equal(e.evidenceStatus, 'All visible access text understood');
  assert.match(e.evidenceNote, /does not verify the app's behaviour or its exact OAuth scopes/);
  assert.doesNotMatch(text(page1), /\bverified\b/i);
  const ids = explain(analyzeRecord({ name: 'x', scopeIds: parseScopeInput('gmail.readonly') })).summary;
  assert.equal(ids.evidenceStatus, 'Known permission IDs');
  assert.match(ids.evidenceNote, /does not show what the app does/);
});

// ---- 3. explanations ----
test('Gmail explanation covers read, change and send when each is supported by the source', () => {
  const r = analyzeRecord(both('Example Mail Tool', 'g1', 'Read, compose and send emails from your Gmail account', 'Manage drafts and send emails'));
  const s = explain(r).summary;
  assert.match(s.access[0], /Read and change your Gmail messages and send email as you/);
  assert.match(s.whyItMatters, /emails/i);
  assert.match(s.whyItMatters, /change/);
  assert.match(s.whyItMatters, /send messages that appear to come from you/);
  assert.equal(s.whyItMatters.split('. ').length, 1, 'one sentence');
  assert.ok(s.whyItMatters.length <= 170);
});

test('read-only access never mentions changing, sending or deleting', () => {
  for (const r of [analyzeRecord({ name: 'x', scopeIds: ['gmail.readonly'] }), analyzeRecord(both('E', 'r1', 'See and download all your Google Drive files'))]) {
    assert.doesNotMatch(text(r), /\b(change|send|delete|share|configure)\b/i);
  }
});

test('administrative power is named only as the source names it (no invented "settings")', () => {
  const cal = analyzeRecord(both('Example Calendar App', 'a1', 'See, edit, share and permanently delete all the calendars that you can access using Google Calendar'));
  const cloud = analyzeRecord(both('Example Cloud Tool', 'a2', 'See, edit, configure and delete your Google Cloud data and see the email address for your Google Account.'));
  assert.match(text(cal), /share/);
  assert.doesNotMatch(text(cal), /settings/i);
  assert.match(text(cloud), /configure/);
  assert.doesNotMatch(text(cloud), /settings|sharing/i);
  // verified scope IDs carry the same specific wording
  assert.match(text(analyzeRecord({ name: 'x', scopeIds: ['calendar'] })), /share/);
  assert.doesNotMatch(text(analyzeRecord({ name: 'x', scopeIds: ['cloud-platform'] })), /settings|sharing/i);
});

test('profile wording does not claim a name or picture the page never stated', () => {
  const only = analyzeRecord(both('Example', 'p1'));
  assert.match(text(only), /basic profile info/);
  assert.doesNotMatch(text(only), /\bname\b|picture|email address/i);
  const withEmail = analyzeRecord(both('Example', 'p2', 'See and download all of your Google Account email addresses'));
  assert.match(text(withEmail), /basic profile info and email address/);
});

test('"Connect itself to your Google Drive" never produces file-access wording', () => {
  const r = analyzeRecord(both('Example Drive App', 'd1', 'Connect itself to your Google Drive'));
  assert.doesNotMatch(text(r), /\b(see|read|change|delete)\b.*files/i);
  assert.match(explain(r).summary.whyItMatters, /^It can only see basic profile details\.$|No file access is stated/);
});

// ---- evidence duplication ----
test('a line split into clauses, or repeated, appears once as evidence', () => {
  const r = analyzeRecord(both('Example Mail Tool', 'e1', 'Manage drafts and send emails'));
  const gmail = r.capabilities.find((c) => c.resource === 'gmail');
  assert.deepEqual(gmail.evidence.map((e) => e.text), ['Manage drafts and send emails']);
  const id = r.capabilities.find((c) => c.resource === 'identity_basic');
  assert.deepEqual(id.evidence.map((e) => e.text), ['See your profile info']);
});

// ---- 4. recommendations ----
test('next step is proportionate for complete records and points at the gap for incomplete ones', () => {
  // A genuine sign-in-only page. (The old fixture had an access section that listed nothing, which is now correctly "partial".)
  const low = explain(analyzeRecord(page('A', 'n1', signIn('A'), I('account_circle'), I('See your profile info'), FOOTER))).summary.nextStep;
  const med = explain(analyzeRecord(both('B', 'n2', 'See and download any calendar that you can access using your Google Calendar'))).summary.nextStep;
  const high = explain(analyzeRecord(both('C', 'n3', 'See and download all your Google Drive files'))).summary.nextStep;
  assert.match(low, /^No action needed/);
  assert.match(med, /^Keep it if you still use it/);
  assert.match(high, /^Keep it only if you recognise it and still use it/);
  assert.equal(new Set([low, med, high]).size, 3);
  const partial = explain(analyzeRecord(both('D', 'n4', 'Something we have never seen'))).summary.nextStep;
  assert.match(partial, /review the access we could not read/);
  const none = explain(analyzeRecord({ name: 'E' })).summary.nextStep;
  assert.match(none, /could not read it/);
});

test('incomplete low-sensitivity records are never told "no action needed"', () => {
  const r = analyzeRecord(both('Example', 'q1', 'Something we have never seen'));
  assert.equal(r.sensitivity.lowerBound, true);
  assert.doesNotMatch(explain(r).summary.nextStep, /No action needed/);
});

// ---- 6. accuracy of claims ----
test('without a stated purpose, no summary claims the access is needed or unnecessary', () => {
  const cases = [
    both('A', 'c1', 'See and download all your Google Drive files'),
    both('B', 'c2', 'Read, compose and send emails from your Gmail account'),
    both('C', 'c3'),
    page('D', 'c4', I('nothing useful'))
  ];
  for (const rec of cases) assert.doesNotMatch(text(analyzeRecord(rec)), /unnecessary|excessive|too much|not needed|does not need|needs? this|malicious|dangerous|suspicious/i);
});

test('high sensitivity with complete evidence never suggests removal on its own', () => {
  const r = analyzeRecord(both('Example Mail Tool', 'h1', 'Read, compose and send emails from your Gmail account'));
  assert.equal(r.sensitivity.level, 'high');
  assert.equal(r.recommendation.action, 'review_access');
  assert.doesNotMatch(explain(r).summary.nextStep, /^Remove/);
});
