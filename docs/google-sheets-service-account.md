# Google Sheets & Drive via service account (Node billing API)

The React app **never** holds your service account private key. A small **Express** server in `server/` uses the [Google Sheets API](https://developers.google.com/sheets/api) and [Drive API](https://developers.google.com/drive/api) with a **service account** JSON key.

## 1. Google Cloud

1. [Google Cloud Console](https://console.cloud.google.com/) → create or pick a project.
2. **APIs & Services → Library** → enable **Google Sheets API** and **Google Drive API**.
3. **APIs & Services → Credentials → Create credentials → Service account** → create a JSON key and download it.
4. Put the file in your project root (e.g. `google-sa-key.json`) and **add it to `.gitignore`** (patterns are already suggested in the repo).

## 2. Share Google files with the service account

Open the downloaded JSON and copy the **`client_email`** (ends with `@….iam.gserviceaccount.com`).

1. **Each navbar company spreadsheet** (Aadarsh, Deva, Sangita — the three files in `VITE_GOOGLE_SHEET_ID_*`): **Share** → service account email → **Editor**.
2. **Master spreadsheet** *(only if you set `BILLING_MASTER_SPREADSHEET_ID`)* — tab **`AppData`**, **A1** = app JSON: **Share** → same email → **Editor**.

Without sharing **every** file the API touches, you get **403** errors.

## 3. Environment variables

In **`.env.local`** (or **`.env`**) at the project root:

```env
# Frontend
VITE_GOOGLE_SHEETS_SYNC=1
VITE_GOOGLE_SHEET_ID_AADARSH=...
VITE_GOOGLE_SHEET_ID_DEVA=...
VITE_GOOGLE_SHEET_ID_SANGITA=...

# Backend (no VITE_ prefix — not exposed to the browser)
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=google-sa-key.json
# Optional — Google backup for companies/clients/bills; omit to use localStorage only for that data
# BILLING_MASTER_SPREADSHEET_ID=your_master_spreadsheet_id
```

- **Spreadsheet IDs**: from `https://docs.google.com/spreadsheets/d/THIS_PART/edit`.  
- Layout details: [google-sheets-drive-layout.md](./google-sheets-drive-layout.md).

Optional: `BILLING_API_PORT` (default **8787**). If you change it, set the same value in `.env.local` so Vite’s `loadEnv` picks it up for the dev proxy.

Optional: `BILLING_API_SECRET` — if set, every request must include header `x-billing-api-secret`. Prefer terminating TLS at a reverse proxy that injects this header instead of putting the secret in `VITE_*`.

## 4. Run the app

```bash
npm install
npm run dev
```

This starts **Vite** (UI) and **`node server/index.js`** (billing API). Open the URL Vite prints (e.g. `http://localhost:5173`).

Check the API: [http://localhost:8787/api/billing/health](http://localhost:8787/api/billing/health) should return `{"ok":true,"service":"billing-google-api"}`.

## 5. Production

- Build the UI: `npm run build` → serve `dist/` from any static host **or** the same Node process (add `express.static('dist')` if you want one server).
- Run **`node server/index.js`** (or use PM2, systemd, Railway, etc.) with the same env vars.
- Put the UI and API on the same origin if possible, and reverse-proxy **`/api/billing`** to the Node port so you do not need CORS or a public API secret in the browser.

## Drive layout

**One spreadsheet per navbar company** (Aadarsh, Deva, Sangita) + optional **master** for `AppData`. Each **bill** is a **tab** (`Bill-<n>`) in the company’s file. See [google-sheets-drive-layout.md](./google-sheets-drive-layout.md).

### “Drive storage quota has been exceeded” (legacy / rare)

The app **no longer creates a new spreadsheet per client**, so this error is uncommon. If Google still returns it (e.g. other automation), remember: **new files owned by a service account** can hit **SA quota**, not your Gmail bar. **Workspace + Shared drive** or **OAuth as you** are the usual fixes. See Stack Overflow discussions such as [service accounts and Drive quota](https://stackoverflow.com/questions/75977788/google-drive-api-via-service-account-storage-quota-exceeded).

## Legacy Apps Script

Older setups used a published Apps Script web app. That path has been removed from the app; use this service account flow instead.
