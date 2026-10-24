// All fixtures below are SYNTHETIC (invented apps and text shaped like the extractor's output).
// They are not captures of a real Google Account page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzeRecord, analyzeAll, explain, describeLine, lookupScope } from '../core/index.js';

// ---- synthetic fixture helpers ----
const access = (...texts) => ({ heading: 'Access to your account', items: texts.map((text) => ({ text })) });
const rec = (name, id, ...sections) => ({ name, href: 'https://myaccount.google.com/linkedapps/overview/' + id, extraction: { h1: name, sections } });
const scopes = (name, ...ids) => ({ name, scopeIds: ids });
const level = (r) => r.sensitivity.level;
const allText = (r) => { const e = explain(r); return [e.headline, e.nextStep, ...e.limitations, ...e.findings.flatMap((f) => [f.sentence, f.could])].join(' ');};

// ---- consistency ----
test('equivalent basic-profile evidence gets the same classification', () => {
  const a = analyzeRecord(scopes('A', 'email'));
  const b = analyzeRecord(scopes('B', 'https://www.googleapis.com/auth/userinfo.email'));
  const c = analyzeRecord(rec('C', 'c1', access('See your primary Google Account email address')));
  for (const r of [a, b, c]) { assert.equal(level(r), 'low'); assert.equal(r.capabilities[0].resource, 'identity_basic'); }
  assert.equal(c.capabilities.some((x) => x.resource === 'gmail'), false); // regression: "email address" is not Gmail
});

test('read, write, send and delete are evaluated separately', () => {
  const act = (id) => analyzeRecord(scopes('X', id)).capabilities[0].actions;
  assert.deepEqual(act('gmail.readonly'), ['read']);
  assert.deepEqual(act('gmail.send'), ['send']);
  assert.deepEqual(act('drive.readonly'), ['read']);
  assert.ok(act('mail.google.com').includes('delete'));
  assert.ok(!act('gmail.modify').includes('delete'));
});

test('description with several verbs keeps all of them (regression: first-match-wins lost actions)', () => {
  const d = describeLine('See, edit, create, and delete all of your Google Drive files');
  assert.deepEqual(d.capabilities[0].actions.sort(), ['delete', 'read', 'write']);
  assert.equal(d.capabilities[0].breadth, 'all');
});

// ---- sensitivity ----
test('sensitivity for Gmail, Drive, Calendar and cloud access', () => {
  assert.equal(level(analyzeRecord(scopes('x', 'gmail.readonly'))), 'high');
  assert.equal(level(analyzeRecord(scopes('x', 'drive.readonly'))), 'high');
  assert.equal(level(analyzeRecord(scopes('x', 'calendar.readonly'))), 'medium');
  assert.equal(level(analyzeRecord(scopes('x', 'cloud-platform'))), 'high');
  assert.equal(level(analyzeRecord(scopes('x', 'drive.file'))), 'low');
});

test('cloud access is not described as control of the entire account', () => {
  const text = allText(analyzeRecord(scopes('x', 'cloud-platform')));
  assert.match(text, /your account can reach/);
  assert.doesNotMatch(text, /entire|whole account/i);
});

test('narrow breadth is not described as access to everything', () => {
  const r = analyzeRecord(rec('N', 'n1', access('See, edit, create, and delete only the specific Google Drive files you use with this app')));
  assert.equal(r.capabilities[0].breadth, 'app_created');
  assert.equal(level(r), 'low');
  assert.doesNotMatch(allText(r), /all your/i);
});

// ---- unknown / missing / malformed: fail safe ----
test('unknown scope ID is unknown, not guessed and not low', () => {
  const r = analyzeRecord(scopes('x', 'https://www.googleapis.com/auth/foo.readonly'));
  assert.equal(level(r), 'unknown');
  assert.equal(r.confidence.level, 'partial'); // the ID is present but not understood
  assert.ok(r.confidence.gaps.includes('unknown_permission'));
  assert.notEqual(r.recommendation.action, 'no_action_indicated');
  assert.equal(lookupScope('foo.readonly').known, false);
});

