import { isDriveLayoutConfigured, companySpreadsheetId } from './config'
import { syncBillSheet, deleteBillSheet } from './driveLayout'
import { billSheetTitle, billToSheetRows } from './billSheetRows'

const timers = new Map()
const latestByBillId = new Map()

let getDriveCtx = () => ({
  companies: [],
  clients: [],
  patchBillDriveMeta: () => {},
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

export async function flushBillToDrive(bill, companies, clients) {
  if (!isDriveLayoutConfigured()) return
  const client = clients.find((c) => c.id === bill.client_id)
  if (!client) return
  const spreadsheetId = companySpreadsheetId(bill.company_id)
  if (!spreadsheetId) return
  const rows = billToSheetRows(bill, client)
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
