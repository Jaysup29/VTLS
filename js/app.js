/* =====================================================================
   VAULT TRANSACTION LEDGER — Application logic
   A single-user local tool. No backend. JSON file as database.
   ===================================================================== */

// ----- State -----
let state = {
  branchName: '',
  userName: '',
  entries: [],  // Vault Entry (Prenda)
  exits: []     // Vault Exit (Ren/Red/Re-app)
};
let fileHandle = null;   // File System Access API handle (if supported)
let currentFileName = null;
let dirty = false;       // unsaved changes
let editingId = null;    // row currently being edited
let editingTab = null;
let sortState = { entry: { col: null, dir: 1 }, exit: { col: null, dir: 1 } };
let searchText = { entry: '', exit: '' };

const LS_KEY = 'vaultLedger.autosave.v1';
const hasFS = 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;

// ----- Helpers -----
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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

function markDirty(flag = true) {
  dirty = flag;
  const ind = $('statusIndicator');
  const txt = $('statusText');
  ind.className = 'status-indicator ' + (flag ? 'unsaved' : 'saved');
  if (currentFileName) {
    txt.textContent = currentFileName + (flag ? ' · unsaved changes' : ' · saved');
  } else {
    txt.textContent = flag ? 'Local autosave only · no file selected' : 'Local autosave only';
  }
  // Always sync localStorage with the current state so "New" and "Open"
  // immediately replace any stale autosave from a previous session.
  autosave();
}

function autosave() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) { /* quota */ }
}

