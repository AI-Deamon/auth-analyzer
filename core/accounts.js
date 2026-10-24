// Account helpers. Pure functions; no browser APIs, so they are testable and safe to reuse.
// Google serves several signed-in accounts at once and selects one with the "authuser" index (0, 1, 2, ...).
// The index is not a stable identity (it changes if the user signs out of an account), so the email read from the
// page is what identifies an account, and it is re-checked before any app is attributed to it.

export const MAX_ACCOUNTS = 8;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// "Google Account: Jane Doe\n(jane@example.com)"  ->  { email: 'jane@example.com', name: 'Jane Doe' }
export function parseAccountLabel(label) {
  const text = String(label ?? '').replace(/\s+/g, ' ').trim();
  const m = text.match(EMAIL);
  if (!m) return null;
  const name = text.replace(/^google account:?/i, '').replace(m[0], ' ').replace(/[()<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return { email: m[0].toLowerCase(), name: name || null };
}

// Prefer the label that explicitly says "Google Account"; otherwise the first label containing an email.
export function pickAccountLabel(labels) {
  const list = (Array.isArray(labels) ? labels : []).filter((l) => typeof l === 'string' && EMAIL.test(l));
  return list.find((l) => /google account/i.test(l)) || list[0] || null;
}

// Keep the first occurrence of each email (case-insensitive). Accounts without a readable email are kept by index.
export function uniqueAccounts(accounts) {
  const seen = new Set();
  const out = [];
  for (const a of accounts || []) {
    if (!a || !Number.isInteger(a.authuser)) continue;
    const key = a.email ? 'e:' + String(a.email).toLowerCase() : 'i:' + a.authuser;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// Same URL with ?authuser=N, replacing any existing value. Never adds anything else.
export function withAuthUser(url, n) {
  const u = new URL(url);
  u.searchParams.set('authuser', String(n));
  return u.href;
}

export const accountLabel = (a) => (a && (a.email || 'Account ' + (Number.isInteger(a.authuser) ? a.authuser + 1 : '?'))) || 'Unknown account';

// Selected accounts: keep only those still present, in list order. Nothing selected previously = all selected.
export function resolveSelection(accounts, selectedEmails) {
  const list = accounts || [];
  if (!Array.isArray(selectedEmails)) return list.map((a) => a.email || 'i:' + a.authuser);
  const keys = new Set(selectedEmails);
  return list.map((a) => a.email || 'i:' + a.authuser).filter((k) => keys.has(k));
}
export const accountKey = (a) => (a.email || 'i:' + a.authuser);

// Decide whether the page we are looking at belongs to the account we meant to scan.
// Fail safe: if the page does not show an email we cannot prove whose apps these are, so the account is not scanned.
export function verifyAccount(expected, labels) {
  const seen = parseAccountLabel(pickAccountLabel(labels));
  if (!seen) return { ok: false, reason: 'account_not_verified' };
  if (expected && expected.email && seen.email !== String(expected.email).toLowerCase()) return { ok: false, reason: 'account_mismatch', sawEmail: seen.email };
  return { ok: true, seen };
}
