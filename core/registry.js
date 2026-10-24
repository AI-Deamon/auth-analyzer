// Verified permission metadata: Google OAuth scope IDs -> structured capabilities.
// Only identifiers that appear here are treated as "verified". Unknown IDs are NOT guessed from their names.
//
// Capability = { resource, actions: [read|write|send|delete|admin], breadth }
// breadth: all | app_created | app_data | selected | add_only | metadata | availability_only | upload_only
//          | basic | user_accessible | unspecified

export const RULES_VERSION = '2026-10-22.1';

const cap = (resource, actions, breadth = 'all', adminKinds) => (adminKinds ? { resource, actions, breadth, adminKinds } : { resource, actions, breadth });
const R = ['read'], RW = ['read', 'write'], RWD = ['read', 'write', 'delete'];

export const SCOPE_REGISTRY = {
  // Identity
  openid: cap('identity_basic', R, 'basic'),
  email: cap('identity_basic', R, 'basic'),
  profile: cap('identity_basic', R, 'basic'),
  'userinfo.email': cap('identity_basic', R, 'basic'),
  'userinfo.profile': cap('identity_basic', R, 'basic'),
  'user.birthday.read': cap('identity_extended', R, 'basic'),
  'user.gender.read': cap('identity_extended', R, 'basic'),
  'user.addresses.read': cap('identity_extended', R, 'basic'),
  'user.phonenumbers.read': cap('identity_extended', R, 'basic'),

  // Gmail
  'mail.google.com': cap('gmail', ['read', 'write', 'send', 'delete']),
  'gmail.modify': cap('gmail', ['read', 'write', 'send']),
  'gmail.readonly': cap('gmail', R),
  'gmail.send': cap('gmail', ['send']),
  'gmail.compose': cap('gmail', ['write', 'send']),
  'gmail.insert': cap('gmail', ['write'], 'add_only'),
  'gmail.metadata': cap('gmail', R, 'metadata'),
  'gmail.labels': cap('gmail', ['write'], 'metadata'),
  'gmail.settings.basic': cap('gmail_settings', ['write']),
  'gmail.settings.sharing': cap('gmail_settings', ['write', 'admin'], 'all', ['change delegation and forwarding for']),

  // Drive
  drive: cap('drive', RWD),
  'drive.install': cap('drive', ['connect'], 'app_install'),
  'drive.readonly': cap('drive', R),
  'drive.file': cap('drive', RW, 'app_created'),
  'drive.appdata': cap('drive', RW, 'app_data'),
  'drive.metadata': cap('drive', RW, 'metadata'),
  'drive.metadata.readonly': cap('drive', R, 'metadata'),
  'drive.photos.readonly': cap('photos', R),

  // Calendar
  calendar: cap('calendar', ['read', 'write', 'delete', 'admin'], 'all', ['share']),
  'calendar.readonly': cap('calendar', R),
  'calendar.events': cap('calendar', RW),
  'calendar.events.readonly': cap('calendar', R),
  'calendar.freebusy': cap('calendar', R, 'availability_only'),
  'calendar.settings.readonly': cap('calendar', R, 'metadata'),

  // Contacts
  contacts: cap('contacts', RWD),
  'contacts.readonly': cap('contacts', R),
  'contacts.other.readonly': cap('contacts', R),
  'directory.readonly': cap('directory', R),

  // Photos
  photoslibrary: cap('photos', RW),
  'photoslibrary.readonly': cap('photos', R),
  'photoslibrary.appendonly': cap('photos', ['write'], 'add_only'),
  'photoslibrary.readonly.appcreateddata': cap('photos', R, 'app_created'),
  'photoslibrary.sharing': cap('photos', ['write']),
  'photospicker.mediaitems.readonly': cap('photos', R, 'selected'),

  // YouTube
  youtube: cap('youtube', RWD),
  'youtube.force-ssl': cap('youtube', RWD),
  'youtube.readonly': cap('youtube', R),
  'youtube.upload': cap('youtube', ['write'], 'upload_only'),

  // Docs, Sheets, Slides, Forms, Tasks, Chat
  documents: cap('docs', RWD),
  'documents.readonly': cap('docs', R),
  spreadsheets: cap('sheets', RWD),
  'spreadsheets.readonly': cap('sheets', R),
  presentations: cap('slides', RWD),
  'presentations.readonly': cap('slides', R),
  'forms.body': cap('forms', RW),
  'forms.responses.readonly': cap('forms', R),
  tasks: cap('tasks', RWD),
  'tasks.readonly': cap('tasks', R),
  'chat.messages': cap('chat', ['read', 'write', 'send']),

  // Fitness
  'fitness.activity.read': cap('fitness', R),
  'fitness.body.read': cap('fitness', R),
  'fitness.sleep.read': cap('fitness', R),
  'fitness.location.read': cap('fitness_location', R),

  // Cloud / admin: scoped to what the signed-in user can already reach, not "the whole account".
  'cloud-platform': cap('cloud', ['read', 'write', 'delete', 'admin'], 'user_accessible', ['configure']),
  'admin.directory.user': cap('admin_directory', ['read', 'write', 'delete', 'admin'], 'all', ['administer']),
  'admin.directory.group': cap('admin_directory', ['read', 'write', 'delete', 'admin'], 'all', ['administer'])
};

const PREFIX = 'https://www.googleapis.com/auth/';
const ALIASES = { 'https://mail.google.com': 'mail.google.com' };

export function normalizeScopeId(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  if (ALIASES[s]) return ALIASES[s];
  return s.startsWith(PREFIX) ? s.slice(PREFIX.length) : s;
}

// Returns { id, known, capability|null }. Unknown IDs are reported as unknown, never guessed.
export function lookupScope(raw) {
  const id = normalizeScopeId(raw);
  if (!id) return null;
  const entry = Object.hasOwn(SCOPE_REGISTRY, id) ? SCOPE_REGISTRY[id] : null;
  return { id, raw: String(raw).trim(), known: !!entry, capability: entry ? { ...entry, actions: [...entry.actions] } : null };
}

// Accepts space/comma/newline separated IDs, or a sign-in URL containing scope=...
export function parseScopeInput(text) {
  let t = String(text ?? '');
  const m = t.match(/[?&]scope=([^&#\s]+)/i);
  if (m) { try { t = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { t = m[1]; } }
  return [...new Set(t.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
}
