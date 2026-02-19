/**
 * Auth module — handles both local dev (JWT against Express API) and
 * production (amazon-cognito-identity-js via CDN).
 *
 * Public API:
 *   Auth.init()          → loads config, returns user or null
 *   Auth.login(email, pw)→ stores tokens, returns user
 *   Auth.logout()        → clears state, redirects to login
 *   Auth.getUser()       → returns current user object or null
 *   Auth.isAdmin()       → true if user has admin role/group
 *   Auth.requireAuth()   → call at top of protected pages; redirects if not authed
 */

const Auth = (() => {
  let _user = null;

  // ── Storage helpers ─────────────────────────────────────────────────────────

  function saveSession(token, user) {
    sessionStorage.setItem('access_token', token);
    sessionStorage.setItem('user', JSON.stringify(user));
    _user = user;
  }

  function clearSession() {
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('user');
    _user = null;
  }

  function loadSession() {
    const stored = sessionStorage.getItem('user');
    if (stored) {
      try { _user = JSON.parse(stored); } catch { _user = null; }
    }
    return _user;
  }

  // ── Local dev auth ──────────────────────────────────────────────────────────

  async function localLogin(email, password) {
    const data = await API.post('/auth/login', { email, password });
    saveSession(data.token, data.user);
    return data.user;
  }

  // ── Cognito auth (production) ───────────────────────────────────────────────

  async function loadCognitoConfig() {
    try {
      const cfg = await API.get('/config');
      CONFIG.COGNITO.userPoolId = cfg.userPoolId;
      CONFIG.COGNITO.clientId   = cfg.clientId;
      CONFIG.COGNITO.region     = cfg.region;
    } catch (e) {
      console.warn('Could not load Cognito config:', e.message);
    }
  }

  function getCognitoPool() {
    const { CognitoUserPool } = window.AmazonCognitoIdentity;
    return new CognitoUserPool({
      UserPoolId: CONFIG.COGNITO.userPoolId,
      ClientId:   CONFIG.COGNITO.clientId,
    });
  }

  function cognitoLogin(email, password) {
    return new Promise((resolve, reject) => {
      const { AuthenticationDetails, CognitoUser } = window.AmazonCognitoIdentity;
      const pool = getCognitoPool();

      const authDetails = new AuthenticationDetails({ Username: email, Password: password });
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess(session) {
          const idToken = session.getIdToken();
          const payload = idToken.decodePayload();
          const user = {
            id:         payload.sub,
            email:      payload.email,
            first_name: payload.given_name  || '',
            last_name:  payload.family_name || '',
            role:       (payload['cognito:groups'] || []).includes('Admins') ? 'admin' : 'user',
          };
          saveSession(idToken.getJwtToken(), user);
          resolve(user);
        },
        onFailure(err) {
          reject(new Error(err.message || 'Authentication failed'));
        },
        newPasswordRequired() {
          reject(new Error('NEW_PASSWORD_REQUIRED'));
        },
      });
    });
  }

  function cognitoLogout() {
    try {
      const pool = getCognitoPool();
      const u    = pool.getCurrentUser();
      if (u) u.signOut();
    } catch { /* ignore */ }
  }

  function getCognitoCurrentUser() {
    return new Promise((resolve) => {
      try {
        const pool = getCognitoPool();
        const u    = pool.getCurrentUser();
        if (!u) return resolve(null);

        u.getSession((err, session) => {
          if (err || !session?.isValid()) return resolve(null);
          const payload = session.getIdToken().decodePayload();
          const user = {
            id:         payload.sub,
            email:      payload.email,
            first_name: payload.given_name  || '',
            last_name:  payload.family_name || '',
            role:       (payload['cognito:groups'] || []).includes('Admins') ? 'admin' : 'user',
          };
          saveSession(session.getIdToken().getJwtToken(), user);
          resolve(user);
        });
      } catch {
        resolve(null);
      }
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async function init() {
    if (!CONFIG.IS_LOCAL) {
      await loadCognitoConfig();
      const u = await getCognitoCurrentUser();
      if (u) { _user = u; return u; }
    }
    return loadSession();
  }

  async function login(email, password) {
    if (CONFIG.IS_LOCAL) return localLogin(email, password);
    return cognitoLogin(email, password);
  }

  function logout() {
    if (!CONFIG.IS_LOCAL) cognitoLogout();
    clearSession();
    window.location.href = '/login.html';
  }

  function getUser() { return _user || loadSession(); }

  function isAdmin() {
    const u = getUser();
    return u?.role === 'admin';
  }

  function requireAuth() {
    const u = getUser();
    if (!u) {
      window.location.href = '/login.html';
      return null;
    }
    return u;
  }

  function highlightNav() {
    const path = window.location.pathname;
    document.querySelectorAll('.navbar-actions a[href]').forEach(a => {
      if (a.getAttribute('href') === path) a.classList.add('active');
    });
  }

  document.addEventListener('DOMContentLoaded', highlightNav);

  return { init, login, logout, getUser, isAdmin, requireAuth };
})();

window.Auth = Auth;
