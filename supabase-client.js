// supabase-client.js
const SUPABASE_URL = 'https://smdbfaomeghoejqqkplv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtZGJmYW9tZWdob2VqcXFrcGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1OTY4MDEsImV4cCI6MjA4NzE3MjgwMX0.HuQdEt6Knr7_MgYt2B_QiUbls2hy8SMPZlSxe5KPTqU';
const SUPABASE_PROJECT_REF = 'smdbfaomeghoejqqkplv';
const AUTH_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
// Never hardcode service-role keys in frontend code.
const SUPABASE_SERVICE_ROLE_KEY = String(window.__SUPABASE_SERVICE_ROLE_KEY || '').trim();
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.SUPABASE_FUNCTIONS_BASE = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

// Centralized Logger
window._L = {
  info: (msg, data) => console.log(`%c[INFO] ${msg}`, 'color: #7DC870; font-weight: bold;', data || ''),
  warn: (msg, data) => console.warn(`%c[WARN] ${msg}`, 'color: #EAB308; font-weight: bold;', data || ''),
  error: (msg, data) => console.error(`%c[ERROR] ${msg}`, 'color: #EF4444; font-weight: bold;', data || ''),
  debug: (msg, data) => console.debug(`%c[DEBUG] ${msg}`, 'color: #60A5FA;', data || '')
};

// Wait for Supabase to be loaded via CDN
function initSupabaseAuth() {
  if (!window.supabase) {
    console.error('Supabase library not loaded. Ensure script is included via CDN.');
    return null;
  }
  const safeLock = async (_name, _timeout, fn) => await fn();
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: AUTH_STORAGE_KEY,
      lock: safeLock
    }
  });
}

function initSupabaseService() {
  if (!window.supabase || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  } catch (e) {
    _L.warn('Service-role client init failed; falling back to anon client.', e);
    return null;
  }
}

window.sbAuthClient = window.sbAuthClient || initSupabaseAuth();
window.sbServiceClient = window.sbServiceClient || initSupabaseService();
window.createSupabaseBrowserClient = (url = SUPABASE_URL, anon = SUPABASE_ANON_KEY) => {
  if (!window.supabase) return null;
  const safeLock = async (_name, _timeout, fn) => await fn();
  return window.supabase.createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: AUTH_STORAGE_KEY,
      lock: safeLock
    }
  });
};
window.getDbClient = () => window.sbServiceClient || window.sbAuthClient;
window.sbClient = window.sbAuthClient ? {
  auth: window.sbAuthClient.auth,
  from: (...args) => (window.getDbClient() || window.sbAuthClient).from(...args),
  rpc: (...args) => (window.getDbClient() || window.sbAuthClient).rpc(...args),
  storage: window.sbAuthClient.storage,
  functions: window.sbAuthClient.functions,
  channel: (...args) => window.sbAuthClient.channel(...args),
  removeChannel: (...args) => window.sbAuthClient.removeChannel(...args),
  removeAllChannels: (...args) => window.sbAuthClient.removeAllChannels(...args),
} : null;

if (window.sbClient) _L.info("Supabase auth client initialized.");
else _L.error("Failed to initialize Supabase auth client.");
if (window.sbServiceClient) _L.info("Supabase service-role data client enabled.");
else _L.info("Supabase service-role client disabled in browser (secure default).");

const LANDING_PAGES = new Set(['', 'index.html', 'landing_page.html']);
const VALID_ROLES = new Set(['client', 'developer', 'commissioner', 'admin']);
const ROLE_ALIASES = Object.freeze({
  sales: 'commissioner',
  commisioner: 'commissioner',
  sales_agent: 'commissioner',
  dev: 'developer',
  engineer: 'developer',
  super_admin: 'admin'
});
const FIXED_EMAIL_ROLE_MAP = Object.freeze({
  'client@test.com': 'client',
  'admin@test.com': 'admin',
  'commissioner@test.com': 'commissioner',
  'developer@test.com': 'developer',
});

function currentPageName() {
  const pathLeaf = window.location.pathname.split('/').pop() || '';
  return pathLeaf.split('?')[0].split('#')[0];
}

function appUrl(path = '') {
  const safePath = String(path || '').replace(/^\/+/, '');
  return new URL(safePath, `${window.location.origin}/`).toString();
}