function clearAutosave() {
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state = Object.assign({ branchName: '', userName: '', entries: [], exits: [] }, parsed);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// ----- Render -----
function render() {
  $('branchName').value = state.branchName || '';
  $('userName').value = state.userName || '';
  renderTable('entry');
  renderTable('exit');
  renderDashboard();
}

function renderTable(kind) {
  const list = kind === 'entry' ? state.entries : state.exits;
  const tbody = $(kind === 'entry' ? 'entryTbody' : 'exitTbody');
  const totalCell = $(kind === 'entry' ? 'entryTotal' : 'exitTotal');
  const countCell = $(kind === 'entry' ? 'entryCount' : 'exitCount');

  const q = searchText[kind].toLowerCase().trim();
  let rows = list.slice();

  // Filter
  if (q) {
    rows = rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
  }

  // Sort
  const ss = sortState[kind];
  if (ss.col) {
    const col = ss.col, dir = ss.dir;
    rows.sort((a, b) => {
      let av = a[col], bv = b[col];
      if (col === 'principalAmount') { av = Number(av || 0); bv = Number(bv || 0); }
      else { av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase(); }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  // Total
  const total = list.reduce((s, r) => s + Number(r.principalAmount || 0), 0);
  totalCell.textContent = fmt(total);
  countCell.textContent = list.length;

  // Update sort indicators
  document.querySelectorAll(`#${kind}Table th[data-sort]`).forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    const ind = th.querySelector('.sort-ind');
    if (th.dataset.sort === ss.col) {
      th.classList.add(ss.dir === 1 ? 'sorted-asc' : 'sorted-desc');
      ind.textContent = ss.dir === 1 ? '↑' : '↓';
    } else {
      ind.textContent = '↕';
    }
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${q ? 'No matches for your search.' : 'No records yet. Add one using the form above.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => rowHtml(kind, r)).join('');
}

function rowHtml(kind, r) {
  const isEditing = editingId === r.id && editingTab === kind;
  const typeBadge = (t) => `<span class="badge ${esc(t || '').replace(/[^A-Za-z0-9-]/g, '-')}">${esc(t || '')}</span>`;

  if (isEditing) {
    if (kind === 'entry') {
      return `<tr class="editing" data-id="${r.id}">
        <td><input type="date" data-f="date" value="${esc(r.date)}"></td>
        <td><input type="text" data-f="ptNo" value="${esc(r.ptNo)}"></td>
        <td><input type="text" data-f="itemDescription" value="${esc(r.itemDescription)}"></td>
        <td><input type="number" step="0.01" min="0" data-f="principalAmount" value="${esc(r.principalAmount)}"></td>
        <td>${typeSelect('entry', r.transactionType)}</td>
        <td><input type="text" data-f="signature" value="${esc(r.signature || '')}"></td>
        <td class="row-actions">
          <button class="btn-icon" onclick="saveEdit('entry','${r.id}')">Save</button>
          <button class="btn-icon" onclick="cancelEdit()">Cancel</button>
        </td>
      </tr>`;
    } else {
      return `<tr class="editing" data-id="${r.id}">
        <td><input type="text" data-f="ptNo" value="${esc(r.ptNo)}"></td>
        <td><input type="date" data-f="loanDate" value="${esc(r.loanDate)}"></td>
        <td><input type="text" data-f="itemDescription" value="${esc(r.itemDescription)}"></td>
        <td><input type="number" step="0.01" min="0" data-f="principalAmount" value="${esc(r.principalAmount)}"></td>
        <td>${typeSelect('exit', r.transactionType)}</td>
        <td><input type="time" data-f="timeOfTransaction" value="${esc(r.timeOfTransaction)}"></td>
        <td class="row-actions">
          <button class="btn-icon" onclick="saveEdit('exit','${r.id}')">Save</button>
          <button class="btn-icon" onclick="cancelEdit()">Cancel</button>
        </td>
      </tr>`;
    }
  }

  if (kind === 'entry') {
    return `<tr data-id="${r.id}">
      <td>${esc(fmtDate(r.date))}</td>
      <td>${esc(r.ptNo)}</td>
      <td>${esc(r.itemDescription)}</td>
      <td class="numeric">${fmt(r.principalAmount)}</td>
      <td>${typeBadge(r.transactionType)}</td>
      <td>${esc(r.signature || '')}</td>
      <td class="row-actions">
        <button class="btn-icon" onclick="beginEdit('entry','${r.id}')">Edit</button>
        <button class="btn-danger" onclick="deleteRow('entry','${r.id}')">Delete</button>
      </td>
    </tr>`;
  } else {
    return `<tr data-id="${r.id}">
      <td>${esc(r.ptNo)}</td>
      <td>${esc(fmtDate(r.loanDate))}</td>
      <td>${esc(r.itemDescription)}</td>
      <td class="numeric">${fmt(r.principalAmount)}</td>
      <td>${typeBadge(r.transactionType)}</td>
      <td>${esc(fmtTime(r.timeOfTransaction))}</td>
      <td class="row-actions">
        <button class="btn-icon" onclick="beginEdit('exit','${r.id}')">Edit</button>
        <button class="btn-danger" onclick="deleteRow('exit','${r.id}')">Delete</button>
      </td>
    </tr>`;
  }
}

function typeSelect(kind, current) {
  const opts = kind === 'entry'
    ? ['NP','Ren','Re-app','OMEE','2MEE','BD']
    : ['Ren','Red','Re-app','OMEE','2MEE'];
  return `<select data-f="transactionType">${opts.map(o => `<option value="${o}"${o===current?' selected':''}>${o}</option>`).join('')}</select>`;
}

// ----- CRUD -----
$('entryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const rec = {
    id: uid(),
    createdAt: new Date().toISOString(),
    date: $('e_date').value,
    ptNo: $('e_ptNo').value.trim(),
    itemDescription: $('e_desc').value.trim(),
    principalAmount: Number($('e_amount').value || 0),
    transactionType: $('e_type').value,
    signature: $('e_sig').value.trim()
  };
  if (!rec.date || !rec.ptNo || !rec.itemDescription || !rec.transactionType) {
    toast('Please fill in all required fields.', 'error'); return;
  }
  state.entries.push(rec);
  markDirty();
  renderTable('entry');
  renderDashboard();
  $('entryForm').reset();
  $('e_ptNo').focus();
  toast('Entry added ✓', 'success');
});

$('exitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const rec = {
    id: uid(),
    createdAt: new Date().toISOString(),
    ptNo: $('x_ptNo').value.trim(),
    loanDate: $('x_loanDate').value,
    itemDescription: $('x_desc').value.trim(),
    principalAmount: Number($('x_amount').value || 0),
    transactionType: $('x_type').value,
    timeOfTransaction: $('x_time').value
  };
  if (!rec.ptNo || !rec.loanDate || !rec.itemDescription || !rec.transactionType || !rec.timeOfTransaction) {
    toast('Please fill in all required fields.', 'error'); return;
  }
  state.exits.push(rec);
  markDirty();
  renderTable('exit');
  renderDashboard();
  $('exitForm').reset();
  $('x_ptNo').focus();
  toast('Exit added ✓', 'success');
});

$('entryResetBtn').addEventListener('click', () => $('entryForm').reset());
$('exitResetBtn').addEventListener('click', () => $('exitForm').reset());

window.beginEdit = (kind, id) => { editingId = id; editingTab = kind; renderTable(kind); };
window.cancelEdit = () => { const k = editingTab; editingId = null; editingTab = null; if (k) renderTable(k); };

window.saveEdit = (kind, id) => {
  const row = document.querySelector(`#${kind}Tbody tr[data-id="${id}"]`);
  if (!row) return;
  const list = kind === 'entry' ? state.entries : state.exits;
  const rec = list.find(r => r.id === id);
  if (!rec) return;
  row.querySelectorAll('[data-f]').forEach(el => {
    const f = el.dataset.f;
    rec[f] = el.type === 'number' ? Number(el.value || 0) : el.value.trim ? el.value.trim() : el.value;
  });
  editingId = null; editingTab = null;
  markDirty();
  renderTable(kind);
  renderDashboard();
  toast('Changes saved ✓', 'success');
};

window.deleteRow = async (kind, id) => {
  const ok = await confirmDialog('Delete this row?', 'This will remove the record from the ledger. This cannot be undone.');
  if (!ok) return;
  if (kind === 'entry') state.entries = state.entries.filter(r => r.id !== id);
  else state.exits = state.exits.filter(r => r.id !== id);
  markDirty();
  renderTable(kind);
  renderDashboard();
  toast('Row deleted', 'error');
};

// ----- Branch / Tabs / Search / Sort -----
$('branchName').addEventListener('input', (e) => {
  state.branchName = e.target.value;
  markDirty();
});

$('userName').addEventListener('input', (e) => {
  state.userName = e.target.value;
  markDirty();
});

document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab + 'Panel').classList.add('active');
  });
});

