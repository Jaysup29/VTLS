/* =====================================================================
   VAULT LEDGER v2 — Main application module
   ===================================================================== */

const App = (() => {
  // ---- DOM helpers ----
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = (d) => {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('en-PH', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };
  const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hh = parseInt(h, 10);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = ((hh + 11) % 12) + 1;
    return `${h12}:${m} ${ampm}`;
  };
  const fmtDateTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  // ---- State ----
  let editingTab = null;
  let editingId = null;
  let sortState = { entry: { col: null, dir: 1 }, exit: { col: null, dir: 1 } };
  let searchText = { entry: '', exit: '', active: '', audit: '' };
  let dashRange = 'all';
  let trendMetric = 'count';
  let dirty = false;

  // Cache lists (queried fresh on every render for accuracy)
  function entries()  { return DB.listEntries({ scopeUserId: Auth.scopeUserId() }); }
  function exits()    { return DB.listExits({ scopeUserId: Auth.scopeUserId() }); }
  // For dashboard "Active Pawns" — always scoped to same rule
  function allEntriesForActive() { return DB.listEntries({ scopeUserId: Auth.scopeUserId() }); }
  function allExitsForActive() { return DB.listExits({ scopeUserId: Auth.scopeUserId() }); }

  // ---- Toast + confirm ----
  function toast(msg, kind = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + kind;
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.className = 'toast ' + kind, 2400);
  }
  function confirmDialog(title, message) {
    return new Promise((resolve) => {
      const dlg = $('confirmDialog');
      $('confirmTitle').textContent = title;
      $('confirmMessage').textContent = message;
      const ok = () => { cleanup(); resolve(true); };
      const cancel = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        $('confirmOk').removeEventListener('click', ok);
        $('confirmCancel').removeEventListener('click', cancel);
        dlg.close();
      };
      $('confirmOk').addEventListener('click', ok);
      $('confirmCancel').addEventListener('click', cancel);
      dlg.showModal();
    });
  }

  // ---- Screen management ----
  function showScreen(name) {
    ['loadingScreen', 'dbScreen', 'setupScreen', 'loginScreen', 'appScreen'].forEach(id => {
      const el = $(id);
      if (el) el.style.display = id === name ? '' : 'none';
    });
  }

  // ---- Dirty flag / status ----
  function markDirty(flag = true) {
    dirty = flag;
    const ind = $('statusIndicator');
    const txt = $('statusText');
    if (!ind) return;
    ind.className = 'status-indicator ' + (flag ? 'unsaved' : 'saved');
    const name = DB.getFileName();
    if (name) txt.textContent = name + (flag ? ' · unsaved changes' : ' · saved');
    else txt.textContent = flag ? 'In-memory DB · unsaved' : 'Database loaded';
  }

  // ---- DB screen handlers ----
  function setupDbScreen() {
    $('btnCreateDb').addEventListener('click', async () => {
      DB.createEmpty();
      DB.setFileName(null);
      DB.setFileHandle(null);
      afterDbLoaded();
      toast('Empty database created. Please save it to a file soon.', 'success');
    });
    $('btnOpenDb').addEventListener('click', async () => {
      await openDb();
    });
  }

  async function openDb() {
    try {
      if (DB.hasFileAPI()) {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'SQLite database', accept: { 'application/x-sqlite3': ['.db', '.sqlite', '.sqlite3'] } }],
          multiple: false
        });
        const file = await handle.getFile();
        const buf = await file.arrayBuffer();
        await DB.loadFromArrayBuffer(buf);
        DB.setFileHandle(handle);
        DB.setFileName(file.name);
        afterDbLoaded();
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.db,.sqlite,.sqlite3';
        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return;
          const buf = await file.arrayBuffer();
          await DB.loadFromArrayBuffer(buf);
          DB.setFileName(file.name);
          afterDbLoaded();
        };
        input.click();
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('Failed to open: ' + err.message, 'error');
    }
  }

  function afterDbLoaded() {
    // Route based on whether users exist
    if (DB.userCount() === 0) {
      showScreen('setupScreen');
      $('setupFullName').focus();
    } else {
      const name = DB.getFileName() || '(in-memory)';
      $('loginDbName').textContent = name;
      // Try to restore session
      const restored = Auth.restoreSession();
      if (restored) enterApp();
      else {
        showScreen('loginScreen');
        $('loginUsername').focus();
      }
    }
  }

  // ---- Setup (first admin) ----
  function setupSetupScreen() {
    $('setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('setupError');
      err.textContent = '';
      const pw = $('setupPassword').value;
      const pw2 = $('setupPasswordConfirm').value;
      if (pw !== pw2) { err.textContent = 'Passwords do not match.'; return; }
      if (pw.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
      const username = $('setupUsername').value.trim();
      const fullName = $('setupFullName').value.trim();
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
        err.textContent = 'Username must be 3-32 chars (letters, digits, _ . - only).';
        return;
      }
      const result = await Auth.createUserAccount({ username, fullName, role: 'admin', password: pw });
      if (!result.ok) { err.textContent = result.error; return; }
      // Now log in automatically
      const loginResult = await Auth.login(username, pw);
      if (!loginResult.ok) { err.textContent = loginResult.error; return; }
      markDirty(true);
      enterApp();
      toast('Welcome, ' + fullName + '! Save the database to persist your admin account.', 'success');
    });
  }

  // ---- Login ----
  function setupLoginScreen() {
    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('loginError');
      err.textContent = '';
      const username = $('loginUsername').value.trim();
      const password = $('loginPassword').value;
      const result = await Auth.login(username, password);
      if (!result.ok) {
        err.textContent = result.error;
        $('loginPassword').value = '';
        $('loginPassword').focus();
        return;
      }
      $('loginPassword').value = '';
      markDirty(true);  // last_login_at was updated
      enterApp();
      toast('Welcome back, ' + result.user.full_name, 'success');
    });
    $('loginSwitchDb').addEventListener('click', () => {
      DB.close();
      Auth.logout();
      showScreen('dbScreen');
    });
  }

  // ---- Enter app ----
  function enterApp() {
    showScreen('appScreen');
    applyRoleUI();
    const user = Auth.currentUserRecord();
    $('userChipAvatar').textContent = (user.full_name || user.username || '?').charAt(0).toUpperCase();
    $('userChipName').textContent = user.full_name;
    $('userChipRole').textContent = user.role;
    // Branch name
    $('branchName').value = DB.getMeta('branch_name') || '';
    // Default form dates
    const today = new Date().toISOString().slice(0, 10);
    $('e_date').value = today;
    $('x_loanDate').value = today;
    const now = new Date();
    $('x_time').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    refreshAll();
    markDirty(dirty);

    // Activate default tab (dashboard)
    switchTab('dashboard');
  }

  // ---- Role-based UI ----
  function applyRoleUI() {
    // Hide tabs not allowed for this role
    document.querySelectorAll('nav.tabs button[data-requires-role]').forEach(btn => {
      const required = btn.dataset.requiresRole.split(',').map(s => s.trim());
      const user = Auth.currentUserRecord();
      if (!user || !required.includes(user.role)) btn.classList.add('hidden-tab');
      else btn.classList.remove('hidden-tab');
    });

    // Hide forms for write-restricted roles
    document.querySelectorAll('[data-requires-write]').forEach(el => {
      const what = el.dataset.requiresWrite;
      const ability = what === 'entry' ? 'write_entries' : 'write_exits';
      el.style.display = Auth.can(ability) ? '' : 'none';
    });

    // Scope badge text
    const label = Auth.scopeLabel();
    ['entryScopeBadge', 'exitScopeBadge'].forEach(id => {
      const el = $(id);
      if (el) {
        el.textContent = label;
        if (label) el.classList.remove('empty'); else el.classList.add('empty');
      }
    });
    $('dashScope').textContent = label ? '· ' + label : '';

    // Hide "Created By" column when scope is own-only (redundant info)
    const bodyScope = Auth.scopeUserId() ? 'hide-created-by-col' : '';
    document.body.classList.remove('hide-created-by-col');
    if (bodyScope) document.body.classList.add(bodyScope);
  }

  // ---- Refresh everything ----
  function refreshAll() {
    renderTable('entry');
    renderTable('exit');
    renderDashboard();
    renderUsersTable();
    renderAuditTable();
    updateTabCounts();
  }

  function updateTabCounts() {
    $('entryCount').textContent = entries().length;
    $('exitCount').textContent = exits().length;
  }

  // ---- Table rendering ----
  function renderTable(kind) {
    const list = kind === 'entry' ? entries() : exits();
    const tbody = $(kind === 'entry' ? 'entryTbody' : 'exitTbody');
    const totalCell = $(kind === 'entry' ? 'entryTotal' : 'exitTotal');

    const q = searchText[kind].toLowerCase().trim();
    let rows = list.slice();

    if (q) {
      rows = rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));
    }

    const ss = sortState[kind];
    if (ss.col) {
      rows.sort((a, b) => {
        let av = a[ss.col], bv = b[ss.col];
        if (ss.col === 'principal_amount') { av = Number(av || 0); bv = Number(bv || 0); }
        else { av = String(av ?? '').toLowerCase(); bv = String(bv ?? '').toLowerCase(); }
        return av < bv ? -ss.dir : av > bv ? ss.dir : 0;
      });
    }

    const total = list.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
    totalCell.textContent = fmt(total);

    document.querySelectorAll(`#${kind}Table th[data-sort]`).forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      const ind = th.querySelector('.sort-ind');
      if (th.dataset.sort === ss.col) {
        th.classList.add(ss.dir === 1 ? 'sorted-asc' : 'sorted-desc');
        if (ind) ind.textContent = ss.dir === 1 ? '↑' : '↓';
      } else if (ind) ind.textContent = '↕';
    });

    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${q ? 'No matches for your search.' : 'No records yet.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => rowHtml(kind, r)).join('');
  }

  function rowHtml(kind, r) {
    const isEditing = editingId === r.id && editingTab === kind;
    const canModify = Auth.canModifyRecord(r);
    const canWrite = Auth.can(kind === 'entry' ? 'write_entries' : 'write_exits');
    const scopeVisible = !Auth.scopeUserId();  // only show Created By when user sees all

    if (isEditing) {
      return editingRowHtml(kind, r);
    }

    const createdByCell = scopeVisible
      ? `<td class="scope-visible">${esc(r.created_by_name || r.created_by_username || '—')}</td>`
      : '';

    const typeBadge = `<span class="badge ${esc((r.transaction_type || '').replace(/[^A-Za-z0-9-]/g, '-'))}">${esc(r.transaction_type || '')}</span>`;

    let actionsHtml = '';
    if (canWrite && canModify) {
      actionsHtml = `
        <button class="btn-icon" data-act="edit" data-kind="${kind}" data-id="${r.id}">Edit</button>
        <button class="btn-danger" data-act="delete" data-kind="${kind}" data-id="${r.id}">Delete</button>`;
    } else {
      actionsHtml = '<span class="hint">—</span>';
    }

    if (kind === 'entry') {
      return `<tr data-id="${r.id}">
        <td>${esc(fmtDate(r.date))}</td>
        <td>${esc(r.pt_no)}</td>
        <td>${esc(r.item_description)}</td>
        <td class="numeric">${fmt(r.principal_amount)}</td>
        <td>${typeBadge}</td>
        <td>${esc(r.signature || '')}</td>
        ${createdByCell}
        <td class="row-actions">${actionsHtml}</td>
      </tr>`;
    } else {
      return `<tr data-id="${r.id}">
        <td>${esc(r.pt_no)}</td>
        <td>${esc(fmtDate(r.loan_date))}</td>
        <td>${esc(r.item_description)}</td>
        <td class="numeric">${fmt(r.principal_amount)}</td>
        <td>${typeBadge}</td>
        <td>${esc(fmtTime(r.time_of_transaction))}</td>
        ${createdByCell}
        <td class="row-actions">${actionsHtml}</td>
      </tr>`;
    }
  }

  function editingRowHtml(kind, r) {
    const scopeVisible = !Auth.scopeUserId();
    const createdByCell = scopeVisible ? `<td class="scope-visible">${esc(r.created_by_name || '')}</td>` : '';
    if (kind === 'entry') {
      return `<tr class="editing" data-id="${r.id}">
        <td><input type="date" data-f="date" value="${esc(r.date)}"></td>
        <td><input type="text" data-f="pt_no" value="${esc(r.pt_no)}"></td>
        <td><input type="text" data-f="item_description" value="${esc(r.item_description)}"></td>
        <td><input type="number" step="0.01" min="0" data-f="principal_amount" value="${esc(r.principal_amount)}"></td>
        <td>${typeSelect('entry', r.transaction_type)}</td>
        <td><input type="text" data-f="signature" value="${esc(r.signature || '')}"></td>
        ${createdByCell}
        <td class="row-actions">
          <button class="btn-icon" data-act="save" data-kind="entry" data-id="${r.id}">Save</button>
          <button class="btn-icon" data-act="cancel">Cancel</button>
        </td>
      </tr>`;
    } else {
      return `<tr class="editing" data-id="${r.id}">
        <td><input type="text" data-f="pt_no" value="${esc(r.pt_no)}"></td>
        <td><input type="date" data-f="loan_date" value="${esc(r.loan_date)}"></td>
        <td><input type="text" data-f="item_description" value="${esc(r.item_description)}"></td>
        <td><input type="number" step="0.01" min="0" data-f="principal_amount" value="${esc(r.principal_amount)}"></td>
        <td>${typeSelect('exit', r.transaction_type)}</td>
        <td><input type="time" data-f="time_of_transaction" value="${esc(r.time_of_transaction)}"></td>
        ${createdByCell}
        <td class="row-actions">
          <button class="btn-icon" data-act="save" data-kind="exit" data-id="${r.id}">Save</button>
          <button class="btn-icon" data-act="cancel">Cancel</button>
        </td>
      </tr>`;
    }
  }

  function typeSelect(kind, current) {
    const opts = kind === 'entry'
      ? ['NP', 'Ren', 'Re-app', 'OMEE', '2MEE', 'BD']
      : ['Ren', 'Red', 'Re-app', 'OMEE', '2MEE'];
    return `<select data-f="transaction_type">${opts.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  }

  // ---- CRUD handlers ----
  function setupEntryForm() {
    $('entryForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!Auth.can('write_entries')) return;
      const rec = {
        date: $('e_date').value,
        pt_no: $('e_ptNo').value.trim(),
        item_description: $('e_desc').value.trim(),
        principal_amount: Number($('e_amount').value || 0),
        transaction_type: $('e_type').value,
        signature: $('e_sig').value.trim()
      };
      if (!rec.date || !rec.pt_no || !rec.item_description || !rec.transaction_type) {
        toast('Please fill in all required fields.', 'error');
        return;
      }
      const id = DB.insertEntry(rec, Auth.currentUserRecord().id);
      DB.audit(Auth.currentUserRecord(), 'create_entry', 'entry', id, `PT ${rec.pt_no}, ₱${fmt(rec.principal_amount)}`);
      markDirty();
      renderTable('entry');
      renderDashboard();
      updateTabCounts();
      $('entryForm').reset();
      $('e_date').value = new Date().toISOString().slice(0, 10);
      $('e_ptNo').focus();
      toast('Entry added ✓', 'success');
    });
    $('entryResetBtn').addEventListener('click', () => $('entryForm').reset());
  }

  function setupExitForm() {
    $('exitForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!Auth.can('write_exits')) return;
      const rec = {
        pt_no: $('x_ptNo').value.trim(),
        loan_date: $('x_loanDate').value,
        item_description: $('x_desc').value.trim(),
        principal_amount: Number($('x_amount').value || 0),
        transaction_type: $('x_type').value,
        time_of_transaction: $('x_time').value
      };
      if (!rec.pt_no || !rec.loan_date || !rec.item_description || !rec.transaction_type || !rec.time_of_transaction) {
        toast('Please fill in all required fields.', 'error');
        return;
      }
      const id = DB.insertExit(rec, Auth.currentUserRecord().id);
      DB.audit(Auth.currentUserRecord(), 'create_exit', 'exit', id, `PT ${rec.pt_no}, type ${rec.transaction_type}`);
      markDirty();
      renderTable('exit');
      renderDashboard();
      updateTabCounts();
      $('exitForm').reset();
      $('x_loanDate').value = new Date().toISOString().slice(0, 10);
      const now = new Date();
      $('x_time').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      $('x_ptNo').focus();
      toast('Exit added ✓', 'success');
    });
    $('exitResetBtn').addEventListener('click', () => $('exitForm').reset());
  }

  // Delegated row action handler (edit / delete / save / cancel)
  function setupRowActions() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const kind = btn.dataset.kind;
      const id = Number(btn.dataset.id);

      if (act === 'edit') {
        editingId = id;
        editingTab = kind;
        renderTable(kind);
      } else if (act === 'cancel') {
        editingId = null;
        editingTab = null;
        if (kind) renderTable(kind); else { renderTable('entry'); renderTable('exit'); }
      } else if (act === 'save') {
        const row = document.querySelector(`#${kind}Tbody tr[data-id="${id}"]`);
        if (!row) return;
        const rec = {};
        row.querySelectorAll('[data-f]').forEach(el => {
          rec[el.dataset.f] = el.type === 'number' ? Number(el.value || 0) : (el.value.trim ? el.value.trim() : el.value);
        });
        const before = kind === 'entry' ? DB.getEntry(id) : DB.getExit(id);
        if (!Auth.canModifyRecord(before)) { toast('Not authorized', 'error'); return; }
        if (kind === 'entry') DB.updateEntry(id, rec, Auth.currentUserRecord().id);
        else DB.updateExit(id, rec, Auth.currentUserRecord().id);
        DB.audit(Auth.currentUserRecord(), 'update_' + kind, kind, id, `PT ${rec.pt_no}`);
        editingId = null; editingTab = null;
        markDirty();
        renderTable(kind);
        renderDashboard();
        toast('Changes saved ✓', 'success');
      } else if (act === 'delete') {
        const rec = kind === 'entry' ? DB.getEntry(id) : DB.getExit(id);
        if (!Auth.canModifyRecord(rec)) { toast('Not authorized', 'error'); return; }
        const ok = await confirmDialog('Delete this row?', 'This cannot be undone.');
        if (!ok) return;
        if (kind === 'entry') DB.deleteEntry(id); else DB.deleteExit(id);
        DB.audit(Auth.currentUserRecord(), 'delete_' + kind, kind, id, `PT ${rec?.pt_no || ''}`);
        markDirty();
        renderTable(kind);
        renderDashboard();
        updateTabCounts();
        toast('Row deleted', 'error');
      } else if (act === 'reset-pw') {
        openResetPasswordDialog(id);
      } else if (act === 'toggle-active') {
        await toggleUserActive(id);
      } else if (act === 'change-role') {
        const newRole = btn.dataset.role;
        await changeUserRole(id, newRole);
      } else if (act === 'delete-user') {
        await deleteUserConfirm(id);
      }
    });
  }

  // ---- Branch / Tabs / Search / Sort ----
  function setupBranchInput() {
    $('branchName').addEventListener('input', (e) => {
      DB.setMeta('branch_name', e.target.value);
      markDirty();
    });
  }

  function switchTab(tabName) {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === tabName + 'Panel'));
  }

  function setupTabs() {
    document.querySelectorAll('nav.tabs button').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function setupSearchAndSort() {
    $('entrySearch').addEventListener('input', (e) => { searchText.entry = e.target.value; renderTable('entry'); });
    $('exitSearch').addEventListener('input', (e) => { searchText.exit = e.target.value; renderTable('exit'); });
    $('activeSearch').addEventListener('input', (e) => { searchText.active = e.target.value; renderActivePawns(); });
    $('auditSearch').addEventListener('input', (e) => { searchText.audit = e.target.value; renderAuditTable(); });

    ['entry', 'exit'].forEach(kind => {
      document.querySelectorAll(`#${kind}Table th[data-sort]`).forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.sort;
          const s = sortState[kind];
          if (s.col === col) s.dir = -s.dir; else { s.col = col; s.dir = 1; }
          renderTable(kind);
        });
      });
    });
  }

  // ---- DB save/export ----
  function setupDbToolbar() {
    $('btnSaveDb').addEventListener('click', () => saveDb(false));
    $('btnSaveDbAs').addEventListener('click', () => saveDb(true));
    $('btnExportDb').addEventListener('click', () => exportDb());

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDb(false);
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  async function saveDb(saveAs) {
    const bytes = DB.exportBytes();
    if (DB.hasFileAPI()) {
      try {
        let handle = DB.getFileHandle();
        if (!handle || saveAs) {
          handle = await window.showSaveFilePicker({
            suggestedName: DB.getFileName() || defaultDbName(),
            types: [{ description: 'SQLite database', accept: { 'application/x-sqlite3': ['.db'] } }]
          });
          DB.setFileHandle(handle);
          DB.setFileName(handle.name);
        }
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        markDirty(false);
        toast('Saved to ' + DB.getFileName(), 'success');
      } catch (err) {
        if (err.name !== 'AbortError') toast('Save failed: ' + err.message, 'error');
      }
    } else {
      exportDb();
    }
  }

  function exportDb() {
    const bytes = DB.exportBytes();
    const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = DB.getFileName() || defaultDbName();
    a.click();
    URL.revokeObjectURL(url);
    if (!DB.hasFileAPI()) markDirty(false);
    toast('Downloaded ' + a.download, 'success');
  }

  function defaultDbName() {
    const b = (DB.getMeta('branch_name') || 'branch').replace(/[^A-Za-z0-9]/g, '_');
    const d = new Date().toISOString().slice(0, 10);
    return `vault_${b}_${d}.db`;
  }

  // ---- User menu ----
  function setupUserMenu() {
    const chip = $('userChip');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      chip.classList.toggle('open');
    });
    document.addEventListener('click', () => chip.classList.remove('open'));

    $('menuLogout').addEventListener('click', () => {
      Auth.logout('manual');
      showScreen('loginScreen');
      $('loginUsername').value = '';
      $('loginPassword').value = '';
      $('loginUsername').focus();
      $('loginDbName').textContent = DB.getFileName() || '(in-memory)';
      toast('Signed out', '');
    });

    $('menuChangePassword').addEventListener('click', () => {
      $('cp_current').value = '';
      $('cp_new').value = '';
      $('cp_confirm').value = '';
      $('changePasswordError').textContent = '';
      $('changePasswordDialog').showModal();
    });

    $('cpCancel').addEventListener('click', () => $('changePasswordDialog').close());
    $('changePasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('changePasswordError');
      err.textContent = '';
      const cur = $('cp_current').value;
      const n1 = $('cp_new').value;
      const n2 = $('cp_confirm').value;
      if (n1 !== n2) { err.textContent = 'Passwords do not match.'; return; }
      if (n1.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
      const result = await Auth.changePassword(Auth.currentUserRecord().id, cur, n1);
      if (!result.ok) { err.textContent = result.error; return; }
      markDirty();
      $('changePasswordDialog').close();
      toast('Password changed ✓', 'success');
    });
  }

  // ---- USERS TAB ----
  function setupUsersTab() {
    $('newUserForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.can('manage_users')) return;
      const username = $('nu_username').value.trim();
      const fullName = $('nu_fullname').value.trim();
      const role = $('nu_role').value;
      const password = $('nu_password').value;
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
        toast('Username must be 3-32 chars (letters, digits, _ . - only).', 'error');
        return;
      }
      if (password.length < 8) { toast('Password must be at least 8 characters.', 'error'); return; }
      const result = await Auth.createUserAccount({ username, fullName, role, password });
      if (!result.ok) { toast(result.error, 'error'); return; }
      markDirty();
      renderUsersTable();
      renderAuditTable();
      $('newUserForm').reset();
      toast(`User ${username} created ✓`, 'success');
    });
    $('newUserResetBtn').addEventListener('click', () => $('newUserForm').reset());

    // Reset password dialog
    $('rpCancel').addEventListener('click', () => $('resetPasswordDialog').close());
    $('resetPasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('resetPasswordError');
      err.textContent = '';
      const n1 = $('rp_new').value;
      const n2 = $('rp_confirm').value;
      if (n1 !== n2) { err.textContent = 'Passwords do not match.'; return; }
      if (n1.length < 8) { err.textContent = 'Must be at least 8 characters.'; return; }
      const userId = Number($('resetPasswordDialog').dataset.userId);
      const result = await Auth.adminResetPassword(userId, n1);
      if (!result.ok) { err.textContent = result.error; return; }
      markDirty();
      renderAuditTable();
      $('resetPasswordDialog').close();
      toast('Password reset ✓', 'success');
    });
  }

  function openResetPasswordDialog(userId) {
    const u = DB.findUserById(userId);
    if (!u) return;
    $('rpUsername').textContent = u.username;
    $('rp_new').value = '';
    $('rp_confirm').value = '';
    $('resetPasswordError').textContent = '';
    $('resetPasswordDialog').dataset.userId = userId;
    $('resetPasswordDialog').showModal();
  }

  async function toggleUserActive(userId) {
    const u = DB.findUserById(userId);
    if (!u) return;
    const current = Auth.currentUserRecord();
    if (u.id === current.id) { toast('Cannot disable your own account.', 'error'); return; }
    const willDisable = !!u.is_active;
    const ok = await confirmDialog(
      willDisable ? 'Disable user?' : 'Enable user?',
      willDisable ? `${u.username} will no longer be able to sign in.` : `${u.username} will be able to sign in again.`
    );
    if (!ok) return;
    DB.setUserActive(userId, !u.is_active);
    DB.audit(current, willDisable ? 'disable_user' : 'enable_user', 'user', userId, u.username);
    markDirty();
    renderUsersTable();
    renderAuditTable();
    toast(`User ${willDisable ? 'disabled' : 'enabled'} ✓`, 'success');
  }

  async function changeUserRole(userId, newRole) {
    const u = DB.findUserById(userId);
    if (!u) return;
    const current = Auth.currentUserRecord();
    if (u.id === current.id && newRole !== 'admin') {
      toast('Cannot demote yourself from admin.', 'error');
      renderUsersTable();
      return;
    }
    if (u.role === newRole) return;
    DB.updateUserRole(userId, newRole);
    DB.audit(current, 'change_role', 'user', userId, `${u.role} → ${newRole}`);
    markDirty();
    renderUsersTable();
    renderAuditTable();
    toast(`Role changed to ${newRole}`, 'success');
  }

  async function deleteUserConfirm(userId) {
    const u = DB.findUserById(userId);
    if (!u) return;
    const current = Auth.currentUserRecord();
    if (u.id === current.id) { toast('Cannot delete your own account.', 'error'); return; }
    // Count records that will be orphaned
    const entryCount = DB.scalar('SELECT COUNT(*) FROM entries WHERE created_by = ?', [userId]) || 0;
    const exitCount = DB.scalar('SELECT COUNT(*) FROM exits WHERE created_by = ?', [userId]) || 0;
    const detail = (entryCount + exitCount) > 0
      ? `${u.username} has ${entryCount} entries and ${exitCount} exits. Those records will remain but show as "deleted user".`
      : `${u.username} has no records. Account will be removed.`;
    const ok = await confirmDialog('Delete user?', detail);
    if (!ok) return;
    DB.deleteUser(userId);
    DB.audit(current, 'delete_user', 'user', userId, u.username);
    markDirty();
    renderUsersTable();
    renderAuditTable();
    toast('User deleted', 'error');
  }

  function renderUsersTable() {
    if (!Auth.can('manage_users')) return;
    const users = DB.listUsers();
    $('usersCount').textContent = users.length;
    const current = Auth.currentUserRecord();
    const tbody = $('usersTbody');
    tbody.innerHTML = users.map(u => {
      const isSelf = current && u.id === current.id;
      const roleOpts = ['admin', 'supervisor', 'encoder', 'viewer']
        .map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${r}</option>`).join('');
      return `<tr>
        <td><strong>${esc(u.username)}</strong>${isSelf ? ' <span class="hint">(you)</span>' : ''}</td>
        <td>${esc(u.full_name)}</td>
        <td>
          <select data-act="change-role" data-id="${u.id}" class="inline-select" onchange="this.blur()">${roleOpts}</select>
        </td>
        <td><span class="status-badge ${u.is_active ? 'active' : 'disabled'}">${u.is_active ? 'Active' : 'Disabled'}</span></td>
        <td>${esc(fmtDateTime(u.created_at))}</td>
        <td>${esc(fmtDateTime(u.last_login_at))}</td>
        <td class="row-actions">
          <button class="btn-icon" data-act="reset-pw" data-id="${u.id}">Reset PW</button>
          <button class="btn-icon" data-act="toggle-active" data-id="${u.id}">${u.is_active ? 'Disable' : 'Enable'}</button>
          ${!isSelf ? `<button class="btn-danger" data-act="delete-user" data-id="${u.id}">Delete</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    // Role select uses 'change' not 'click'
    tbody.querySelectorAll('select[data-act="change-role"]').forEach(sel => {
      sel.addEventListener('change', () => changeUserRole(Number(sel.dataset.id), sel.value));
    });
  }

  // ---- AUDIT TAB ----
  function renderAuditTable() {
    if (!Auth.can('view_audit')) return;
    const rows = DB.listAudit(500);
    const q = searchText.audit.toLowerCase().trim();
    let filtered = rows;
    if (q) filtered = rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));
    $('auditCount').textContent = rows.length;
    const tbody = $('auditTbody');
    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${q ? 'No matches.' : 'No audit entries yet.'}</td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map(r => `<tr>
      <td>${esc(fmtDateTime(r.at))}</td>
      <td>${esc(r.username || '—')}</td>
      <td><span class="badge">${esc(r.action)}</span></td>
      <td>${esc((r.target_type || '') + (r.target_id ? ' #' + r.target_id : ''))}</td>
      <td>${esc(r.details || '')}</td>
    </tr>`).join('');
  }

  // ---- DASHBOARD ----
  const TYPE_COLORS = {
    'NP': '#2f6f4f', 'Ren': '#2c5282', 'Re-app': '#8a5a2b',
    'OMEE': '#6b2c82', '2MEE': '#822c5c', 'BD': '#822c2c', 'Red': '#b45309'
  };

  function getRangeBounds(range) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = null, end = null, label = 'All time';
    if (range === 'today') { start = today; end = new Date(today.getTime() + 86400000); label = 'Today'; }
    else if (range === '7d')   { start = new Date(today.getTime() - 6*86400000);  end = new Date(today.getTime() + 86400000); label = 'Last 7 days'; }
    else if (range === '30d')  { start = new Date(today.getTime() - 29*86400000); end = new Date(today.getTime() + 86400000); label = 'Last 30 days'; }
    else if (range === 'month'){ start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth()+1, 1); label = now.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }); }
    else if (range === 'year') { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear()+1, 0, 1); label = String(now.getFullYear()); }
    return { start, end, label };
  }

  function recordDate(rec, kind) {
    if (rec.created_at) return new Date(rec.created_at);
    if (kind === 'entry' && rec.date) return new Date(rec.date + 'T00:00:00');
    if (kind === 'exit' && rec.loan_date) return new Date(rec.loan_date + 'T00:00:00');
    return null;
  }

  function inRange(rec, kind, bounds) {
    if (!bounds.start) return true;
    const d = recordDate(rec, kind);
    if (!d) return false;
    return d >= bounds.start && d < bounds.end;
  }

  function getActivePawns() {
    const allEntries = allEntriesForActive();
    const allExits = allExitsForActive();
    const redeemed = new Set(allExits.filter(e => e.transaction_type === 'Red').map(e => e.pt_no));
    const byPT = new Map();
    allEntries.forEach(e => {
      if (!e.pt_no) return;
      const ex = byPT.get(e.pt_no);
      if (!ex || (e.date || '') > (ex.date || '')) byPT.set(e.pt_no, e);
    });
    const active = [];
    byPT.forEach((e, pt) => { if (!redeemed.has(pt)) active.push(e); });
    return active;
  }

  function renderDashboard() {
    if (!$('dashSubtitle')) return;
    const bounds = getRangeBounds(dashRange);
    $('dashSubtitle').textContent = bounds.label;

    const allE = entries();
    const allX = exits();
    const rangeE = allE.filter(r => inRange(r, 'entry', bounds));
    const rangeX = allX.filter(r => inRange(r, 'exit', bounds));

    const totalIn = rangeE.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
    const totalOut = rangeX.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
    const net = totalIn - totalOut;

    $('kpiEntries').textContent = rangeE.length;
    $('kpiExits').textContent = rangeX.length;
    $('kpiIn').textContent = fmt(totalIn);
    $('kpiOut').textContent = fmt(totalOut);
    $('kpiNet').textContent = fmt(Math.abs(net));
    $('kpiNetSign').textContent = net < 0 ? '-₱' : '₱';
    $('kpiNetSub').textContent = net >= 0 ? 'net inflow' : 'net outflow';
    const netCard = document.querySelector('.kpi-card[data-kind="net"]');
    netCard.classList.remove('positive', 'negative');
    if (net > 0) netCard.classList.add('positive');
    else if (net < 0) netCard.classList.add('negative');

    $('kpiActive').textContent = getActivePawns().length;

    renderDonut('entry', rangeE);
    renderDonut('exit', rangeX);
    renderLineChart(rangeE, rangeX, bounds);
    renderActivePawns();
  }

  function renderDonut(kind, records) {
    const svg = $(kind === 'entry' ? 'donutEntry' : 'donutExit');
    const legend = $(kind === 'entry' ? 'donutEntryLegend' : 'donutExitLegend');
    const totalEl = $(kind === 'entry' ? 'donutEntryTotal' : 'donutExitTotal');

    const groups = {};
    records.forEach(r => {
      const t = r.transaction_type || '—';
      groups[t] = (groups[t] || 0) + 1;
    });
    const data = Object.keys(groups)
      .map(k => ({ label: k, value: groups[k], color: TYPE_COLORS[k] || '#888' }))
      .sort((a, b) => b.value - a.value);
    const total = data.reduce((s, d) => s + d.value, 0);
    totalEl.textContent = `${total} total`;

    if (total === 0) {
      svg.innerHTML = `<circle cx="100" cy="100" r="70" fill="none" stroke="#f2ede1" stroke-width="30"/>
        <text class="center-value" x="100" y="100" text-anchor="middle" dominant-baseline="middle">—</text>`;
      legend.innerHTML = '<div class="donut-empty">No data in this range</div>';
      return;
    }

    const cx = 100, cy = 100, r = 70, stroke = 30;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    let segs = `<circle class="bg-ring" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${stroke}"/>`;
    data.forEach(d => {
      const segLen = (d.value / total) * circumference;
      const dash = `${segLen - 1} ${circumference - segLen + 1}`;
      segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += segLen;
    });
    segs += `<text class="center-value" x="${cx}" y="${cy-4}" text-anchor="middle" dominant-baseline="middle">${total}</text>`;
    segs += `<text class="center-label" x="${cx}" y="${cy+18}" text-anchor="middle">TRANSACTIONS</text>`;
    svg.innerHTML = segs;

    legend.innerHTML = data.map(d => {
      const pct = ((d.value / total) * 100).toFixed(1);
      return `<div class="legend-row">
        <div class="swatch" style="background:${d.color}"></div>
        <div class="label">${esc(d.label)}</div>
        <div class="count">${d.value}</div>
        <div class="pct">${pct}%</div>
      </div>`;
    }).join('');
  }

  function renderLineChart(rangeE, rangeX, bounds) {
    const svg = $('lineChart');
    const W = 900, H = 280;
    const padL = 50, padR = 20, padT = 20, padB = 40;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    let start = bounds.start, end = bounds.end;
    if (!start) {
      const allD = [];
      rangeE.forEach(r => { const d = recordDate(r, 'entry'); if (d) allD.push(d); });
      rangeX.forEach(r => { const d = recordDate(r, 'exit'); if (d) allD.push(d); });
      if (!allD.length) {
        svg.innerHTML = `<text class="empty-text" x="${W/2}" y="${H/2}" text-anchor="middle">No data to chart</text>`;
        return;
      }
      allD.sort((a, b) => a - b);
      start = new Date(allD[0].getFullYear(), allD[0].getMonth(), allD[0].getDate());
      const last = allD[allD.length - 1];
      end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    }

    const dayMs = 86400000;
    const dayCount = Math.max(1, Math.round((end - start) / dayMs));
    if (dayCount > 366) {
      svg.innerHTML = `<text class="empty-text" x="${W/2}" y="${H/2}" text-anchor="middle">Range too wide for daily view</text>`;
      return;
    }

    const days = [];
    for (let i = 0; i < dayCount; i++) {
      days.push({ date: new Date(start.getTime() + i*dayMs), entryCount: 0, entryAmt: 0, exitCount: 0, exitAmt: 0 });
    }
    const idx = (d) => Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / dayMs);
    rangeE.forEach(r => {
      const d = recordDate(r, 'entry'); if (!d) return;
      const i = idx(d); if (i < 0 || i >= dayCount) return;
      days[i].entryCount++; days[i].entryAmt += Number(r.principal_amount || 0);
    });
    rangeX.forEach(r => {
      const d = recordDate(r, 'exit'); if (!d) return;
      const i = idx(d); if (i < 0 || i >= dayCount) return;
      days[i].exitCount++; days[i].exitAmt += Number(r.principal_amount || 0);
    });

    const metricField = trendMetric === 'count' ? 'Count' : 'Amt';
    const entryVals = days.map(d => d['entry' + metricField]);
    const exitVals = days.map(d => d['exit' + metricField]);
    const maxV = Math.max(1, ...entryVals, ...exitVals);

    if (entryVals.every(v => v === 0) && exitVals.every(v => v === 0)) {
      svg.innerHTML = `<text class="empty-text" x="${W/2}" y="${H/2}" text-anchor="middle">No transactions in this range</text>`;
      return;
    }

    const xAt = (i) => padL + (dayCount === 1 ? innerW/2 : (i/(dayCount-1))*innerW);
    const yAt = (v) => padT + innerH - (v/maxV)*innerH;

    let grid = '';
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const y = padT + (t/ticks)*innerH;
      const val = maxV - (t/ticks)*maxV;
      grid += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}"/>`;
      const lbl = trendMetric === 'count' ? Math.round(val) : fmt(val);
      grid += `<text class="axis-label" x="${padL-6}" y="${y+3}" text-anchor="end">${lbl}</text>`;
    }

    const xLabelCount = Math.min(6, dayCount);
    let xLabels = '';
    for (let i = 0; i < xLabelCount; i++) {
      const dayI = Math.round((i/Math.max(1, xLabelCount-1))*(dayCount-1));
      const d = days[dayI].date;
      xLabels += `<text class="axis-label" x="${xAt(dayI)}" y="${H-padB+16}" text-anchor="middle">${d.toLocaleDateString('en-PH', { month:'short', day:'numeric' })}</text>`;
    }

    const buildPath = (vals, close) => {
      const pts = vals.map((v, i) => `${xAt(i)},${yAt(v)}`);
      let p = 'M' + pts.join(' L');
      if (close) p += ` L${xAt(dayCount-1)},${padT+innerH} L${xAt(0)},${padT+innerH} Z`;
      return p;
    };

    const dots = (vals, cls) => vals.map((v, i) => v > 0 ? `<circle class="${cls}" cx="${xAt(i)}" cy="${yAt(v)}" r="2.5"/>` : '').join('');

    svg.innerHTML = `
      ${grid}
      <path class="entry-area" d="${buildPath(entryVals, true)}"/>
      <path class="exit-area" d="${buildPath(exitVals, true)}"/>
      <path class="exit-line" d="${buildPath(exitVals, false)}"/>
      <path class="entry-line" d="${buildPath(entryVals, false)}"/>
      ${dots(exitVals, 'exit-dot')}
      ${dots(entryVals, 'entry-dot')}
      <line class="axis-line" x1="${padL}" y1="${padT+innerH}" x2="${W-padR}" y2="${padT+innerH}"/>
      ${xLabels}
    `;
  }

  function renderActivePawns() {
    const active = getActivePawns();
    const q = searchText.active.toLowerCase().trim();
    let rows = active.slice();
    if (q) rows = rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const total = active.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
    $('activeTotal').textContent = fmt(total);
    $('activeCount').textContent = active.length;

    const tbody = $('activeTbody');
    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${q ? 'No matches.' : 'No active pawns.'}</td></tr>`;
      return;
    }

    const today = new Date();
    const toDate = (s) => s ? new Date(s + 'T00:00:00') : null;
    tbody.innerHTML = rows.map(r => {
      const d = toDate(r.date);
      const days = d ? Math.max(0, Math.floor((today - d)/86400000)) : '—';
      const badge = days === '—' ? 'fresh' : (days <= 30 ? 'fresh' : days <= 90 ? 'medium' : 'old');
      const badgeText = days === '—' ? '—' : `${days}d`;
      return `<tr>
        <td>${esc(r.pt_no)}</td>
        <td>${esc(fmtDate(r.date))}</td>
        <td>${esc(r.item_description)}</td>
        <td class="numeric">${fmt(r.principal_amount)}</td>
        <td><span class="badge ${esc((r.transaction_type||'').replace(/[^A-Za-z0-9-]/g, '-'))}">${esc(r.transaction_type||'')}</span></td>
        <td class="numeric"><span class="days-badge ${badge}">${badgeText}</span></td>
      </tr>`;
    }).join('');
  }

  function setupDashboard() {
    $('dashRange').addEventListener('change', (e) => { dashRange = e.target.value; renderDashboard(); });
    document.querySelectorAll('.chart-toggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        trendMetric = btn.dataset.metric;
        renderDashboard();
      });
    });
  }

  // ---- PRINT ----
  function setupPrint() {
    $('entryPrintBtn').addEventListener('click', () => printLedger('entry'));
    $('exitPrintBtn').addEventListener('click', () => printLedger('exit'));
    $('activePrintBtn').addEventListener('click', () => printActivePawns());
  }

  function printLedger(kind) {
    const list = kind === 'entry' ? entries() : exits();
    const total = list.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
    const now = new Date().toLocaleString('en-PH');
    const user = Auth.currentUserRecord();
    const branch = DB.getMeta('branch_name') || '';
    const scope = Auth.scopeLabel();

    let tableHtml = '';
    if (kind === 'entry') {
      tableHtml = `
        <table class="print-table">
          <thead><tr>
            <th style="width:10%">Date</th><th style="width:10%">PT No.</th>
            <th style="width:32%">Item Description</th><th style="width:14%">Principal Amount</th>
            <th style="width:20%">Transaction Type<br>(NP/Ren/Re-app/OMEE/2MEE/BD)</th>
            <th style="width:14%">Signature</th>
          </tr></thead>
          <tbody>${list.map(r => `<tr>
            <td>${esc(fmtDate(r.date))}</td><td>${esc(r.pt_no)}</td>
            <td>${esc(r.item_description)}</td><td class="numeric">${fmt(r.principal_amount)}</td>
            <td>${esc(r.transaction_type)}</td><td>${esc(r.signature||'')}</td>
          </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px">No records</td></tr>'}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right">TOTAL</td><td class="numeric">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>
        </table>`;
    } else {
      tableHtml = `
        <table class="print-table">
          <thead><tr>
            <th style="width:10%">PT No.</th><th style="width:12%">Loan Date</th>
            <th style="width:32%">Item Description</th><th style="width:14%">Principal Amount</th>
            <th style="width:18%">Transaction Type<br>(Ren/Red/Re-app)</th>
            <th style="width:14%">Time of Transaction</th>
          </tr></thead>
          <tbody>${list.map(r => `<tr>
            <td>${esc(r.pt_no)}</td><td>${esc(fmtDate(r.loan_date))}</td>
            <td>${esc(r.item_description)}</td><td class="numeric">${fmt(r.principal_amount)}</td>
            <td>${esc(r.transaction_type)}</td><td>${esc(fmtTime(r.time_of_transaction))}</td>
          </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px">No records</td></tr>'}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right">TOTAL</td><td class="numeric">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>
        </table>`;
    }

    const title = kind === 'entry'
      ? 'Vault Entry Form: Prenda Transaction (OMEE/2MEE/FRA/Backdating)'
      : 'Vault Exit Form: Renewal / Redemption / Re-appraisal / OMEE / 2MEE Transaction';

    $('printArea').innerHTML = `
      <div class="print-title">${title}</div>
      <div class="print-branch">
        <span class="pb-item">Branch Name: <span class="pb-line">${esc(branch)}</span></span>
        <span class="pb-item">User: <span class="pb-line">${esc(user?.full_name || '')}</span></span>
      </div>
      ${tableHtml}
      <div class="print-meta">
        <span>Printed: ${esc(now)}${scope ? ' · ' + scope : ''}</span>
        <span>Records: ${list.length}</span>
      </div>`;
    window.print();
  }

  function printActivePawns() {
    const active = getActivePawns();
    const total = active.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
    const today = new Date();
    const toDate = (s) => s ? new Date(s + 'T00:00:00') : null;
    const now = today.toLocaleString('en-PH');
    const user = Auth.currentUserRecord();
    const branch = DB.getMeta('branch_name') || '';

    const rowsHtml = active.sort((a, b) => String(b.date||'').localeCompare(String(a.date||'')))
      .map(r => {
        const d = toDate(r.date);
        const days = d ? Math.max(0, Math.floor((today - d)/86400000)) : '—';
        return `<tr>
          <td>${esc(r.pt_no)}</td><td>${esc(fmtDate(r.date))}</td>
          <td>${esc(r.item_description)}</td><td class="numeric">${fmt(r.principal_amount)}</td>
          <td>${esc(r.transaction_type)}</td><td class="numeric">${days === '—' ? '—' : days+'d'}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px">No active pawns</td></tr>';

    $('printArea').innerHTML = `
      <div class="print-title">Active Pawns Report</div>
      <div class="print-branch">
        <span class="pb-item">Branch Name: <span class="pb-line">${esc(branch)}</span></span>
        <span class="pb-item">User: <span class="pb-line">${esc(user?.full_name || '')}</span></span>
      </div>
      <table class="print-table">
        <thead><tr>
          <th style="width:10%">PT No.</th><th style="width:12%">Entry Date</th>
          <th style="width:38%">Item Description</th><th style="width:15%">Principal Amount</th>
          <th style="width:13%">Type</th><th style="width:12%">Days in Vault</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:right">TOTAL PRINCIPAL</td><td class="numeric">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>
      </table>
      <div class="print-meta">
        <span>Printed: ${esc(now)}</span><span>Active pawns: ${active.length}</span>
      </div>`;
    window.print();
  }

  // ---- Idle logout hook ----
  function onIdleLogout() {
    showScreen('loginScreen');
    $('loginUsername').value = '';
    $('loginPassword').value = '';
    $('loginDbName').textContent = DB.getFileName() || '(in-memory)';
    toast('Signed out due to inactivity', 'error');
  }

  // ---- Init ----
  async function init() {
    $('footerYear').textContent = new Date().getFullYear();
    try {
      await DB.init();
    } catch (err) {
      document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#9b2c2c">
        <h2>Failed to load database engine</h2>
        <p>${esc(err.message || err)}</p>
        <p>Make sure the <code>lib/</code> folder is present alongside <code>index.html</code>.</p>
      </div>`;
      return;
    }

    setupDbScreen();
    setupSetupScreen();
    setupLoginScreen();
    setupBranchInput();
    setupTabs();
    setupEntryForm();
    setupExitForm();
    setupRowActions();
    setupSearchAndSort();
    setupDbToolbar();
    setupUserMenu();
    setupUsersTab();
    setupDashboard();
    setupPrint();

    showScreen('dbScreen');
  }

  return { init, onIdleLogout };
})();

window.addEventListener('DOMContentLoaded', App.init);
