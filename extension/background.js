// Scans myaccount.google.com in the user's own logged-in browser. Nothing is sent anywhere.
// This file only EXTRACTS structure from pages. All interpretation happens in core/ (pure, tested).
// Selectors / layout assumptions are isolated in the SELECTORS block below so they are easy to update.
import { findDetailsLinks } from './core/parse.js';
import { MAX_ACCOUNTS, parseAccountLabel, pickAccountLabel, uniqueAccounts, withAuthUser, accountLabel, accountKey, resolveSelection, verifyAccount } from './core/accounts.js';

const LIST_URL = 'https://myaccount.google.com/connections';
let running = false;

const setStatus = (s) => chrome.storage.local.set({ scan: { ...s, updatedAt: Date.now() } });

function waitComplete(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(f); resolve(); };
    const f = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(f);
    setTimeout(done, 20000);
  });
}

async function run(tabId, func) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func });
  return r && r.result;
}

// ---- injected into the page (must be self-contained) ----
async function listExtract() {
  const SELECTORS = { appLinkPath: /^\/linkedapps\/overview\//, viewSwitch: 'li, [role="tab"], [role="menuitem"], button', accessView: /^Access to\b/ };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = () => [...document.querySelectorAll('a[href]')].filter((a) => {
    try { return SELECTORS.appLinkPath.test(new URL(a.href, location.href).pathname); } catch (e) { return false; }
  });
  const collect = () => {
    const seen = new Map();
    for (const a of find()) {
      const href = new URL(a.href, location.href).href;
      const name = (a.getAttribute('aria-label') || a.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean)[0];
      if (name && !seen.has(href)) seen.set(href, { name, href });
    }
    return [...seen.values()];
  };
  const scrollAll = async () => {
    let n = -1;
    for (let i = 0; i < 15 && n !== find().length; i++) { n = find().length; window.scrollTo(0, document.body.scrollHeight); await sleep(600); }
  };
  for (let i = 0; i < 30 && !find().length; i++) await sleep(500);
  await sleep(1500);
  await scrollAll();
  const all = collect();
  // Prefer the "Access to" view: apps that can reach account data, not just sign-in.
  let view = 'all';
  let apps = all;
  // The "View by" control is a dropdown: its options exist in the page but do nothing until it is opened.
  const viewBy = [...document.querySelectorAll('li, button, [role="button"], div')].find((e) => /^View by\b/i.test((e.innerText || '').trim()) && e.innerText.length < 120);
  if (viewBy) { viewBy.click(); await sleep(800); }
  const opt = [...document.querySelectorAll(SELECTORS.viewSwitch)].find((e) => SELECTORS.accessView.test((e.innerText || '').trim()) && e.innerText.length < 200);
  // Diagnostics for the view switch, so a failure can be explained from the exported report.
  const viewAttempt = { dropdownFound: !!viewBy, optionFound: !!opt, optionText: opt ? (opt.innerText || '').replace(/\s+/g, ' ').slice(0, 60) : null, allCount: all.length, accessCount: null,
    // The click found the option but did not filter the list (103 before and after in a real run). Record the element so the cause can be seen.
    optionHtml: opt ? opt.outerHTML.replace(/\s+/g, ' ').slice(0, 300) : null, dropdownHtml: viewBy ? viewBy.outerHTML.replace(/\s+/g, ' ').slice(0, 300) : null };
  if (opt) {
    // A bare <li> has no click handler of its own (seen in a real run), so fire the full event sequence on it and, if the
    // list does not change, on its nearest ancestors. What was tried is recorded so a failure can be diagnosed.
    const fire = (el) => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); };
    const chain = [];
    for (let e = opt, i = 0; e && i < 4; e = e.parentElement, i++) chain.push(e);
    viewAttempt.path = chain.map((e) => e.tagName.toLowerCase() + (e.getAttribute('role') ? '[role=' + e.getAttribute('role') + ']' : '') + (e.hasAttribute('jsaction') ? '[jsaction]' : ''));
    viewAttempt.tried = 0;
    let acc = [];
    for (const target of chain) {
      fire(target);
      viewAttempt.tried++;
      await sleep(1800);
      await scrollAll();
      acc = collect();
      if (acc.length && acc.length < all.length) break;
    }
    viewAttempt.accessCount = acc.length;
    if (acc.length && acc.length < all.length) { apps = acc; view = 'access'; }
  }
  return {
    url: location.href, view, viewAttempt, total: all.length, apps,
    sample: [...document.querySelectorAll('a[href], [role="link"], [role="listitem"], li')].slice(0, 80).map((a) =>
      (a.tagName + ' ' + (a.getAttribute('href') || a.getAttribute('role') || '') + ' | ' + (a.innerText || '').replace(/\s+/g, ' ').slice(0, 60))),
    text: document.body.innerText.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 60)
  };
}