$('entrySearch').addEventListener('input', e => { searchText.entry = e.target.value; renderTable('entry'); });
$('exitSearch').addEventListener('input', e => { searchText.exit = e.target.value; renderTable('exit'); });

['entry', 'exit'].forEach(kind => {
  document.querySelectorAll(`#${kind}Table th[data-sort]`).forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      const s = sortState[kind];
      if (s.col === col) s.dir = -s.dir;
      else { s.col = col; s.dir = 1; }
      renderTable(kind);
    });
  });
});

// ----- File System Access (Open / Save / Save As / New / Export) -----
$('btnNew').addEventListener('click', async () => {
  const ok = await confirmDialog('Start a new database?', 'Unsaved changes in the current database will be lost unless you save first.');
  if (!ok) return;
  state = { branchName: '', userName: '', entries: [], exits: [] };
  fileHandle = null;
  currentFileName = null;
  clearAutosave();           // wipe any stale autosave from previous session
  render();
  markDirty(false);          // this will also write the fresh empty state back
  toast('New database started', 'success');
});

$('btnOpen').addEventListener('click', async () => {
  if (hasFS) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON database', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
      const file = await handle.getFile();
      const text = await file.text();
      loadData(JSON.parse(text));
      fileHandle = handle;
      currentFileName = file.name;
      markDirty(false);
      toast('Opened ' + file.name, 'success');
    } catch (err) {
      if (err.name !== 'AbortError') toast('Failed to open file: ' + err.message, 'error');
    }
  } else {
    // Fallback: use hidden file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        loadData(JSON.parse(text));
        currentFileName = file.name;
        markDirty(false);
        toast('Loaded ' + file.name + ' (use Export to download updates)', 'success');
      } catch (err) { toast('Invalid JSON file', 'error'); }
    };
    input.click();
  }
});