test('missing or malformed extraction is never reassuring', () => {
  for (const raw of [null, undefined, {}, { name: 'x' }, { name: 'x', extraction: {} }, { name: 'x', extraction: { sections: 'nope' } }, { name: 'x', error: 'boom' }, 42]) {
    const r = analyzeRecord(raw);
    assert.equal(level(r), 'unknown', JSON.stringify(raw));
    assert.equal(r.confidence.level, 'insufficient');
    assert.equal(r.recommendation.action, 'review_access');
    assert.doesNotThrow(() => explain(r));
  }
});

test('unrecognised access text makes the result a lower bound, not plain Low (regression)', () => {
  const r = analyzeRecord(rec('U', 'u1', access('See your name and profile picture', 'Do something we have never seen')));
  assert.equal(level(r), 'low');
  assert.equal(r.sensitivity.lowerBound, true);
  assert.equal(r.confidence.level, 'partial');
  assert.equal(r.recommendation.action, 'review_access');
  assert.match(explain(r).sensitivityLabel, /^At least Low/);
  assert.equal(r.evidence.items.filter((i) => i.kind === 'unrecognised').length, 1);
});

test('buttons and dates are ignored but unknown text in the access section is kept', () => {
  const r = analyzeRecord(rec('B', 'b1', { heading: 'Access to your account', items: [{ text: 'See your email address' }, { text: 'Remove access', tag: 'button' }, { text: 'Has access since Jan 4, 2024' }] }));
  assert.equal(r.extraction.ignored.chrome, 1);
  assert.equal(r.extraction.ignored.metadata, 1);
  assert.equal(r.confidence.level, 'described');
});

test('permission text outside the access section is included and flagged, not dropped', () => {
  const r = analyzeRecord(rec('O', 'o1', { heading: 'About this app', items: [{ text: 'Read, compose, and send emails from your Gmail account' }] }));
  assert.ok(r.capabilities.some((c) => c.resource === 'gmail'));
  assert.ok(r.extraction.issues.includes('permission_text_outside_access_section'));
  assert.equal(r.confidence.level, 'partial');
});

test('"manage" wording is flagged ambiguous', () => {
  const r = analyzeRecord(rec('M', 'm1', access('Manage your YouTube account')));
  assert.equal(r.confidence.level, 'partial');
});

// ---- duplicates and adjacent records ----
test('same display name with different IDs stays separate and flagged', () => {
  const res = analyzeAll([rec('Dup', 'id1', access('See your email address')), rec('Dup', 'id2', access('See your contacts'))]);
  assert.equal(res.length, 2);
  assert.ok(res.every((r) => r.identity.flags.includes('same_name_other_record')));
});

test('identical record seen twice collapses; differing record with same ID is flagged', () => {
  const same = analyzeAll([rec('A', 'id1', access('See your contacts')), rec('A', 'id1', access('See your contacts'))]);
  assert.equal(same.length, 1);
  assert.equal(same[0].identity.duplicateCount, 2);
  const diff = analyzeAll([rec('A', 'id1', access('See your contacts')), rec('A', 'id1', access('See your Google Calendar'))]);
  assert.equal(diff.length, 2);
  assert.ok(diff.every((r) => r.identity.flags.includes('conflicting_duplicate')));
});

test('adjacent records never share capabilities', () => {
  const res = analyzeAll([rec('Mail', 'm1', access('Read, compose, and send emails from your Gmail account')), rec('Cal', 'c1', access('See your Google Calendar events'))]);
  const mail = res.find((r) => r.identity.name === 'Mail'), cal = res.find((r) => r.identity.name === 'Cal');
  assert.deepEqual(mail.capabilities.map((c) => c.resource), ['gmail']);
  assert.deepEqual(cal.capabilities.map((c) => c.resource), ['calendar']);
});

// ---- purpose compatibility ----
test('purpose is unknown unless the user states it (regression: "other" used to flag everything)', () => {
  const r = analyzeRecord(scopes('x', 'gmail.readonly'));
  assert.equal(r.purpose.state, 'unknown');
  assert.equal(r.purpose.reason, 'not_stated');
  assert.equal(analyzeRecord(scopes('x', 'gmail.readonly'), { purpose: 'other' }).purpose.state, 'unknown');
});

