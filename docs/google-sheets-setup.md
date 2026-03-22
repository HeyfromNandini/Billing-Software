# Google Sheets sync

**Bills** sync as **tabs** (`Bill-<n>`) inside **three fixed company spreadsheets** (Aadarsh, Deva, Sangita). Optionally, app data (`companies`, `clients`, `bills`) can also be backed up as **one JSON string** in **`AppData!A1`** on a **master Google Sheet**; without that, the app keeps that data in **localStorage** only.

Sync is implemented with a **Node billing API** and a **Google service account** — not Apps Script.

→ **Full setup:** [google-sheets-service-account.md](./google-sheets-service-account.md)  
→ **Company sheets + tabs:** [google-sheets-drive-layout.md](./google-sheets-drive-layout.md)

### Quick checklist

1. Enable **Sheets API** + **Drive API**; create a **service account** JSON key.
2. Share **all three company** spreadsheets with the service account email (**Editor**). If you use a **master** sheet for `AppData`, share that too.
3. `.env.local`: `VITE_GOOGLE_SHEETS_SYNC=1`, the three `VITE_GOOGLE_SHEET_ID_*` vars, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=…`. Optionally set `BILLING_MASTER_SPREADSHEET_ID` for Google-backed app JSON.
4. Run **`npm run dev`** (starts Vite + `server/index.js`).

### Limits & notes

- **AppData** cell size limit (~50k characters) still applies.
- **Multi-tab / multi-device:** last save wins; bill pages poll about every 20s for conflicts.
- **Security:** protect the billing API in production (same-origin reverse proxy, optional `BILLING_API_SECRET`).
