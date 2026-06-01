import { google } from 'googleapis'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const APP_DATA_SHEET = 'AppData'
const APP_DATA_RANGE = 'AppData!A1'
/** Google Sheets max ~50k chars per cell; store large JSON across row 1 (A1, B1, …). */
const APP_DATA_ROW_RANGE = 'AppData!A1:ZZ1'
const APP_DATA_MAX_CELL_CHARS = 49000
const APP_DATA_BACKUP_DIR = resolve(process.cwd(), 'backups', 'appdata')

export class AppDataWriteRejectedError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'AppDataWriteRejectedError'
    this.details = details
  }
}

function appDataCounts(data) {
  if (data?.masterDisabled) {
    return { companies: 0, clients: 0, bills: 0, masterDisabled: true }
  }
  return {
    companies: Array.isArray(data?.companies) ? data.companies.length : 0,
    clients: Array.isArray(data?.clients) ? data.clients.length : 0,
    bills: Array.isArray(data?.bills) ? data.bills.length : 0,
    masterDisabled: false,
  }
}

function timestampForBackupFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Local timestamped snapshot of AppData before each write (best-effort; may fail on read-only hosts). */
function writeAppDataBackupFile(existing, meta = {}) {
  try {
    mkdirSync(APP_DATA_BACKUP_DIR, { recursive: true })
    const file = resolve(APP_DATA_BACKUP_DIR, `appdata-backup-${timestampForBackupFilename()}.json`)
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          backedUpAt: new Date().toISOString(),
          masterSpreadsheetId: getMasterSpreadsheetId(),
          ...meta,
          previous: existing,
        },
        null,
        2
      )}\n`,
      'utf8'
    )
    console.log(`[billing-api] AppData backup saved: ${file}`)
    return file
  } catch (e) {
    console.warn('[billing-api] AppData local backup failed:', e?.message || String(e))
    return null
  }
}

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

function chunkString(str, maxLen) {
  const chunks = []
  for (let i = 0; i < str.length; i += maxLen) {
    chunks.push(str.slice(i, i + maxLen))
  }
  return chunks
}

function joinAppDataRow(row) {
  if (!row?.length) return ''
  return row.map((c) => String(c ?? '')).join('')
}

function parseAppDataCell(cell) {
  if (!cell || !String(cell).trim()) {
    return {
      data: { companies: [], clients: [], bills: [] },
      parseOk: true,
      empty: true,
    }
  }
  try {
    const parsed = JSON.parse(String(cell))
    return {
      data: {
        companies: Array.isArray(parsed.companies) ? parsed.companies : [],
        clients: Array.isArray(parsed.clients) ? parsed.clients : [],
        bills: Array.isArray(parsed.bills) ? parsed.bills : [],
      },
      parseOk: true,
      empty: false,
    }
  } catch {
    return {
      data: { companies: [], clients: [], bills: [] },
      parseOk: false,
      empty: false,
    }
  }
}

async function readAppDataRowFromSheets_(spreadsheetId) {
  const { sheets } = await getGoogleClients()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: APP_DATA_ROW_RANGE,
  })
  return joinAppDataRow(res.data.values?.[0])
}

export async function readAppData() {
  const spreadsheetId = getMasterSpreadsheetId()
  if (!spreadsheetId) {
    return { masterDisabled: true }
  }
  try {
    const cell = await readAppDataRowFromSheets_(spreadsheetId)
    const { data } = parseAppDataCell(cell)
    return data
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
}

export async function saveAppData(body, options = {}) {
  const spreadsheetId = getMasterSpreadsheetId()
  if (!spreadsheetId) {
    return { ok: true, skipped: true }
  }

  const force =
    options.force === true ||
    body?.__appDataForce === true ||
    body?.__force === true

  const payload = {
    companies: body?.companies || [],
    clients: body?.clients || [],
    bills: body?.bills || [],
  }

  let existing = { companies: [], clients: [], bills: [] }
  let existingMeta = { parseOk: true, empty: true }
  try {
    const cell = await readAppDataRowFromSheets_(spreadsheetId)
    existingMeta = parseAppDataCell(cell)
    existing = existingMeta.data
  } catch (e) {
    if (!force) {
      const message =
        `AppData write rejected: could not read existing AppData (${e?.message || String(e)}). ` +
        'Pass force to override.'
      console.warn(`[billing-api] ${message}`)
      throw new AppDataWriteRejectedError(message, { readError: e?.message || String(e) })
    }
    console.warn('[billing-api] AppData read failed; proceeding with force:', e?.message || e)
  }

  const existingCounts = appDataCounts(existing)
  const incomingCounts = appDataCounts(payload)

  if (!existingMeta.parseOk && !force) {
    const message =
      'AppData write rejected: existing AppData cell is present but could not be parsed. ' +
      'Pass force (header x-billing-app-data-force: 1, query ?force=1, or body __appDataForce: true) to override.'
    console.warn(`[billing-api] ${message}`)
    throw new AppDataWriteRejectedError(message, { incoming: incomingCounts, parseOk: false })
  }

  if (!existingMeta.empty && existingCounts.bills > incomingCounts.bills && !force) {
    const message =
      `AppData write rejected: existing has ${existingCounts.bills} bills but incoming payload has ${incomingCounts.bills}. ` +
      'Pass force (header x-billing-app-data-force: 1, query ?force=1, or body __appDataForce: true) to override.'
    console.warn(`[billing-api] ${message}`)
    console.warn(
      `[billing-api] Counts — existing: ${existingCounts.companies} companies, ${existingCounts.clients} clients, ${existingCounts.bills} bills; ` +
        `incoming: ${incomingCounts.companies} companies, ${incomingCounts.clients} clients, ${incomingCounts.bills} bills`
    )
    throw new AppDataWriteRejectedError(message, {
      existing: existingCounts,
      incoming: incomingCounts,
    })
  }

  writeAppDataBackupFile(existing, { incomingCounts, forced: force })

  const { sheets } = await getGoogleClients()
  await ensureAppDataSheet_(sheets, spreadsheetId)
  const json = JSON.stringify(payload)
  const chunks = chunkString(json, APP_DATA_MAX_CELL_CHARS)
  const q = quoteSheetRange(APP_DATA_SHEET)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${q}!A1:ZZ1`,
  })
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${q}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [chunks] },
  })
  return { ok: true, backupCounts: existingCounts, writtenCounts: incomingCounts, forced: force }
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