$('btnSave').addEventListener('click', async () => { await saveToFile(false); });
$('btnSaveAs').addEventListener('click', async () => { await saveToFile(true); });
$('btnExport').addEventListener('click', () => exportDownload());

async function saveToFile(saveAs) {
  const data = JSON.stringify(state, null, 2);
  if (hasFS) {
    try {
      if (!fileHandle || saveAs) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: currentFileName || defaultFileName(),
          types: [{ description: 'JSON database', accept: { 'application/json': ['.json'] } }]
        });
        currentFileName = fileHandle.name;
      }
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      markDirty(false);
      toast('Saved to ' + currentFileName, 'success');
    } catch (err) {
      if (err.name !== 'AbortError') toast('Save failed: ' + err.message, 'error');
    }
  } else {
    exportDownload();
  }
}

function exportDownload() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentFileName || defaultFileName();
  a.click();
  URL.revokeObjectURL(url);
  if (!hasFS) markDirty(false);
  toast('Downloaded ' + a.download, 'success');
}

function defaultFileName() {
  const b = (state.branchName || 'branch').replace(/[^A-Za-z0-9]/g, '_');
  const d = new Date().toISOString().slice(0, 10);
  return `vault_ledger_${b}_${d}.json`;
}

function loadData(data) {
  state = {
    branchName: data.branchName || '',
    userName: data.userName || '',
    entries: Array.isArray(data.entries) ? data.entries : [],
    exits: Array.isArray(data.exits) ? data.exits : []
  };
  // Ensure every row has an id
  state.entries.forEach(r => { if (!r.id) r.id = uid(); });
  state.exits.forEach(r => { if (!r.id) r.id = uid(); });
  render();
}

// ----- Print -----
$('entryPrintBtn').addEventListener('click', () => printLedger('entry'));
$('exitPrintBtn').addEventListener('click', () => printLedger('exit'));

function printLedger(kind) {
  const list = kind === 'entry' ? state.entries : state.exits;
  const total = list.reduce((s, r) => s + Number(r.principalAmount || 0), 0);
  const now = new Date().toLocaleString('en-PH');

  let html = '';
  if (kind === 'entry') {
    html = `
      <div class="print-title">Vault Entry Form: Prenda Transaction (OMEE/2MEE/FRA/Backdating)</div>
      <div class="print-branch">
        <span class="pb-item">Branch Name: <span class="pb-line">${esc(state.branchName || '')}</span></span>
        <span class="pb-item">User: <span class="pb-line">${esc(state.userName || '')}</span></span>
      </div>
      <table class="print-table">
        <thead>
          <tr>
            <th style="width:10%">Date</th>
            <th style="width:10%">PT No.</th>
            <th style="width:32%">Item Description</th>
            <th style="width:14%">Principal Amount</th>
            <th style="width:20%">Transaction Type<br>(NP/Ren/Re-app/OMEE/2MEE/BD)</th>
            <th style="width:14%">Signature</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(r => `
            <tr>
              <td>${esc(fmtDate(r.date))}</td>
              <td>${esc(r.ptNo)}</td>
              <td>${esc(r.itemDescription)}</td>
              <td class="numeric">${fmt(r.principalAmount)}</td>
              <td>${esc(r.transactionType)}</td>
              <td>${esc(r.signature || '')}</td>
            </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px">No records</td></tr>'}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="text-align:right">TOTAL</td>
            <td class="numeric">${fmt(total)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
      <div class="print-meta">
        <span>Printed: ${esc(now)}</span>
        <span>Records: ${list.length}</span>
      </div>
    `;
  } else {
    html = `
      <div class="print-title">Vault Exit Form: Renewal / Redemption / Re-appraisal / OMEE / 2MEE Transaction</div>
      <div class="print-branch">
        <span class="pb-item">Branch Name: <span class="pb-line">${esc(state.branchName || '')}</span></span>
        <span class="pb-item">User: <span class="pb-line">${esc(state.userName || '')}</span></span>
      </div>
      <table class="print-table">
        <thead>
          <tr>
            <th style="width:10%">PT No.</th>
            <th style="width:12%">Loan Date</th>
            <th style="width:32%">Item Description</th>
            <th style="width:14%">Principal Amount</th>
            <th style="width:18%">Transaction Type<br>(Ren/Red/Re-app)</th>
            <th style="width:14%">Time of Transaction</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(r => `
            <tr>
              <td>${esc(r.ptNo)}</td>
              <td>${esc(fmtDate(r.loanDate))}</td>
              <td>${esc(r.itemDescription)}</td>
              <td class="numeric">${fmt(r.principalAmount)}</td>
              <td>${esc(r.transactionType)}</td>
              <td>${esc(fmtTime(r.timeOfTransaction))}</td>
            </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px">No records</td></tr>'}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="text-align:right">TOTAL</td>
            <td class="numeric">${fmt(total)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
      <div class="print-meta">
        <span>Printed: ${esc(now)}</span>
        <span>Records: ${list.length}</span>
      </div>
    `;
  }
  $('printArea').innerHTML = html;
  window.print();
}

// ----- Keyboard shortcuts -----
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveToFile(false);
  }
});

