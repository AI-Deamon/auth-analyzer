// Builds a reproducible report: the raw extraction (input format) plus the analysis it produced.
// Re-running analyzeRecord on report.records[i].input must reproduce report.records[i].analysis.
// Pure function; the caller decides what to do with the result (the UI offers a local file download).
import { RULES_VERSION } from './registry.js';

const swap = (s, from, to) => (typeof s === 'string' && from ? s.split(from).join(to) : s);

function redactDeep(value, names) {
  if (typeof value === 'string') return names.reduce((acc, [from, to]) => swap(acc, from, to), value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, names));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, names)]));
  return value;
}

// inputs: raw records as scanned. results: analyzeAll output (same records, possibly reordered/collapsed).
export function buildReport(inputs, results, { generatedAt = null, view = null, viewAttempt = null, redactNames = false } = {}) {
  const byKey = new Map();
  for (const raw of inputs) byKey.set(raw.key || raw.href || raw.id || raw.name, raw);
  const names = redactNames ? [...new Set(inputs.map((r) => r && r.name).filter((n) => typeof n === 'string' && n.length >= 3))].sort((a, b) => b.length - a.length).map((n, i) => [n, 'App ' + (i + 1)]) : [];
  const accounts = redactNames ? [...new Set(inputs.flatMap((r) => (r && r.account ? [r.account.email, r.account.name] : [])).filter((s) => typeof s === 'string' && s.length >= 3))].sort((a, b) => b.length - a.length).map((s, i) => [s, 'Account ' + (i + 1)]) : [];
  const hide = [...accounts, ...names]; // account emails first so an email is never partly replaced by an app name
  const records = results.map((res) => {
    const input = byKey.get(res.identity.key) || byKey.get(res.identity.href || res.identity.id || res.identity.name) || null;
    const entry = {
      input,
      analysis: {
        id: res.identity.id, name: res.identity.name, account: res.identity.account, flags: res.identity.flags, duplicateCount: res.identity.duplicateCount,
        sensitivity: res.sensitivity, confidence: res.confidence, purpose: { state: res.purpose.state, reason: res.purpose.reason },
        recommendation: res.recommendation,
        extraction: res.extraction,
        capabilities: res.capabilities.map((c) => ({ resource: c.resource, actions: c.actions, breadth: c.breadth, source: c.source, level: c.sensitivity.level, rule: c.sensitivity.ruleId, evidence: c.evidence.map((e) => e.text) })),
        unrecognised: res.evidence.items.filter((i) => i.kind === 'unrecognised').map((i) => i.text),
        collapsed: res.evidence.collapsed || 0
      }
    };
    return redactNames ? redactDeep(entry, hide) : entry;
  });
  const count = (f) => results.filter(f).length;
  return {
    format: 'auth-analyzer-report', formatVersion: 1, rulesVersion: RULES_VERSION, generatedAt, view, viewAttempt, redacted: !!redactNames,
    summary: {
      records: results.length,
      sensitivity: { high: count((r) => r.sensitivity.level === 'high'), medium: count((r) => r.sensitivity.level === 'medium'), low: count((r) => r.sensitivity.level === 'low'), unknown: count((r) => r.sensitivity.level === 'unknown') },
      evidence: { understood: count((r) => r.confidence.level === 'verified' || r.confidence.level === 'described'), partial: count((r) => r.confidence.level === 'partial'), insufficient: count((r) => r.confidence.level === 'insufficient') }
    },
    records
  };
}
