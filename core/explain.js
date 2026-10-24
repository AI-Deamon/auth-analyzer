// Presentation text. Takes the structured result from analyze.js and writes plain language.
// Every sentence is built from capabilities that exist in the result; nothing is claimed beyond the evidence.
import { PURPOSES } from './purpose.js';

const NOUN = {
  identity_basic: 'your basic profile info',
  identity_extended: 'personal details such as your birthday, address or phone number',
  gmail: 'your Gmail messages', gmail_settings: 'your Gmail settings (such as filters and forwarding)',
  drive: 'your Google Drive files', docs: 'your Google Docs', sheets: 'your Google Sheets', slides: 'your Google Slides',
  forms: 'your Google Forms', tasks: 'your Google Tasks', calendar: 'your Google Calendar', contacts: 'your contacts',
  directory: 'your organisation\'s directory', photos: 'your Google Photos', youtube: 'your YouTube account',
  fitness: 'your fitness and health data', fitness_location: 'your location history from fitness data',
  cloud: 'Google Cloud resources your account can reach', admin_directory: 'users and groups in your organisation',
  chat: 'your Google Chat messages'
};
// Short object names for the one-sentence "why it matters" line.
const SHORT = {
  gmail: 'emails', gmail_settings: 'mail settings', drive: 'files', docs: 'documents', sheets: 'spreadsheets', slides: 'presentations',
  forms: 'forms', tasks: 'to-do items', calendar: 'calendar', contacts: 'contacts', directory: 'directory', photos: 'photos',
  youtube: 'YouTube account', fitness: 'health data', fitness_location: 'location history', cloud: 'cloud resources',
  admin_directory: 'organisation accounts', chat: 'chats', identity_extended: 'personal details', identity_basic: 'profile info'
};
const READ_VERB = new Set(['gmail', 'chat', 'docs', 'sheets', 'slides']);
const SEND = { gmail: 'send email as you', chat: 'send chat messages as you' };
const SEND_WHY = { gmail: 'send messages that appear to come from you', chat: 'send messages that appear to come from you' };
const SEEN = {
  gmail: 'private conversations, receipts, bank statements or password-reset emails',
  gmail_settings: 'rules that forward or hide your mail',
  drive: 'documents, photos, ID scans or spreadsheets',
  docs: 'letters, notes or contracts', sheets: 'budgets, lists or financial data', slides: 'work or personal presentations',
  photos: 'personal photos, faces, places and dates', calendar: 'where you will be, when, and who you are meeting',
  contacts: 'names, emails and phone numbers of people you know', directory: 'names and details of colleagues',
  youtube: 'what you watch, which reveals your interests', forms: 'answers other people gave you',
  fitness: 'activity, heart rate or sleep', fitness_location: 'where you go and when',
  chat: 'private messages', identity_extended: 'details that could be used to identify or contact you',
  cloud: 'servers, stored data and billing', admin_directory: 'accounts for everyone in the organisation'
};
const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Administrative power is named only as the evidence names it ("share", "configure", ...). Never a generic "settings".
const adminVerbs = (c) => (c.adminKinds && c.adminKinds.length ? c.adminKinds : ['make administrative changes to']);

export function capabilitySentence(c) {
  if (c.resource === 'unknown') return 'Has a permission we do not recognise (' + (c.evidence[0]?.text || 'unknown') + ').';
  let noun = NOUN[c.resource] || 'part of your account';
  if (c.resource === 'identity_basic' && c.evidence.some((e) => /email address/i.test(e.text))) noun = 'your basic profile info and email address';
  if (c.breadth === 'app_install') return 'Can add itself as an option inside your Google Drive (no file access is stated).';
  if (c.actions.length && c.actions.every((a) => a === 'unspecified')) return 'Has some access to ' + noun + ' (the wording does not say what it can do).';
  if (c.breadth === 'add_only') return 'Can add items to ' + noun + ' but cannot see existing ones.';
  const verbs = [];
  if (c.actions.includes('read')) verbs.push(READ_VERB.has(c.resource) ? 'read' : 'see');
  if (c.actions.includes('write')) verbs.push('change');
  if (c.actions.includes('delete')) verbs.push('delete');
  if (c.actions.includes('admin')) verbs.push(...adminVerbs(c));
  const parts = [];
  const target = c.breadth === 'all' && noun.startsWith('your ') ? 'all ' + noun : noun;
  if (verbs.length) parts.push(list(verbs) + ' ' + target);
  if (c.actions.includes('send') && SEND[c.resource]) parts.push(SEND[c.resource]);
  if (!parts.length) parts.push('access ' + noun);
  const suffix = { app_created: ' (only items this app creates or that you open with it)', app_data: ' (only its own hidden app data)', selected: ' (only items you choose)', metadata: ' (names and details only, not contents)', availability_only: ' (free/busy times only)', upload_only: ' (uploading only)' }[c.breadth] || '';
  return 'Can ' + parts.join(' and ') + suffix + '.';
}

