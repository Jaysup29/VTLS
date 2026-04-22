# Changelog

## v2.0.0 — SQLite + Multi-User Edition

Major rewrite adding authentication, role-based access control, and a real
relational database.

---

### 🔐 Authentication & Security

- **Login system** with username + password
- **First-run admin setup** — first user on a fresh database automatically becomes admin
- **PBKDF2 password hashing** (100,000 iterations, unique salt per user) via Web Crypto API
- **Session persistence** — stays logged in while the browser tab is open
- **Auto-logout** after 30 minutes of inactivity
- **Change Password** from the user menu
- **Admin password reset** — admins can reset any user's password
- **Wrong password rejection** with clear error messages

### 👥 User Management (Admin only)

- **Users tab** — add, edit, disable, delete user accounts
- **4 roles:** Admin, Supervisor, Encoder, Viewer
- **Enable/Disable user accounts** — disabled users cannot log in
- **Change user role** on the fly via inline dropdown
- **Delete users** (their records remain but show as "deleted user")
- **Cannot delete/disable your own account** (safety guardrail)

### 🎭 Role-Based Permissions

| Feature | Admin | Supervisor | Encoder | Viewer |
|---|---|---|---|---|
| See all records | ✅ | ✅ | Own only | ✅ |
| Add records | ✅ | ✅ | ✅ | ❌ |
| Edit records | All | All | Own only | ❌ |
| Delete records | All | All | Own only | ❌ |
| Manage users | ✅ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ |
| Access dashboard | ✅ | ✅ | ✅ (own data) | ✅ |

- **"Your records only" badge** shown to encoders
- **Hidden tabs** for unauthorized roles (Users tab hidden from non-admins, Audit tab hidden from encoders/viewers)
- **Hidden forms** for read-only roles (Viewer sees tables but no Add forms)

### 🗄️ Database Engine (SQLite)

- **Migrated from JSON to SQLite** via sql.js (WebAssembly)
- **Real relational database** with foreign keys, indexes, and constraints
- **Scales to tens of thousands of records** without performance issues
- **ACID transactions** for data integrity
- **Portable `.db` file** — single file holds everything (users, records, audit log)
- **Schema auto-migration** — new tables added in future versions apply automatically on open

### 📋 Audit Log (New Tab)

- **Tamper-evident log** of sensitive actions
- Captures: logins, logouts, record create/update/delete, user management, password changes/resets, role changes
- **Timestamped** with user, action, target, and details
- **Searchable** across all fields
- **Visible to Admins and Supervisors**

### 🏷️ Data Tracking

- **Every record tagged** with `created_by`, `created_at`, `updated_by`, `updated_at`
- **"Created By" column** shown on Entry/Exit tables for Admin/Supervisor/Viewer
- **Case-insensitive username lookup** for login convenience

### 🎨 UI Enhancements

- **User chip** in the header showing avatar initial, name, and role
- **Dropdown user menu** with Change Password and Sign Out
- **Scope badge** labeling restricted views ("Your records only")
- **Role badges** with color coding (Admin red, Supervisor purple, Encoder green, Viewer blue)
- **Status badges** (Active/Disabled) in the Users tab
- **Loading screen** while SQLite WASM engine initializes
- **Dedicated Welcome screen** with Create/Open database buttons
- **Dedicated Login screen** with database switcher
- **Dedicated Admin Setup screen** for first-run
- **Custom favicon** (V in amber on navy)

### 💾 File Handling

- **Open/Save as native `.db` file** via File System Access API
- **Export database** button for backups
- **Save As…** to save to a new location
- **Unsaved changes warning** when closing the browser tab
- **`Ctrl+S` keyboard shortcut** to save

### 🧰 Packaging & Launch

- **Smart launcher** (`start-windows.bat`) — auto-detects PHP, Node, or Python
- **Cross-platform launcher** (`start-mac-linux.sh`) for Mac and Linux
- **Self-contained offline bundle** — sql.js WASM bundled locally, no CDN calls needed
- **README** with complete setup instructions

### 📁 File Structure (Changed)

**v1 (flat):**

```
vault-ledger/
├── index.html
├── css/style.css
├── js/app.js
└── data/sample.json
```

**v2 (modular):**

```
vault-ledger-v2/
├── index.html
├── favicon.svg
├── start-windows.bat      ← smart launcher
├── start-mac-linux.sh
├── README.md
├── CHANGELOG.md
├── css/
│   ├── style.css
│   └── auth.css           ← new: auth screen styles
├── js/
│   ├── db.js              ← new: SQLite wrapper
│   ├── auth.js            ← new: login, hashing, permissions
│   └── app.js             ← rewritten for v2
├── lib/                   ← new
│   ├── sql-wasm.js
│   ├── sql-wasm.wasm
│   └── LICENSE-sql.js
└── data/
```

### ✅ v1 Features Preserved

Everything from v1 still works exactly as before:

- Vault Entry (Prenda) tab with all 6 transaction types
- Vault Exit tab with all 5 transaction types
- Branch Name in header
- Dashboard with 6 KPI cards, 2 donut charts, daily trend line chart
- Active Pawns table with aging badges
- Sort, search, inline edit, delete
- Print-ready layouts matching the original paper forms
- Running totals per tab
- Footer with copyright

### ⚠️ Breaking Changes

- **Must launch via HTTP server** — can't just double-click `index.html` anymore (sql.js WASM requirement). Use the `.bat` or run `php -S 127.0.0.1:8080` in cmd.
- **First-run setup required** — you must create an admin account before using the app
- **User Name field removed from header** — replaced by the logged-in user's name automatically shown in the user chip and on prints
- **No automatic migration from v1 JSON data** — v2 starts with a fresh empty SQLite database

---

## v1.0.0 — JSON Edition (baseline)

Single-user local forms system for recording Vault Entry (Prenda) and
Vault Exit (Renewal/Redemption/Re-appraisal) transactions.

- Two tabs: Vault Entry and Vault Exit
- Branch Name and User Name inputs in header
- Dashboard with KPI cards, donut charts, trend line chart, active pawns table
- Dashboard filter dropdown (All time, Today, 7/30 days, month, year)
- Sort, search, inline edit, delete per record
- Print-ready layouts matching original paper forms
- JSON file as database via File System Access API
- LocalStorage autosave as safety net
- Footer with copyright
