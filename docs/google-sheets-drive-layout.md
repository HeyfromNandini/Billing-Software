# Google Drive layout: master AppData + one spreadsheet per navbar company

This extends [google-sheets-setup.md](./google-sheets-setup.md) and [google-sheets-service-account.md](./google-sheets-service-account.md).

### What you configure

| What | Purpose |
|------|--------|
| **`BILLING_MASTER_SPREADSHEET_ID`** | *(Optional.)* Spreadsheet with tab **`AppData`**, cell **`A1`** = full app JSON for **cloud backup** of companies/clients/bills. If unset or empty, the app loads that data from **localStorage only**; **bill tabs** still sync to the three company sheets. |
| **`VITE_GOOGLE_SHEET_ID_AADARSH`**, **`VITE_GOOGLE_SHEET_ID_DEVA`**, **`VITE_GOOGLE_SHEET_ID_SANGITA`** | The three **navbar** workbooks (Aadarsh Logistics, Deva Lifters, Sangita Logistics). Keys match internal company ids: `aadarsh`, `deva`, `sangita`. |
| **`VITE_GOOGLE_SHEETS_SYNC=1`** | Turns on the billing API in the UI. |

**Mental model:** the **browser** calls your **Node billing API**; the API uses a **service account** to read/write Sheets. There is **no** “new spreadsheet per client” — clients live only in app JSON; **bills** sync as **tabs** inside the correct **company** spreadsheet.

### Drive / Sheets structure

1. **Master** *(optional)* — one file with **`AppData!A1`** for Google-backed backup of app JSON. Omit `BILLING_MASTER_SPREADSHEET_ID` if you only want local backup + company bill sheets.
2. **Sangita Logistics** — one Google Sheet; every bill whose `company_id` is **`sangita`** syncs to a tab **`Bill-<number>`** (e.g. `Bill-146`) in **this** file.
3. **Aadarsh / Deva** — same pattern for `aadarsh` and `deva`.

**Bill numbers** are unique **per navbar company** in the app, so tab names do not collide across clients of the same company.

**+ Add company** on a company page adds a **client** in the app only — **no** new Drive file.

### Sync behaviour

- **App → Sheet:** bill edits push the bill’s tab in the **company** spreadsheet (debounced ~900 ms). New tabs use **`__BILL_SYNC_V3__`**: row 1 marks the tab; **bill details** are **label / value** rows in columns **A–B**; then the transport table. Older tabs with **`__BILL_SYNC_V2__`** (JSON in B1) still import correctly.
- **Sheet → App:** on the bill page, **poll ~20 s**; if the file changed externally and the grid differs, a **conflict banner** appears.

### Edge cases

| Case | Behaviour |
|------|-----------|
| New bill | New tab `Bill-<n>` in the company spreadsheet. |
| Delete bill | Tab removed if the spreadsheet has more than one sheet. |
| Delete client | All that client’s bill tabs are removed from the company spreadsheet. |
| Delete navbar company (Home) | All bill tabs for that company are removed from its spreadsheet. |
| Extra companies (not aadarsh/deva/sangita) | No `VITE_GOOGLE_SHEET_ID_*` → bills for them **do not** sync until you add env vars (not implemented for arbitrary ids in code — only the three keys above). |

### `.env.local` (browser + server)

```env
VITE_GOOGLE_SHEETS_SYNC=1

VITE_GOOGLE_SHEET_ID_SANGITA=1Tfiu_8ntOWsrxCuAmSoCf3UyeOgBzbpxqPxwoF3GSb4
VITE_GOOGLE_SHEET_ID_AADARSH=1-Eq_IFkXDKeMHCxHKKMb-GUy23L5QTsSjTN6yTEmpEU
VITE_GOOGLE_SHEET_ID_DEVA=1DTER_peSip3Q505A32kH7calBJiqvHb_nA2BdtEzX4A

GOOGLE_SERVICE_ACCOUNT_KEY_FILE=google-sa-key.json
# Optional — omit for localStorage-only app data (bills still sync to company sheets):
# BILLING_MASTER_SPREADSHEET_ID=your_master_spreadsheet_id
```

Share the **three company** spreadsheets (and the **master**, if you use one) with the service account email as **Editor**.

Restart **`npm run dev`** after changes.

### Troubleshooting

- **`Failed to fetch`:** billing API not running — use **`npm run dev`**, open Vite’s URL, check **`/api/billing/health`**.
- **403 / permission denied:** service account not shared on **every** spreadsheet that is read or written.
- **Drive quota (service account):** creating **new** files as the SA often fails on consumer Gmail; this layout avoids **per-client** file creation — you only edit **existing** company sheets.

### Legacy data

Older JSON may include **`drive_spreadsheet_id`** on clients; it is **ignored**. You can remove it from `AppData` JSON when convenient.