function couldInclude(c) {
  const notes = [];
  if (c.actions.includes('read') && SEEN[c.resource] && c.sensitivity.level !== 'low' && c.breadth !== 'metadata') notes.push('This could include ' + SEEN[c.resource] + '.');
  if (c.actions.includes('send') && SEND[c.resource]) notes.push('Messages sent this way would appear to come from you.');
  if (c.actions.includes('delete')) notes.push('Items it removes may not be recoverable.');
  return notes.join(' ');
}

const unrecognisedLines = (r) => r.evidence.items.filter((i) => i.kind === 'unrecognised').map((i) => i.text);
const quote = (t) => '"' + (t.length > 80 ? t.slice(0, 77) + '...' : t) + '"';

const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const GAP_TEXT = {
  access_section_empty: () => 'The page has an access section but it listed no permissions, so we cannot tell what access the app has.',
  collapsed_access_items: (r) => 'The page hides ' + plural(r.evidence.collapsed, 'more permission') + ' behind a "+' + r.evidence.collapsed + ' more" link that was not read, so the access may be larger than listed.',
  unrecognised_access_text: (r) => unrecognisedLines(r).length + ' line(s) of access text were not understood (listed under "Text we did not understand"), so the access may be larger than shown.',
  ambiguous_wording: () => 'Some wording did not say exactly what is allowed. We did not assume extra access beyond what the text states.',
  unknown_permission: () => 'A permission ID is not in our reference list, so it is not rated.',
  extraction_partial: () => 'Google\'s page layout was only partly recognised, so some access may be missing.',
  extraction_failed: () => 'We could not read this app\'s page.',
  no_access_evidence: () => 'No access information could be read for this app.'
};
const FLAG_TEXT = {
  conflicting_duplicate: 'This app appears more than once with different access. We kept both separate.',
  same_name_other_record: 'Another record has the same name. We cannot tell if they are the same authorization, so they are shown separately.'
};
const ISSUE_TEXT = {
  collapsed_resolved_via_details: "The permissions hidden behind a \"+N more\" link were read from the app's details page.",
  collapsed_details_incomplete: "The app's details page was read, but it did not list as many extra permissions as the \"+N more\" link announced, so some access may still be missing.",
  details_page_unreadable: "The app's details page could not be read.",
  no_access_section: 'The page did not have the layout we expect, so a missing permission list cannot be trusted.',
  no_structure: 'The page had no recognisable structure; only its main text was checked.',
  empty_page: 'The page had no readable content.',
  access_section_empty: 'The page has an access section but no permissions were listed in it.',
  permission_text_outside_access_section: 'Some permission wording appeared outside the expected "access" section. It is included, but please check it.',
  name_mismatch: 'The app name on its page differs from the name in the list.',
  missing_name: 'No app name could be read.'
};

const ACTION_LABEL = { no_action_indicated: 'No action indicated', review_access: 'Review access', verify_needed: 'Verify still needed', investigate_mismatch: 'Investigate mismatch', consider_revoking: 'Consider removing' };
const CONF_LABEL = { verified: 'Known permission IDs', described: 'All visible access text understood', partial: 'Partly understood', insufficient: 'Not enough information' };
const PURPOSE_LABEL = { consistent: 'Fits what you said it does', broader: 'May be broader than needed', unknown: 'Cannot tell', conflicting: 'Conflicting information' };