// Returns the page as { heading, items:[{text, tag}] } sections. No interpretation, no full-page text dump.
async function detailExtract() {
  const SELECTORS = {
    root: 'main, [role="main"]',
    heading: 'h1, h2, h3, h4, [role="heading"]',
    block: 'li, [role="listitem"], p, div, section, button, a, span'
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const root = () => document.querySelector(SELECTORS.root) || document.body;
  let last = -1, stable = 0;
  for (let i = 0; i < 24 && stable < 3; i++) {
    const n = root().innerText.length;
    stable = n === last && n > 200 ? stable + 1 : 0;
    last = n;
    await sleep(400);
  }

  // Expand collapsed permission lists ("+1 more", "+4 more"). Only in-page expanders are clicked (no href, or "#"/javascript:),
  // so this never navigates away or changes anything in the account. Anything left collapsed is reported, never assumed empty.
  const isMore = (e) => /^\+\s*\d+\s+more$/i.test((e.innerText || '').trim());
  const expansion = { found: 0, clicked: 0, skippedWithHref: 0 };
  for (let pass = 0; pass < 3; pass++) {
    const els = [...root().querySelectorAll('a, button, [role="button"], [role="link"]')].filter(isMore);
    if (!els.length) break;
    expansion.found = Math.max(expansion.found, els.length);
    let did = 0;
    for (const e of els) {
      const h = e.getAttribute('href');
      if (!h || h.startsWith('#') || h.startsWith('javascript:')) { e.click(); did++; } else expansion.skippedWithHref++;
    }
    expansion.clicked += did;
    if (!did) break;
    await sleep(900);
  }

  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const tagOf = (el) => (el.closest('button, [role="button"]') ? 'button' : el.closest('a') ? 'a' : 'text');
  const sections = [{ heading: '', items: [] }];
  const walker = document.createTreeWalker(root(), NodeFilter.SHOW_TEXT);
  const grouped = new Map(); // innermost block -> text parts (keeps adjacent records from mixing)
  const order = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    const p = n.parentElement;
    if (!t || !p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || !visible(p)) continue;
    const head = p.closest(SELECTORS.heading);
    const block = head || p.closest(SELECTORS.block) || p;
    if (!grouped.has(block)) { const a = p.closest('a'); grouped.set(block, { head: !!head, tag: tagOf(p), href: a ? (a.getAttribute('href') || '').slice(0, 120) : '', abs: a ? a.href : '', parts: [] }); order.push(block); }
    grouped.get(block).parts.push(t);
  }
  for (const b of order) {
    const g = grouped.get(b);
    const text = g.parts.join(' ');
    if (g.head) sections.push({ heading: text, items: [] });
    else sections[sections.length - 1].items.push({ text, tag: g.tag, ...(g.href ? { href: g.href } : {}), ...(g.abs && g.abs.includes('/linkedapps/details/') ? { abs: g.abs } : {}) });
  }
  const real = sections.filter((s) => s.heading || s.items.length);
  const h1El = document.querySelector('h1, [role="heading"][aria-level="1"]');
  const lineCount = root().innerText.split('\n').filter((x) => x.trim()).length;
  const hasHeadings = real.some((s) => s.heading);
  return {
    url: location.href,
    title: document.title,
    h1: h1El ? h1El.innerText.trim() : null,
    expansion,
    sections: hasHeadings ? real : [],
    // Only when no headings were found: a capped copy of the main region so the problem can be diagnosed.
    mainLines: hasHeadings ? undefined : root().innerText.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 120),
    lineCount
  };
}
// ----------------------------------------------------------

// Page-side: labels that carry an account email (the avatar button's aria-label, "Google Account: Name (email)").
async function readAccountLabels() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = () => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') || '').filter((l) => l.includes('@') && l.length < 200);
  for (let i = 0; i < 16 && !read().length; i++) await sleep(500);
  return { url: location.href, labels: read().slice(0, 10) };
}

