import { isGoogleSheetsConfigured } from './config'
import { billingGet, billingPostJson } from './billingClient'

function normalizePayload(json) {
  if (!json || typeof json !== 'object') {
    return { companies: [], clients: [], bills: [] }
  }
  return {
    companies: Array.isArray(json.companies) ? json.companies : [],
    clients: Array.isArray(json.clients) ? json.clients : [],
    bills: Array.isArray(json.bills) ? json.bills : [],
  }
}

/** GET /api/billing/app-data — returns { companies, clients, bills } or { masterDisabled: true } */
export async function fetchAppDataFromSheets() {
  if (!isGoogleSheetsConfigured()) {
    throw new Error('Set VITE_GOOGLE_SHEETS_SYNC=1 in .env.local and run the billing API (npm run dev).')
  }
  const json = await billingGet('/app-data', 'Google Sheets GET')
  if (json && json.masterDisabled === true) {
    return { masterDisabled: true }
  }
  return normalizePayload(json)
}

export async function saveAppDataToSheets(payload) {
  if (!isGoogleSheetsConfigured()) return
  await billingPostJson(
    '/app-data',
    {
      companies: payload.companies ?? [],
      clients: payload.clients ?? [],
      bills: payload.bills ?? [],
    },
    'Google Sheets save (POST)'
  )
}
