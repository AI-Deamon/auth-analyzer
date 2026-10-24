import { analyzeAll, buildReport, accountLabel, RULES_VERSION } from './core/index.js';
import { cardHtml, contextFromPrefs, esc } from './ui/card.js';

const $ = (id) => document.getElementById(id);
let records = [], prefs = {}, scanView = null, viewAttempt = null, scanErrors = [], acctFilter = '';
const acctText = (r) => (r.identity.account ? accountLabel(r.identity.account) : '');
const prefFor = (key, raw) => prefs[key] || (raw && prefs[raw.href]) || (raw && prefs[raw.id]) || undefined; // older scans keyed prefs by href
const ERROR_TEXT = { not_signed_in: 'was not signed in', account_not_verified: 'could not be verified (its email was not shown on the page), so it was skipped', account_mismatch: 'showed a different account than expected, so it was skipped', no_apps_found: 'showed no connected apps' };

function render() {
  const results = analyzeAll(records, (key, raw) => contextFromPrefs(prefFor(key, raw)));
  const accts = [...new Set(results.map(acctText).filter(Boolean))];
  const sel = $('acct');
  sel.hidden = accts.length < 2;
  if (accts.length > 1) { sel.innerHTML = '<option value="">All accounts (' + results.length + ')</option>' + accts.map((a) => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join(''); sel.value = accts.includes(acctFilter) ? acctFilter : ''; acctFilter = sel.value; }
  const shown = acctFilter ? results.filter((r) => acctText(r) === acctFilter) : results;
  $('out').innerHTML = shown.map((r) => cardHtml(r, r.identity.key, prefFor(r.identity.key, r.identity), { showAccount: accts.length > 1 })).join('') || '<div class="card">No scan results yet. Use the toolbar button to scan.</div>';
  $('rules').textContent = 'Rules ' + RULES_VERSION;
  $('errors').innerHTML = scanErrors.length ? '<div class="banner"><b>Some accounts were not scanned.</b><ul>' + scanErrors.map((e) => '<li>' + esc(e.account) + ' ' + esc(ERROR_TEXT[e.reason] || e.reason) + (e.sawEmail ? ' (page showed ' + esc(e.sawEmail) + ')' : '') + '.</li>').join('') + '</ul></div>' : '';
  $('banner').innerHTML = scanView === 'all' && records.length ? '<div class="banner">All ' + records.length + ' connected records were scanned, including apps that only use Sign in with Google (the "Access to" view could not be selected' + (viewAttempt ? '; dropdown found: ' + viewAttempt.dropdownFound + ', option found: ' + viewAttempt.optionFound + ', apps after switching: ' + viewAttempt.accessCount : '') + '). Apps are sorted with the most sensitive first.</div>' : '';
}

$('acct').addEventListener('change', (e) => { acctFilter = e.target.value; render(); });

$('out').addEventListener('change', (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.f) return;
  prefs[t.dataset.k] = { ...prefs[t.dataset.k], [t.dataset.f]: t.value };
  chrome.storage.local.set({ prefs });
  render();
});

function download(redactNames) {
  const results = analyzeAll(records, (key, raw) => contextFromPrefs(prefFor(key, raw)));
  const report = buildReport(records, results, { generatedAt: new Date().toISOString(), view: scanView, viewAttempt, redactNames });
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'auth-analyzer-report' + (redactNames ? '-redacted' : '') + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').addEventListener('click', () => download(false));
$('exportR').addEventListener('click', () => download(true));

$('clear').addEventListener('click', () => {
  if (!confirm('Delete the saved scan and your answers from this browser?')) return;
  chrome.storage.local.remove(['records', 'prefs', 'scannedAt', 'debug', 'scan', 'view', 'viewAttempt', 'scanErrors', 'scannedAccounts', 'views', 'accounts', 'selectedAccounts'], () => { records = []; prefs = {}; scanErrors = []; $('meta').textContent = ''; render(); });
});

chrome.storage.local.get(['records', 'prefs', 'scannedAt', 'debug', 'view', 'viewAttempt', 'scanErrors'], (d) => {
  records = d.records || []; prefs = d.prefs || {}; scanView = d.view || null; viewAttempt = d.viewAttempt || null; scanErrors = d.scanErrors || [];
  $('meta').textContent = d.scannedAt ? 'Scanned ' + new Date(d.scannedAt).toLocaleString() + ': ' + records.length + ' records. Data stays in this browser.' : '';
  render();
  if (d.debug) $('dbg').innerHTML = '<div class="card"><b>Diagnostics</b><p class="mute">The scanner found no apps. Page: ' + esc(d.debug.url) + '</p><details open><summary>Elements seen</summary><pre>' + esc((d.debug.sample || []).join('\n')) + '</pre></details><details><summary>Page text</summary><pre>' + esc((d.debug.text || []).join('\n')) + '</pre></details></div>';
});
