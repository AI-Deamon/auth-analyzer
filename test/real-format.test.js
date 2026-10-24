// Regression tests built from the layout and wording seen in a real exported report (Oct 2026).
// The permission wording and the order of lines are real; app names, ids and the combinations are SYNTHETIC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRecord, analyzeAll, explain, buildReport } from '../core/index.js';

// ---- synthetic builders reproducing the real page's line order ----
const I = (text, tag = 'text') => ({ text, tag });
const signInLine = (n) => I(`When you use Sign in with Google to sign in to your ${n} account, you're sharing some sensitive info with ${n}`);
const accessLine = (n) => I(`To use some ${n} features, you gave ${n} some access to your Google Account. This access might include sensitive info.`);
const FOOTER = I('See something suspicious?');
const page = (name, id, ...items) => ({
  name, nameSource: 'list_link_first_line', href: 'https://myaccount.google.com/linkedapps/overview/' + id,
  extraction: { title: 'Linked app - Google Account', h1: null, lineCount: items.length, sections: [{ heading: '', items: [I(name, 'a'), I('Remove access', 'button'), ...items] }] }
});
const signInOnly = (name, id) => page(name, id, signInLine(name), I('account_circle'), I('See your profile info'), FOOTER);
const withAccess = (name, id, ...perms) => page(name, id, signInLine(name), I('account_circle'), I('See your profile info'), accessLine(name), ...perms.flatMap((p) => [I('pentagon'), I(p)]), FOOTER);

const caps = (r) => r.capabilities;
const find = (r, resource, breadth) => r.capabilities.find((c) => c.resource === resource && (!breadth || c.breadth === breadth));
const summaryText = (r) => { const s = explain(r).summary; return [...s.access, s.whyItMatters, s.nextStep].join(' '); };

test('sign-in-only page (90 of 103 in the real report) is Low with understood evidence, not Unknown', () => {
  const r = analyzeRecord(signInOnly('Example Sign-in App', 'a1'));
  assert.equal(r.extraction.status, 'ok');
  assert.ok(!r.extraction.issues.includes('no_access_section'));
  assert.equal(r.sensitivity.level, 'low');
  assert.equal(r.sensitivity.lowerBound, false);
  assert.deepEqual(caps(r).map((c) => c.resource), ['identity_basic']);
  assert.equal(explain(r).summary.evidenceStatus, 'All visible access text understood');
  assert.equal(r.recommendation.action, 'no_action_indicated');
});

test('app name is never evidence: "Gmail" in the name does not create Gmail access (real defect)', () => {
  const r = analyzeRecord(signInOnly('Example Gmail Helper', 'a2'));
  assert.deepEqual(caps(r).map((c) => c.resource), ['identity_basic']);
  assert.doesNotMatch(summaryText(r), /gmail|email messages/i);
  const mail = analyzeRecord(withAccess('Mail', 'a3', 'Read, compose and send emails from your Gmail account'));
  assert.ok(find(mail, 'gmail'), 'short app name must not erase "Gmail"/"emails"');
});

test('combined permissions: compose + send + manage drafts merge without inventing delete or extra read', () => {
  const r = analyzeRecord(withAccess('Example Mail Tool', 'g1', 'Manage drafts and send emails'));
  const g = find(r, 'gmail');
  assert.deepEqual([...g.actions].sort(), ['send', 'write']);
  assert.ok(!g.actions.includes('read'), 'no read was stated');
  assert.ok(!g.actions.includes('delete'));
  assert.equal(r.sensitivity.level, 'high');
  assert.doesNotMatch(summaryText(r), /\bdelete|\bread\b/i);
});

test('"Read, compose and send" is read + change + send, and stays high without a revoke suggestion', () => {
  const r = analyzeRecord(withAccess('Example Mail Tool', 'g2', 'Read, compose and send emails from your Gmail account'));
  assert.deepEqual([...find(r, 'gmail').actions].sort(), ['read', 'send', 'write']);
  assert.equal(r.recommendation.action, 'review_access');
});

