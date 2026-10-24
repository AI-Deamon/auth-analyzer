// Fixtures here replicate the REAL page structure from an exported report (Oct 2026), line for line:
// three headings, the "Sign in with Google" label, icon text, "See details", buttons, footer and the collapsed "+N more" link.
// The structure and wording are real; app names and ids are SYNTHETIC. Earlier synthetic fixtures omitted these elements
// and therefore missed regressions (the "Sign in with Google" label, collapsed lists), so these tests exist to prevent that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRecord, analyzeAll, explain } from '../core/index.js';

const T = (text, tag = 'text') => ({ text, tag });
const signInSentence = (n) => T(`When you use Sign in with Google to sign in to your ${n} account, you're sharing some sensitive info with ${n}`);
const accessSentence = (n) => T(`To use some ${n} features, you gave ${n} some access to your Google Account. This access might include sensitive info.`);

// opts: { signIn: bool, access: string[]|null, more: number, crossAccount: bool, headings: 'real'|'renamed'|'none', explainers: bool }
function realPage(name, id, { signIn = true, access = null, more = 0, crossAccount = false, headings = 'real', explainers = true } = {}) {
  const H = (real, renamed) => (headings === 'real' ? real : headings === 'renamed' ? renamed : '');
  const tail = [T('See details'), T('Delete all', 'button'), T(`Remove all links and stop sharing your Google Account data with ${name}`, 'button'), T('See something suspicious?'), T('Report this app', 'a')];
  const sections = [{ heading: 'Keep track of your Google Account data', items: [...(crossAccount ? [T('This app or service is secured by Cross-Account Protection.')] : []), T('Learn more', 'a')] }];
  if (access === null) {
    sections.push({ heading: H(`How Google helps you sign in to ${name}`, `About signing in with ${name}`), items: [T('Sign in with Google'), ...(explainers ? [signInSentence(name)] : []), T('account_circle'), T('See your profile info'), ...tail] });
  } else {
    if (signIn) sections.push({ heading: H(`How Google helps you sign in to ${name}`, `About signing in with ${name}`), items: [T('Sign in with Google'), ...(explainers ? [signInSentence(name)] : []), T('account_circle'), T('See your profile info'), T('See details')] });
    sections.push({
      heading: H(`${name} has some access to your Google Account`, `What ${name} can do`),
      items: [...(explainers ? [accessSentence(name)] : []), T('account_circle'), T('See your profile info'), ...access.flatMap((p) => [T('pentagon'), T(p)]), ...(more ? [T(`+${more} more`, 'a')] : []), ...tail]
    });
  }
  return { name, nameSource: 'list_link_first_line', href: 'https://myaccount.google.com/linkedapps/overview/' + id, extraction: { title: 'Linked app', h1: '', lineCount: 19, sections } };
}

const unrec = (r) => r.evidence.items.filter((i) => i.kind === 'unrecognised');
const status = (r) => explain(r).summary.evidenceStatus;
const CAL = 'See, edit, share and permanently delete all the calendars that you can access using Google Calendar';
const DRV = 'See and download all your Google Drive files';

// ---- the sign-in-only layout (94 of 103 real records) ----
test('real sign-in-only layout: Low, fully understood; the "Sign in with Google" label is known text (regression)', () => {
  const r = analyzeRecord(realPage('Example Sign-in App', 's1', { crossAccount: true }));
  assert.equal(unrec(r).length, 0, JSON.stringify(unrec(r)));
  assert.equal(r.sensitivity.level, 'low');
  assert.equal(status(r), 'All visible access text understood');
  assert.deepEqual(r.capabilities.map((c) => c.resource), ['identity_basic']);
  assert.ok(r.evidence.items.some((i) => i.kind === 'other' && /Cross-Account Protection/.test(i.text)), 'unknown page text is retained, not dropped');
});

// ---- collapsed lists: the defect that made 5 of 10 real access records look complete ----
test('"+N more" means hidden permissions: the record is partial, never "All visible access text understood" (regression)', () => {
  const r = analyzeRecord(realPage('Example Calendar App', 'c1', { access: [CAL], more: 4 }));
  assert.equal(r.evidence.collapsed, 4);
  assert.equal(r.confidence.level, 'partial');
  assert.ok(r.confidence.gaps.includes('collapsed_access_items'));
  const e = explain(r);
  assert.equal(e.summary.evidenceStatus, 'Partly understood');
  assert.match(e.summary.evidenceNote, /4 permissions hidden behind a "\+4 more" link/);
  assert.match(e.summary.nextStep, /click "\+4 more"/);
  assert.ok(r.evidence.items.some((i) => i.kind === 'collapsed' && i.count === 4), 'the link is evidence, not chrome');
  assert.equal(r.extraction.ignored.chrome > 0, true);
});

test('control: identical record without the collapsed link is complete (so the link is what changes the result)', () => {
  const withMore = analyzeRecord(realPage('Example Calendar App', 'c2', { access: [CAL], more: 1 }));
  const without = analyzeRecord(realPage('Example Calendar App', 'c3', { access: [CAL] }));
  assert.equal(status(without), 'All visible access text understood');
  assert.equal(status(withMore), 'Partly understood');
  assert.deepEqual(withMore.capabilities.map((c) => [c.resource, c.actions, c.breadth]), without.capabilities.map((c) => [c.resource, c.actions, c.breadth]));
  assert.equal(without.sensitivity.lowerBound, false);
});

test('a collapsed list on a low-sensitivity record is a lower bound and never "no action needed"', () => {
  const r = analyzeRecord(realPage('Example App', 'c4', { access: [], more: 2 }));
  assert.equal(r.sensitivity.level, 'low');
  assert.equal(r.sensitivity.lowerBound, true);
  assert.doesNotMatch(explain(r).summary.nextStep, /No action needed/);
});

