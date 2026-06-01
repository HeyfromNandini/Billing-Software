#!/usr/bin/env node
/**
 * Remove duplicate Bill-* worksheet tabs (same company spreadsheet + bill number).
 * Keeps the tab that matches AppData (after dedupe) or the Bill-{n}__{id} tab with the most data.
 *
 * Dry-run (default): lists tabs that would be deleted; no Google writes.
 * Write mode:       npm run dedupe-bill-sheets -- --write
 *   - Dedupes AppData!A1 bills (same rules as dedupe-app-data)
 *   - Deletes extra Bill-* tabs in company spreadsheets
 */
import dotenv from 'dotenv'
import { existsSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  getGoogleClients,
  readAppData,
  saveAppData,
  getMasterSpreadsheetId,
  deleteBillSheet,
} from '../server/googleHandlers.js'
import { dedupeBills, billKeepScore } from '../src/utils/billing.js'
import { parseBillMetaFromTabTitle } from '../src/sheets/billSheetRows.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const REPORT_FILE = resolve(root, 'dedupe-bill-sheets-report.json')
const WRITE_MODE = process.argv.includes('--write')

const COMPANY_SHEETS = [
  { companyId: 'aadarsh', envKey: 'VITE_GOOGLE_SHEET_ID_AADARSH' },
  { companyId: 'deva', envKey: 'VITE_GOOGLE_SHEET_ID_DEVA' },
  { companyId: 'sangita', envKey: 'VITE_GOOGLE_SHEET_ID_SANGITA' },
]

const BILL_TAB_PREFIX = /^Bill-/i

dotenv.config({ path: resolve(root, '.env') })
if (existsSync(resolve(root, '.env.local'))) {
  dotenv.config({ path: resolve(root, '.env.local'), override: true })
}

function envSpreadsheetId(envKey) {
  return process.env[envKey]?.trim() || ''
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function listBillTabs(spreadsheetId) {
  const { sheets } = await getGoogleClients()
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  })
  return (meta.data.sheets || [])
    .map((s) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title,
    }))
    .filter((t) => t.title && BILL_TAB_PREFIX.test(t.title))
}

/** Higher = prefer keeping this tab when bill numbers collide. */
function tabKeepScore(tabTitle, canonicalBillId, billIdsForNumber) {
  const { billId } = parseBillMetaFromTabTitle(tabTitle)
  let score = 0
  if (billId) score += 200
  if (billId && billId === canonicalBillId) score += 10_000
  if (billId && billIdsForNumber.has(billId)) score += 1_000
  if (!billId && !canonicalBillId) score += 50
  if (!billId && canonicalBillId) score += 0
  return score
}

function buildCanonicalBillMaps(bills) {
  const byCompanyNumber = new Map()
  const idsByCompanyNumber = new Map()

  for (const b of bills) {
    const num = String(b.bill_number ?? '').trim()
    if (!b.company_id || !num) continue
    const key = `${b.company_id}\0${num}`
    if (!idsByCompanyNumber.has(key)) idsByCompanyNumber.set(key, new Set())
    idsByCompanyNumber.get(key).add(String(b.id))

    const cur = byCompanyNumber.get(key)
    if (!cur || billKeepScore(b) > billKeepScore(cur)) {
      byCompanyNumber.set(key, b)
    }
  }

  return { byCompanyNumber, idsByCompanyNumber }
}

function planTabDeletions(tabs, companyId, canonicalMaps) {
  const byNumber = new Map()
  for (const tab of tabs) {
    const { billNumber } = parseBillMetaFromTabTitle(tab.title)
    const num = String(billNumber ?? '').trim()
    if (!num) continue
    if (!byNumber.has(num)) byNumber.set(num, [])
    byNumber.get(num).push(tab)
  }

  const toDelete = []
  const toKeep = []

  for (const [billNumber, group] of byNumber) {
    if (group.length <= 1) {
      toKeep.push(...group)
      continue
    }
    const key = `${companyId}\0${billNumber}`
    const canonical = canonicalMaps.byCompanyNumber.get(key)
    const canonicalId = canonical?.id ? String(canonical.id) : null
    const idSet = canonicalMaps.idsByCompanyNumber.get(key) || new Set()

    let best = group[0]
    let bestScore = tabKeepScore(best.title, canonicalId, idSet)
    for (let i = 1; i < group.length; i += 1) {
      const t = group[i]
      const sc = tabKeepScore(t.title, canonicalId, idSet)
      if (sc > bestScore) {
        best = t
        bestScore = sc
      }
    }
    toKeep.push(best)
    for (const t of group) {
      if (t.sheetId !== best.sheetId) {
        toDelete.push({
          companyId,
          billNumber,
          tabTitle: t.title,
          keepTitle: best.title,
          canonicalBillId: canonicalId,
        })
      }
    }
  }

  return { toDelete, toKeep }
}

