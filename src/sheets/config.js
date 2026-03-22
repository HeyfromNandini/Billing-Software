/** Base URL path or absolute URL for the Node billing API (service account). */
export function billingApiBase() {
  const raw = import.meta.env.VITE_BILLING_API_BASE?.trim()
  if (!raw) return '/api/billing'
  let base = raw.replace(/\/$/, '')
  try {
    const u = new URL(base)
    if (u.pathname === '' || u.pathname === '/') {
      base = `${u.origin}/api/billing`
    }
  } catch {
    /* relative path e.g. /api/billing */
  }
  return base
}

export function billingApiUrl(path) {
  const base = billingApiBase()
  const p = path.startsWith('/') ? path : `/${path}`
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${base}${p}`
  }
  return new URL(`${base}${p}`, typeof window !== 'undefined' ? window.location.href : 'http://localhost').href
}

/** Optional shared secret (must match server BILLING_API_SECRET). Exposed in the bundle if set — use only behind a trusted proxy in production. */
export function billingApiSecretHeaders() {
  const s = import.meta.env.VITE_BILLING_API_SECRET?.trim()
  return s ? { 'x-billing-api-secret': s } : {}
}

/**
 * Google Sheets/Drive sync via the local (or deployed) billing API + service account.
 * Enable with VITE_GOOGLE_SHEETS_SYNC=1 in .env.local.
 */
export function isGoogleSheetsConfigured() {
  return import.meta.env.VITE_GOOGLE_SHEETS_SYNC === '1'
}

/**
 * Spreadsheet id for each navbar company (fixed files under Billing software).
 * Keys must match company `id`: aadarsh | deva | sangita
 */
export function companySpreadsheetId(companyId) {
  const id = String(companyId || '')
  const map = {
    aadarsh: import.meta.env.VITE_GOOGLE_SHEET_ID_AADARSH?.trim(),
    deva: import.meta.env.VITE_GOOGLE_SHEET_ID_DEVA?.trim(),
    sangita: import.meta.env.VITE_GOOGLE_SHEET_ID_SANGITA?.trim(),
  }
  return (map[id] || '').trim()
}

/**
 * Drive sync: one Google Sheet per navbar company; each bill is a tab (Bill-&lt;n&gt;) in that file.
 * Requires all three company spreadsheet ids when sync is on.
 */
export function isDriveLayoutConfigured() {
  if (!isGoogleSheetsConfigured()) return false
  return (
    Boolean(companySpreadsheetId('aadarsh')) &&
    Boolean(companySpreadsheetId('deva')) &&
    Boolean(companySpreadsheetId('sangita'))
  )
}

/**
 * Visible setup hints when env is easy to misconfigure (e.g. sheet IDs set but sync flag missing).
 * @returns {string[]}
 */
export function getGoogleSyncSetupWarnings() {
  const warnings = []
  const syncOn = import.meta.env.VITE_GOOGLE_SHEETS_SYNC === '1'
  const a = import.meta.env.VITE_GOOGLE_SHEET_ID_AADARSH?.trim()
  const d = import.meta.env.VITE_GOOGLE_SHEET_ID_DEVA?.trim()
  const s = import.meta.env.VITE_GOOGLE_SHEET_ID_SANGITA?.trim()
  const hasAnyCompanySheet = Boolean(a || d || s)

  if (!syncOn && hasAnyCompanySheet) {
    warnings.push(
      'You set VITE_GOOGLE_SHEET_ID_* but VITE_GOOGLE_SHEETS_SYNC is not 1 — the app will not use the billing API or sync bills to Google Sheets. Add VITE_GOOGLE_SHEETS_SYNC=1 to .env.local, save, then stop and run npm run dev again.'
    )
  }
  if (syncOn) {
    if (!a) warnings.push('Missing VITE_GOOGLE_SHEET_ID_AADARSH — bills for Aadarsh will not sync to Drive.')
    if (!d) warnings.push('Missing VITE_GOOGLE_SHEET_ID_DEVA — bills for Deva will not sync to Drive.')
    if (!s) warnings.push('Missing VITE_GOOGLE_SHEET_ID_SANGITA — bills for Sangita will not sync to Drive.')
  }
  return warnings
}
