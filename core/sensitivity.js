// Access sensitivity: "what COULD this access expose or allow?" Deterministic, first-match-wins rules.
// Sensitivity is about potential impact only. It says nothing about the app's intent or trustworthiness.

export const LEVELS = ['low', 'medium', 'high']; // plus 'unknown'
const RANK = { low: 1, medium: 2, high: 3 };

const CONTENT = new Set(['gmail', 'drive', 'docs', 'sheets', 'slides', 'photos', 'chat']);
const NARROW = new Set(['app_created', 'app_data', 'selected', 'add_only']);
const has = (c, ...a) => a.some((x) => c.actions.includes(x));

// Each rule: id, level, rationale (shown to users and tests), test(capability)
export const RULES = [
  { id: 'S00', level: 'unknown', rationale: 'The wording does not say what the app can do with this resource.', test: (c) => c.actions.length > 0 && c.actions.every((a) => a === 'unspecified') },
  { id: 'S01', level: 'low', rationale: 'Basic profile details only.', test: (c) => c.resource === 'identity_basic' },
  { id: 'S02', level: 'medium', rationale: 'Personal details such as birthday, address or phone number.', test: (c) => c.resource === 'identity_extended' },
  { id: 'S03', level: 'high', rationale: 'Cloud or organisation-admin access can create, change or remove resources.', test: (c) => c.resource === 'cloud' || c.resource === 'admin_directory' },
  { id: 'S04', level: 'high', rationale: 'Gmail settings can redirect, filter or hide incoming mail.', test: (c) => c.resource === 'gmail_settings' },
  { id: 'S05', level: 'high', rationale: 'Sending or deleting email acts on your behalf or destroys data.', test: (c) => c.resource === 'gmail' && has(c, 'send', 'delete') },
  { id: 'S05b', level: 'low', rationale: 'Lets the app appear as an option inside Drive. No file access is stated.', test: (c) => c.resource === 'drive' && c.breadth === 'app_install' },
  { id: 'S06', level: 'low', rationale: 'Limited to items the app creates, items you choose, or add-only access.', test: (c) => CONTENT.has(c.resource) && NARROW.has(c.breadth) },
  { id: 'S07', level: 'medium', rationale: 'Metadata only: names, dates and counts, not contents.', test: (c) => CONTENT.has(c.resource) && c.breadth === 'metadata' },
  { id: 'S08', level: 'high', rationale: 'Personal content (messages, files, documents, photos) that is not narrowly limited.', test: (c) => CONTENT.has(c.resource) },
  { id: 'S09', level: 'low', rationale: 'Only free/busy availability, not event details.', test: (c) => c.resource === 'calendar' && c.breadth === 'availability_only' },
  { id: 'S10', level: 'high', rationale: 'Calendar deletion or sharing control.', test: (c) => c.resource === 'calendar' && has(c, 'delete', 'admin') },
  { id: 'S11', level: 'medium', rationale: 'Calendar events reveal schedules and locations.', test: (c) => c.resource === 'calendar' },
  { id: 'S12', level: 'high', rationale: 'Deleting contacts.', test: (c) => c.resource === 'contacts' && has(c, 'delete') },
  { id: 'S13', level: 'medium', rationale: 'Contacts reveal who you know.', test: (c) => c.resource === 'contacts' || c.resource === 'directory' },
  { id: 'S14', level: 'high', rationale: 'Deleting YouTube content.', test: (c) => c.resource === 'youtube' && has(c, 'delete') },
  { id: 'S15', level: 'medium', rationale: 'YouTube activity reveals interests; changes act as you.', test: (c) => c.resource === 'youtube' },
  { id: 'S16', level: 'high', rationale: 'Location history reveals where you go and when.', test: (c) => c.resource === 'fitness_location' },
  { id: 'S17', level: 'medium', rationale: 'Health and activity data is personal.', test: (c) => c.resource === 'fitness' },
  { id: 'S18', level: 'low', rationale: 'To-do items.', test: (c) => c.resource === 'tasks' },
  { id: 'S19', level: 'medium', rationale: 'Form answers contain information other people gave you.', test: (c) => c.resource === 'forms' }
];

// Fail safe: anything not covered by a rule is 'unknown', never 'low'.
export function classifyCapability(c) {
  const rule = RULES.find((r) => r.test(c));
  return rule ? { level: rule.level, ruleId: rule.id, rationale: rule.rationale } : { level: 'unknown', ruleId: 'S-UNKNOWN', rationale: 'No documented rule covers this access.' };
}

// Overall = highest known capability level. If any capability is unknown or the evidence is incomplete,
// the result is a lower bound ("at least"), and with no known capability it is 'unknown'.
export function overallSensitivity(capabilities, { incomplete = false } = {}) {
  const known = capabilities.filter((c) => c.sensitivity.level !== 'unknown');
  const anyUnknown = capabilities.some((c) => c.sensitivity.level === 'unknown');
  if (!known.length) return { level: 'unknown', lowerBound: false, drivers: [] };
  const top = Math.max(...known.map((c) => RANK[c.sensitivity.level]));
  const level = LEVELS[top - 1];
  return {
    level,
    lowerBound: (anyUnknown || incomplete) && level !== 'high',
    drivers: known.filter((c) => RANK[c.sensitivity.level] === top).map((c) => ({ resource: c.resource, ruleId: c.sensitivity.ruleId }))
  };
}

export const sensitivityRank = (level) => RANK[level] ?? 0;
