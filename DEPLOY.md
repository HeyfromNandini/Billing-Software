# Deploying billing software (Vercel or Netlify)

This app is a **Vite React frontend** plus a **Node/Express billing API** that talks to Google Sheets/Drive via a service account. Both platforms serve the static build from `dist` and run the API as serverless functions on `/api/billing/*`.

Local dev uses `npm run dev` (Vite + Express on port 8787). Production uses the same routes without a separate API server.

---

## Before you deploy

1. **Push the repo to GitHub** (or GitLab/Bitbucket — both hosts support connected repos).
2. **Google Cloud service account**
   - Create a service account with Sheets + Drive API access.
   - Download the JSON key once (you will paste it into env vars — do not commit it).
   - Share each target spreadsheet with the service account email (`…@….iam.gserviceaccount.com`) as Editor.
3. **Spreadsheet IDs** — from each sheet URL:  
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

---

## Environment variables checklist

Copy values from your local `.env.local` where possible. See `.env.example` for names.

### Required for Google Sheets sync (frontend — build time)

These are baked into the JS bundle at build time. Set them in the host’s **Environment variables** UI before deploying.

| Variable | Example | Notes |
|----------|---------|--------|
| `VITE_GOOGLE_SHEETS_SYNC` | `1` | Must be exactly `1` to enable sync |
| `VITE_GOOGLE_SHEET_ID_AADARSH` | `1abc…` | Company sheet for Aadarsh |
| `VITE_GOOGLE_SHEET_ID_DEVA` | `1def…` | Company sheet for Deva |
| `VITE_GOOGLE_SHEET_ID_SANGITA` | `1ghi…` | Company sheet for Sangita |

### Required for Google Sheets sync (backend — runtime)

Set on the host as **server/runtime** env vars (not only “build” if your host splits scopes — on Vercel/Netlify, one project env is usually fine for both).

| Variable | Example | Notes |
|----------|---------|--------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",…}` | **Use this on Vercel/Netlify.** Paste the full JSON on one line. Do **not** use `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` in serverless (no persistent file upload). |

### Optional but recommended

| Variable | Where | Notes |
|----------|--------|--------|
| `BILLING_API_SECRET` | Backend | Protects API routes; random long string |
| `VITE_BILLING_API_SECRET` | Frontend (build) | Must **match** `BILLING_API_SECRET` if you set it |
| `BILLING_MASTER_SPREADSHEET_ID` | Backend | Master sheet with tab `AppData`, cell `A1` = JSON backup. Omit = no cloud master backup (company sheets still sync) |
| `MASTER_SPREADSHEET_ID` | Backend | Alias for `BILLING_MASTER_SPREADSHEET_ID` |

### Usually leave unset in production

| Variable | Why |
|----------|-----|
| `VITE_BILLING_API_BASE` | Default `/api/billing` works when UI and API share the same domain |
| `BILLING_API_PORT` | Only for local Express; serverless sets `PORT` automatically |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Local dev only; use `GOOGLE_SERVICE_ACCOUNT_JSON` in the cloud |

---

## Deploy on Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → import this repo.
2. Framework preset should detect **Vite**. Confirm:
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
   - (Already in `vercel.json` if the UI picks it up.)
3. **Environment variables** → add every variable from the tables above.
4. Deploy.

**API routing:** `vercel.json` rewrites `/api/billing/*` to `api/billing/[...path].js`, which runs your Express app.

### After deploy (Vercel)

Open in the browser (replace with your URL):

```text
https://YOUR-SITE.vercel.app/api/billing/health
```

Expected: `{"ok":true,"service":"billing-google-api"}`

Then open the app root and confirm Google Sheets sync works for one company.

---

## Deploy on Netlify

1. [netlify.com](https://netlify.com) → **Add new site** → import this repo.
2. `netlify.toml` sets build/publish/functions automatically:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions:** `netlify/functions`
3. **Site configuration → Environment variables** → add every variable from the tables above.
4. Deploy.

**API routing:** `netlify.toml` proxies `/api/billing/*` → `/.netlify/functions/billing`.

### After deploy (Netlify)

```text
https://YOUR-SITE.netlify.app/api/billing/health
```

Expected: `{"ok":true,"service":"billing-google-api"}`

---

## Quick copy-paste template

Use this as a checklist when filling the host UI (replace placeholders):

```env
# Frontend (build)
VITE_GOOGLE_SHEETS_SYNC=1
VITE_GOOGLE_SHEET_ID_AADARSH=
VITE_GOOGLE_SHEET_ID_DEVA=
VITE_GOOGLE_SHEET_ID_SANGITA=
VITE_BILLING_API_SECRET=

# Backend (runtime)
GOOGLE_SERVICE_ACCOUNT_JSON=
BILLING_MASTER_SPREADSHEET_ID=
BILLING_API_SECRET=
```

If you set `BILLING_API_SECRET`, you **must** set the same value in `VITE_BILLING_API_SECRET`.

---

## Redeploy when env changes

- **`VITE_*` changes** → trigger a **new build** (frontend bundle must rebuild).
- **Backend-only changes** (`GOOGLE_SERVICE_ACCOUNT_JSON`, etc.) → redeploy or use the host’s “clear cache and redeploy” if the API still misbehaves.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `Failed to fetch` in the UI | API not reachable or wrong URL | Check `/api/billing/health` on your live URL |
| HTML instead of JSON errors | Request hit SPA fallback, not API | Confirm rewrites in `vercel.json` / `netlify.toml`; health URL must return JSON |
| `401 Unauthorized (BILLING_API_SECRET)` | Secret mismatch | Match `BILLING_API_SECRET` and `VITE_BILLING_API_SECRET`, redeploy |
| `Set GOOGLE_SERVICE_ACCOUNT_JSON` | Missing backend creds | Add full JSON to project env vars, redeploy |
| Sheets sync off / warnings in header | Missing `VITE_*` or sync flag | Set `VITE_GOOGLE_SHEETS_SYNC=1` and all three sheet IDs, **rebuild** |
| Google API permission errors | Sheet not shared with SA | Share each spreadsheet with the service account email |
| Works locally, not in prod | Used key **file** path locally | Production must use `GOOGLE_SERVICE_ACCOUNT_JSON` |

---

## Local vs production

| | Local (`npm run dev`) | Vercel / Netlify |
|--|----------------------|------------------|
| Frontend | Vite `:5173` | Static `dist` |
| API | Express `:8787`, proxied as `/api/billing` | Serverless function, same path |
| Google credentials | `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` or `GOOGLE_SERVICE_ACCOUNT_JSON` | `GOOGLE_SERVICE_ACCOUNT_JSON` only |

For local setup, copy `.env.example` to `.env.local` and fill in values.
