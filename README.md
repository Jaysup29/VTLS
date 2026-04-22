# Vault Transaction Ledger — v2 (SQLite + Multi-User)

A single-PC, multi-user vault ledger with login, role-based permissions,
and SQLite for storage. Still fully offline, no server, no XAMPP.

## Folder structure

```
vault-ledger-v2/
├── index.html
├── css/
│   ├── style.css
│   └── auth.css
├── js/
│   ├── db.js        — SQLite wrapper
│   ├── auth.js      — login, hashing, permissions
│   └── app.js       — UI, tabs, forms, dashboard
├── lib/
│   ├── sql-wasm.js  — sql.js loader (official)
│   ├── sql-wasm.wasm — SQLite compiled to WebAssembly
│   └── LICENSE-sql.js
├── data/            — your .db files go here (optional)
└── README.md
```

## Requirements

- **Chrome, Edge, or Brave** (Chromium-based) for full experience — File System Access API gives real read/write to `.db`
- Firefox / Safari work too but Save falls back to Download
- **No internet required** after initial load (fonts come from Google Fonts — if you need truly offline, see "Full offline" below)

## Important: Launch via a local HTTP server

The SQLite engine (sql.js) loads a WebAssembly file (`sql-wasm.wasm`). Browsers refuse to load WASM from a `file://` URL for security reasons. You must serve the folder through a tiny local HTTP server. Three easy options:

**Option 1 — Python (already installed on most PCs):**
```
cd vault-ledger-v2
python -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

**Option 2 — VS Code Live Server extension:**
Install the "Live Server" extension, then right-click `index.html` → "Open with Live Server."

**Option 3 — Node.js (if you have it):**
```
npx serve vault-ledger-v2
```

None of these require XAMPP, Apache, PHP, or MySQL. They're just file servers. You can even shut them down when you're done; the `.db` file stays on your PC.

## First run

1. Double-click `index.html`. Browser opens the app.
2. You'll see **Welcome** screen. Click **Create New Database** → an empty SQLite DB is created in memory.
3. **First-time setup** screen appears — fill in your admin details:
   - Full Name
   - Username (3-32 chars, letters / numbers / `_ . -`)
   - Password (min 8 chars)
4. Click **Create Admin & Continue**. You're logged in as admin.
5. **IMPORTANT:** Click **Save As…** in the top bar → save to a `.db` file. Until you save, everything is only in memory and will be lost on close.

## Subsequent runs

1. Open `index.html` again.
2. Click **Open Existing Database…** → pick your `.db` file.
3. Enter your username + password on the login screen.
4. Start working.

## Roles

| Role | What they can do |
|---|---|
| **Admin** | Everything: manage users, view audit log, see & edit all records |
| **Supervisor** | See & edit all records, view audit log. Cannot manage users |
| **Encoder** | See & edit **only their own** records. Cannot manage users |
| **Viewer** | See all records but read-only |

## Users tab (Admin only)

- Create new users with any role
- Reset a user's password
- Enable/disable accounts (disabled users can't sign in)
- Change a user's role
- Delete users (records they created stay, credited to "deleted user")

## Audit Log (Admin + Supervisor)

Every sensitive action gets logged: logins, logouts, create/update/delete
records, user management, password changes/resets. Cannot be edited from
within the app.

## Data safety

- Every record auto-tags the creator and creation time
- Edits add updater + update time
- Passwords are PBKDF2-hashed (100k iterations, random salt per user)
- Session auto-logs out after 30 minutes of inactivity
- Browser warns you if you close with unsaved changes

## Limits to know

Because there's no backend:
- Security depends on physical protection of the `.db` file — anyone with the file and time can attempt offline password cracking
- Role-based UI is a workflow guardrail, not a defense against a technically adept malicious user with DevTools
- This setup is ideal for **trusted employees in a controlled branch environment**, where the auth system provides accountability and workflow separation

## Keyboard shortcuts

- `Ctrl+S` — Save database to current file

## Full offline

If you want to run this without any internet whatsoever, edit `index.html`
and remove the three `<link>` tags pointing to `fonts.googleapis.com`.
The app will fall back to system fonts (still perfectly usable, just less styled).
