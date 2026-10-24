// "+N more" links. REAL: the link exists on 5 of 10 real access records and points to linkedapps/details/<id>.
// ASSUMED (not yet observed): the layout of that details page. The fixtures below are SYNTHETIC guesses at it, so these tests
// check the fail-safe rules (never resolve a hidden list on thin evidence, never treat unknown text as safe), not Google's layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeRecord, explain, findDetailsLinks } from '../core/index.js';

const T = (text, tag = 'text', href) => ({ text, tag, ...(href ? { href } : {}) });
const BASE = 'https://myaccount.google.com/linkedapps/overview/app1?authuser=0';
const CAL = 'See and download any calendar that you can access using your Google Calendar';
const GMAIL = 'Read, compose and send emails from your Gmail account';
const CONTACTS = 'See and download your contacts';

function mainPage(name, perms, more, href = 'linkedapps/details/DET1/oauth/XYZ') {
  return { url: BASE, sections: [
    { heading: 'Keep track of your Google Account data', items: [] },
    { heading: `${name} has some access to your Google Account`, items: [T('account_circle'), T('See your profile info'), ...perms.flatMap((p) => [T('pentagon'), T(p)]), ...(more ? [T(`+${more} more`, 'a', href)] : []), T('See details')] }
  ] };
}
const detailsPage = (...lines) => ({ url: 'https://myaccount.google.com/linkedapps/details/DET1', sections: [{ heading: 'Access details', items: lines.map((l) => T(l)) }] });
const rec = (name, perms, more, followed) => ({
  account: { authuser: 0, email: 'alex@example.com' }, name, href: 'https://myaccount.google.com/linkedapps/overview/app1',
  extraction: { ...mainPage(name, perms, more), ...(followed ? { followed } : {}) }
});
const status = (r) => explain(r).summary.evidenceStatus;

// ---- which links are followed ----
test('findDetailsLinks follows only "+N more" links to a details page on the same site', () => {
  const ex = { url: BASE, sections: [{ heading: '', items: [
    T('+1 more', 'a', 'linkedapps/details/A1/oauth/B2'),            // yes (relative, as seen in a real report)
    T('+4 more', 'a', 'https://myaccount.google.com/linkedapps/details/C3'), // yes (absolute)
    T('+2 more', 'a', 'https://evil.example.com/linkedapps/details/X'),      // other host: never
    T('+2 more', 'a', 'linkedapps/overview/Z'),                              // not a details page
    T('Learn more', 'a', 'linkedapps/details/L'),                            // not a collapsed list
    T('+3 more', 'text', 'linkedapps/details/Q'),                            // not a link
    T('+1 more', 'a', 'linkedapps/details/A1/oauth/B2')                      // duplicate
  ] }] };
  const links = findDetailsLinks(ex);
  assert.deepEqual(links.map((l) => l.href), ['https://myaccount.google.com/linkedapps/details/A1/oauth/B2', 'https://myaccount.google.com/linkedapps/details/C3']);
  assert.equal(findDetailsLinks(ex, 1).length, 1, 'the cap is respected');
  assert.deepEqual(findDetailsLinks(null), []);
});

// ---- without following: unchanged fail-safe behaviour ----
test('an unfollowed "+N more" keeps the record partial (the previously verified behaviour)', () => {
  const r = analyzeRecord(rec('Example Calendar App', [CAL], 1));
  assert.equal(r.evidence.collapsed, 1);
  assert.equal(status(r), 'Partly understood');
});

// ---- following: resolution rules ----
test('resolved only when the details page yields at least as many NEW permissions as announced; hidden access is added', () => {
  const r = analyzeRecord(rec('Example Calendar App', [CAL], 1, [{ from: '+1 more', href: '/linkedapps/details/DET1', extraction: detailsPage(CAL, GMAIL) }]));
  assert.equal(r.evidence.collapsed, 0);
  assert.ok(r.extraction.issues.includes('collapsed_resolved_via_details'));
  assert.equal(status(r), 'All visible access text understood');
  const gmail = r.capabilities.find((c) => c.resource === 'gmail');
  assert.ok(gmail && gmail.actions.includes('send'), 'the previously hidden Gmail permission is now rated');
  assert.equal(r.sensitivity.level, 'high');
  assert.ok(r.evidence.items.some((i) => i.fromDetails && i.kind === 'description'), 'details evidence is marked as such');
});

test('fewer new permissions than announced: still partial, with a specific reason', () => {
  const r = analyzeRecord(rec('Example Calendar App', [CAL], 4, [{ extraction: detailsPage(CAL, GMAIL) }]));
  assert.equal(r.evidence.collapsed, 4);
  assert.ok(r.extraction.issues.includes('collapsed_details_incomplete'));
  assert.equal(status(r), 'Partly understood');
  assert.ok(r.capabilities.some((c) => c.resource === 'gmail'), 'what was found is still counted');
  assert.match(explain(r).limitations.join(' '), /did not list as many extra permissions/);
});

test('unknown text on the details page is never treated as safe, even if the count is satisfied', () => {
  const r = analyzeRecord(rec('Example Calendar App', [CAL], 1, [{ extraction: detailsPage(CAL, GMAIL, 'Some wording we have never seen') }]));
  assert.equal(r.evidence.items.filter((i) => i.kind === 'unrecognised' && i.fromDetails).length, 1);
  assert.notEqual(status(r), 'All visible access text understood');
  assert.equal(r.evidence.collapsed, 1, 'not resolved while anything on that page is unresolved');
});

test('an unreadable or failed details page leaves the list unresolved', () => {
  for (const followed of [[{ error: 'Error: tab closed' }], [{ extraction: { sections: [] } }], [{}]]) {
    const r = analyzeRecord(rec('Example Calendar App', [CAL], 1, followed));
    assert.ok(r.extraction.issues.includes('details_page_unreadable'));
    assert.equal(r.evidence.collapsed, 1);
    assert.equal(status(r), 'Partly understood');
  }
});

test('a "+N more" inside the details page itself is not resolved either', () => {
  const nested = { url: 'https://myaccount.google.com/linkedapps/details/DET1', sections: [{ heading: 'Access details', items: [T(CAL), T(GMAIL), T('+2 more', 'a', 'linkedapps/details/DET2')] }] };
  const r = analyzeRecord(rec('Example Calendar App', [CAL], 1, [{ extraction: nested }]));
  assert.equal(status(r), 'Partly understood');
  assert.ok(r.evidence.collapsed >= 1);
});

test('rewording does not fabricate resolution: the same permission seen again adds no new capability', () => {
  const r = analyzeRecord(rec('Example Calendar App', [CAL], 1, [{ extraction: detailsPage(CAL) }]));
  assert.equal(r.evidence.collapsed, 1, 'no new permission text, so the announced hidden item is still unaccounted for');
  assert.equal(r.capabilities.filter((c) => c.resource === 'calendar').length, 1);
});

// ---- the worker only follows what findDetailsLinks allows ----
test('the worker follows details links through the vetted helper, for the same account', () => {
  const worker = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const scan = worker.slice(worker.indexOf('async function scan('));
  assert.match(scan, /for \(const link of findDetailsLinks\(extraction\)\)/);
  assert.match(scan, /withAuthUser\(link\.href, acct\.authuser\)/);
  assert.match(worker, /if \(!h \|\| h\.startsWith\('#'\) \|\| h\.startsWith\('javascript:'\)\)/, 'in-page expanders only; links are followed separately and vetted');
});