test('calendar wording: share/delete is admin+delete; "any calendar" is read only', () => {
  const r = analyzeRecord(withAccess('Example Calendar App', 'c1',
    'See, edit, share and permanently delete all the calendars that you can access using Google Calendar',
    'See and download any calendar that you can access using your Google Calendar',
    'View and edit events on all of your calendars'));
  const c = find(r, 'calendar', 'all');
  assert.deepEqual([...c.actions].sort(), ['admin', 'delete', 'read', 'write']);
  assert.equal(r.sensitivity.level, 'high');
  assert.equal(r.capabilities.filter((x) => x.resource === 'calendar').length, 1, 'same resource and breadth merge');
});

test('Drive: "Connect itself" is not file access; scoped and full access stay distinct', () => {
  const r = analyzeRecord(withAccess('Example Drive App', 'd1',
    'Connect itself to your Google Drive',
    'See and download all your Google Drive files',
    'See, edit, create and delete only the specific Google Drive files that you use with this app'));
  const install = find(r, 'drive', 'app_install');
  assert.deepEqual(install.actions, ['connect']);
  assert.equal(install.sensitivity.level, 'low');
  assert.deepEqual(find(r, 'drive', 'all').actions, ['read']);
  const scoped = find(r, 'drive', 'app_created');
  assert.ok(scoped.actions.includes('delete') && scoped.sensitivity.level === 'low');
  assert.match(explain(r).findings.map((f) => f.sentence).join(' '), /add itself as an option inside your Google Drive/);
});

test('one line, two clauses: Cloud access AND the email address are both kept (real defect: second clause dropped)', () => {
  const r = analyzeRecord(withAccess('Example Cloud Tool', 'k1', 'See, edit, configure and delete your Google Cloud data and see the email address for your Google Account.'));
  const cloud = find(r, 'cloud');
  assert.deepEqual([...cloud.actions].sort(), ['admin', 'delete', 'read', 'write']);
  assert.equal(cloud.breadth, 'user_accessible');
  assert.deepEqual(find(r, 'identity_basic').actions, ['read'], 'the email clause must only be read');
  assert.doesNotMatch(summaryText(r), /entire|whole account/i);
});

test('unknown permission wording is kept and makes the result partial, never plain Low (real: "Report logging information")', () => {
  const r = analyzeRecord(withAccess('Example Logger', 'u1', 'Report logging information for Google apps'));
  assert.equal(r.evidence.items.filter((i) => i.kind === 'unrecognised').length, 1);
  assert.equal(r.confidence.level, 'partial');
  assert.equal(r.sensitivity.lowerBound, true);
  assert.equal(explain(r).summary.evidenceStatus, 'Partly understood');
  assert.notEqual(r.recommendation.action, 'no_action_indicated');
});

test('icon-font text and footer are not permissions (real: "account_circle", "pentagon", "See something suspicious?")', () => {
  const r = analyzeRecord(withAccess('Example App', 'i1', 'See your Google Calendar events'));
  assert.equal(r.evidence.items.filter((i) => i.kind === 'unrecognised').length, 0);
  assert.ok(r.extraction.ignored.chrome >= 3);
  assert.equal(r.confidence.level, 'described');
});

test('content after the footer marker is not classified as access', () => {
  const rec = page('Example App', 'f1', signInLine('Example App'), I('See your profile info'), FOOTER, I('Some unrelated footer text that is long enough'));
  const r = analyzeRecord(rec);
  assert.equal(r.evidence.items.filter((i) => i.kind === 'unrecognised').length, 0);
  assert.equal(r.sensitivity.level, 'low');
});

// ---- failure and incomplete-scan handling ----
test('unrecognised layout never becomes Low: no markers + no permissions = Unknown', () => {
  const r = analyzeRecord(page('Example App', 'x1', I('Totally different page text'), I('Another line')));
  assert.ok(r.extraction.issues.includes('no_access_section'));
  assert.equal(r.sensitivity.level, 'unknown');
  assert.equal(explain(r).summary.evidenceStatus, 'Unknown'); // nothing usable was found
  assert.notEqual(r.recommendation.action, 'no_action_indicated');
});

test('unrecognised layout with a recognisable permission is a lower bound, flagged as outside the expected section', () => {
  const r = analyzeRecord(page('Example App', 'x2', I('See and download all your Google Drive files')));
  assert.equal(r.sensitivity.level, 'high');
  assert.ok(r.extraction.issues.includes('permission_text_outside_access_section'));
  assert.equal(r.confidence.level, 'partial');
});