const ACCOUNT_HOME = 'https://myaccount.google.com/';

async function gotoTab(tabId, url) {
  if (tabId === undefined) tabId = (await chrome.tabs.create({ url, active: true })).id;
  else await chrome.tabs.update(tabId, { url });
  await waitComplete(tabId);
  return tabId;
}

// Finds the Google accounts signed in to this browser by trying authuser=0,1,2,... and reading the email from the page.
async function discoverAccounts() {
  if (running) return;
  running = true;
  let tabId;
  try {
    await setStatus({ state: 'running', message: 'Looking for your signed-in Google accounts...', done: 0, total: 0 });
    const found = [];
    for (let n = 0; n < MAX_ACCOUNTS; n++) {
      tabId = await gotoTab(tabId, withAuthUser(ACCOUNT_HOME, n));
      const t = await chrome.tabs.get(tabId);
      if (!t.url || !t.url.startsWith(ACCOUNT_HOME)) { // sign-in or account chooser page
        if (n === 0) { await setStatus({ state: 'error', message: 'Please sign in to Google in that tab, then press "Find my Google accounts" again.' }); return; }
        break;
      }
      const page = await run(tabId, readAccountLabels);
      const parsed = parseAccountLabel(pickAccountLabel(page && page.labels));
      if (!parsed) break;
      if (found.some((a) => a.email === parsed.email)) break; // Google fell back to an account we already have
      found.push({ authuser: n, ...parsed });
      await setStatus({ state: 'running', message: 'Found ' + found.length + ' account(s)...', done: found.length, total: 0 });
    }
    const accounts = uniqueAccounts(found);
    if (!accounts.length) { await setStatus({ state: 'error', message: 'Could not read any Google account from the page. Sign in, then try again.' }); return; }
    const prev = (await chrome.storage.local.get('selectedAccounts')).selectedAccounts;
    const kept = resolveSelection(accounts, prev);
    await chrome.storage.local.set({ accounts, selectedAccounts: kept.length ? kept : accounts.map(accountKey) });
    await setStatus({ state: 'done', message: 'Found ' + accounts.length + ' account(s). Choose which to scan.', done: accounts.length, total: accounts.length });
  } catch (e) {
    await setStatus({ state: 'error', message: 'Account search failed: ' + e });
  } finally {
    if (tabId !== undefined) chrome.tabs.remove(tabId).catch(() => {});
    running = false;
  }
}

// Scans the accounts the user selected. Each account is verified (its email must be shown on the page) before any app is
// attributed to it, so apps are never filed under the wrong account.
//
// Reliability: Chrome stops idle extension workers, and a scan of ~100 apps takes minutes. So (1) a keep-alive ping runs
// while scanning, (2) progress is saved every few apps, and (3) an interrupted scan can be resumed instead of restarted.
let keepAlive;
const startKeepAlive = () => { stopKeepAlive(); keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000); };
const stopKeepAlive = () => { if (keepAlive) clearInterval(keepAlive); keepAlive = undefined; };
const recKey = (r) => accountKey(r.account || {}) + '|' + r.href;
const SAVE_EVERY = 3;

