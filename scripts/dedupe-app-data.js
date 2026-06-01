#!/usr/bin/env node
/**
 * Remove duplicate bills from AppData!A1 (same id, or same company + bill number).
 *
 * Dry-run (default): prints summary only.
 * Write mode:       npm run dedupe-app-data -- --write
 */
import dotenv from 'dotenv'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readAppData, saveAppData, getMasterSpreadsheetId } from '../server/googleHandlers.js'
import { dedupeBills } from '../src/utils/billing.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const WRITE_MODE = process.argv.includes('--write')

dotenv.config({ path: resolve(root, '.env') })
if (existsSync(resolve(root, '.env.local'))) {
  dotenv.config({ path: resolve(root, '.env.local'), override: true })
}

function summarize(bills) {
  const byNum = new Map()
  for (const b of bills) {
    const key = `${b.company_id}|${b.bill_number}`
    byNum.set(key, (byNum.get(key) || 0) + 1)
  }
  const dupGroups = [...byNum.values()].filter((n) => n > 1).length
  return { total: bills.length, dupGroups }
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

  const before = Array.isArray(data.bills) ? data.bills : []
  const after = dedupeBills(before)
  const removed = before.length - after.length

  console.log('')
  console.log(WRITE_MODE ? 'Dedupe + write mode' : 'Dedupe preview (dry-run — no Google writes)')
  console.log('-------------------------------------------')
  console.log(`Bills before: ${before.length}`)
  console.log(`Bills after:  ${after.length}`)
  console.log(`Removed:      ${removed}`)
  console.log(`Before dup groups (company+number): ${summarize(before).dupGroups}`)
  console.log(`After dup groups (company+number):  ${summarize(after).dupGroups}`)
  console.log('')

  if (removed === 0) {
    console.log('No duplicate bills found — nothing to do.')
    return
  }

  if (!WRITE_MODE) {
    console.log('To write deduped AppData: npm run dedupe-app-data -- --write')
    console.log('')
    return
  }

  const out = await saveAppData(
    {
      companies: data.companies || [],
      clients: data.clients || [],
      bills: after,
    },
    { force: true }
  )

  if (out?.skipped || out?.ok !== true) {
    console.error('saveAppData failed:', out)
    process.exit(1)
  }

  const verify = await readAppData()
  const verifyBills = Array.isArray(verify.bills) ? verify.bills : []
  console.log(`Written. Read-back bill count: ${verifyBills.length}`)
  console.log('Done.')
  console.log('')
}

main().catch((e) => {
  console.error('[dedupe-app-data]', e)
  process.exit(1)
})
