// Interprets Google's plain-English access descriptions into capabilities.
// Compositional (resource + verbs + breadth), NOT a table of whole phrases mapped to invented scope IDs.
// Every capability produced here has source 'description' and is a normalised interpretation of text.
//
// Safety rules (each one is a regression from real data):
//  - The app's own name is removed before matching, so "Claude for Gmail" is never read as Gmail access.
//  - A verb that the text does not contain is never assumed. Verb-less wording becomes actions ['unspecified'].
//  - A line with several clauses ("delete your Cloud data and see the email address ...") is split, so no clause is dropped.

const IDENTITY_BASIC = /(primary google account email|email address(es)?|profile (picture|info)|personal info|associate you with|your name\b)/i;
const IDENTITY_EXT = /\b(birthday|date of birth|gender|home address|work address|phone numbers?)\b/i;

// Order matters only for specificity (e.g. Chat before generic messages, Gmail settings before Gmail).
const RESOURCES = [
  ['chat', /\bgoogle chat\b|\bchat messages?\b/i],
  ['gmail_settings', /\b(gmail|e-?mail)\b.*\b(settings|filters|forwarding|delegation)\b|\b(settings|filters|forwarding)\b.*\b(gmail|e-?mail)\b/i],
  ['gmail', /\bgmail\b|\be-?mails?\b(?!\s+address)|\bdrafts?\b/i],
  ['drive', /\bgoogle drive\b|\bdrive files?\b/i],
  ['docs', /\bgoogle docs\b|\bdocuments?\b/i],
  ['sheets', /\bgoogle sheets\b|\bspreadsheets?\b/i],
  ['slides', /\bgoogle slides\b|\bpresentations?\b/i],
  ['forms', /\bgoogle forms?\b/i],
  ['tasks', /\bgoogle tasks\b/i],
  ['calendar', /\bcalendars?\b|\bevents?\b/i],
  ['contacts', /\bcontacts\b/i],
  ['directory', /\b(organi[sz]ation|domain)'?s? directory\b/i],
  ['photos', /\bgoogle photos\b|\bphotos? library\b/i],
  ['youtube', /\byoutube\b/i],
  ['fitness_location', /\blocation (history|data)\b/i],
  ['fitness', /\b(fitness|heart rate|sleep data|activity data)\b/i],
  ['cloud', /\bgoogle cloud\b|\bcloud (platform|data)\b/i],
  ['admin_directory', /\b(users|groups) in your (organi[sz]ation|domain)\b/i]
];

const VERB_WORDS = 'see|view|read|download|edit|manage|send|delete|create|upload|share|compose|configure|connect';
const VERBS = {
  read: /\b(see|view|read|download|list)\b/i,
  write: /\b(edit|change|modify|create|upload|add|organi[sz]e|update|compose)\b/i,
  send: /\bsend\b/i,
  delete: /\bdelete\b/i,
  admin: /\b(share|permissions?|administer|configure)\b/i
};
const MANAGE = /\bmanage\b/i;
const ADMIN_WORDS = { share: 'share', configure: 'configure', administer: 'administer', permission: 'change permissions for', permissions: 'change permissions for' };
const READ_ONLY_HINT = /\b(read[- ]only|view only|only (see|view|read))\b/i;
const DRIVE_INSTALL = /^connect itself to your google drive\b/i;

const BREADTH = [
  ['app_created', /\bonly the specific\b|\bfiles? (that )?you (use|open)\b|\bcreated by this app\b|\bthis app (creates|created)\b/i],
  ['selected', /\b(that|the .* you) (choose|pick|select)\b/i],
  ['metadata', /\b(metadata|names and details|file names)\b/i],
  ['all', /\b(all|any|every)\b/i]
];

const CLAUSE_SPLIT = new RegExp('\\s+and\\s+(?=(?:' + VERB_WORDS + ')\\b)', 'i');

function stripAppName(text, appName) {
  const n = String(appName ?? '').trim();
  if (n.length < 3) return text;
  // Whole-word only: an app called "Mail" must not erase "mail" inside "Gmail" or "emails".
  return text.replace(new RegExp('(?<![A-Za-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'gi'), ' ');
}

const hasSubject = (t) => IDENTITY_BASIC.test(t) || IDENTITY_EXT.test(t) || RESOURCES.some(([, re]) => re.test(t));

// Split "A and see B" into clauses, but only where the left side already names something,
// so "See and download any calendar" stays one clause.
function splitClauses(text) {
  const segs = text.split(CLAUSE_SPLIT);
  const out = [];
  let cur = '';
  segs.forEach((seg, i) => {
    cur = cur ? cur + ' and ' + seg : seg;
    if (i < segs.length - 1 && hasSubject(cur)) { out.push(cur); cur = ''; }
  });
  if (cur) out.push(cur);
  return out;
}

export function describeLine(line, { appName } = {}) {
  const original = String(line ?? '').trim();
  const result = { text: original, matched: false, capabilities: [], ambiguous: false, readOnlyHint: READ_ONLY_HINT.test(original) };
  if (!original) return result;
  if (DRIVE_INSTALL.test(original)) {
    result.matched = true;
    result.capabilities.push(mk('drive', ['connect'], 'app_install', original, 'D-drive-install'));
    return result;
  }
  const text = stripAppName(original, appName);
  for (const clause of splitClauses(text)) {
    const r = describeClause(clause, original);
    if (r.matched) { result.matched = true; result.capabilities.push(...r.capabilities); result.ambiguous = result.ambiguous || r.ambiguous; }
  }
  return result;
}

function describeClause(text, original) {
  const out = { matched: false, capabilities: [], ambiguous: false };
  if (IDENTITY_EXT.test(text)) {
    out.matched = true;
    out.capabilities.push(mk('identity_extended', ['read'], 'basic', original, 'D-identity-extended'));
    return out;
  }
  const picked0 = RESOURCES.filter(([, re]) => re.test(text)).map(([r]) => r);
  const picked = picked0.includes('gmail_settings') ? picked0.filter((r) => r !== 'gmail') : picked0;
  const identity = IDENTITY_BASIC.test(text);

  if (identity && !picked.length) {
    out.matched = true;
    out.capabilities.push(mk('identity_basic', ['read'], 'basic', original, 'D-identity-basic'));
    return out;
  }
  if (!picked.length) return out;

  const actions = Object.entries(VERBS).filter(([, re]) => re.test(text)).map(([a]) => a);
  if (MANAGE.test(text)) { out.ambiguous = true; if (!actions.includes('write')) actions.push('write'); } // "manage" may include more; do not guess
  if (!actions.length) { out.ambiguous = true; actions.push('unspecified'); }           // never assume "read"
  const breadth = (BREADTH.find(([, re]) => re.test(text)) || [])[0] || 'unspecified';

  // Record which administrative power the text actually names (never a generic "settings" claim).
  const adminKinds = actions.includes('admin') ? [...new Set((text.match(/\b(share|configure|administer|permissions?)\b/gi) || []).map((w) => ADMIN_WORDS[w.toLowerCase()]))] : null;
  for (const resource of picked) {
    const c = mk(resource, [...new Set(actions)], resource === 'cloud' ? 'user_accessible' : breadth, original, 'D-' + resource);
    if (adminKinds) c.adminKinds = adminKinds;
    out.capabilities.push(c);
  }
  if (identity) out.capabilities.push(mk('identity_basic', ['read'], 'basic', original, 'D-identity-basic'));
  out.matched = true;
  return out;
}

function mk(resource, actions, breadth, text, ruleId) {
  return { resource, actions, breadth, source: 'description', evidence: [{ kind: 'description', text, ruleId }] };
}
