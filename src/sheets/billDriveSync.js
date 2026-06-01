import { isDriveLayoutConfigured, companySpreadsheetId } from './config'
import { syncBillSheet, deleteBillSheet, readBillSheet } from './driveLayout'
import {
  billSheetTitle,
  legacyBillSheetTitle,
  billToSheetRows,
  parseBillFromSheetValues,
  mergeEntryCustomFromSheetEntries,
  mergeCustomColumnDefs,
} from './billSheetRows'

const timers = new Map()
const latestByBillId = new Map()

let getDriveCtx = () => ({
  companies: [],
  clients: [],
  patchBillDriveMeta: () => {},
  patchBillFromSheetPull: () => {},
  patchClientCustomColumns: () => {},
})

/** Called from AppProvider whenever companies/clients change. */
export function registerDriveSyncContext(getCtx) {
  getDriveCtx = getCtx
}

export function cancelBillDriveSync(billId) {
  const t = timers.get(billId)
  if (t) clearTimeout(t)
  timers.delete(billId)
  latestByBillId.delete(billId)
}

export function queueBillDriveSyncWithBill(bill) {
  if (!isDriveLayoutConfigured() || !bill?.id) return
  latestByBillId.set(bill.id, bill)
  const prev = timers.get(bill.id)
  if (prev) clearTimeout(prev)
  timers.set(
    bill.id,
    setTimeout(() => {
      timers.delete(bill.id)
      const b = latestByBillId.get(bill.id)
      latestByBillId.delete(bill.id)
      if (!b) return
      const { companies, clients } = getDriveCtx()
      void flushBillToDrive(b, companies, clients).catch((e) => console.error('[Drive] bill sheet', e))
    }, 900)
  )
}

/** Read sheet tab and fill empty entry.custom fields before overwriting the tab. */
async function mergeBillFromSheetBeforePush(bill, client, spreadsheetId) {
  const names = [billSheetTitle(bill), legacyBillSheetTitle(bill)]
  let values = null
  for (const sheetName of names) {
    const data = await readBillSheet({ spreadsheetId, sheetName })
    if (data.ok && data.values?.length) {
      values = data.values
      break
    }
  }
  if (!values) return { bill, client }

  const parsed = parseBillFromSheetValues(values, client)
  if (!parsed?.billPatch?.entries?.length) return { bill, client }

  const mergedCols = mergeCustomColumnDefs(client.custom_columns, parsed.customColumns)
  const clientChanged =
    JSON.stringify(mergedCols) !== JSON.stringify(client.custom_columns ?? [])
  const clientOut = clientChanged ? { ...client, custom_columns: mergedCols } : client

  const ids = mergedCols.map((c) => c.id)
  const { entries, changed } = mergeEntryCustomFromSheetEntries(
    bill.entries || [],
    parsed.billPatch.entries,
    ids
  )
  if (!changed && !clientChanged) return { bill, client: clientOut }

  const billOut = changed ? { ...bill, entries } : bill
  const ctx = getDriveCtx()
  if (clientChanged) ctx.patchClientCustomColumns?.(client.id, mergedCols)
  if (changed) ctx.patchBillFromSheetPull?.(bill.id, entries)
  return { bill: billOut, client: clientOut }
}

export async function flushBillToDrive(bill, companies, clients) {
  if (!isDriveLayoutConfigured()) return
  const client = clients.find((c) => c.id === bill.client_id)
  if (!client) return
  const spreadsheetId = companySpreadsheetId(bill.company_id)
  if (!spreadsheetId) return

  const { bill: billToWrite, client: clientToWrite } = await mergeBillFromSheetBeforePush(
    bill,
    client,
    spreadsheetId
  )
  const rows = billToSheetRows(billToWrite, clientToWrite)
  const json = await syncBillSheet({
    spreadsheetId,
    sheetName: billSheetTitle(bill),
    rows,
  })
  if (json?.fileLastUpdated) {
    getDriveCtx().patchBillDriveMeta?.(bill.id, { drive_file_updated_at: json.fileLastUpdated })
  }
}

/** Push this bill to Drive immediately (e.g. overwrite sheet after conflict). */
export async function flushBillToDriveNow(bill) {
  if (!bill?.id) return
  cancelBillDriveSync(bill.id)
  const { companies, clients } = getDriveCtx()
  await flushBillToDrive(bill, companies, clients)
}

export async function removeBillSheetFromDrive(bill) {
  if (!isDriveLayoutConfigured() || !bill?.company_id) return
  const spreadsheetId = companySpreadsheetId(bill.company_id)
  if (!spreadsheetId) return
  await deleteBillSheet({
    spreadsheetId,
    sheetName: billSheetTitle(bill),
  })
}
