/* =====================================================================
   DB MODULE — sql.js (SQLite WASM) wrapper
   ===================================================================== */

const DB = (() => {
  let SQL = null;         // sql.js module
  let db = null;          // current Database instance
  let fileHandle = null;  // File System Access handle (if supported)
  let fileName = null;
  const hasFS = 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
  const LS_HANDLE_KEY = 'vault.v2.lastFileHint';

  // ---- SCHEMA ----
  const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','supervisor','encoder','viewer')),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      pt_no TEXT NOT NULL,
      item_description TEXT NOT NULL,
      principal_amount REAL NOT NULL DEFAULT 0,
      transaction_type TEXT NOT NULL,
      signature TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_by INTEGER,
      updated_at TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_entries_pt_no     ON entries(pt_no);
    CREATE INDEX IF NOT EXISTS idx_entries_date      ON entries(date);
    CREATE INDEX IF NOT EXISTS idx_entries_created_by ON entries(created_by);

    CREATE TABLE IF NOT EXISTS exits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pt_no TEXT NOT NULL,
      loan_date TEXT NOT NULL,
      item_description TEXT NOT NULL,
      principal_amount REAL NOT NULL DEFAULT 0,
      transaction_type TEXT NOT NULL,
      time_of_transaction TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_by INTEGER,
      updated_at TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_exits_pt_no     ON exits(pt_no);
    CREATE INDEX IF NOT EXISTS idx_exits_loan_date ON exits(loan_date);
    CREATE INDEX IF NOT EXISTS idx_exits_created_by ON exits(created_by);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);

    -- Default meta
    INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', '1');
    INSERT OR IGNORE INTO meta(key, value) VALUES('branch_name', '');
  `;

  // ---- Initialization ----
  async function init() {
    SQL = await initSqlJs({
      locateFile: (f) => 'lib/' + f
    });
  }

  // ---- DB lifecycle ----
  function createEmpty() {
    db = new SQL.Database();
    db.exec(SCHEMA_SQL);
  }

  async function loadFromArrayBuffer(buf) {
    const bytes = new Uint8Array(buf);
    db = new SQL.Database(bytes);
    // Ensure schema is present (for any new tables added in future versions)
    db.exec(SCHEMA_SQL);
  }

  function isOpen() { return db !== null; }

  function close() {
    if (db) { db.close(); db = null; }
    fileHandle = null;
    fileName = null;
  }

  function getFileName() { return fileName; }
  function setFileName(n) { fileName = n; }
  function getFileHandle() { return fileHandle; }
  function setFileHandle(h) { fileHandle = h; }
  function hasFileAPI() { return hasFS; }

  // ---- Export to binary ----
  function exportBytes() {
    return db.export();  // Uint8Array
  }

  // ---- Query helpers ----
  function exec(sql, params) {
    const stmt = db.prepare(sql);
    try {
      if (params) stmt.bind(params);
      stmt.step();
      return db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] ?? null;
    } finally {
      stmt.free();
    }
  }

  function run(sql, params) {
    // For UPDATE/DELETE (no inserted ID to return)
    const stmt = db.prepare(sql);
    try {
      if (params) stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  function all(sql, params) {
    const stmt = db.prepare(sql);
    try {
      if (params) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function one(sql, params) {
    const rows = all(sql, params);
    return rows.length ? rows[0] : null;
  }

  function scalar(sql, params) {
    const row = one(sql, params);
    if (!row) return null;
    return Object.values(row)[0];
  }

  // ---- Meta ----
  function getMeta(key) {
    return scalar('SELECT value FROM meta WHERE key = ?', [key]);
  }
  function setMeta(key, value) {
    run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value ?? '']);
  }

  // ---- Users ----
  function userCount() {
    return scalar('SELECT COUNT(*) FROM users') || 0;
  }

  function createUser({ username, fullName, role, passwordHash, passwordSalt }) {
    const now = new Date().toISOString();
    return exec(
      `INSERT INTO users(username,full_name,role,password_hash,password_salt,is_active,created_at)
       VALUES(?,?,?,?,?,1,?)`,
      [username, fullName, role, passwordHash, passwordSalt, now]
    );
  }

  function findUserByUsername(username) {
    return one('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
  }

  function findUserById(id) {
    return one('SELECT * FROM users WHERE id = ?', [id]);
  }

  function listUsers() {
    return all('SELECT * FROM users ORDER BY role, username');
  }

  function updateUserLastLogin(id) {
    run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  }

  function updateUserPassword(id, passwordHash, passwordSalt) {
    run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [passwordHash, passwordSalt, id]);
  }

  function updateUserRole(id, role) {
    run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  }

  function setUserActive(id, active) {
    run('UPDATE users SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
  }

  function deleteUser(id) {
    run('DELETE FROM users WHERE id = ?', [id]);
  }

  // ---- Entries ----
  function insertEntry(rec, userId) {
    const now = new Date().toISOString();
    return exec(
      `INSERT INTO entries(date,pt_no,item_description,principal_amount,transaction_type,signature,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [rec.date, rec.pt_no, rec.item_description, rec.principal_amount, rec.transaction_type, rec.signature || '', userId, now]
    );
  }

  function updateEntry(id, rec, userId) {
    const now = new Date().toISOString();
    run(
      `UPDATE entries SET date=?, pt_no=?, item_description=?, principal_amount=?, transaction_type=?, signature=?, updated_by=?, updated_at=?
       WHERE id = ?`,
      [rec.date, rec.pt_no, rec.item_description, rec.principal_amount, rec.transaction_type, rec.signature || '', userId, now, id]
    );
  }

  function deleteEntry(id) {
    run('DELETE FROM entries WHERE id = ?', [id]);
  }

  function getEntry(id) {
    return one(`
      SELECT e.*, u.username AS created_by_username, u.full_name AS created_by_name
      FROM entries e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?
    `, [id]);
  }

  function listEntries(opts = {}) {
    // opts: { scopeUserId: number|null (null=all), search: string }
    const where = [];
    const params = [];
    if (opts.scopeUserId) { where.push('e.created_by = ?'); params.push(opts.scopeUserId); }
    const sql = `
      SELECT e.*, u.username AS created_by_username, u.full_name AS created_by_name
      FROM entries e LEFT JOIN users u ON u.id = e.created_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.date DESC, e.id DESC
    `;
    return all(sql, params);
  }

  // ---- Exits ----
  function insertExit(rec, userId) {
    const now = new Date().toISOString();
    return exec(
      `INSERT INTO exits(pt_no,loan_date,item_description,principal_amount,transaction_type,time_of_transaction,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [rec.pt_no, rec.loan_date, rec.item_description, rec.principal_amount, rec.transaction_type, rec.time_of_transaction, userId, now]
    );
  }

  function updateExit(id, rec, userId) {
    const now = new Date().toISOString();
    run(
      `UPDATE exits SET pt_no=?, loan_date=?, item_description=?, principal_amount=?, transaction_type=?, time_of_transaction=?, updated_by=?, updated_at=?
       WHERE id = ?`,
      [rec.pt_no, rec.loan_date, rec.item_description, rec.principal_amount, rec.transaction_type, rec.time_of_transaction, userId, now, id]
    );
  }

  function deleteExit(id) {
    run('DELETE FROM exits WHERE id = ?', [id]);
  }

  function getExit(id) {
    return one(`
      SELECT x.*, u.username AS created_by_username, u.full_name AS created_by_name
      FROM exits x LEFT JOIN users u ON u.id = x.created_by WHERE x.id = ?
    `, [id]);
  }

  function listExits(opts = {}) {
    const where = [];
    const params = [];
    if (opts.scopeUserId) { where.push('x.created_by = ?'); params.push(opts.scopeUserId); }
    const sql = `
      SELECT x.*, u.username AS created_by_username, u.full_name AS created_by_name
      FROM exits x LEFT JOIN users u ON u.id = x.created_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY x.loan_date DESC, x.id DESC
    `;
    return all(sql, params);
  }

  // ---- Audit log ----
  function audit(user, action, targetType, targetId, details) {
    run(
      `INSERT INTO audit_log(at,user_id,username,action,target_type,target_id,details)
       VALUES(?,?,?,?,?,?,?)`,
      [new Date().toISOString(), user?.id || null, user?.username || null, action, targetType || null, targetId || null, details || null]
    );
  }

  function listAudit(limit = 500) {
    return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
  }

  function auditCount() {
    return scalar('SELECT COUNT(*) FROM audit_log') || 0;
  }

  // ---- Public API ----
  return {
    init, createEmpty, loadFromArrayBuffer, isOpen, close, exportBytes,
    getFileName, setFileName, getFileHandle, setFileHandle, hasFileAPI,
    all, one, scalar, run, exec,
    getMeta, setMeta,
    userCount, createUser, findUserByUsername, findUserById, listUsers,
    updateUserLastLogin, updateUserPassword, updateUserRole, setUserActive, deleteUser,
    insertEntry, updateEntry, deleteEntry, getEntry, listEntries,
    insertExit, updateExit, deleteExit, getExit, listExits,
    audit, listAudit, auditCount
  };
})();
