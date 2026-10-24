// Purpose compatibility: is the access consistent with what the USER says the app does?
// The app's name, developer reputation or any generated text are never used as evidence.
// States: consistent | broader | unknown | conflicting

const BASIC = { identity_basic: ['read'] };
const x = (o) => ({ ...BASIC, ...o });

// What a kind of app can reasonably be expected to use. Documented, conservative, and easy to change.
export const PURPOSES = {
  signin: { label: 'Sign-in / account login only', expects: x({}) },
  calendar: { label: 'Calendar / scheduling', expects: x({ calendar: ['read', 'write', 'delete', 'admin'], contacts: ['read'] }) },
  email: { label: 'Email client / email tool', expects: x({ gmail: ['read', 'write', 'send', 'delete'], gmail_settings: ['write'], contacts: ['read', 'write'] }) },
  storage: { label: 'File storage / backup / editing', expects: x({ drive: ['read', 'write', 'delete'], docs: ['read', 'write'], sheets: ['read', 'write'], slides: ['read', 'write'] }) },
  photos: { label: 'Photo printing / editing', expects: x({ photos: ['read', 'write'], drive: ['read', 'write'] }) },
  docs: { label: 'Productivity / notes / tasks', expects: x({ docs: ['read', 'write'], sheets: ['read', 'write'], slides: ['read', 'write'], forms: ['read', 'write'], tasks: ['read', 'write', 'delete'], drive: ['read', 'write'], calendar: ['read', 'write'] }) },
  video: { label: 'Video / YouTube tool', expects: x({ youtube: ['read', 'write', 'delete'] }) },
  fitness: { label: 'Fitness / health', expects: x({ fitness: ['read'], fitness_location: ['read'] }) },
  crm: { label: 'CRM / sales / marketing', expects: x({ gmail: ['read', 'send', 'write'], contacts: ['read', 'write'], calendar: ['read', 'write'] }) }
  // 'other' / unset intentionally absent: purpose is unknown.
};

export function evaluatePurpose(capabilities, { purpose, incomplete = false, conflicting = false } = {}) {
  const profile = purpose ? PURPOSES[purpose] : null;
  if (conflicting) return { state: 'conflicting', stated: purpose || null, reason: 'The source text contradicts itself (for example "read-only" alongside the ability to change things).', items: [] };
  if (!profile) return { state: 'unknown', stated: null, reason: 'not_stated', items: [] };

  const items = capabilities
    .filter((c) => c.sensitivity.level !== 'low') // only access that matters is judged
    .map((c) => {
      const allowed = profile.expects[c.resource];
      const within = !!allowed && c.actions.every((a) => allowed.includes(a));
      return { resource: c.resource, within };
    });
  const beyond = items.filter((i) => !i.within);
  if (beyond.length) return { state: 'broader', stated: purpose, reason: 'beyond_expected', items };
  if (incomplete) return { state: 'unknown', stated: purpose, reason: 'insufficient_evidence', items };
  return { state: 'consistent', stated: purpose, reason: 'within_expected', items };
}