// ----- Warn before unload if dirty -----
window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ===== DASHBOARD =====
let dashRange = 'all';
let trendMetric = 'count';  // 'count' or 'amount'
let activeSearchText = '';

const TYPE_COLORS = {
  // Entry types
  'NP':      '#2f6f4f',
  'Ren':     '#2c5282',
  'Re-app':  '#8a5a2b',
  'OMEE':    '#6b2c82',
  '2MEE':    '#822c5c',
  'BD':      '#822c2c',
  // Exit-only
  'Red':     '#b45309'
};

function getRangeBounds(range) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = null, end = null, label = 'All time';

  if (range === 'today') {
    start = today;
    end = new Date(today.getTime() + 86400000);
    label = 'Today';
  } else if (range === '7d') {
    start = new Date(today.getTime() - 6 * 86400000);
    end = new Date(today.getTime() + 86400000);
    label = 'Last 7 days';
  } else if (range === '30d') {
    start = new Date(today.getTime() - 29 * 86400000);
    end = new Date(today.getTime() + 86400000);
    label = 'Last 30 days';
  } else if (range === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    label = now.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  } else if (range === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
    label = String(now.getFullYear());
  }
  return { start, end, label };
}

// Best-available effective date for filtering a record
function recordDate(rec, kind) {
  // Prefer explicit createdAt; else fall back to record date fields
  if (rec.createdAt) return new Date(rec.createdAt);
  if (kind === 'entry' && rec.date) return new Date(rec.date + 'T00:00:00');
  if (kind === 'exit') {
    if (rec.loanDate) return new Date(rec.loanDate + 'T00:00:00');
  }
  return null;
}

function inRange(rec, kind, bounds) {
  if (!bounds.start) return true;  // all-time
  const d = recordDate(rec, kind);
  if (!d) return false;
  return d >= bounds.start && d < bounds.end;
}

function getActivePawns() {
  // Active = PT Nos present in entries but never redeemed (no exit with type 'Red')
  const redeemed = new Set(
    state.exits.filter(e => e.transactionType === 'Red').map(e => e.ptNo)
  );
  // For each PT No., keep the latest entry (by date)
  const byPT = new Map();
  state.entries.forEach(e => {
    if (!e.ptNo) return;
    const existing = byPT.get(e.ptNo);
    if (!existing || (e.date || '') > (existing.date || '')) byPT.set(e.ptNo, e);
  });
  const active = [];
  byPT.forEach((e, pt) => { if (!redeemed.has(pt)) active.push(e); });
  return active;
}

