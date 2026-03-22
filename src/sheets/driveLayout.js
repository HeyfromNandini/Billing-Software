import { isGoogleSheetsConfigured, billingApiUrl, billingApiSecretHeaders } from './config'
import { billingPostJson, billingGet } from './billingClient'
import { fetchBillingBackend } from './billingBackendFetch'
import { parseBillingApiJson } from './billingApiResponse'

const POST_ACTION_KEY = '__billingAction'

async function postAction(action, payload) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error('Set VITE_GOOGLE_SHEETS_SYNC=1 and run the billing API (npm run dev).')
  }
  return billingPostJson(
    '/rpc',
    {
      ...payload,
      [POST_ACTION_KEY]: action,
    },
    `Drive POST ${action}`
  )
}

/** Replace or create a worksheet tab; returns { fileLastUpdated? } */
export async function syncBillSheet({ spreadsheetId, sheetName, rows }) {
  return postAction('syncBillSheet', {
    spreadsheetId,
    sheetName,
    rows: rows || [],
  })
}

export async function deleteBillSheet({ spreadsheetId, sheetName }) {
  await postAction('deleteBillSheet', {
    spreadsheetId,
    sheetName,
  })
}

export async function getSpreadsheetMeta(spreadsheetId) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error('Set VITE_GOOGLE_SHEETS_SYNC=1 and run the billing API (npm run dev).')
  }
  const q = new URLSearchParams({ spreadsheetId })
  return billingGet(`/drive/spreadsheet-meta?${q}`, 'Drive GET getSpreadsheetMeta')
}

/**
 * Does not throw when sheet is missing (ok: false) so bill poll can no-op.
 */
export async function readBillSheet({ spreadsheetId, sheetName }) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error('Set VITE_GOOGLE_SHEETS_SYNC=1 and run the billing API (npm run dev).')
  }
  const q = new URLSearchParams({ spreadsheetId, sheetName })
  const url = billingApiUrl(`/drive/bill-sheet?${q}`)
  const res = await fetchBillingBackend(
    url,
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store',
        Pragma: 'no-cache',
        ...billingApiSecretHeaders(),
      },
    },
    'Drive GET readBillSheet'
  )
  const text = await res.text()
  if (!String(text ?? '').trim()) {
    throw new Error(
      `Drive GET readBillSheet: empty response (HTTP ${res.status}). URL: ${res.url || ''} — check billing API is running.`
    )
  }
  const json = parseBillingApiJson(text, 'Drive GET readBillSheet')
  if (!res.ok) {
    throw new Error(json.error || `Drive GET readBillSheet: HTTP ${res.status}`)
  }
  return json
}
