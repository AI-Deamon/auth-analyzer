// Presentation only: turns an analysis result into HTML. Contains no risk logic.
// The card shows four short facts. Everything technical stays available in expandable sections.
import { explain, PURPOSES, accountLabel } from '../core/index.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LV = { high: 'lv5', medium: 'lv3', low: 'lv1', unknown: 'lvu' };
const EV = { 'All visible access text understood': 'lv1', 'Known permission IDs': 'lv1', 'Partly understood': 'lv3', Unknown: 'lvu' };

export const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => '<option value="' + esc(k) + '"' + (String(k) === String(cur) ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
export const purposeOptions = { '': 'Not sure / skip', ...Object.fromEntries(Object.entries(PURPOSES).map(([k, v]) => [k, v.label])) };
export const usedOptions = { '': 'Not sure', 0: 'This month', 3: '1-6 months ago', 6: '6-12 months ago', 12: 'Over a year ago' };
export const neededOptions = { '': 'Not sure', yes: 'Yes', no: 'No' };

// prefs: { purpose, monthsUnused, stillNeeded } the user has chosen for this record (all optional).
export function cardHtml(r, key, prefs = {}, { showControls = true, showAccount = false } = {}) {
  const e = explain(r);
  const s = e.summary;
  const findings = e.findings.map((f) =>
    '<li><span class="pill ' + LV[f.level] + '">' + esc(f.level) + '</span> ' + esc(f.sentence) + (f.could ? ' <span class="mute">' + esc(f.could) + '</span>' : '') +
    '<div class="mute">Rule ' + esc(f.rule) + ': ' + esc(f.why) + ' Source: ' + esc(f.source) + '.</div>' +
    '<pre>' + esc(f.evidence.join('\n')) + '</pre></li>').join('');
  const unrecognised = r.evidence.items.filter((i) => i.kind === 'unrecognised');
  const known = r.evidence.items.filter((i) => i.kind === 'boilerplate');
  const other = r.evidence.items.filter((i) => i.kind === 'other');
  const manage = r.identity.href && r.recommendation.action !== 'no_action_indicated';
  return '<div class="card"><div class="top"><div class="score ' + LV[r.sensitivity.level] + '" style="border-radius:10px;width:auto;padding:0 12px;height:34px;font-size:13px">' + esc(e.sensitivityLabel) + '</div>' +
    '<b>' + esc(r.identity.name) + '</b>' + (showAccount && r.identity.account ? ' <span class="mute">' + esc(accountLabel(r.identity.account)) + '</span>' : '') + '</div>' +
    '<dl class="sum">' +
    '<dt>Access</dt><dd><ul>' + s.access.map((a) => '<li>' + esc(a) + '</li>').join('') + (s.moreAccess ? '<li class="mute">and ' + s.moreAccess + ' more (see details)</li>' : '') + '</ul></dd>' +
    '<dt>Why it matters</dt><dd>' + esc(s.whyItMatters) + '</dd>' +
    '<dt>Next step</dt><dd>' + esc(s.nextStep) + '</dd>' +
    '<dt>Evidence status</dt><dd><span class="pill ' + EV[s.evidenceStatus] + '" style="min-width:0">' + esc(s.evidenceStatus) + '</span> <span class="mute">' + esc(s.evidenceNote) + '</span></dd>' +
    '</dl>' +
    (manage ? '<a class="btn" target="_blank" rel="noopener noreferrer" href="' + esc(r.identity.href) + '">Open in Google to manage access</a>' : '') +
    '<details><summary>Evidence and technical details</summary>' +
    '<div class="tags"><span>' + esc(e.confidenceLabel) + '</span><span>Purpose: ' + esc(e.purposeLabel) + '</span><span>' + esc(e.actionLabel) + '</span></div>' +
    (findings ? '<ul>' + findings + '</ul>' : '') +
    '<ul class="mute lim">' + e.limitations.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' +
    (unrecognised.length ? '<b>Text we did not understand (' + unrecognised.length + ')</b><pre>' + esc(unrecognised.map((i) => i.text).join('\n')) + '</pre>' : '') +
    (other.length ? '<b>Other page text (kept, not judged)</b><pre>' + esc(other.map((i) => i.text).join('\n')) + '</pre>' : '') +
    (known.length ? '<b>Known page text (not a permission)</b><pre>' + esc(known.map((i) => i.text).join('\n')) + '</pre>' : '') +
    '<b>Extraction</b><pre>' + esc(JSON.stringify({ status: r.extraction.status, issues: r.extraction.issues, ignored: r.extraction.ignored, layout: r.extraction.layout, id: r.identity.id, flags: r.identity.flags, rules: r.capabilities.map((c) => c.sensitivity.ruleId) }, null, 1)) + '</pre>' +
    (showControls ? '<div class="ctl"><label>What it does: <select data-k="' + esc(key) + '" data-f="purpose">' + opts(purposeOptions, prefs.purpose || '') + '</select></label>' +
      '<label>Last used: <select data-k="' + esc(key) + '" data-f="monthsUnused">' + opts(usedOptions, prefs.monthsUnused ?? '') + '</select></label>' +
      '<label>Still need it? <select data-k="' + esc(key) + '" data-f="stillNeeded">' + opts(neededOptions, prefs.stillNeeded || '') + '</select></label></div>' : '') +
    '</details></div>';
}

export const contextFromPrefs = (p = {}) => ({
  purpose: p.purpose || undefined,
  monthsUnused: p.monthsUnused === '' || p.monthsUnused == null ? undefined : Number(p.monthsUnused),
  stillNeeded: p.stillNeeded || undefined
});
