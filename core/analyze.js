// Pipeline: raw extracted record -> normalise -> capabilities -> sensitivity -> purpose -> confidence -> recommendation.
// Pure and deterministic: no network, no storage, no DOM. Presentation text lives in explain.js.
import { RULES_VERSION } from './registry.js';
import { normalizeRecord } from './parse.js';
import { classifyCapability, overallSensitivity, sensitivityRank } from './sensitivity.js';
import { evaluatePurpose } from './purpose.js';
import { evaluateConfidence } from './confidence.js';
import { recommend } from './recommend.js';

const WRITEISH = ['write', 'send', 'delete'];

function mergeCapabilities(list) {
  const map = new Map();
  for (const c of list) {
    const key = c.resource + '|' + c.breadth;
    const m = map.get(key);
    if (!m) map.set(key, { resource: c.resource, breadth: c.breadth, actions: [...c.actions], sources: [c.source], evidence: [...c.evidence], ambiguous: !!c.ambiguous, adminKinds: [...(c.adminKinds || [])] });
    else {
      for (const a of c.actions) if (!m.actions.includes(a)) m.actions.push(a);
      if (!m.sources.includes(c.source)) m.sources.push(c.source);
      m.evidence.push(...c.evidence);
      m.ambiguous = m.ambiguous || !!c.ambiguous;
      for (const k of c.adminKinds || []) if (!m.adminKinds.includes(k)) m.adminKinds.push(k);
    }
  }
  // A line split into clauses, or a line seen twice, must not appear twice as evidence.
  const uniq = (ev) => ev.filter((e, i) => ev.findIndex((x) => x.kind === e.kind && x.text === e.text) === i);
  return [...map.values()].map((m) => ({ ...m, evidence: uniq(m.evidence), source: m.sources.every((s) => s === 'scope_id') ? 'scope_id' : 'description' }));
}

// "read-only" wording next to the ability to change/send/delete the same resource.
function hasConflict(items) {
  for (const it of items) {
    if (it.kind !== 'description' || !it.readOnlyHint) continue;
    for (const cap of it.capabilities) {
      if (cap.actions.some((a) => WRITEISH.includes(a))) return true;
      for (const other of items) {
        if (other === it || other.kind !== 'description') continue;
        if (other.capabilities.some((o) => o.resource === cap.resource && o.actions.some((a) => WRITEISH.includes(a)))) return true;
      }
    }
  }
  return false;
}

// context: { purpose?, monthsUnused?, stillNeeded? } all supplied by the user, all optional.
export function analyzeRecord(raw, context = {}) {
  const n = normalizeRecord(raw);
  const descCaps = n.items.filter((i) => i.kind === 'description').flatMap((i) => i.capabilities.map((c) => ({ ...c, ambiguous: i.ambiguous })));
  const capabilities = mergeCapabilities([...n.scopeCaps, ...descCaps]).map((c) => ({ ...c, sensitivity: classifyCapability(c) }));

  const unrecognised = n.items.filter((i) => i.kind === 'unrecognised').length;
  const ambiguous = capabilities.filter((c) => c.ambiguous).length;
  const unknownResources = capabilities.filter((c) => c.resource === 'unknown').length;
  const confidence = evaluateConfidence({ capabilities, unrecognised, ambiguous, extractionStatus: n.status, unknownResources, collapsed: n.collapsed || 0, accessEmpty: n.issues.includes('access_section_empty') });
  const incomplete = confidence.level === 'partial' || confidence.level === 'insufficient';

  const sensitivity = overallSensitivity(capabilities, { incomplete });
  const purpose = evaluatePurpose(capabilities, { purpose: context.purpose, incomplete, conflicting: hasConflict(n.items) });
  const recommendation = recommend({ sensitivity, purpose, confidence, context });

  return {
    rulesVersion: RULES_VERSION,
    identity: { id: n.id, name: n.name, href: n.href, nameSource: n.nameSource, duplicateCount: 1, flags: [], account: normaliseAccount(raw), key: recordKey(raw) },
    extraction: { status: n.status, issues: n.issues, ignored: n.ignored },
    evidence: { items: n.items.map(({ text, kind, ambiguous: amb, truncated, outsideAccessSection, count, marker, fromDetails }) => ({ text, kind, ambiguous: !!amb, truncated: !!truncated, outsideAccessSection: !!outsideAccessSection, ...(count ? { count } : {}), ...(marker ? { marker } : {}), ...(fromDetails ? { fromDetails: true } : {}) })), collapsed: n.collapsed || 0 },
    capabilities, sensitivity, purpose, confidence, recommendation,
    context: { purpose: context.purpose || null, monthsUnused: context.monthsUnused ?? null, stillNeeded: context.stillNeeded || null }
  };
}

// An app id is only meaningful inside one account, so identity is always (account, id).
const accountOf = (r) => (r && r.account && (r.account.email || 'i:' + r.account.authuser)) || '';
function normaliseAccount(raw) { const a = raw && raw.account; return a && typeof a === 'object' ? { authuser: Number.isInteger(a.authuser) ? a.authuser : null, email: a.email || null, name: a.name || null } : null; }
function recordKey(raw) { return raw ? (raw.key || [accountOf(raw), raw.href || raw.id || raw.name].filter(Boolean).join('|')) : ''; }

const signature = (r) => JSON.stringify(r.capabilities.map((c) => [c.resource, c.breadth, [...c.actions].sort()]).sort()) + '|' + r.confidence.level;

// Analyse a list of records without ever merging by display name alone.
export function analyzeAll(rawRecords, contextFor = () => ({})) {
  const out = [];
  const byId = new Map();
  for (const raw of rawRecords || []) {
    const keyForCtx = recordKey(raw);
    const res = analyzeRecord(raw, contextFor(keyForCtx, raw) || {});
    const id = res.identity.id ? accountOf(raw) + '|' + res.identity.id : null;
    if (id && byId.has(id)) {
      const first = byId.get(id);
      if (signature(first) === signature(res)) { first.identity.duplicateCount++; continue; } // same authorization seen twice
      first.identity.flags.push('conflicting_duplicate');
      res.identity.flags.push('conflicting_duplicate');
    } else if (id) byId.set(id, res);
    out.push(res);
  }
  // Same display name is NOT the same authorization. Keep apart and say the relationship is uncertain.
  const byName = new Map();
  for (const r of out) { const k = (r.identity.account ? (r.identity.account.email || r.identity.account.authuser) : '') + '|' + r.identity.name.trim().toLowerCase(); byName.set(k, [...(byName.get(k) || []), r]); }
  for (const group of byName.values()) if (group.length > 1) for (const r of group) r.identity.flags.push('same_name_other_record');
  return out.sort((a, b) => sortRank(b) - sortRank(a) || a.identity.name.localeCompare(b.identity.name));
}

// unknown sorts just below high: it must not hide among the low-risk results.
function sortRank(r) { return r.sensitivity.level === 'unknown' ? 2.5 : sensitivityRank(r.sensitivity.level) + (r.sensitivity.lowerBound ? 0.25 : 0); }