function renderDashboard() {
  const bounds = getRangeBounds(dashRange);
  $('dashSubtitle').textContent = bounds.label;

  const entries = state.entries.filter(r => inRange(r, 'entry', bounds));
  const exits   = state.exits.filter(r   => inRange(r, 'exit',  bounds));

  // ---- KPIs ----
  const totalIn  = entries.reduce((s, r) => s + Number(r.principalAmount || 0), 0);
  const totalOut = exits.reduce((s, r)   => s + Number(r.principalAmount || 0), 0);
  const net = totalIn - totalOut;

  $('kpiEntries').textContent = entries.length;
  $('kpiExits').textContent   = exits.length;
  $('kpiIn').textContent      = fmt(totalIn);
  $('kpiOut').textContent     = fmt(totalOut);
  $('kpiNet').textContent     = fmt(Math.abs(net));
  $('kpiNetSign').textContent = net < 0 ? '-₱' : '₱';
  $('kpiNetSub').textContent  = net >= 0 ? 'net inflow' : 'net outflow';

  const netCard = document.querySelector('.kpi-card[data-kind="net"]');
  netCard.classList.remove('positive', 'negative');
  if (net > 0) netCard.classList.add('positive');
  else if (net < 0) netCard.classList.add('negative');

  // Active pawns uses ALL data regardless of filter (it's an always-current count)
  const active = getActivePawns();
  $('kpiActive').textContent = active.length;

  // ---- Donut charts ----
  renderDonut('entry', entries);
  renderDonut('exit', exits);

  // ---- Line chart ----
  renderLineChart(entries, exits, bounds);

  // ---- Active pawns table ----
  renderActivePawns(active);
}

