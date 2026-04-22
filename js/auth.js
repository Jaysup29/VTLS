/* =====================================================================
   AUTH MODULE — password hashing (PBKDF2), session, permissions
   ===================================================================== */

const Auth = (() => {
  const SESSION_KEY = 'vault.v2.session';
  const IDLE_LIMIT_MS = 30 * 60 * 1000;  // 30 min idle auto-logout
  const PBKDF2_ITERATIONS = 100000;
  const SALT_BYTES = 16;
  const HASH_BYTES = 32;

  let currentUser = null;
  let lastActivity = Date.now();
  let idleTimerId = null;

  // ---- Utility: bytes <-> base64 ----
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // ---- PBKDF2 password hashing ----
  async function hashPassword(password, saltB64) {
    const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const pwBuf = new TextEncoder().encode(password);
    const keyMaterial = await crypto.subtle.importKey(
      'raw', pwBuf, { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      HASH_BYTES * 8
    );
    return { hash: bytesToB64(new Uint8Array(bits)), salt: bytesToB64(salt) };
  }

  async function verifyPassword(password, storedHash, storedSalt) {
    const { hash } = await hashPassword(password, storedSalt);
    // Constant-time compare
    if (hash.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    return diff === 0;
  }

  // ---- Session ----
  function saveSession() {
    if (currentUser) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        id: currentUser.id,
        username: currentUser.username,
        fullName: currentUser.full_name,
        role: currentUser.role,
        loggedInAt: currentUser.loggedInAt
      }));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  function restoreSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      // Verify that user still exists and is active in the current DB
      const dbUser = DB.findUserById(s.id);
      if (!dbUser || !dbUser.is_active) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      currentUser = {
        id: dbUser.id,
        username: dbUser.username,
        full_name: dbUser.full_name,
        role: dbUser.role,
        loggedInAt: s.loggedInAt
      };
      startIdleTimer();
      return currentUser;
    } catch (e) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function currentUserRecord() { return currentUser; }

  async function login(username, password) {
    const user = DB.findUserByUsername(username);
    if (!user) return { ok: false, error: 'Invalid username or password' };
    if (!user.is_active) return { ok: false, error: 'This account has been disabled' };
    const ok = await verifyPassword(password, user.password_hash, user.password_salt);
    if (!ok) return { ok: false, error: 'Invalid username or password' };

    currentUser = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      loggedInAt: new Date().toISOString()
    };
    DB.updateUserLastLogin(user.id);
    DB.audit(currentUser, 'login', 'user', user.id, null);
    saveSession();
    startIdleTimer();
    return { ok: true, user: currentUser };
  }

  function logout(reason) {
    if (currentUser) {
      DB.audit(currentUser, 'logout', 'user', currentUser.id, reason || null);
    }
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    stopIdleTimer();
  }

  async function changePassword(userId, currentPw, newPw) {
    const u = DB.findUserById(userId);
    if (!u) return { ok: false, error: 'User not found' };
    const ok = await verifyPassword(currentPw, u.password_hash, u.password_salt);
    if (!ok) return { ok: false, error: 'Current password is incorrect' };
    const { hash, salt } = await hashPassword(newPw);
    DB.updateUserPassword(userId, hash, salt);
    DB.audit(currentUser, 'change_password', 'user', userId, null);
    return { ok: true };
  }

  async function adminResetPassword(targetUserId, newPw) {
    if (!can('manage_users')) return { ok: false, error: 'Not authorized' };
    const { hash, salt } = await hashPassword(newPw);
    DB.updateUserPassword(targetUserId, hash, salt);
    const target = DB.findUserById(targetUserId);
    DB.audit(currentUser, 'reset_password', 'user', targetUserId, `Reset password for ${target?.username}`);
    return { ok: true };
  }

  async function createUserAccount({ username, fullName, role, password }) {
    if (!can('manage_users') && DB.userCount() > 0) {
      return { ok: false, error: 'Not authorized' };
    }
    const existing = DB.findUserByUsername(username);
    if (existing) return { ok: false, error: 'Username already taken' };
    const { hash, salt } = await hashPassword(password);
    const id = DB.createUser({
      username: username.trim(),
      fullName: fullName.trim(),
      role,
      passwordHash: hash,
      passwordSalt: salt
    });
    DB.audit(currentUser, 'create_user', 'user', id, `Created ${role} user ${username}`);
    return { ok: true, id };
  }

  // ---- Idle timer ----
  function startIdleTimer() {
    stopIdleTimer();
    lastActivity = Date.now();
    idleTimerId = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_LIMIT_MS) {
        logout('idle timeout');
        if (typeof App !== 'undefined' && App.onIdleLogout) App.onIdleLogout();
      }
    }, 30000);
    // reset activity on user input
    ['click', 'keydown', 'mousemove'].forEach(ev => {
      document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true });
    });
  }

  function stopIdleTimer() {
    if (idleTimerId) clearInterval(idleTimerId);
    idleTimerId = null;
  }

  // ---- Permissions ----
  // Ability matrix per role
  const ABILITIES = {
    admin: {
      manage_users: true,
      view_audit: true,
      write_entries: true,
      write_exits: true,
      edit_all: true,
      delete_all: true,
      view_all: true,
      view_dashboard: true,
    },
    supervisor: {
      manage_users: false,
      view_audit: true,
      write_entries: true,
      write_exits: true,
      edit_all: true,
      delete_all: true,
      view_all: true,
      view_dashboard: true,
    },
    encoder: {
      manage_users: false,
      view_audit: false,
      write_entries: true,
      write_exits: true,
      edit_all: false,
      delete_all: false,
      view_all: false,  // own records only
      view_dashboard: true,  // dashboard shows scoped data
    },
    viewer: {
      manage_users: false,
      view_audit: false,
      write_entries: false,
      write_exits: false,
      edit_all: false,
      delete_all: false,
      view_all: true,
      view_dashboard: true,
    }
  };

  function can(ability) {
    if (!currentUser) return false;
    const caps = ABILITIES[currentUser.role];
    return !!(caps && caps[ability]);
  }

  // Can current user edit/delete a specific record?
  function canModifyRecord(record) {
    if (!currentUser) return false;
    if (can('edit_all')) return true;
    // Encoders: only their own
    return record.created_by === currentUser.id;
  }

  // Scope user ID for list queries — null means no filter (see all)
  function scopeUserId() {
    if (!currentUser) return null;
    if (can('view_all')) return null;
    return currentUser.id;
  }

  function scopeLabel() {
    if (!currentUser) return '';
    if (can('view_all')) return '';
    return 'Your records only';
  }

  return {
    hashPassword, verifyPassword,
    login, logout, restoreSession, saveSession, currentUserRecord,
    changePassword, adminResetPassword, createUserAccount,
    can, canModifyRecord, scopeUserId, scopeLabel,
    startIdleTimer, stopIdleTimer
  };
})();