test('purpose states: consistent, broader, conflicting, insufficient', () => {
  assert.equal(analyzeRecord(scopes('x', 'calendar.readonly'), { purpose: 'calendar' }).purpose.state, 'consistent');
  assert.equal(analyzeRecord(scopes('x', 'gmail.readonly'), { purpose: 'signin' }).purpose.state, 'broader');
  const conflict = analyzeRecord(rec('C', 'c1', access('View only access to your Google Drive files', 'See, edit and delete all your Google Drive files')), { purpose: 'storage' });
  assert.equal(conflict.purpose.state, 'conflicting');
  const partial = analyzeRecord(rec('P', 'p1', access('See your Google Calendar', 'Unknown thing')), { purpose: 'calendar' });
  assert.equal(partial.purpose.state, 'unknown');
  assert.equal(partial.purpose.reason, 'insufficient_evidence');
});

// ---- recommendations ----
test('high sensitivity alone never recommends revoking, and never implies maliciousness', () => {
  const r = analyzeRecord(scopes('x', 'mail.google.com'));
  assert.equal(level(r), 'high');
  assert.equal(r.recommendation.action, 'review_access');
  assert.doesNotMatch(allText(r), /malicious|dangerous|unsafe|steal|suspicious|attack/i);
});

test('recommendation rules', () => {
  const base = scopes('x', 'gmail.readonly');
  assert.equal(analyzeRecord(base, { stillNeeded: 'no' }).recommendation.action, 'consider_revoking');
  assert.equal(analyzeRecord(base, { monthsUnused: 12 }).recommendation.action, 'verify_needed');
  assert.equal(analyzeRecord(base, { monthsUnused: 12, stillNeeded: 'yes' }).recommendation.action, 'review_access');
  assert.equal(analyzeRecord(base, { purpose: 'signin' }).recommendation.action, 'investigate_mismatch');
  assert.equal(analyzeRecord(scopes('x', 'email')).recommendation.action, 'no_action_indicated');
});

// ---- explanations contain no unsupported claims ----
test('explanations never mention capabilities that are not in the evidence', () => {
  const mail = allText(analyzeRecord(scopes('x', 'gmail.readonly')));
  assert.doesNotMatch(mail, /\b(send|delete|change)\b/i);
  const drive = allText(analyzeRecord(scopes('x', 'drive.readonly')));
  assert.doesNotMatch(drive, /\b(delete|change|send)\b/i);
  const cal = allText(analyzeRecord(scopes('x', 'calendar.readonly')));
  assert.doesNotMatch(cal, /\b(delete|change|send)\b/i);
  assert.doesNotMatch(cal, /gmail|drive/i);
});

test('every finding carries its evidence and rule', () => {
  const e = explain(analyzeRecord(rec('E', 'e1', access('See and download all your Google Drive files'))));
  assert.equal(e.findings.length, 1);
  assert.equal(e.findings[0].rule, 'S08');
  assert.deepEqual(e.findings[0].evidence, ['See and download all your Google Drive files']);
});

// ---- determinism and privacy ----
test('results are identical across repeated runs', () => {
  const input = [rec('A', 'a1', access('See your contacts')), rec('B', 'b1', access('Read, compose, and send emails from your Gmail account')), scopes('C', 'drive')];
  assert.deepEqual(JSON.stringify(analyzeAll(input)), JSON.stringify(analyzeAll(input)));
});

test('source contains no network calls or telemetry', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const files = [
    ...readdirSync(path.join(root, 'core')).map((f) => path.join(root, 'core', f)),
    ...['background.js', 'popup.js', 'results.js'].map((f) => path.join(root, 'extension', f))
  ];
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|navigator\.sendBeacon|gtag|analytics/i, f);
});

// ---- regressions found while checking the rendered UI ----
test('unknown permission ID is not labelled as verified evidence', () => {
  const r = analyzeRecord(scopes('x', 'foo.bar'));
  assert.ok(!r.confidence.basis.includes('verified_scope_id'));
  assert.match(explain(r).findings[0].source, /not in our reference list/);
});

test('headline lists the most sensitive access first', () => {
  const r = analyzeRecord(scopes('x', 'email', 'calendar.readonly', 'gmail.readonly'));
  const h = explain(r).headline;
  assert.ok(h.indexOf('Gmail') < h.indexOf('Calendar'), h);
  assert.ok(h.indexOf('Calendar') < h.indexOf('profile info'), h);
});
