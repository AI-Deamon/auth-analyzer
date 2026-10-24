import { accountKey, accountLabel } from './core/accounts.js';

const $ = (id) => document.getElementById(id);
let accounts = [], selected = new Set(), busy = false, partial = null;

function refreshButtons() {
  $('find').disabled = busy;
  $('find').textContent = accounts.length ? 'Refresh account list' : 'Find my Google accounts';
  $('scan').disabled = busy || selected.size === 0;
  $('resume').hidden = !partial || busy;
  if (partial) $('resume').textContent = 'Resume interrupted scan (' + partial.records.length + ' apps already read)';
  $('scan').textContent = selected.size ? 'Scan ' + selected.size + ' selected account' + (selected.size === 1 ? '' : 's') : 'Scan selected accounts';
}

function renderAccounts() {
  const box = $('accounts');
  box.replaceChildren(...accounts.map((a) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(accountKey(a));
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(accountKey(a)); else selected.delete(accountKey(a));
      chrome.storage.local.set({ selectedAccounts: [...selected] });
      refreshButtons();
    });
    const text = document.createElement('span');
    text.textContent = accountLabel(a); // textContent: account names/emails are never interpreted as HTML
    if (a.name) { const small = document.createElement('small'); small.textContent = a.name; text.append(small); }
    label.append(cb, text);
    return label;
  }));
  refreshButtons();
}

function showStatus(s) {
  if (!s) return;
  $('st').textContent = s.message + (s.state === 'running' && s.total ? ' (' + s.done + '/' + s.total + ')' : '');
  busy = s.state === 'running';
  refreshButtons();
}

chrome.storage.local.get(['accounts', 'selectedAccounts', 'scan', 'partialScan'], (d) => {
  partial = d.partialScan || null;
  accounts = d.accounts || [];
  selected = new Set(d.selectedAccounts || accounts.map(accountKey));
  renderAccounts();
  showStatus(d.scan);
});
chrome.storage.onChanged.addListener((c) => {
  if (c.accounts) {
    accounts = c.accounts.newValue || [];
    const keep = new Set(accounts.map(accountKey));
    selected = new Set([...selected].filter((k) => keep.has(k)));
    if (!selected.size) selected = keep;
    renderAccounts();
  }
  if (c.selectedAccounts && c.selectedAccounts.newValue) selected = new Set(c.selectedAccounts.newValue);
  if (c.partialScan) { partial = c.partialScan.newValue || null; refreshButtons(); }
  if (c.scan) showStatus(c.scan.newValue);
});

// Wake the worker. If the last scan was cut off, the worker marks it interrupted, which unlocks this popup.
chrome.runtime.sendMessage({ type: 'ping' }, () => void chrome.runtime.lastError);

$('find').onclick = () => { chrome.runtime.sendMessage({ type: 'discover' }); showStatus({ state: 'running', message: 'Starting...' }); };
$('scan').onclick = () => { chrome.runtime.sendMessage({ type: 'scan' }); showStatus({ state: 'running', message: 'Starting...' }); };
$('resume').onclick = () => { chrome.runtime.sendMessage({ type: 'scan', resume: true }); showStatus({ state: 'running', message: 'Resuming...' }); };
$('res').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