// ---- nothing is silently lost ----
test('every input line is either evidence or counted: headings are retained (regression: the access heading was consumed)', () => {
  for (const rec of [realPage('A', 'a1', { access: [CAL, DRV], more: 1, crossAccount: true }), realPage('B', 'a2', { crossAccount: true }), realPage('C', 'a3', { access: [DRV], signIn: false })]) {
    const r = analyzeRecord(rec);
    const input = rec.extraction.sections.reduce((n, s) => n + (s.heading ? 1 : 0) + s.items.length, 0);
    assert.equal(r.evidence.items.length + r.extraction.ignored.chrome + r.extraction.ignored.metadata, input, rec.name);
    assert.ok(r.evidence.items.some((i) => i.marker === 'access_heading') === (rec.extraction.sections.length > 2 || !rec.extraction.sections.some((s) => /How Google helps/.test(s.heading))));
  }
});

// ---- empty or missing sections must not look reassuring ----
test('an access section that lists nothing is not falsely reassuring (verified edge case)', () => {
  const rec = realPage('Example App', 'e1', { access: [] });
  rec.extraction.sections[rec.extraction.sections.length - 1].items = rec.extraction.sections[rec.extraction.sections.length - 1].items.filter((i) => i.text !== 'See your profile info' && i.text !== 'account_circle');
  const r = analyzeRecord(rec);
  assert.ok(r.extraction.issues.includes('access_section_empty'));
  assert.equal(r.confidence.level, 'partial');
  assert.notEqual(status(r), 'All visible access text understood');
  assert.match(explain(r).summary.nextStep, /listed nothing|check what it can access/);
});

// ---- formatting changes ----
test('renamed headings: the explainer sentences still give the same capabilities', () => {
  const real = analyzeRecord(realPage('Example Drive App', 'f1', { access: [DRV] }));
  const renamed = analyzeRecord(realPage('Example Drive App', 'f2', { access: [DRV], headings: 'renamed' }));
  const sig = (r) => JSON.stringify(r.capabilities.map((c) => [c.resource, c.actions, c.breadth, c.sensitivity.level]));
  assert.equal(sig(renamed), sig(real));
  assert.equal(renamed.confidence.level, 'described');
});

test('headings AND explainers changed: permission text is still found but flagged, and an empty result is Unknown, never Low', () => {
  const withPerm = analyzeRecord(realPage('Example Drive App', 'g1', { access: [DRV], headings: 'none', explainers: false }));
  assert.equal(withPerm.sensitivity.level, 'high');
  assert.equal(withPerm.confidence.level, 'partial');
  const none = analyzeRecord(realPage('Example App', 'g2', { headings: 'none', explainers: false }));
  assert.equal(none.sensitivity.lowerBound, true, 'a low result on an unrecognised layout is only a lower bound');
  assert.notEqual(none.confidence.level, 'described');
});

// ---- identity, invariance, adjacency ----
test('same display name with different ids stays separate, and permissions never cross records', () => {
  const res = analyzeAll([realPage('Example Mail', 'd1', { access: ['Read, compose and send emails from your Gmail account'] }), realPage('Example Mail', 'd2')]);
  assert.equal(res.length, 2);
  assert.ok(res.every((r) => r.identity.flags.includes('same_name_other_record')));
  const sign = res.find((r) => r.identity.id === 'd2');
  assert.deepEqual(sign.capabilities.map((c) => c.resource), ['identity_basic'], 'the sign-in-only record must not inherit Gmail access');
});

test('renaming the app never changes the classification', () => {
  const sig = (r) => JSON.stringify([r.capabilities.map((c) => [c.resource, c.actions, c.breadth, c.sensitivity.level]), r.confidence.level]);
  for (const perms of [[CAL], [DRV], ['Read, compose and send emails from your Gmail account'], ['Connect itself to your Google Drive']]) {
    assert.equal(sig(analyzeRecord(realPage('Gmail Drive Calendar Pro', 'r1', { access: perms }))), sig(analyzeRecord(realPage('Zed', 'r2', { access: perms }))));
  }
});

// ---- every explanation is supported by the evidence ----
test('summary text only names resources that appear in the capabilities (generic property check)', () => {
  const WORDS = { gmail: /\bgmail\b|\bemails?\b/i, drive: /\bdrive\b|\bfiles\b/i, calendar: /\bcalendar\b|\bevents\b/i, cloud: /\bcloud\b/i, contacts: /\bcontacts\b/i, photos: /\bgoogle photos\b/i }; // "photos" alone is an example of Drive file contents, not a claim of Photos access
  const records = [
    realPage('Zed', 'p1', { access: [CAL] }), realPage('Zed', 'p2', { access: [DRV, 'Connect itself to your Google Drive'] }),
    realPage('Zed', 'p3', { access: ['Read, compose and send emails from your Gmail account'] }), realPage('Zed', 'p4'),
    realPage('Zed', 'p5', { access: ['See, edit, configure and delete your Google Cloud data and see the email address for your Google Account.'] })
  ];
  for (const rec of records) {
    const r = analyzeRecord(rec);
    const s = explain(r).summary;
    const text = [...s.access, s.whyItMatters, s.nextStep].join(' ');
    const present = new Set(r.capabilities.map((c) => c.resource));
    for (const [resource, re] of Object.entries(WORDS)) {
      if (resource === 'gmail' && present.has('identity_basic') && /email address/i.test(text) && !present.has('gmail')) continue; // "email address" is identity wording
      if (re.test(text) && !present.has(resource)) assert.fail(`"${resource}" mentioned without evidence in: ${text}`);
    }
  }
});