function renderDonut(kind, records) {
  const svg = $(kind === 'entry' ? 'donutEntry' : 'donutExit');
  const legend = $(kind === 'entry' ? 'donutEntryLegend' : 'donutExitLegend');
  const totalEl = $(kind === 'entry' ? 'donutEntryTotal' : 'donutExitTotal');

  // Aggregate by type
  const groups = {};
  records.forEach(r => {
    const t = r.transactionType || '—';
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

  // Build donut segments
  const cx = 100, cy = 100, r = 70, stroke = 30;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  let segs = `<circle class="bg-ring" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${stroke}"/>`;
  data.forEach(d => {
    const segLen = (d.value / total) * circumference;
    const dash = `${segLen - 1} ${circumference - segLen + 1}`; // small gap
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += segLen;
  });
  segs += `<text class="center-value" x="${cx}" y="${cy - 4}" text-anchor="middle" dominant-baseline="middle">${total}</text>`;
  segs += `<text class="center-label" x="${cx}" y="${cy + 18}" text-anchor="middle">TRANSACTIONS</text>`;
  svg.innerHTML = segs;

  // Legend
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

function renderLineChart(entries, exits, bounds) {
  const svg = $('lineChart');
  const W = 900, H = 280;
  const padL = 50, padR = 20, padT = 20, padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // Determine the date range: use bounds if set, else span min..max of the data
  let start = bounds.start, end = bounds.end;
  if (!start) {
    const allDates = [];
    entries.forEach(r => { const d = recordDate(r, 'entry'); if (d) allDates.push(d); });
    exits.forEach(r   => { const d = recordDate(r, 'exit');  if (d) allDates.push(d); });
    if (!allDates.length) {
      svg.innerHTML = `<text class="empty-text" x="${W/2}" y="${H/2}" text-anchor="middle">No data to chart</text>`;
      return;
    }
    allDates.sort((a, b) => a - b);
    start = new Date(allDates[0].getFullYear(), allDates[0].getMonth(), allDates[0].getDate());
    const last = allDates[allDates.length - 1];
    end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  }

  // Build daily buckets
  const dayMs = 86400000;
  const dayCount = Math.max(1, Math.round((end - start) / dayMs));
  if (dayCount > 366) {
    svg.innerHTML = `<text class="empty-text" x="${W/2}" y="${H/2}" text-anchor="middle">Range too wide for daily view</text>`;
    return;
  }

  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start.getTime() + i * dayMs);
    days.push({ date: d, entryCount: 0, entryAmt: 0, exitCount: 0, exitAmt: 0 });
  }
  const idx = (d) => Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / dayMs);

  entries.forEach(r => {
    const d = recordDate(r, 'entry'); if (!d) return;
    const i = idx(d); if (i < 0 || i >= dayCount) return;
    days[i].entryCount++;
    days[i].entryAmt += Number(r.principalAmount || 0);
  });
  exits.forEach(r => {
    const d = recordDate(r, 'exit'); if (!d) return;
    const i = idx(d); if (i < 0 || i >= dayCount) return;
    days[i].exitCount++;
    days[i].exitAmt += Number(r.principalAmount || 0);
  });

  const metricField = trendMetric === 'count' ? 'Count' : 'Amt';
  const entryVals = days.map(d => d['entry' + metricField]);
  const exitVals  = days.map(d => d['exit'  + metricField]);
  const maxV = Math.max(1, ...entryVals, ...exitVals);

  if (maxV === 1 && entryVals.every(v => v === 0) && exitVals.every(v => v === 0)) {
    svg.innerHTML = `<text class="empty-text" x="${W/2}" y="${H/2}" text-anchor="middle">No transactions in this range</text>`;
    return;
  }

  const xAt = (i) => padL + (dayCount === 1 ? innerW / 2 : (i / (dayCount - 1)) * innerW);
  const yAt = (v) => padT + innerH - (v / maxV) * innerH;

  // Grid lines + y-axis labels (4 gridlines)
  let grid = '';
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const y = padT + (t / ticks) * innerH;
    const val = maxV - (t / ticks) * maxV;
    grid += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`;
    const labelVal = trendMetric === 'count' ? Math.round(val) : fmt(val);
    grid += `<text class="axis-label" x="${padL - 6}" y="${y + 3}" text-anchor="end">${labelVal}</text>`;
  }

  // X-axis labels — show up to ~6 evenly spaced
  const xLabelCount = Math.min(6, dayCount);
  let xLabels = '';
  for (let i = 0; i < xLabelCount; i++) {
    const dayI = Math.round((i / Math.max(1, xLabelCount - 1)) * (dayCount - 1));
    const d = days[dayI].date;
    const txt = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    xLabels += `<text class="axis-label" x="${xAt(dayI)}" y="${H - padB + 16}" text-anchor="middle">${txt}</text>`;
  }

  const buildPath = (vals, close) => {
    const pts = vals.map((v, i) => `${xAt(i)},${yAt(v)}`);
    let p = 'M' + pts.join(' L');
    if (close) p += ` L${xAt(dayCount - 1)},${padT + innerH} L${xAt(0)},${padT + innerH} Z`;
    return p;
  };

  const entryArea = buildPath(entryVals, true);
  const entryLine = buildPath(entryVals, false);
  const exitArea  = buildPath(exitVals, true);
  const exitLine  = buildPath(exitVals, false);

  const dots = (vals, cls) => vals.map((v, i) => v > 0 ? `<circle class="${cls}" cx="${xAt(i)}" cy="${yAt(v)}" r="2.5"/>` : '').join('');

  svg.innerHTML = `
    ${grid}
    <path class="entry-area" d="${entryArea}"/>
    <path class="exit-area"  d="${exitArea}"/>
    <path class="exit-line"  d="${exitLine}"/>
    <path class="entry-line" d="${entryLine}"/>
    ${dots(exitVals, 'exit-dot')}
    ${dots(entryVals, 'entry-dot')}
    <line class="axis-line" x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}"/>
    ${xLabels}
  `;
}

function renderActivePawns(active) {
  const tbody = $('activeTbody');
  const totalEl = $('activeTotal');
  const countEl = $('activeCount');
  countEl.textContent = active.length;

  const q = activeSearchText.toLowerCase().trim();
  let rows = active.slice();
  if (q) {
    rows = rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
  }
  // Sort by date descending (newest first)
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const total = active.reduce((s, r) => s + Number(r.principalAmount || 0), 0);
  totalEl.textContent = fmt(total);

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${q ? 'No matches.' : 'No active pawns. All entries have been redeemed, or no entries exist yet.'}</td></tr>`;
    return;
  }

  const today = new Date();
  const toDate = (s) => s ? new Date(s + 'T00:00:00') : null;

  tbody.innerHTML = rows.map(r => {
    const d = toDate(r.date);
    const days = d ? Math.max(0, Math.floor((today - d) / 86400000)) : '—';
    const badge = days === '—' ? 'fresh' : (days <= 30 ? 'fresh' : days <= 90 ? 'medium' : 'old');
    const badgeText = days === '—' ? '—' : `${days}d`;
    return `<tr>
      <td>${esc(r.ptNo)}</td>
      <td>${esc(fmtDate(r.date))}</td>
      <td>${esc(r.itemDescription)}</td>
      <td class="numeric">${fmt(r.principalAmount)}</td>
      <td><span class="badge ${esc((r.transactionType || '').replace(/[^A-Za-z0-9-]/g, '-'))}">${esc(r.transactionType || '')}</span></td>
      <td class="numeric"><span class="days-badge ${badge}">${badgeText}</span></td>
    </tr>`;
  }).join('');
}

