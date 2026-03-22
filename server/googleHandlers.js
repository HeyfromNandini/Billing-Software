import { google } from 'googleapis'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const APP_DATA_SHEET = 'AppData'
const APP_DATA_RANGE = 'AppData!A1'

function quoteSheetRange(sheetName) {
  const q = String(sheetName).replace(/'/g, "''")
  return `'${q}'`
}

function padRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  let maxCol = 0
  for (const r of list) {
    if (r && r.length > maxCol) maxCol = r.length
  }
  return list.map((r) => {
    const row = [...(r || [])]
    while (row.length < maxCol) row.push('')
    return row
  })
}

function loadGoogleAuth() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim()
  const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ]
  if (keyFile) {
    const p = resolve(process.cwd(), keyFile)
    if (!existsSync(p)) {
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_KEY_FILE not found: ${p}`)
    }
    return new google.auth.GoogleAuth({ keyFile: p, scopes })
  }
  if (jsonEnv) {
    let credentials
    try {
      credentials = JSON.parse(jsonEnv)
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON')
    }
    return new google.auth.GoogleAuth({ credentials, scopes })
  }
  throw new Error('Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_JSON')
}

let cachedClients = null

export async function getGoogleClients() {
  if (!cachedClients) {
    const auth = loadGoogleAuth()
    const authClient = await auth.getClient()
    cachedClients = {
      sheets: google.sheets({ version: 'v4', auth: authClient }),
      drive: google.drive({ version: 'v3', auth: authClient }),
    }
  }
  return cachedClients
}

/** Master file with AppData!A1 = full JSON backup. Empty = skip cloud backup (bills still sync to company sheets). */
export function getMasterSpreadsheetId() {
  return (
    process.env.BILLING_MASTER_SPREADSHEET_ID?.trim() ||
    process.env.MASTER_SPREADSHEET_ID?.trim() ||
    ''
  )
}

async function ensureAppDataSheet_(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  })
  const titles = (meta.data.sheets || []).map((s) => s.properties?.title)
  if (titles.includes(APP_DATA_SHEET)) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: APP_DATA_SHEET } } }],
    },
  })
}

export async function readAppData() {
  const spreadsheetId = getMasterSpreadsheetId()
  if (!spreadsheetId) {
    return { masterDisabled: true }
  }
  const { sheets } = await getGoogleClients()
  let res
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: APP_DATA_RANGE,
    })
  } catch (e) {
    const status = e?.response?.status
    const msg = (e?.message || String(e)).toLowerCase()
    if (
      status === 400 ||
      msg.includes('unable to parse range') ||
      msg.includes('not found') ||
      msg.includes('does not exist')
    ) {
      return { companies: [], clients: [], bills: [] }
    }
    throw e
  }
  const cell = res.data.values?.[0]?.[0]
  if (!cell || !String(cell).trim()) {
    return { companies: [], clients: [], bills: [] }
  }
  try {
    const data = JSON.parse(String(cell))
    return {
      companies: Array.isArray(data.companies) ? data.companies : [],
      clients: Array.isArray(data.clients) ? data.clients : [],
      bills: Array.isArray(data.bills) ? data.bills : [],
    }
  } catch {
    return { companies: [], clients: [], bills: [] }
  }
}

export async function saveAppData(body) {
  const spreadsheetId = getMasterSpreadsheetId()
  if (!spreadsheetId) {
    return { ok: true, skipped: true }
  }
  const { sheets } = await getGoogleClients()
  await ensureAppDataSheet_(sheets, spreadsheetId)
  const payload = {
    companies: body.companies || [],
    clients: body.clients || [],
    bills: body.bills || [],
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: APP_DATA_RANGE,
    valueInputOption: 'RAW',
    requestBody: { values: [[JSON.stringify(payload)]] },
  })
  return { ok: true }
}

export async function getSpreadsheetMeta(params) {
  const id = params.spreadsheetId
  if (!id) return { ok: false, error: 'spreadsheetId required' }
  const { drive } = await getGoogleClients()
  const file = await drive.files.get({
    fileId: id,
    fields: 'modifiedTime',
    supportsAllDrives: true,
  })
  const t = file.data.modifiedTime
  return { ok: true, fileLastUpdated: t ? new Date(t).toISOString() : undefined }
}

export async function readBillSheet(params) {
  const id = params.spreadsheetId
  const sheetName = params.sheetName
  if (!id || !sheetName) {
    return { ok: false, error: 'spreadsheetId and sheetName required', values: [] }
  }
  const { sheets, drive } = await getGoogleClients()
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: 'sheets.properties(title)',
  })
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === sheetName)
  if (!exists) {
    return { ok: false, error: 'sheet not found', values: [] }
  }
  const range = `${quoteSheetRange(sheetName)}!A1:ZZ5000`
  const vals = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range,
  })
  const file = await drive.files.get({
    fileId: id,
    fields: 'modifiedTime',
    supportsAllDrives: true,
  })
  const mod = file.data.modifiedTime
  return {
    ok: true,
    values: vals.data.values || [],
    fileLastUpdated: mod ? new Date(mod).toISOString() : undefined,
  }
}

export async function syncBillSheet(data) {
  const id = data.spreadsheetId
  const sheetName = data.sheetName
  const rows = data.rows || []
  if (!id || !sheetName) {
    return { ok: false, error: 'spreadsheetId and sheetName required' }
  }
  const { sheets, drive } = await getGoogleClients()
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: 'sheets.properties(sheetId,title)',
  })
  const sheetList = meta.data.sheets || []
  let sh = sheetList.find((s) => s.properties?.title === sheetName)
  if (!sh) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    })
  } else {
    const q = quoteSheetRange(sheetName)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: id,
      range: `${q}!A:ZZ`,
    })
  }
  const padded = padRows(rows)
  if (padded.length > 0) {
    const maxCol = padded[0].length
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${quoteSheetRange(sheetName)}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: padded },
    })
  }
  const file = await drive.files.get({
    fileId: id,
    fields: 'modifiedTime',
    supportsAllDrives: true,
  })
  const mod = file.data.modifiedTime
  return {
    ok: true,
    fileLastUpdated: mod ? new Date(mod).toISOString() : undefined,
  }
}

export async function deleteBillSheet(data) {
  const id = data.spreadsheetId
  const sheetName = data.sheetName
  if (!id || !sheetName) {
    return { ok: false, error: 'spreadsheetId and sheetName required' }
  }
  const { sheets } = await getGoogleClients()
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: 'sheets.properties(sheetId,title)',
  })
  const sheetList = meta.data.sheets || []
  if (sheetList.length <= 1) {
    return { ok: true }
  }
  const sh = sheetList.find((s) => s.properties?.title === sheetName)
  if (!sh) {
    return { ok: true }
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      requests: [{ deleteSheet: { sheetId: sh.properties.sheetId } }],
    },
  })
  return { ok: true }
}

export async function handleRpc(action, body) {
  switch (action) {
    case 'syncBillSheet':
      return syncBillSheet(body)
    case 'deleteBillSheet':
      return deleteBillSheet(body)
    default:
      return { ok: false, error: `unknown action: ${action}` }
  }
}
