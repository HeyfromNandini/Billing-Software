#!/usr/bin/env node
/**
 * Recovery: rebuild { companies, clients, bills } from Bill-* tabs in company spreadsheets.
 *
 * Dry-run (default): writes rebuild-preview.json only — no Google writes.
 * Write mode:       npm run rebuild-app-data -- --write
 *   - Backs up current AppData!A1 → appdata-backup-before-rebuild.json
 *   - Writes reconstructed payload to AppData!A1
 *   - Verifies read-back + GET /api/billing/app-data
 */
import dotenv from 'dotenv'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn, execSync } from 'child_process'
import {
  getGoogleClients,
  readBillSheet,
  readAppData,
  saveAppData,
  getMasterSpreadsheetId,
} from '../server/googleHandlers.js'
import {
  parseBillFromSheetValues,
  mergeCustomColumnDefs,
} from '../src/sheets/billSheetRows.js'
import { dedupeBillEntries, dedupeBills } from '../src/utils/billing.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const OUT_FILE = resolve(root, 'rebuild-preview.json')
const BACKUP_FILE = resolve(root, 'appdata-backup-before-rebuild.json')

const WRITE_MODE = process.argv.includes('--write')

dotenv.config({ path: resolve(root, '.env') })
if (existsSync(resolve(root, '.env.local'))) {
  dotenv.config({ path: resolve(root, '.env.local'), override: true })
}

const COMPANY_SHEETS = [
  { companyId: 'aadarsh', envKey: 'VITE_GOOGLE_SHEET_ID_AADARSH' },
  { companyId: 'deva', envKey: 'VITE_GOOGLE_SHEET_ID_DEVA' },
  { companyId: 'sangita', envKey: 'VITE_GOOGLE_SHEET_ID_SANGITA' },
]

const BILL_TAB_PREFIX = /^Bill-/i

/** Same defaults as src/data/seedData.js MY_COMPANIES (kept here so Node can run without Vite resolution). */
const MY_COMPANIES = [
  { id: 'aadarsh', company_name: 'Aadarsh Logistics', address: '', pan_number: '', phone_1: '', phone_2: '' },
  { id: 'deva', company_name: 'Deva Lifters', address: '', pan_number: '', phone_1: '', phone_2: '' },
  {
    id: 'sangita',
    company_name: 'Sangita Logistics',
    address: 'Balaji Crest, Flat No. 1304, Plot No. 57, Sector 17, Roadpali, Kalamboli, Navi Mumbai – 410218',
    pan_number: 'DRBPS5123R',
    phone_1: '8652082121',
    phone_2: '9702082121',
  },
]

function mergeCompaniesWithDefaults(companies) {
  const incoming = Array.isArray(companies) ? companies.filter((c) => c && c.id) : []
  const defaultIds = new Set(MY_COMPANIES.map((c) => c.id))
  const byId = new Map(incoming.map((c) => [c.id, c]))
  const ordered = MY_COMPANIES.map((d) => {
    const existing = byId.get(d.id)
    return existing ? { ...d, ...existing } : { ...d }
  })
  const extras = incoming.filter((c) => !defaultIds.has(c.id))
  return [...ordered, ...extras]
}

function envSpreadsheetId(envKey) {
  return process.env[envKey]?.trim() || ''
}

function parseBillMetaFromTabTitle(tabTitle) {
  const raw = String(tabTitle || '')
  const withoutPrefix = raw.replace(/^Bill-/i, '')
  const sep = withoutPrefix.indexOf('__')
  if (sep >= 0) {
    return {
      billNumber: withoutPrefix.slice(0, sep),
      billId: withoutPrefix.slice(sep + 2) || null,
    }
  }
  return { billNumber: withoutPrefix, billId: null }
}

function clientDedupeKey(companyId, clientName, location) {
  return [
    companyId,
    String(clientName || '')
      .trim()
      .toLowerCase(),
    String(location || '')
      .trim()
      .toLowerCase(),
  ].join('\0')
}