// ---- Dashboard event wiring ----
$('dashRange').addEventListener('change', (e) => {
  dashRange = e.target.value;
  renderDashboard();
});

document.querySelectorAll('.chart-toggle .toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    trendMetric = btn.dataset.metric;
    renderDashboard();
  });
});

$('activeSearch').addEventListener('input', (e) => {
  activeSearchText = e.target.value;
  renderActivePawns(getActivePawns());
});

$('activePrintBtn').addEventListener('click', () => printActivePawns());

function printActivePawns() {
  const active = getActivePawns();
  const total = active.reduce((s, r) => s + Number(r.principalAmount || 0), 0);
  const today = new Date();
  const toDate = (s) => s ? new Date(s + 'T00:00:00') : null;
  const now = today.toLocaleString('en-PH');

  const rowsHtml = active.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map(r => {
      const d = toDate(r.date);
      const days = d ? Math.max(0, Math.floor((today - d) / 86400000)) : '—';
      return `<tr>
        <td>${esc(r.ptNo)}</td>
        <td>${esc(fmtDate(r.date))}</td>
        <td>${esc(r.itemDescription)}</td>
        <td class="numeric">${fmt(r.principalAmount)}</td>
        <td>${esc(r.transactionType)}</td>
        <td class="numeric">${days === '—' ? '—' : days + 'd'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px">No active pawns</td></tr>';

  $('printArea').innerHTML = `
    <div class="print-title">Active Pawns Report</div>
    <div class="print-branch">
      <span class="pb-item">Branch Name: <span class="pb-line">${esc(state.branchName || '')}</span></span>
      <span class="pb-item">User: <span class="pb-line">${esc(state.userName || '')}</span></span>
    </div>
    <table class="print-table">
      <thead>
        <tr>
          <th style="width:10%">PT No.</th>
          <th style="width:12%">Entry Date</th>
          <th style="width:38%">Item Description</th>
          <th style="width:15%">Principal Amount</th>
          <th style="width:13%">Type</th>
          <th style="width:12%">Days in Vault</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align:right">TOTAL PRINCIPAL</td>
          <td class="numeric">${fmt(total)}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
    <div class="print-meta">
      <span>Printed: ${esc(now)}</span>
      <span>Active pawns: ${active.length}</span>
    </div>
  `;
  window.print();
}

// ----- Init -----
(function init() {
  // Footer year
  $('footerYear').textContent = new Date().getFullYear();

  // Set today as default
  const today = new Date().toISOString().slice(0, 10);
  $('e_date').value = today;
  $('x_loanDate').value = today;
  const now = new Date();
  $('x_time').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // Try to restore autosave
  if (loadAutosave()) {
    render();
    markDirty(false);
    toast('Restored from local autosave', 'success');
  } else {
    render();
    markDirty(false);
  }

  if (!hasFS) {
    // Subtle hint for non-Chromium browsers
    $('statusText').textContent = 'Browser does not support direct file save — use Export to download';
  }
})();