async function main() {
  const masterId = getMasterSpreadsheetId()
  if (!masterId) {
    console.error('BILLING_MASTER_SPREADSHEET_ID is not set.')
    process.exit(1)
  }

  const data = await readAppData()
  if (data?.masterDisabled) {
    console.error('Master spreadsheet disabled or unreadable.')
    process.exit(1)
  }

  const beforeBills = Array.isArray(data.bills) ? data.bills : []
  const afterBills = dedupeBills(beforeBills)
  const billsRemovedFromApp = beforeBills.length - afterBills.length
  const canonicalMaps = buildCanonicalBillMaps(afterBills)

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: !WRITE_MODE,
    appData: {
      billsBefore: beforeBills.length,
      billsAfter: afterBills.length,
      removed: billsRemovedFromApp,
    },
    spreadsheets: [],
    tabsToDelete: [],
    deleted: [],
    errors: [],
  }

  for (const { companyId, envKey } of COMPANY_SHEETS) {
    const spreadsheetId = envSpreadsheetId(envKey)
    const row = { companyId, envKey, spreadsheetId: spreadsheetId || null }
    if (!spreadsheetId) {
      row.skipped = `Missing env ${envKey}`
      report.spreadsheets.push(row)
      continue
    }

    try {
      const tabs = await listBillTabs(spreadsheetId)
      const { toDelete, toKeep } = planTabDeletions(tabs, companyId, canonicalMaps)
      row.billTabCount = tabs.length
      row.duplicateGroups = toDelete.length
      row.keepCount = toKeep.length
      report.tabsToDelete.push(...toDelete.map((d) => ({ ...d, spreadsheetId })))
      report.spreadsheets.push(row)
      await sleep(150)
    } catch (e) {
      row.error = e?.message || String(e)
      report.errors.push({ companyId, error: row.error })
      report.spreadsheets.push(row)
    }
  }

  writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log('')
  console.log(WRITE_MODE ? 'Dedupe bill sheets — WRITE mode' : 'Dedupe bill sheets — dry-run')
  console.log('-------------------------------------------')
  console.log(`AppData bills: ${beforeBills.length} → ${afterBills.length} (remove ${billsRemovedFromApp})`)
  console.log(`Duplicate tabs to delete: ${report.tabsToDelete.length}`)
  console.log(`Report: ${REPORT_FILE}`)
  console.log('')

  if (report.tabsToDelete.length > 0) {
    const sample = report.tabsToDelete.slice(0, 15)
    for (const d of sample) {
      console.log(`  [${d.companyId}] delete "${d.tabTitle}" (keep "${d.keepTitle}", bill #${d.billNumber})`)
    }
    if (report.tabsToDelete.length > 15) {
      console.log(`  … and ${report.tabsToDelete.length - 15} more (see report JSON)`)
    }
    console.log('')
  }

  if (!WRITE_MODE) {
    if (report.tabsToDelete.length === 0 && billsRemovedFromApp === 0) {
      console.log('No duplicate bill tabs or AppData bills found.')
    } else {
      console.log('To delete duplicate tabs and write deduped AppData:')
      console.log('  npm run dedupe-bill-sheets -- --write')
    }
    console.log('')
    return
  }

  if (billsRemovedFromApp > 0) {
    console.log('Writing deduped AppData…')
    const out = await saveAppData(
      {
        companies: data.companies || [],
        clients: data.clients || [],
        bills: afterBills,
      },
      { force: true }
    )
    if (out?.skipped || out?.ok !== true) {
      console.error('saveAppData failed:', out)
      process.exit(1)
    }
    console.log(`AppData updated (${afterBills.length} bills).`)
  }

  if (report.tabsToDelete.length === 0) {
    console.log('No duplicate tabs to delete.')
    console.log('Done.')
    console.log('')
    return
  }

  console.log(`Deleting ${report.tabsToDelete.length} worksheet tab(s)…`)
  for (const d of report.tabsToDelete) {
    try {
      await sleep(200)
      await deleteBillSheet({ spreadsheetId: d.spreadsheetId, sheetName: d.tabTitle })
      report.deleted.push(d.tabTitle)
      console.log(`  deleted: ${d.tabTitle}`)
    } catch (e) {
      const msg = e?.message || String(e)
      report.errors.push({ tabTitle: d.tabTitle, error: msg })
      console.error(`  failed: ${d.tabTitle} — ${msg}`)
    }
  }

  writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('')
  console.log(`Deleted ${report.deleted.length} tab(s). Errors: ${report.errors.length}`)
  console.log('Done.')
  console.log('')
}

main().catch((e) => {
  console.error('[dedupe-bill-sheets]', e)
  process.exit(1)
})