function slugId(prefix, seed) {
  const safe = String(seed || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${prefix}-${safe || Date.now()}`
}

function countPayload(data) {
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

function assertCountsMatch(label, expected, actual) {
  const fields = ['companies', 'clients', 'bills']
  const mismatches = fields.filter((f) => expected[f] !== actual[f])
  if (mismatches.length === 0) return true
  console.error(`${label} count mismatch:`)
  for (const f of mismatches) {
    console.error(`  ${f}: expected ${expected[f]}, got ${actual[f]}`)
  }
  return false
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isQuotaError(message) {
  const m = String(message || '').toLowerCase()
  return m.includes('quota exceeded') || m.includes('rate limit')
}

async function readBillSheetWithRetry(params, maxAttempts = 8) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await readBillSheet(params)
    } catch (e) {
      lastError = e
      const msg = e?.message || String(e)
      if (isQuotaError(msg) && attempt < maxAttempts) {
        const wait = Math.min(30000, 2500 * attempt)
        console.warn(
          `  Rate limited reading [${params.sheetName}], retry in ${wait}ms (${attempt}/${maxAttempts})`
        )
        await sleep(wait)
        continue
      }
      throw e
    }
  }
  throw lastError
}

async function listSheetTitles(spreadsheetId) {
  const { sheets } = await getGoogleClients()
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title)',
  })
  return (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean)
}

function stubClient() {
  return { custom_columns: [] }
}

function buildBillRecord({ companyId, tabTitle, billPatch, clientId, billIdOverride }) {
  const fromTab = parseBillMetaFromTabTitle(tabTitle)
  const billNumber = String(billPatch.bill_number ?? fromTab.billNumber ?? '').trim()
  const id =
    billIdOverride ||
    fromTab.billId ||
    slugId('bill-rebuilt', `${companyId}-${tabTitle}`)

  return {
    id,
    company_id: companyId,
    client_id: clientId,
    bill_number: billNumber,
    bill_date: String(billPatch.bill_date ?? ''),
    client_name: String(billPatch.client_name ?? ''),
    client_location: String(billPatch.client_location ?? ''),
    route_from: String(billPatch.route_from ?? ''),
    route_to: String(billPatch.route_to ?? ''),
    entries: dedupeBillEntries(Array.isArray(billPatch.entries) ? billPatch.entries : []),
    rate_type: billPatch.rate_type ?? 'variable',
    rate_fixed: billPatch.rate_fixed ?? 7500,
    rate_base_weight: billPatch.rate_base_weight ?? 27273,
    rate_base_amount: billPatch.rate_base_amount ?? 7500,
    rate_extra_per_ton: billPatch.rate_extra_per_ton ?? 275,
    pdf_rate_column_text: String(billPatch.pdf_rate_column_text ?? ''),
    _rebuilt_from_tab: tabTitle,
  }
}

function stripInternalFields(bill) {
  const { _rebuilt_from_tab, ...rest } = bill
  return rest
}

async function rebuildFromCompanySheets() {
  const unparsedTabs = []
  const billRecords = []
  let totalTabsFound = 0

  for (const { companyId, envKey } of COMPANY_SHEETS) {
    const spreadsheetId = envSpreadsheetId(envKey)
    if (!spreadsheetId) {
      unparsedTabs.push({
        companyId,
        spreadsheetId: null,
        tabTitle: null,
        reason: `Missing env var ${envKey}`,
      })
      continue
    }

    let titles
    try {
      titles = await listSheetTitles(spreadsheetId)
    } catch (e) {
      unparsedTabs.push({
        companyId,
        spreadsheetId,
        tabTitle: null,
        reason: `Failed to list tabs: ${e?.message || String(e)}`,
      })
      continue
    }

    const billTabs = titles.filter((t) => BILL_TAB_PREFIX.test(String(t)))
    totalTabsFound += billTabs.length

    for (const tabTitle of billTabs) {
      try {
        await sleep(120)
        const data = await readBillSheetWithRetry({ spreadsheetId, sheetName: tabTitle })
        if (!data.ok) {
          unparsedTabs.push({
            companyId,
            spreadsheetId,
            tabTitle,
            reason: data.error || 'readBillSheet returned ok: false',
          })
          continue
        }
        if (!data.values?.length) {
          unparsedTabs.push({
            companyId,
            spreadsheetId,
            tabTitle,
            reason: 'Sheet tab is empty',
          })
          continue
        }

        const parsed = parseBillFromSheetValues(data.values, stubClient())
        if (!parsed?.billPatch) {
          unparsedTabs.push({
            companyId,
            spreadsheetId,
            tabTitle,
            reason: 'Parser returned null (missing sync marker or transport header row)',
          })
          continue
        }

        billRecords.push({
          companyId,
          spreadsheetId,
          tabTitle,
          billPatch: parsed.billPatch,
          customColumns: parsed.customColumns ?? [],
        })
      } catch (e) {
        unparsedTabs.push({
          companyId,
          spreadsheetId,
          tabTitle,
          reason: e?.message || String(e),
        })
      }
    }
  }

  const clientsByKey = new Map()
  const clients = []

  for (const row of billRecords) {
    const name = String(row.billPatch.client_name ?? '').trim()
    const location = String(row.billPatch.client_location ?? '').trim()
    const key = clientDedupeKey(row.companyId, name, location)

    let client = clientsByKey.get(key)
    if (!client) {
      const id = slugId('client-rebuilt', key)
      client = {
        id,
        company_id: row.companyId,
        client_name: name || 'Unknown client',
        location,
        custom_columns: [],
      }
      clientsByKey.set(key, client)
      clients.push(client)
    }
    if (row.customColumns?.length) {
      client.custom_columns = mergeCustomColumnDefs(client.custom_columns, row.customColumns)
    }
  }

  const bills = dedupeBills(
    billRecords.map((row) => {
      const name = String(row.billPatch.client_name ?? '').trim()
      const location = String(row.billPatch.client_location ?? '').trim()
      const key = clientDedupeKey(row.companyId, name, location)
      const client = clientsByKey.get(key)
      return stripInternalFields(
        buildBillRecord({
          companyId: row.companyId,
          tabTitle: row.tabTitle,
          billPatch: row.billPatch,
          clientId: client?.id || slugId('client-rebuilt', key),
        })
      )
    })
  )

  const companies = mergeCompaniesWithDefaults(MY_COMPANIES)

  return {
    generatedAt: new Date().toISOString(),
    dryRun: !WRITE_MODE,
    summary: {
      totalTabsFound,
      totalBillsReconstructed: bills.length,
      totalClientsReconstructed: clients.length,
      totalCompanies: companies.length,
      unparsedTabCount: unparsedTabs.length,
    },
    unparsedTabs,
    companies,
    clients,
    bills: bills,
  }
}

function loadPreviewFile() {
  if (!existsSync(OUT_FILE)) return null
  try {
    return JSON.parse(readFileSync(OUT_FILE, 'utf8'))
  } catch {
    return null
  }
}

function abortWrite(message) {
  console.error('')
  console.error(`WRITE ABORTED: ${message}`)
  console.error('')
  process.exit(1)
}

async function backupCurrentAppData() {
  const masterSpreadsheetId = getMasterSpreadsheetId()
  if (!masterSpreadsheetId) {
    abortWrite('BILLING_MASTER_SPREADSHEET_ID is not set — cannot write AppData!A1')
  }

  const previous = await readAppData()
  const backup = {
    backedUpAt: new Date().toISOString(),
    masterSpreadsheetId,
    previous,
  }
  writeFileSync(BACKUP_FILE, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
  return backup
}

async function writeAppDataPayload(payload) {
  const jsonLen = JSON.stringify({
    companies: payload.companies,
    clients: payload.clients,
    bills: payload.bills,
  }).length
  const chunks = Math.ceil(jsonLen / 49000) || 1
  console.log(`  Payload size: ${jsonLen} chars (${chunks} cell chunk(s) across AppData row 1)`)

  try {
    const out = await saveAppData(
      {
        companies: payload.companies,
        clients: payload.clients,
        bills: payload.bills,
      },
      { force: true }
    )
    if (out?.skipped) {
      abortWrite('saveAppData was skipped (master spreadsheet id missing)')
    }
    if (out?.ok !== true) {
      abortWrite('saveAppData did not return ok: true')
    }
  } catch (e) {
    const msg = e?.message || String(e)
    if (msg.includes('50000 characters')) {
      abortWrite(
        'AppData payload exceeds Google Sheets single-cell limit and chunked write failed — check saveAppData chunking'
      )
    }
    throw e
  }
}

function killProcessOnPort(port) {
  const p = String(port)
  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore' }
      )
    } catch {
      /* nothing listening */
    }
    return
  }
  try {
    execSync(`lsof -ti:${p} | xargs kill -9 2>/dev/null`, { shell: true, stdio: 'ignore' })
  } catch {
    /* nothing listening */
  }
}

async function waitForHealth(baseUrl, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/billing/health`, { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        if (json?.ok) return true
      }
    } catch {
      /* retry */
    }
    await sleep(400)
  }
  return false
}