function pageNameFromUrlish(urlOrPath) {
  try {
    const target = new URL(String(urlOrPath || ''), `${window.location.origin}/`);
    const leaf = target.pathname.split('/').pop() || '';
    return leaf.split('?')[0].split('#')[0];
  } catch (_) {
    return currentPageName();
  }
}

function isLandingPage(page = currentPageName()) {
  return LANDING_PAGES.has(page);
}

function dashboardForRole(role) {
  switch (role) {
    case 'admin': return appUrl('admin_dashboard.html');
    case 'commissioner': return appUrl('sales_dashboard.html');
    case 'developer': return appUrl('developer_dashboard.html');
    case 'client': return appUrl('client_dashboard.html');
    default: return appUrl('client_dashboard.html');
  }
}

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const mapped = ROLE_ALIASES[normalized] || normalized;
  return VALID_ROLES.has(mapped) ? mapped : null;
}

function forcedRoleFromEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return normalizeRole(FIXED_EMAIL_ROLE_MAP[normalized]);
}

function resolveRoleFromUser(user) {
  if (!user) return null;
  const candidates = [
    user.user_metadata?.role,
    user.app_metadata?.role,
    user.app_metadata?.user_role,
    user.role,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeRole(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function getAuthAvatarUrl(user) {
  if (!user) return '';
  const directUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || user.user_metadata?.avatarUrl;
  if (directUrl) return String(directUrl);

  const identities = Array.isArray(user.identities) ? user.identities : [];
  for (const identity of identities) {
    const data = identity?.identity_data || {};
    const identityUrl = data.avatar_url || data.picture || data.avatarUrl;
    if (identityUrl) return String(identityUrl);
  }
  return '';
}

function getAuthNameParts(user) {
  if (!user) return { firstName: '', lastName: '', fullName: '' };
  const meta = user.user_metadata || {};
  let firstName = String(meta.first_name || meta.given_name || '').trim();
  let lastName = String(meta.last_name || meta.family_name || '').trim();
  let fullName = String(meta.full_name || meta.name || '').trim();

  const identities = Array.isArray(user.identities) ? user.identities : [];
  for (const identity of identities) {
    const data = identity?.identity_data || {};
    if (!firstName) firstName = String(data.first_name || data.given_name || '').trim();
    if (!lastName) lastName = String(data.last_name || data.family_name || '').trim();
    if (!fullName) fullName = String(data.full_name || data.name || '').trim();
  }

  if (!fullName) fullName = `${firstName} ${lastName}`.trim();
  if ((!firstName || !lastName) && fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (!firstName) firstName = parts[0] || '';
    if (!lastName) lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
  }

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim() || fullName
  };
}
window.getAuthNameParts = getAuthNameParts;

const WELCOME_EMAIL_LOCAL_PREFIX = 'sc_welcome_email_sent_';

async function callAuthedEdgeFunction(fn, payload, session, retry401 = true) {
  const baseUrl = window.SUPABASE_FUNCTIONS_BASE
    || `${String(window.SUPABASE_URL || SUPABASE_URL).replace(/\/$/, '')}/functions/v1`;
  const targetFn = String(fn || '').trim();
  if (!targetFn) throw new Error('Missing edge function name');

  const userToken = String(session?.access_token || '').trim();
  const anonToken = String(window.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY || '').trim();
  const candidates = [];
  if (userToken) candidates.push(userToken);
  if (anonToken && anonToken !== userToken) candidates.push(anonToken);
  if (!candidates.length) throw new Error('Missing auth token for edge function call');

  let lastStatus = 0;
  let lastBody = {};

  for (const token of candidates) {
    const response = await fetch(`${baseUrl}/${targetFn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonToken || token,
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload || {})
    });

    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;

    lastStatus = response.status;
    lastBody = body;

    if (response.status === 401 && retry401 && token === userToken && window.sbClient?.auth?.refreshSession) {
      const { data: refreshData } = await window.sbClient.auth.refreshSession();
      const refreshed = refreshData?.session;
      if (refreshed?.access_token && refreshed.access_token !== userToken) {
        return callAuthedEdgeFunction(fn, payload, refreshed, false);
      }
    }
  }

  const errorMessage = lastBody?.error || lastBody?.message || `Edge function ${fn} failed (${lastStatus || 'unknown'})`;
  throw new Error(String(errorMessage));
}

async function ensureWelcomeEmailForClient(session, profileHint = null) {
  if (!window.sbClient || !session?.user?.id || !session.user.email) return;

  const localKey = `${WELCOME_EMAIL_LOCAL_PREFIX}${session.user.id}`;
  if (localStorage.getItem(localKey) === '1') return;

  const dbClient = window.getDbClient ? window.getDbClient() : window.sbClient;
  if (!dbClient) return;

  let profile = profileHint;
  if (!profile || profile.id !== session.user.id || !Object.prototype.hasOwnProperty.call(profile, 'welcome_email_sent_at')) {
    const { data, error } = await dbClient
      .from('profiles')
      .select('id, role, first_name, last_name, welcome_email_sent_at')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error) {
      const raw = String(error?.message || '').toLowerCase();
      if (raw.includes('welcome_email_sent_at') && raw.includes('column')) {
        _L.debug('welcome_email_sent_at column not found yet; apply latest migration.');
      } else {
        _L.debug('Welcome-email profile lookup failed.', error);
      }
      return;
    }
    profile = data || null;
  }

  const role = normalizeRole(profile?.role) || normalizeRole(resolveRoleFromUser(session.user)) || 'client';
  if (role !== 'client') {
    localStorage.setItem(localKey, '1');
    return;
  }

  if (profile?.welcome_email_sent_at) {
    localStorage.setItem(localKey, '1');
    return;
  }

  const nameParts = getAuthNameParts(session.user);
  const displayName = nameParts.firstName || nameParts.fullName || String(session.user.email).split('@')[0];

  try {
    const mailResult = await callAuthedEdgeFunction('send-email', {
      to: session.user.email,
      template: 'welcome_client',
      data: {
        name: displayName,
        dashboard_url: dashboardForRole('client'),
        site_url: appUrl('landing_page.html'),
        support_email: 'creative.keagency254@gmail.com',
        support_whatsapp: '+254793832286'
      }
    }, session);

    const sent = Boolean(mailResult?.email?.sent || mailResult?.success);
    if (!sent) {
      _L.warn('Welcome email did not confirm as sent.', mailResult);
      return;
    }

    const timestamp = new Date().toISOString();
    const { error: markErr } = await dbClient
      .from('profiles')
      .update({ welcome_email_sent_at: timestamp, updated_at: timestamp })
      .eq('id', session.user.id);

    if (markErr) {
      const raw = String(markErr?.message || '').toLowerCase();
      if (!raw.includes('welcome_email_sent_at')) _L.warn('Failed to mark welcome_email_sent_at.', markErr);
    }

    localStorage.setItem(localKey, '1');
  } catch (error) {
    _L.warn('Welcome email flow failed.', error);
  }
}

async function ensureUserProfile(session) {
  const dbClient = window.getDbClient ? window.getDbClient() : window.sbClient;
  if (!dbClient || !session?.user) return null;
  const user = session.user;
  const metaRole = resolveRoleFromUser(user);
  const forcedRole = forcedRoleFromEmail(user.email);
  const authAvatarUrl = getAuthAvatarUrl(user);
  const authNames = getAuthNameParts(user);

  const { data: existing, error: selectError } = await dbClient
    .from('profiles')
    .select('id, role, email, first_name, last_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  if (existing?.id) {
    const updatePayload = {
      updated_at: new Date().toISOString()
    };
    let shouldUpdate = false;

    if (authAvatarUrl && !existing.avatar_url) {
      updatePayload.avatar_url = authAvatarUrl;
      shouldUpdate = true;
    }
    if (forcedRole && forcedRole !== existing.role) {
      updatePayload.role = forcedRole;
      shouldUpdate = true;
    } else if (VALID_ROLES.has(metaRole) && metaRole !== existing.role && (!existing.role || existing.role === 'client')) {
      updatePayload.role = metaRole;
      shouldUpdate = true;
    }
    if (!existing.first_name && authNames.firstName) {
      updatePayload.first_name = authNames.firstName;
      shouldUpdate = true;
    }
    if (!existing.last_name && authNames.lastName) {
      updatePayload.last_name = authNames.lastName;
      shouldUpdate = true;
    }

    if (shouldUpdate) {
      const { error: updateError } = await dbClient
        .from('profiles')
        .update(updatePayload)
        .eq('id', user.id);

      if (updateError) _L.warn('Profile sync failed.', updateError);
      else return { ...existing, ...updatePayload };
    }
    return existing;
  }
  if (selectError) _L.warn('Profile lookup failed; attempting self-heal profile create.', selectError);

  const role = forcedRole || (VALID_ROLES.has(metaRole) ? metaRole : 'client');

  const payload = {
    id: user.id,
    email: user.email || '',
    first_name: authNames.firstName || '',
    last_name: authNames.lastName || '',
    avatar_url: authAvatarUrl || '',
    role
  };

  const { error: upsertError } = await dbClient
    .from('profiles')
    .upsert(payload, { onConflict: 'id' });

  if (upsertError) {
    _L.warn('Profile self-heal upsert failed.', upsertError);
  }

  const { data: reloaded, error: reloadError } = await dbClient
    .from('profiles')
    .select('id, role, email, first_name, last_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  if (reloadError) _L.warn('Profile reload failed after upsert.', reloadError);
  return reloaded || null;
}

async function resolveRoleFromDatabase(session) {
  if (!window.sbClient || !session?.user) return null;
  try {
    const { data: rpcRole, error: rpcError } = await window.sbClient.rpc('current_role');
    if (!rpcError) {
      if (typeof rpcRole === 'string') {
        const normalized = normalizeRole(rpcRole);
        if (normalized) return normalized;
      } else if (rpcRole && typeof rpcRole === 'object') {
        const candidate = rpcRole.role ?? rpcRole.current_role;
        const normalized = normalizeRole(candidate);
        if (normalized) return normalized;
      }
    }
  } catch (e) {
    _L.debug('current_role rpc unavailable, using profile fallback.', e);
  }

  try {
    const { data: profile, error: profileError } = await window.sbClient
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle();
    if (!profileError) {
      return normalizeRole(profile?.role);
    }
  } catch (e) {
    _L.debug('Profile role fallback failed.', e);
  }

  try {
    const { data: userRow, error: userError } = await window.sbClient
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle();
    if (!userError) {
      return normalizeRole(userRow?.role);
    }
  } catch (e) {
    _L.debug('Users-table role fallback failed.', e);
  }
  return null;
}

async function getDashboardForRole(session, options = {}) {
  const unresolvedFallback = Object.prototype.hasOwnProperty.call(options, 'unresolvedFallback')
    ? options.unresolvedFallback
    : appUrl('client_dashboard.html');
  const fastRoleLookup = Boolean(options.fastRoleLookup);
  if (!window.sbClient || !session?.user) return unresolvedFallback;

  let profile = null;
  if (!fastRoleLookup) {
    try {
      profile = await ensureUserProfile(session);
    } catch (e) {
      _L.debug('ensureUserProfile failed while resolving dashboard role.', e);
    }
  }
  const profileRole = profile?.role;
  const metaRole = resolveRoleFromUser(session.user);
  const forcedRole = forcedRoleFromEmail(session.user?.email);
  const dbRole = forcedRole ? null : await resolveRoleFromDatabase(session);
  const role = forcedRole || normalizeRole(profileRole) || dbRole || normalizeRole(metaRole);
  if (!role) return unresolvedFallback;
  return dashboardForRole(role);
}

function fixMojibakeText(str) {
  let input = String(str || '');
  if (!/[ÃÂâ]/.test(input)) return input;
  const replacements = [
    ['â†’', '->'],
    ['â€¢', '•'],
    ['â—', '•'],
    ['â–²', '▲'],
    ['â–¼', '▼'],
    ['â€“', '-'],
    ['â€”', '-'],
    ['â€¦', '...'],
    ['Â·', '·'],
    ['Ã¢â‚¬Â¢', '•'],
    ['Ã¢â‚¬Â¦', '...'],
    ['Ã¢â‚¬â€œ', '-'],
    ['Ã¢â‚¬â€�', '-'],
    ['Ã¢â€ â€™', '->'],
    ['Ãƒâ€šÃ‚Â·', '·'],
    ['Ã¢â€”Â', ''],
    ['Ã¢â€“Â²', ''],
  ];
  replacements.forEach(([bad, good]) => {
    input = input.split(bad).join(good);
  });
  if (!/[ÃÂâ]/.test(input)) return input;
  try {
    const decoded = decodeURIComponent(escape(input));
    const badScore = (s) => (String(s).match(/[ÃÂâ]/g) || []).length;
    return badScore(decoded) < badScore(input) ? decoded : input;
  } catch (_) {
    return input;
  }
}

function sanitizeMojibake(root = document.body) {
  if (!root || !document.createTreeWalker) return;
  const skipTags = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const parentTag = node.parentElement?.tagName;
    if (parentTag && skipTags.has(parentTag)) return;
    const text = node.nodeValue || '';
    if (!/[ÃÂâ]/.test(text)) return;
    const fixed = fixMojibakeText(text);
    if (fixed !== text) node.nodeValue = fixed;
  });
}

window.sanitizeMojibake = sanitizeMojibake;
window.fixMojibakeText = fixMojibakeText;
document.addEventListener('DOMContentLoaded', () => sanitizeMojibake(document.body));

async function handleAuthRedirect(session) {
  if (session && session.user) {
    _L.info('User session detected, checking dashboard for role...', { email: session.user.email });
    const dashboard = await getDashboardForRole(session, {
      unresolvedFallback: appUrl('client_dashboard.html'),
      fastRoleLookup: true
    });
    const currentPage = currentPageName();
    const targetPage = pageNameFromUrlish(dashboard);

    _L.debug(`Redirect check: Current = ${currentPage}, Target = ${targetPage}`);

    // Prevent redirect loop if already on the correct dashboard
    if (currentPage !== targetPage) {
      _L.info(`Redirecting to ${dashboard}`);
      window.location.href = dashboard;
    }
  }
}

// Global function to protect dashboard pages
async function protectDashboard() {
  if (!window.sbClient) return;
  if (window.__SC_PROTECT_IN_FLIGHT) return;
  window.__SC_PROTECT_IN_FLIGHT = true;

  try {
    const { data: { session }, error } = await window.sbClient.auth.getSession();
    if (error || !session) {
      // If not authenticated and not on landing page, redirect to landing page
      const currentPage = currentPageName();
      if (!isLandingPage(currentPage)) {
        window.location.href = appUrl('landing_page.html');
      }
    } else {
      // Make sure the user is allowed to access this dashboard
      const dashboard = await getDashboardForRole(session, { unresolvedFallback: null });
      const currentPage = currentPageName();
      const targetPage = dashboard ? pageNameFromUrlish(dashboard) : '';
      if (dashboard && currentPage !== targetPage && !isLandingPage(currentPage)) {
        // If trying to access a different dashboard without permission
        window.location.href = dashboard;
      }
    }
  } finally {
    window.__SC_PROTECT_IN_FLIGHT = false;
  }
}

// Global function to redirect if heavily logged in
async function redirectIfLoggedIn() {
  if (!window.sbClient) return;
  const { data: { session }, error } = await window.sbClient.auth.getSession();
  if (session) {
    Promise.resolve()
      .then(() => ensureWelcomeEmailForClient(session))
      .catch((e) => _L.debug('Welcome email check during redirectIfLoggedIn failed.', e));
    await handleAuthRedirect(session);
  }
}

// Use google auth configuration
async function initiateGoogleAuth() {
  if (!window.sbClient) {
    _L.error("Supabase client not initialized");
    if (window.showToast) window.showToast('Authentication system not ready. Please refresh.');
    return;
  }

  _L.info("Initiating Google OAuth...");
  const { data, error } = await window.sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: appUrl('landing_page.html'),
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      }
    }
  });

  if (error) {
    _L.error("Google OAuth error:", error);
    if (window.showToast) window.showToast('Authentication failed. Please try again.');
  } else {
    _L.info("Google OAuth initiated successfully");
  }
}

// Global function to sign out
async function signOut() {
  if (!window.sbClient) return;
  const { error } = await window.sbClient.auth.signOut();
  if (error) {
    console.error('Error signing out:', error.message);
  } else {
    window.location.href = appUrl('landing_page.html');
  }
}

// Listener for auth state changes
if (window.sbClient && !window.__SC_AUTH_LISTENER_ATTACHED) {
  window.__SC_AUTH_LISTENER_ATTACHED = true;
  window.sbClient.auth.onAuthStateChange(async (event, session) => {
    _L.debug(`Auth Event: ${event}`, { sessionSet: !!session });

    if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
      if (session?.user) {
        Promise.resolve()
          .then(() => ensureUserProfile(session))
          .then((profile) => ensureWelcomeEmailForClient(session, profile))
          .catch((syncErr) => _L.debug('auth background sync/welcome failed.', syncErr));
      }
      const currentPage = currentPageName();
      if (isLandingPage(currentPage)) {
        await handleAuthRedirect(session);
      }
    } else if (event === 'SIGNED_OUT') {
      _L.info("User signed out, redirecting to landing page.");
      const currentPage = currentPageName();
      if (!isLandingPage(currentPage)) {
        window.location.href = appUrl('landing_page.html');
      }
    }
  });
}

// Explicit global exports for inline page scripts
window.ensureUserProfile = ensureUserProfile;
window.getDashboardForRole = getDashboardForRole;
window.protectDashboard = protectDashboard;
window.redirectIfLoggedIn = redirectIfLoggedIn;
window.initiateGoogleAuth = initiateGoogleAuth;
window.signOut = signOut;

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  // Specifically for admin which uses a class
  if (savedTheme === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
}

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  if (theme === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
}

// Loading States
const loaderCss = `
.loading-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-page, #0A0A0A);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  opacity: 1;
  transition: opacity 0.4s ease;
}
.loading-overlay.hidden {
  opacity: 0;
  pointer-events: none;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: var(--accent, #7DC870);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
[data-theme="light"] .spinner {
  border: 3px solid rgba(0,0,0,0.05);
  border-top-color: var(--accent, #3d8c18);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
`;

function injectLoader() {
  if (!document.getElementById('global-loader-style')) {
    const style = document.createElement('style');
    style.id = 'global-loader-style';
    style.innerHTML = loaderCss;
    document.head.appendChild(style);
  }

  if (document.getElementById('global-loader')) return;

  const loader = document.createElement('div');
  loader.id = 'global-loader';
  loader.className = 'loading-overlay';
  loader.innerHTML = '<div class="spinner"></div>';
  document.body.appendChild(loader);
}

function hideLoader() {
  const loader = document.getElementById('global-loader');
  if (loader) {
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 400);
  }
}

// Auto-inject for dashboards
const isDashboard = window.location.pathname.includes('_dashboard.html');
if (isDashboard && !window.__SC_LOADER_LISTENER_ATTACHED) {
  window.__SC_LOADER_LISTENER_ATTACHED = true;
  window.addEventListener('DOMContentLoaded', injectLoader);
}

// Initialize theme on load
initTheme();

// Toast Notifications
const toastCss = `
.global-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.85);
  color: #fff;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  backdrop-filter: blur(8px);
  animation: toast-in 0.3s ease;
}
[data-theme="light"] .global-toast {
  background: rgba(255,255,255,0.95);
  color: #000;
  border: 1px solid rgba(0,0,0,0.05);
}
@keyframes toast-in {
  from { transform: translate(-50%, 20px); opacity: 0; }
  to { transform: translate(-50%, 0); opacity: 1; }
}
`;

function showToast(msg, duration = 3000) {
  let style = document.getElementById('global-toast-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'global-toast-style';
    style.innerHTML = toastCss;
    document.head.appendChild(style);
  }

  const t = document.createElement('div');
  t.className = 'global-toast';
  t.innerHTML = msg;
  document.body.appendChild(t);

  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%, 10px)';
    t.style.transition = 'all 0.4s ease';
    setTimeout(() => t.remove(), 400);
  }, duration);
}

window.showToast = showToast;

// Replace emoji glyphs with inline SVG icons across pages (UI-safe text replacement)
const EMOJI_ICON_MAP = {
  '\u{1F4B0}': 'money',
  '\u{1F512}': 'lock',
  '\u{2B50}': 'star',
  '\u{23F3}': 'clock',
  '\u{1F44B}': 'wave',
  '\u{1F4BC}': 'briefcase',
  '\u2705': 'check',
  '\u{1F4CB}': 'clipboard',
  '\u{1F4AC}': 'chat',
  '\u{1F4B8}': 'money',
  '\u{1F3E6}': 'bank',
  '\u{1F6A8}': 'alert',
  '\u{1F4C4}': 'file',
  '\u{1F4F7}': 'camera',
  '\u{1F319}': 'moon',
  '\u2600': 'sun',
  '\u26A0': 'alert',
  '\u261D': 'pointer',
  '\u23F0': 'clock',
  '👋': 'wave',
  '💼': 'briefcase',
  '✅': 'check',
  '📋': 'clipboard',
  '💬': 'chat',
  '🔒': 'lock',
  '💸': 'money',
  '🏦': 'bank',
  '🚨': 'alert',
  '📄': 'file',
  '⭐': 'star',
  '📷': 'camera',
  '🌙': 'moon',
  '☀': 'sun',
  '⚠': 'alert',
  '☝': 'pointer',
  '⏰': 'clock'
};

function iconSvg(name) {
  const c = 'currentColor';
  switch (name) {
    case 'wave': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><path d="M4 13c2-4 4-6 6-6s3 1 3 3v8"/><path d="M10 8l2 2"/><path d="M7 10l2 2"/></svg>`;
    case 'briefcase': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    case 'check': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'clipboard': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M6 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/></svg>`;
    case 'chat': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-3 3v-7a8.5 8.5 0 1 1 19-5z"/></svg>`;
    case 'lock': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
    case 'money': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7"/></svg>`;
    case 'bank': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><path d="M3 10h18"/><path d="M5 10v8"/><path d="M9 10v8"/><path d="M15 10v8"/><path d="M19 10v8"/><path d="M2 18h20"/><path d="M12 3l10 5H2z"/></svg>`;
    case 'alert': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    case 'file': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    case 'star': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><polygon points="12 2 15 9 22 9 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9 9 9"/></svg>`;
    case 'camera': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
    case 'moon': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    case 'sun': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>`;
    case 'pointer': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><path d="M9 21V9l8 3-3 2 3 7-2 .8-3-6-3 2z"/></svg>`;
    case 'clock': return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${c}" stroke-width="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>`;
    default: return '';
  }
}

function replaceEmojiInNode(root) {
  if (!root) return;
  const emojiKeys = Object.keys(EMOJI_ICON_MAP).sort((a, b) => b.length - a.length);
  const findTokenAt = (text, index) => {
    for (const token of emojiKeys) {
      if (text.startsWith(token, index)) return token;
    }
    return null;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const parentTag = t.parentElement?.tagName?.toLowerCase();
    if (parentTag === 'script' || parentTag === 'style') continue;
    if (t.nodeValue && emojiKeys.some(e => t.nodeValue.includes(e))) {
      targets.push(t);
    }
  }
  targets.forEach(node => {
    const parent = node.parentNode;
    if (!parent) return;
    const text = node.nodeValue || '';
    const frag = document.createDocumentFragment();
    let cursor = 0;
    while (cursor < text.length) {
      const key = findTokenAt(text, cursor);
      if (key) {
        const span = document.createElement('span');
        span.className = 'emoji-svg-icon';
        span.style.display = 'inline-flex';
        span.style.width = '1em';
        span.style.height = '1em';
        span.style.verticalAlign = '-0.15em';
        span.innerHTML = iconSvg(EMOJI_ICON_MAP[key]);
        frag.appendChild(span);
        cursor += key.length;
      } else {
        let nextIndex = text.length;
        for (let j = cursor + 1; j < text.length; j += 1) {
          if (findTokenAt(text, j)) {
            nextIndex = j;
            break;
          }
        }
        frag.appendChild(document.createTextNode(text.slice(cursor, nextIndex)));
        cursor = nextIndex;
      }
    }
    parent.replaceChild(frag, node);
  });
}

function removeEmojisSitewide() {
  if (window.__SC_EMOJI_OBSERVER_ATTACHED) return;
  window.__SC_EMOJI_OBSERVER_ATTACHED = true;

  const run = () => replaceEmojiInNode(document.body);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  const obs = new MutationObserver(() => run());
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  }, { once: true });
}

removeEmojisSitewide();
