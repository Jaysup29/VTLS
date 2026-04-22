# Vault Transaction Ledger

A single-user local forms system for recording Vault Entry (Prenda) and
Vault Exit (Renewal/Redemption/Re-appraisal) transactions. No XAMPP, no
backend — just HTML, CSS, JS, and a JSON file as the database.

## Folder structure

```
vault-ledger/
├── index.html              ← open this in Chrome / Edge
├── css/
│   └── style.css
├── js/
│   └── app.js
└── data/
    └── sample-vault-data.json   ← optional: sample DB to test Open
```

## How to run

1. Double-click `index.html`. It opens in your default browser.
2. For best experience, open it in **Chrome, Edge, or Brave** (File
   System Access API is supported — real read/write to a .json file).
3. Firefox / Safari still work, but file save falls back to a download.

## First-time workflow

1. Type the **Branch Name** at the top.
2. Fill in the form and click **Add Entry** (or **Add Exit** on the
   other tab). The record appears in the table below.
3. Click **Save As…** → choose where to save `data.json`. This is now
   your "database" file.
4. Next time you open the app, click **Open…** → pick your saved
   `.json` file → continue where you left off.
5. Press `Ctrl+S` anytime to save to the current file.
6. Click **🖨 Print** to print a report that matches the original paper
   form layout.

## Keyboard shortcuts

- `Ctrl+S` — Save to current file
- Click any column header — sort by that column (click again = reverse)

## Safety nets

- Autosave to browser **localStorage** every time you make a change. If
  you forget to save and close the tab, data is restored on next open.
- A red dot in the status bar warns you about unsaved changes.
- Browser shows a "leave page?" prompt if you close with unsaved work.

## Data file format

```json
{
  "branchName": "Your Branch",
  "userName": "Your Name",
  "entries": [
    {
      "id": "auto-generated",
      "date": "2026-04-22",
      "ptNo": "12345",
      "itemDescription": "...",
      "principalAmount": 5000.00,
      "transactionType": "NP",
      "signature": "JDR"
    }
  ],
  "exits": [
    {
      "id": "auto-generated",
      "ptNo": "12345",
      "loanDate": "2026-03-10",
      "itemDescription": "...",
      "principalAmount": 2500.00,
      "transactionType": "Red",
      "timeOfTransaction": "14:30"
    }
  ]
}
```

You can back up the whole ledger by just copying the .json file.