async function fetchAppDataViaHttp(port, maxAttempts = 8) {
  const secret = process.env.BILLING_API_SECRET?.trim()
  const headers = { 'Cache-Control': 'no-store' }
  if (secret) headers['x-billing-api-secret'] = secret

  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/billing/app-data`, {
        cache: 'no-store',
        headers,
      })
      const text = await res.text()
      if (!res.ok) {
        const err = new Error(
          `GET /api/billing/app-data failed: HTTP ${res.status} — ${text.slice(0, 200)}`
        )
        if (isQuotaError(text) && attempt < maxAttempts) {
          const wait = Math.min(30000, 3000 * attempt)
          console.warn(`  API read rate limited, retry in ${wait}ms (${attempt}/${maxAttempts})`)
          await sleep(wait)
          lastError = err
          continue
        }
        throw err
      }
      return JSON.parse(text)
    } catch (e) {
      lastError = e
      if (isQuotaError(e?.message) && attempt < maxAttempts) {
        const wait = Math.min(30000, 3000 * attempt)
        console.warn(`  API fetch error, retry in ${wait}ms (${attempt}/${maxAttempts})`)
        await sleep(wait)
        continue
      }
      throw e
    }
  }
  throw lastError
}

async function restartBillingApiAndVerify(expectedCounts) {
  const port = Number(process.env.BILLING_API_PORT || process.env.PORT || 8787)
  const baseUrl = `http://localhost:${port}`

  console.log(`Restarting billing API on port ${port}...`)
  killProcessOnPort(port)
  await sleep(800)

  const child = spawn(process.execPath, [resolve(root, 'server/index.js')], {
    cwd: root,
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  const healthy = await waitForHealth(baseUrl)
  if (!healthy) {
    abortWrite(`Billing API did not become healthy at ${baseUrl}/api/billing/health`)
  }

  console.log('Billing API is up. Fetching GET /api/billing/app-data ...')
  const httpData = await fetchAppDataViaHttp(port)
  const httpCounts = countPayload(httpData)

  if (httpCounts.masterDisabled) {
    abortWrite('GET /api/billing/app-data returned masterDisabled after write')
  }

  const ok = assertCountsMatch('HTTP GET /api/billing/app-data', expectedCounts, httpCounts)
  if (!ok) {
    abortWrite('HTTP verification failed after write')
  }

  return httpCounts
}

async function runWritePhase(payload) {
  const expectedCounts = {
    companies: payload.summary.totalCompanies,
    clients: payload.summary.totalClientsReconstructed,
    bills: payload.summary.totalBillsReconstructed,
  }

  console.log('')
  console.log('Write phase — AppData!A1 only (company bill tabs unchanged)')
  console.log('-----------------------------------------------------------')

  const preview = loadPreviewFile()
  if (!preview?.summary) {
    abortWrite(`Missing or invalid ${OUT_FILE} — run dry-run first`)
  }

  if (preview.summary.totalBillsReconstructed !== payload.summary.totalBillsReconstructed) {
    abortWrite(
      `Reconstructed bill count (${payload.summary.totalBillsReconstructed}) differs from preview (${preview.summary.totalBillsReconstructed})`
    )
  }
  if (preview.summary.totalClientsReconstructed !== payload.summary.totalClientsReconstructed) {
    abortWrite(
      `Reconstructed client count (${payload.summary.totalClientsReconstructed}) differs from preview (${preview.summary.totalClientsReconstructed})`
    )
  }
  if (preview.summary.totalCompanies !== payload.summary.totalCompanies) {
    abortWrite(
      `Reconstructed company count (${payload.summary.totalCompanies}) differs from preview (${preview.summary.totalCompanies})`
    )
  }

  if (payload.summary.unparsedTabCount > 0) {
    abortWrite(`${payload.summary.unparsedTabCount} tab(s) could not be parsed — fix before writing`)
  }

  console.log('Preview counts match fresh reconstruction. Proceeding with backup...')
  const backup = await backupCurrentAppData()
  const beforeCounts = countPayload(backup.previous)

  console.log(`Backup saved: ${BACKUP_FILE}`)
  console.log(
    `  Previous AppData: ${beforeCounts.masterDisabled ? 'masterDisabled / empty' : `${beforeCounts.companies} companies, ${beforeCounts.clients} clients, ${beforeCounts.bills} bills`}`
  )

  console.log('')
  console.log('Writing reconstructed payload to AppData!A1 ...')
  await writeAppDataPayload(payload)

  console.log('Reading AppData!A1 back for verification ...')
  const readBack = await readAppData()
  const readBackCounts = countPayload(readBack)

  if (readBackCounts.masterDisabled) {
    abortWrite('readAppData returned masterDisabled immediately after write')
  }

  const readOk = assertCountsMatch('readAppData() after write', expectedCounts, readBackCounts)
  if (!readOk) {
    abortWrite('AppData read-back verification failed — AppData!A1 may be inconsistent')
  }

  console.log('')
  console.log('Verification summary (Google Sheets read-back)')
  console.log('---------------------------------------------')
  console.log(`  Companies: ${readBackCounts.companies} (expected ${expectedCounts.companies}) ✓`)
  console.log(`  Clients:   ${readBackCounts.clients} (expected ${expectedCounts.clients}) ✓`)
  console.log(`  Bills:     ${readBackCounts.bills} (expected ${expectedCounts.bills}) ✓`)

  const httpCounts = await restartBillingApiAndVerify(expectedCounts)

  console.log('')
  console.log('Verification summary (HTTP API)')
  console.log('--------------------------------')
  console.log(`  GET /api/billing/app-data`)
  console.log(`  Companies: ${httpCounts.companies} ✓`)
  console.log(`  Clients:   ${httpCounts.clients} ✓`)
  console.log(`  Bills:     ${httpCounts.bills} ✓`)
  console.log('')
  console.log('Write completed successfully.')
  console.log(`  Backup:  ${BACKUP_FILE}`)
  console.log(`  Preview: ${OUT_FILE}`)
  console.log('')
}

async function main() {
  const payload = await rebuildFromCompanySheets()

  payload.dryRun = !WRITE_MODE
  writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log('')
  console.log(WRITE_MODE ? 'Rebuild + write mode' : 'Rebuild preview (dry-run — no Google writes)')
  console.log('-------------------------------------------')
  console.log(`Total Bill-* tabs found:     ${payload.summary.totalTabsFound}`)
  console.log(`Total bills reconstructed:   ${payload.summary.totalBillsReconstructed}`)
  console.log(`Total clients reconstructed:   ${payload.summary.totalClientsReconstructed}`)
  console.log(`Total companies:               ${payload.summary.totalCompanies}`)
  console.log(`Unparsed tabs:                 ${payload.summary.unparsedTabCount}`)
  console.log('')
  console.log(`Preview written to: ${OUT_FILE}`)
  console.log('')

  if (payload.unparsedTabs.length > 0) {
    console.log('Tabs that could not be parsed:')
    for (const u of payload.unparsedTabs) {
      console.log(
        `  - [${u.companyId}] ${u.tabTitle ?? '(list failed)'}: ${u.reason}`
      )
    }
    console.log('')
  }

  if (WRITE_MODE) {
    await runWritePhase(payload)
  } else {
    console.log('To write AppData!A1 after review: npm run rebuild-app-data -- --write')
    console.log('')
  }
}

main().catch((e) => {
  console.error('[rebuild-app-data]', e)
  process.exit(1)
})