async function scan(resume = false) {
  if (running) return;
  running = true;
  startKeepAlive();
  let tabId;
  const errors = [];
  let saveState = null;
  try {
    const store = await chrome.storage.local.get(['accounts', 'selectedAccounts', 'partialScan']);
    const accounts = store.accounts || [];
    const part = resume && store.partialScan ? store.partialScan : null;
    if (!part) await chrome.storage.local.remove('partialScan'); // a fresh scan discards any old partial one
    const wanted = new Set(part ? part.accountKeys : (store.selectedAccounts || accounts.map(accountKey)));
    const chosen = accounts.filter((a) => wanted.has(accountKey(a)));
    if (!chosen.length) { await setStatus({ state: 'error', message: 'Choose at least one account to scan.' }); return; }

    const records = part ? part.records : [];
    const views = part ? part.views : {};
    const done = new Set(records.map(recKey));
    saveState = () => chrome.storage.local.set({ partialScan: { accountKeys: chosen.map(accountKey), records, views, savedAt: Date.now() } });
    let sinceSave = 0;

    for (let ai = 0; ai < chosen.length; ai++) {
      const acct = chosen[ai];
      const who = accountLabel(acct);
      const prefix = chosen.length > 1 ? 'Account ' + (ai + 1) + ' of ' + chosen.length + ': ' : '';
      await setStatus({ state: 'running', message: prefix + (part ? 'resuming ' : 'opening ') + who + '...', done: 0, total: 0 });
      tabId = await gotoTab(tabId, withAuthUser(LIST_URL, acct.authuser));
      const t = await chrome.tabs.get(tabId);
      if (!t.url || !t.url.startsWith(LIST_URL)) { errors.push({ account: who, reason: 'not_signed_in' }); continue; }

      const check = verifyAccount(acct, ((await run(tabId, readAccountLabels)) || {}).labels); // never file apps under an account we cannot prove
      if (!check.ok) { errors.push({ account: who, reason: check.reason, ...(check.sawEmail ? { sawEmail: check.sawEmail } : {}) }); continue; }

      const list = await run(tabId, listExtract);
      if (!list || !list.apps.length) { errors.push({ account: who, reason: 'no_apps_found' }); await chrome.storage.local.set({ debug: list || null }); continue; }
      views[acct.email || 'i:' + acct.authuser] = { view: list.view, viewAttempt: list.viewAttempt || null };

      for (let i = 0; i < list.apps.length; i++) {
        const app = list.apps[i];
        const base = { account: { authuser: acct.authuser, email: acct.email || null, name: acct.name || null }, name: app.name, nameSource: 'list_link_first_line', href: app.href };
        if (done.has(recKey(base))) continue; // already read before the interruption
        await setStatus({ state: 'running', message: prefix + 'reading ' + app.name + '...', done: i, total: list.apps.length });
        tabId = await gotoTab(tabId, withAuthUser(app.href, acct.authuser));
        try {
          const extraction = await run(tabId, detailExtract);
          // "+N more" links point to a details page that lists the hidden permissions. Follow them (read-only, same site, same account).
          const followed = [];
          for (const link of findDetailsLinks(extraction)) {
            const shortHref = link.href.replace('https://myaccount.google.com', '');
            try {
              tabId = await gotoTab(tabId, withAuthUser(link.href, acct.authuser));
              followed.push({ from: link.text, href: shortHref, extraction: await run(tabId, detailExtract) });
            } catch (e) {
              followed.push({ from: link.text, href: shortHref, error: String(e) });
            }
          }
          records.push({ ...base, extraction: followed.length ? { ...extraction, followed } : extraction });
        } catch (e) {
          records.push({ ...base, error: String(e) });
        }
        done.add(recKey(base));
        if (++sinceSave >= SAVE_EVERY) { sinceSave = 0; await saveState(); }
      }
    }

    if (!records.length) {
      await chrome.storage.local.set({ scanErrors: errors });
      await setStatus({ state: 'error', message: 'Nothing was scanned: ' + errors.map((e) => e.account + ' (' + e.reason + ')').join(', ') + '.' });
      return;
    }
    const first = Object.values(views)[0] || {};
    await chrome.storage.local.set({
      records, scannedAt: Date.now(), debug: null, scanErrors: errors,
      scannedAccounts: chosen.map(accountKey), views,
      view: Object.values(views).every((v) => v.view === 'access') ? 'access' : 'all', viewAttempt: first.viewAttempt || null
    });
    await chrome.storage.local.remove('partialScan');
    await setStatus({ state: 'done', message: 'Scanned ' + records.length + ' apps in ' + (chosen.length - errors.length) + ' account(s).', done: records.length, total: records.length });
    await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
  } catch (e) {
    if (saveState) await saveState().catch(() => {});
    await setStatus({ state: 'error', message: 'Scan stopped: ' + e + '. Your progress was saved; you can resume.' });
  } finally {
    stopKeepAlive();
    if (tabId !== undefined) chrome.tabs.remove(tabId).catch(() => {});
    running = false;
  }
}

// A worker that is starting has no scan in progress. If storage still says "running", the previous worker was stopped
// mid-scan: say so, instead of leaving the popup locked forever.
chrome.storage.local.get(['scan', 'partialScan'], ({ scan: s, partialScan }) => {
  if (!running && s && s.state === 'running') {
    setStatus({ state: 'error', message: 'The previous scan was interrupted.' + (partialScan ? ' ' + partialScan.records.length + ' apps were saved; you can resume.' : ' Start a new scan.') });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'ping') { sendResponse({ running }); return; }
  if (msg.type === 'scan') scan(!!msg.resume);
  if (msg.type === 'discover') discoverAccounts();
});