const rank = (c) => ({ high: 3, unknown: 2.5, medium: 2, low: 1 }[c.sensitivity.level] ?? 0);

// ---- "Why it matters": ONE sentence about the most impactful capability, covering each action the evidence supports ----
const READ_CLAUSE = {
  gmail: 'emails often hold private conversations and account-recovery links',
  gmail_settings: 'mail settings can redirect or hide your incoming mail',
  drive: 'files can include documents, photos and ID scans',
  docs: 'documents can hold letters, notes and contracts', sheets: 'spreadsheets often hold financial or personal data', slides: 'presentations can hold work or personal material',
  photos: 'photos show people, places and dates', calendar: 'events show where you will be and who you meet',
  contacts: 'contacts show who you know', directory: 'a directory lists colleagues and their details',
  youtube: 'viewing history reveals your interests', forms: 'forms hold answers other people gave you',
  fitness: 'health and activity data is personal', fitness_location: 'location history shows where you go and when',
  chat: 'chats are private conversations', identity_extended: 'these details can identify or contact you',
  cloud: 'cloud resources can include servers, stored data and billing', admin_directory: 'organisation accounts are widely shared',
  tasks: 'to-do lists can reveal your plans'
};
function whyItMatters(caps) {
  const c = caps[0];
  if (!c) return 'We could not read what it has access to.';
  if (c.sensitivity.level === 'unknown') return 'We cannot tell how much this allows.';
  if (c.breadth === 'app_install') return 'No file access is stated for this part.';
  if (c.resource === 'identity_basic') return 'It can only see basic profile details.';
  const A = new Set(c.actions);
  const noun = SHORT[c.resource] || 'data';
  const acts = [];
  if (A.has('write')) acts.push('change');
  if (A.has('delete')) acts.push('delete');
  if (A.has('admin')) acts.push(...adminVerbs(c));
  const doing = [];
  if (acts.length) doing.push(list(acts) + ' your ' + noun);
  if (A.has('send') && SEND_WHY[c.resource]) doing.push(SEND_WHY[c.resource]);
  const base = A.has('read') ? READ_CLAUSE[c.resource] : null;
  if (base && doing.length) return cap1(base) + ', and it can also ' + list(doing) + '.';
  if (base) return cap1(base) + '.';
  if (doing.length) return 'It can ' + list(doing) + '.';
  return 'It can reach some of your account data.';
}

// ---- "Next step": one specific action, proportionate to sensitivity and to how complete the evidence is ----
function nextStep(result) {
  const a = result.recommendation.action;
  const conf = result.confidence.level;
  if (a === 'consider_revoking') return 'Remove its access in your Google Account.';
  if (a === 'investigate_mismatch') return 'This looks broader than what you described. Check why it needs it, and remove access if the reason is unclear.';
  if (conf === 'insufficient') return 'Open it in Google and check what it can access. We could not read it.';
  if (conf === 'partial') {
    const un = unrecognisedLines(result);
    const hidden = result.evidence.collapsed || 0;
    const vague = result.evidence.items.filter((i) => i.kind === 'description' && i.ambiguous).map((i) => i.text);
    if (hidden) return 'Open it in Google, click "+' + hidden + ' more", and review the permissions that were hidden' + (un.length ? ', plus ' + quote(un[0]) : '') + '.';
    if (!un.length && !vague.length && result.confidence.gaps.includes('access_section_empty')) return 'Open it in Google and check what it can access. The page listed nothing.';
    if (!un.length && vague.length) return 'Open it in Google and check exactly what this wording allows: ' + quote(vague[0]) + '.';
    if (un.length) return 'Open it in Google and review the access we could not read: ' + quote(un[0]) + (un.length > 1 ? ' (and ' + (un.length - 1) + ' more).' : '.');
    return 'Open it in Google and check the access wording we could not fully interpret.';
  }
  if (a === 'verify_needed') return 'You have not used it for a while. If you no longer need it, remove its access.';
  const level = result.sensitivity.level;
  if (level === 'high') return 'Keep it only if you recognise it and still use it. Otherwise remove its access in Google.';
  if (level === 'medium') return 'Keep it if you still use it. Otherwise remove its access in Google.';
  return 'No action needed. Remove it later if you stop using it.';
}

