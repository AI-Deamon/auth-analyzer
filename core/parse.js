// Parsing / normalisation of an extracted record. No capability or risk logic lives here.
// All assumptions about Google's page layout are isolated in EXTRACTION_CONFIG so they are easy to update.
//
// Real detail-page layout (from exported reports, Oct 2026), in document order:
//   heading "Keep track of your Google Account data"       -> page chrome
//   heading "How Google helps you sign in to <App>"         -> SIGN-IN section: "Sign in with Google" label, an explainer sentence,
//                                                              icon text (e.g. account_circle) and "See your profile info"
//   heading "<App> has some access to your Google Account"  -> ACCESS section: an explainer sentence, icon text (e.g. pentagon),
//                                                              the permission lines, and an optional "+N more" link
//   "See something suspicious?"                             -> footer
// The headings are the section boundaries. The explainer sentences are kept as a fallback in case the headings change.
import { describeLine } from './describe.js';
import { lookupScope } from './registry.js';

export const EXTRACTION_CONFIG = {
  signInMarker: /^when you use sign in with google to sign in to your .+ account/i,
  accessMarker: /^to use some .+ features, you gave .+ some access to your google account/i,
  footerMarker: /^see something suspicious\?/i,
  // Known page boilerplate that is NOT a permission, observed in real reports: a sub-heading such as
  // "<App> has some access to your Google Account". Kept (shown in details), never counted as an unknown permission.
  // Deliberately narrow: only this exact shape, so permission wording can never be swallowed by it.
  // The text before "has some access" must be the app's own name (or, if the name is unknown, a short phrase with no
  // sentence punctuation and no permission verb), so permission-like text can never be swallowed.
  boilerplate: /^(.{1,120}) has (some )?access to your google account\.?$/i,
  // Real headings (exported report, Oct 2026): "How Google helps you sign in to <App>" opens the sign-in section and
  // "<App> has some access to your Google Account" opens the access section. "Keep track of your Google Account data"
  // is page chrome. The explainer sentences above remain as a fallback if the headings change.
  signInHeading: /^how google helps you sign in to /i,
  accessHeading: /(has (some )?access to your (google )?account|access to your (google )?account|permissions?)/i,
  knownHeadings: [/^keep track of your google account data$/i],
  // Exact label lines inside the sign-in section (seen on 99 of 103 real records). Known text, not a permission.
  knownLines: [/^sign in with google$/i],
  // A collapsed list ("+1 more", "+4 more"): permissions exist on the page that were not shown. Never chrome.
  collapsed: /^\+\s*(\d+)\s+more$/i,
  chrome: /^(remove access|revoke access|learn more|see details|view details|back|close|cancel|help|send feedback|privacy policy|terms( of service)?|manage|done|got it|more|show more|show less)$/i,
  // Icon fonts render their ligature NAME as text (e.g. "account_circle", "pentagon"). Real text starts with a capital or has spaces.
  iconText: /^[a-z][a-z0-9_]*$/,
  metadata: /^(has access since|access (granted|since)|added|last (used|accessed)|since)\b|^[A-Za-z]+ \d{1,2}, \d{4}$|^\d{1,2} [A-Za-z]+ \d{4}$/i,
  maxLineLength: 300,
  idFromHref: /\/linkedapps\/overview\/([^/?#]+)/
};

export function idFromHref(href) {
  const m = String(href ?? '').match(EXTRACTION_CONFIG.idFromHref);
  return m ? m[1] : null;
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function isBoilerplate(text, appName) {
  const m = text.match(EXTRACTION_CONFIG.boilerplate);
  if (!m) return false;
  const prefix = m[1].trim();
  const name = String(appName ?? '').trim();
  if (name && name !== 'Unnamed app') return prefix.toLowerCase() === name.toLowerCase();
  return !/[.,;:!?]/.test(prefix) && !/^(see|view|read|edit|manage|send|delete|create|upload|download|share|compose|connect|report)\b/i.test(prefix);
}

// mode: pre | signin | access | footer
function classifyItem(item, { mode, appName }) {
  const text = clean(item?.text);
  if (!text) return null;
  const tag = item?.tag || 'text';
  const C = EXTRACTION_CONFIG;
  const more = text.match(C.collapsed);
  if (more) return { text, kind: 'collapsed', count: Number(more[1]), tag };
  if (C.signInMarker.test(text)) return { text, kind: 'marker', marker: 'signin', tag };
  if (C.accessMarker.test(text)) return { text, kind: 'marker', marker: 'access', tag };
  if (C.footerMarker.test(text)) return { text, kind: 'marker', marker: 'footer', tag };
  if (isBoilerplate(text, appName) || C.knownLines.some((re) => re.test(text))) return { text, kind: 'boilerplate', tag };
  if (tag === 'button' || tag === 'a' || C.chrome.test(text) || C.iconText.test(text)) return { text, kind: 'chrome', tag };
  if (C.metadata.test(text)) return { text, kind: 'metadata', tag };
  const inAccess = mode === 'access' || mode === 'signin';
  const d = describeLine(text, { appName });
  if (d.matched && text.length <= C.maxLineLength) {
    return { text, kind: 'description', tag, mode, capabilities: d.capabilities, ambiguous: d.ambiguous, readOnlyHint: d.readOnlyHint, outsideAccessSection: !inAccess };
  }
  // Unmatched text inside the sign-in/access sections might be permission text we do not understand. Never drop it silently.
  return inAccess ? { text: text.slice(0, C.maxLineLength), kind: 'unrecognised', tag, mode, truncated: text.length > C.maxLineLength } : { text, kind: 'outside', tag };
}

// raw: { href?, name?, nameSource?, error?, extraction?:{ title,h1,sections:[{heading,items:[{text,tag}]}], mainLines? } }
//   or { name, scopeIds: [...] } for verified scope-ID input.
export function normalizeRecord(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const issues = [];
  const ex = r.extraction;
  const name = (typeof r.name === 'string' && r.name.trim()) || (ex && ex.h1 && String(ex.h1).trim()) || null;
  if (!name) issues.push('missing_name');
  if (r.name && ex && ex.h1 && !sameName(r.name, ex.h1)) issues.push('name_mismatch');

  const out = {
    id: r.id || idFromHref(r.href), href: r.href || null, name: name || 'Unnamed app',
    nameSource: r.name ? (r.nameSource || 'list') : ex && ex.h1 ? 'detail_heading' : 'none',
    status: 'ok', issues, items: [], scopeCaps: [], ignored: { chrome: 0, metadata: 0, outside: 0, markers: 0 },
    layout: { signIn: false, access: false }
  };

  // Path A: verified scope identifiers
  if (Array.isArray(r.scopeIds)) {
    for (const rawId of r.scopeIds) {
      const s = lookupScope(rawId);
      if (!s) continue;
      if (s.known) out.scopeCaps.push({ ...s.capability, source: 'scope_id', evidence: [{ kind: 'scope_id', text: s.id, ruleId: 'REG' }] });
      else out.scopeCaps.push({ resource: 'unknown', actions: [], breadth: 'unspecified', source: 'scope_id', evidence: [{ kind: 'scope_id', text: s.id, ruleId: 'REG-UNKNOWN' }] });
    }
    if (!out.scopeCaps.length) { out.status = 'failed'; issues.push('no_scopes'); }
    return out;
  }

  // Path B: extracted page text
  if (r.error) { out.status = 'failed'; issues.push('detail_fetch_failed'); return out; }
  if (!ex) { out.status = 'failed'; issues.push('no_extraction'); return out; }

  // Flatten to document order. Headings are kept as items so nothing is lost.
  const sections = Array.isArray(ex.sections) ? ex.sections : [];
  let stream = [];
  for (const s of sections) {
    if (s && s.heading) stream.push({ text: s.heading, tag: 'heading', headingOf: true });
    for (const it of (s && s.items) || []) stream.push(it);
  }
  if (!stream.length && Array.isArray(ex.mainLines)) { stream = ex.mainLines.map((text) => ({ text })); issues.push('no_structure'); }
  if (!stream.length) { out.status = 'failed'; issues.push('empty_page'); return out; }

  let mode = 'pre';
  out.collapsed = 0;
  const C = EXTRACTION_CONFIG;
  for (const item of stream) {
    // Headings are structure: they open sections. Their text is always kept (never discarded).
    if (item.headingOf) {
      const text = clean(item.text);
      if (!text) continue;
      if (C.signInHeading.test(text)) { mode = 'signin'; out.layout.signIn = true; out.ignored.markers++; out.items.push({ text, kind: 'boilerplate', marker: 'signin_heading', tag: 'heading' }); }
      else if (C.accessHeading.test(text)) { mode = 'access'; out.layout.access = true; out.ignored.markers++; out.items.push({ text, kind: 'boilerplate', marker: 'access_heading', tag: 'heading' }); }
      else {
        mode = 'pre'; // an unrecognised heading ends any open section; permission text under it is flagged as outside
        const known = C.knownHeadings.some((re) => re.test(text));
        out.items.push({ text, kind: known ? 'boilerplate' : 'other', tag: 'heading' });
        if (!known) out.ignored.outside++;
      }
      continue;
    }
    const c = classifyItem(item, { mode, appName: out.name });
    if (!c) continue;
    if (c.kind === 'collapsed') {
      out.collapsed += c.count;
      out.items.push(c);
    } else if (c.kind === 'marker') {
      out.ignored.markers++;
      out.items.push({ text: c.text, kind: 'boilerplate', marker: c.marker, tag: c.tag }); // kept for traceability
      mode = c.marker === 'signin' ? 'signin' : c.marker === 'access' ? 'access' : 'footer';
      if (c.marker === 'signin') out.layout.signIn = true;
      if (c.marker === 'access') out.layout.access = true;
    } else if (c.kind === 'chrome') out.ignored.chrome++;
    else if (c.kind === 'metadata') out.ignored.metadata++;
    else if (c.kind === 'outside') { out.ignored.outside++; out.items.push({ text: c.text, kind: 'other', tag: c.tag }); } // kept, not judged
    else out.items.push(c);
  }
  if (out.collapsed > 0) issues.push('collapsed_access_items');
  absorbDetailPages(out, ex, issues);

  if (!out.layout.signIn && !out.layout.access) {
    out.status = 'partial'; issues.push('no_access_section'); // layout not recognised: do not trust absence of permissions
  }
  if (out.layout.access && !out.items.some((i) => i.mode === 'access')) issues.push('access_section_empty');
  if (out.items.some((i) => i.outsideAccessSection)) { out.status = 'partial'; issues.push('permission_text_outside_access_section'); }
  return out;
}

// ---- "+N more" details pages ----
// The "+N more" link on a real page points to linkedapps/details/<id>, a page that lists the hidden permissions.
// The extractor follows it and stores the result in extraction.followed. These helpers read that page conservatively:
// its layout has not been observed yet, so every unmatched line stays "unrecognised" (never silently safe), and the
// hidden list only counts as resolved if the page yields at least as many NEW permission lines as the link announced.
const DETAILS_PATH = /(^|\/)linkedapps\/details\//;

// Links the extractor may follow: "+N more" anchors that point to a details page on the same site.
export function findDetailsLinks(extraction, max = 2) {
  const base = extraction && extraction.url;
  const out = [];
  for (const s of (extraction && extraction.sections) || []) {
    for (const it of s.items || []) {
      if (it && it.tag === 'a' && EXTRACTION_CONFIG.collapsed.test(clean(it.text)) && DETAILS_PATH.test(String(it.abs || it.href || ''))) {
        try {
          // Prefer the URL the browser already resolved. The raw attribute is site-relative ("linkedapps/details/..."), which
          // must be resolved against the site root: against the detail page it would point at /linkedapps/overview/linkedapps/....
          const raw = String(it.href || '');
          const u = it.abs ? new URL(it.abs) : new URL(raw.startsWith('linkedapps/') ? '/' + raw : raw, base);
          if (u.host === 'myaccount.google.com' && !out.some((o) => o.href === u.href)) out.push({ text: clean(it.text), href: u.href });
        } catch { /* ignore malformed links */ }
      }
    }
  }
  return out.slice(0, max);
}

const norm = (t) => clean(t).toLowerCase();

function absorbDetailPages(out, ex, issues) {
  const followed = Array.isArray(ex && ex.followed) ? ex.followed : [];
  if (!followed.length) return;
  const mainTexts = new Set(out.items.filter((i) => i.kind === 'description').map((i) => norm(i.text)));
  const newTexts = new Set();
  let unreadable = 0, nestedCollapsed = 0, unrecognised = 0;
  const C = EXTRACTION_CONFIG;
  for (const f of followed) {
    const fx = f && f.extraction;
    const sections = fx && Array.isArray(fx.sections) ? fx.sections : [];
    const stream = [];
    for (const s of sections) { if (s && s.heading) stream.push({ text: s.heading, tag: 'heading', headingOf: true }); for (const it of (s && s.items) || []) stream.push(it); }
    if (!stream.length) { unreadable++; continue; }
    let mode = 'access'; // everything on a details page is treated as access text until proven otherwise
    for (const item of stream) {
      if (item.headingOf) {
        const t = clean(item.text);
        out.items.push({ text: t, kind: C.knownHeadings.some((re) => re.test(t)) ? 'boilerplate' : 'other', tag: 'heading', fromDetails: true });
        continue;
      }
      const c = classifyItem(item, { mode, appName: out.name });
      if (!c) continue;
      if (c.kind === 'collapsed') { nestedCollapsed += c.count; out.items.push({ ...c, fromDetails: true }); }
      else if (c.kind === 'chrome') out.ignored.chrome++;
      else if (c.kind === 'metadata') out.ignored.metadata++;
      else if (c.kind === 'marker') out.items.push({ text: c.text, kind: 'boilerplate', marker: c.marker, tag: c.tag, fromDetails: true });
      else if (c.kind === 'outside') out.items.push({ text: c.text, kind: 'other', tag: c.tag, fromDetails: true });
      else {
        out.items.push({ ...c, fromDetails: true });
        if (c.kind === 'unrecognised') unrecognised++;
        if (c.kind === 'description' && !mainTexts.has(norm(c.text))) newTexts.add(norm(c.text));
      }
    }
  }
  if (unreadable) issues.push('details_page_unreadable');
  const resolved = out.collapsed > 0 && !unreadable && !nestedCollapsed && !unrecognised && newTexts.size >= out.collapsed;
  if (resolved) { out.collapsed = 0; issues.push('collapsed_resolved_via_details'); }
  else if (out.collapsed > 0) issues.push('collapsed_details_incomplete');
  else if (nestedCollapsed) out.collapsed += nestedCollapsed;
}

function sameName(a, b) {
  const x = String(a).trim().toLowerCase(), y = String(b).trim().toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}