test('failed and empty extractions are Unknown with insufficient evidence', () => {
  for (const rec of [{ name: 'E', href: 'https://myaccount.google.com/linkedapps/overview/e1', error: 'Error: tab closed' }, { name: 'E', extraction: { sections: [] } }, { name: 'E' }]) {
    const r = analyzeRecord(rec);
    assert.equal(r.sensitivity.level, 'unknown');
    assert.equal(explain(r).summary.evidenceStatus, 'Unknown');
  }
});

// ---- duplicates and consistency ----
test('same display name, different authorizations: both kept (real: two "Claude for Gmail" records)', () => {
  const res = analyzeAll([
    withAccess('Example Mail Tool', 'dup1', 'Read, compose and send emails from your Gmail account'),
    signInOnly('Example Mail Tool', 'dup2')
  ]);
  assert.equal(res.length, 2);
  assert.ok(res.every((r) => r.identity.flags.includes('same_name_other_record')));
  const high = res.find((r) => r.sensitivity.level === 'high'), low = res.find((r) => r.sensitivity.level === 'low');
  assert.ok(high && low, 'the sign-in-only duplicate must not inherit the other record\'s Gmail access');
});

test('identical evidence gives identical classification regardless of app name', () => {
  const a = analyzeRecord(withAccess('Alpha', 'z1', 'See and download all your Google Drive files'));
  const b = analyzeRecord(withAccess('Completely Different Name', 'z2', 'See and download all your Google Drive files'));
  const strip = (r) => JSON.stringify([r.capabilities.map((c) => [c.resource, c.actions, c.breadth, c.sensitivity]), r.sensitivity, r.confidence, r.recommendation]);
  assert.equal(strip(a), strip(b));
});

// ---- explanation format ----
test('summary has the four parts, short sentences, and no repeated disclaimer', () => {
  const r = analyzeRecord(withAccess('Example Calendar App', 'c2', 'See and download any calendar that you can access using your Google Calendar'));
  const s = explain(r).summary;
  assert.ok(Array.isArray(s.access) && s.access.length >= 1);
  assert.ok(s.whyItMatters.length <= 170 && s.whyItMatters.split('. ').length === 1, s.whyItMatters);
  assert.ok(s.nextStep.length > 10);
  assert.ok(['All visible access text understood', 'Known permission IDs', 'Partly understood', 'Unknown'].includes(s.evidenceStatus));
  assert.doesNotMatch([...s.access, s.whyItMatters, s.nextStep, s.evidenceNote].join(' '), /not what the app actually does/i);
});

test('no unsupported capability appears in any summary text', () => {
  const cases = [
    ['gmail read-only', analyzeRecord({ name: 'x', scopeIds: ['gmail.readonly'] }), /\b(send|delete|change)\b/i],
    ['calendar read', analyzeRecord(withAccess('Example', 'n1', 'See and download any calendar that you can access using your Google Calendar')), /\b(send|delete|change|edit)\b/i],
    ['sign-in only', analyzeRecord(signInOnly('Example', 'n2')), /\b(gmail|drive|calendar|send|delete)\b/i]
  ];
  for (const [label, r, forbidden] of cases) assert.doesNotMatch(summaryText(r), forbidden, label);
});

// ---- report round trip ----
test('exported report reproduces the analysis from its own input, and can hide names', () => {
  const inputs = [withAccess('Secret Name App', 'r1', 'See and download all your Google Drive files'), signInOnly('Another Private App', 'r2')];
  const results = analyzeAll(inputs);
  const report = buildReport(inputs, results, { generatedAt: '2026-10-22T00:00:00Z', view: 'all' });
  assert.equal(report.format, 'auth-analyzer-report');
  assert.equal(report.summary.records, 2);
  for (const rec of report.records) {
    const again = analyzeRecord(rec.input);
    assert.equal(again.sensitivity.level, rec.analysis.sensitivity.level);
    assert.equal(again.confidence.level, rec.analysis.confidence.level);
  }
  const hidden = JSON.stringify(buildReport(inputs, results, { redactNames: true }));
  assert.doesNotMatch(hidden, /Secret Name App|Another Private App/);
  assert.match(hidden, /App 1/);
});