function evidenceStatus(result) {
  const conf = result.confidence.level;
  if (conf === 'verified') return ['Known permission IDs', 'The permission IDs matched our reference list. This does not show what the app does with them.'];
  if (conf === 'described') return ['All visible access text understood', 'We understood every access line on the page. This does not verify the app\'s behaviour or its exact OAuth scopes.'];
  if (conf === 'partial') {
    const un = unrecognisedLines(result);
    const hidden = result.evidence.collapsed || 0;
    const parts = [];
    if (hidden) parts.push(plural(hidden, 'permission') + ' hidden behind a "+' + hidden + ' more" link');
    if (un.length) parts.push(plural(un.length, 'line') + ' not understood');
    if (result.confidence.gaps.includes('access_section_empty')) parts.push('the access section listed nothing');
    if (!parts.length) parts.push('some wording is too vague to say exactly what is allowed');
    return ['Partly understood', parts.join(' and ').replace(/^./, (c) => c.toUpperCase()) + ', so there may be more access than shown.'];
  }
  return ['Unknown', 'No usable access information was found.'];
}

export function explain(result) {
  const caps = [...result.capabilities].sort((a, b) => rank(b) - rank(a));
  const s = result.sensitivity;
  const name = result.identity.name;
  const top = caps.filter((c) => c.resource !== 'unknown').slice(0, 3).map((c) => capabilitySentence(c).replace(/^Can /, '').replace(/\.$/, ''));
  const headline = !caps.length ? 'We could not read what access ' + name + ' has.' : top.length ? name + ' can ' + list(top) + '.' : name + ' holds a permission we do not recognise.';

  const limitations = ['This shows what the access allows, not what the app actually does with it.'];
  if (result.purpose.state === 'unknown' && result.purpose.reason === 'not_stated') limitations.push('You have not said what this app is for, so we cannot judge whether the access is needed.');
  if (result.purpose.reason === 'insufficient_evidence') limitations.push('The access information is incomplete, so we cannot judge fit with its purpose.');
  for (const g of result.confidence.gaps) if (GAP_TEXT[g]) limitations.push(GAP_TEXT[g](result));
  for (const f of result.identity.flags) if (FLAG_TEXT[f]) limitations.push(FLAG_TEXT[f]);
  for (const i of result.extraction.issues) if (ISSUE_TEXT[i]) limitations.push(ISSUE_TEXT[i]);
  if (result.identity.duplicateCount > 1) limitations.push('This identical record appeared ' + result.identity.duplicateCount + ' times; shown once.');

  const levelWord = { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Unknown' }[s.level];
  const sentences = caps.map((c) => cap1(capabilitySentence(c).replace(/^Can /, '').replace(/\.$/, '')));
  const shown = sentences.slice(0, 4);
  const [evStatus, evNote] = evidenceStatus(result);
  return {
    summary: {
      access: shown,
      moreAccess: Math.max(0, sentences.length - shown.length),
      whyItMatters: whyItMatters(caps),
      nextStep: nextStep(result),
      evidenceStatus: evStatus,
      evidenceNote: evNote
    },
    headline,
    sensitivityLabel: (s.lowerBound ? 'At least ' : '') + levelWord + ' sensitivity',
    confidenceLabel: CONF_LABEL[result.confidence.level],
    purposeLabel: PURPOSE_LABEL[result.purpose.state] + (result.purpose.stated && PURPOSES[result.purpose.stated] ? ' (' + PURPOSES[result.purpose.stated].label + ')' : ''),
    actionLabel: ACTION_LABEL[result.recommendation.action],
    findings: caps.map((c) => ({ sentence: capabilitySentence(c), could: couldInclude(c), level: c.sensitivity.level, rule: c.sensitivity.ruleId, why: c.sensitivity.rationale, source: c.resource === 'unknown' ? 'Permission ID not in our reference list' : c.source === 'scope_id' ? 'Known permission ID' : 'Google\'s wording', evidence: c.evidence.map((e) => e.text) })),
    limitations
  };
}
