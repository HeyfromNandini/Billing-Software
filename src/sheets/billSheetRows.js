import { FIXED_HEADERS } from '../components/TransportTable'
import { rowTotal, rowBalance } from '../utils/billing'

/** Row 1 col A — new layout: col B is version; bill fields are label/value rows below. */
export const SHEET_SYNC_MARKER = '__BILL_SYNC_V3__'

/** Legacy tabs still parse (JSON in B1 + title row). */
export const SHEET_SYNC_MARKER_V2 = '__BILL_SYNC_V2__'

/** Google Sheet tab name (max ~100 chars; avoid * ? : \ / [ ]). */
export function billSheetTitle(bill) {
  const n = String(bill?.bill_number ?? '0').replace(/[*?:\\/[\]]/g, '-')
  return `Bill-${n}`.slice(0, 99)
}

function sortedCustomColumns(client) {
  return [...(client?.custom_columns || [])].sort(
    (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
  )
}

export function buildBillSheetMeta(bill, client) {
  const customs = sortedCustomColumns(client)
  return {
    v: 3,
    bill_number: bill.bill_number,
    bill_date: bill.bill_date,
    client_name: bill.client_name,
    client_location: bill.client_location,
    route_from: bill.route_from,
    route_to: bill.route_to,
    rate_type: bill.rate_type,
    rate_fixed: bill.rate_fixed,
    rate_base_weight: bill.rate_base_weight,
    rate_base_amount: bill.rate_base_amount,
    rate_extra_per_ton: bill.rate_extra_per_ton,
    custom_columns: customs.map((c) => ({ id: c.id, name: c.name, order: c.order })),
  }
}

/** Col A labels (normalized) → bill field + how to parse col B. */
const SHEET_INFO_LABELS = {
  'bill #': { key: 'bill_number', type: 'string' },
  date: { key: 'bill_date', type: 'string' },
  client: { key: 'client_name', type: 'string' },
  location: { key: 'client_location', type: 'string' },
  'route from': { key: 'route_from', type: 'string' },
  'route to': { key: 'route_to', type: 'string' },
  'rate type': { key: 'rate_type', type: 'string' },
  'fixed rate': { key: 'rate_fixed', type: 'number' },
  'base weight (t)': { key: 'rate_base_weight', type: 'number' },
  'base amount': { key: 'rate_base_amount', type: 'number' },
  'extra per ton': { key: 'rate_extra_per_ton', type: 'number' },
}

/**
 * 2D array: sync marker, label/value bill details (cols A–B), blank, table header, data rows.
 * @param {object} bill
 * @param {object} [client]
 */
export function billToSheetRows(bill, client) {
  const customs = sortedCustomColumns(client)
  const customLabels = customs.map((c) => c.name || c.id || 'Custom')
  const headerRow = [...FIXED_HEADERS, ...customLabels]
  const entries = Array.isArray(bill.entries) ? bill.entries : []

  const detailRows = [
    ['Bill #', String(bill.bill_number ?? '')],
    ['Date', bill.bill_date ?? ''],
    ['Client', bill.client_name ?? ''],
    ['Location', bill.client_location ?? ''],
    ['Route from', bill.route_from ?? ''],
    ['Route to', bill.route_to ?? ''],
    ['Rate type', bill.rate_type ?? ''],
    ['Fixed rate', bill.rate_fixed ?? ''],
    ['Base weight (t)', bill.rate_base_weight ?? ''],
    ['Base amount', bill.rate_base_amount ?? ''],
    ['Extra per ton', bill.rate_extra_per_ton ?? ''],
  ]

  const rows = [[SHEET_SYNC_MARKER, '3'], ...detailRows, [], headerRow]

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]
    const total = rowTotal(e)
    const bal = rowBalance(e)
    const base = [
      i + 1,
      e.date ?? '',
      e.vehicle_number ?? '',
      e.invoice_number ?? '',
      e.from ?? '',
      e.to ?? '',
      e.weight ?? '',
      e.rate ?? '',
      total,
      e.advance ?? '',
      bal,
    ]
    const customVals = customs.map((c) => (e.custom && e.custom[c.id]) ?? '')
    rows.push([...base, ...customVals])
  }

  return rows
}

function normHeader(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** Map normalized header → fixed column key (undefined = not fixed). */
function headerToFixedKey(h) {
  const n = normHeader(h)
  if (n === 'sr. no' || n === 'sr no' || n === 'sr.no' || n === 'sr' || n === 'sr no.') return 'sr'
  if (n === 'date') return 'date'
  if (n.startsWith('vehicle')) return 'vehicle'
  if (n.startsWith('invoice')) return 'invoice'
  if (n === 'from') return 'from'
  if (n === 'to') return 'to'
  if (n === 'weight') return 'weight'
  if (n === 'rate') return 'rate'
  if (n === 'total') return 'total'
  if (n === 'advance') return 'advance'
  if (n === 'balance') return 'balance'
  return undefined
}

function numOrEmpty(v) {
  if (v === '' || v == null) return ''
  const x = Number(v)
  return Number.isFinite(x) ? x : ''
}

/** Rows from `start` up to (but not including) transport header: col A = label, B = value. */
function mergeV3LabelRowsIntoPatch(values, start, headerIdx, billPatch) {
  for (let i = start; i < headerIdx; i += 1) {
    const row = values[i]
    if (!row?.length) continue
    const a = String(row[0] ?? '').trim()
    if (!a) continue
    if (headerToFixedKey(row[0]) === 'sr') break
    const spec = SHEET_INFO_LABELS[normHeader(a)]
    if (!spec) continue
    const raw = row[1]
    if (spec.type === 'number') {
      const n = Number(raw)
      billPatch[spec.key] = Number.isFinite(n) ? n : 0
    } else {
      billPatch[spec.key] = raw == null ? '' : String(raw)
    }
  }
}

/** Title row below __BILL_SYNC_V2__ — users often edit these cells; B1 JSON stays stale until next app push. */
function mergeTitleRowIntoBillPatch(titleRow, billPatch) {
  if (!titleRow?.length) return
  const c0 = String(titleRow[0] ?? '').trim()
  const numM = c0.match(/^bill\s*#\s*(.+)$/i)
  if (numM?.[1]?.trim()) billPatch.bill_number = numM[1].trim()
  const c1 = titleRow[1]
  if (c1 != null && String(c1).trim() !== '') billPatch.bill_date = String(c1).trim()
  const c2 = titleRow[2]
  if (c2 != null && String(c2).trim() !== '') billPatch.client_name = String(c2).trim()
  const c3 = titleRow[3]
  if (c3 != null && String(c3).trim() !== '') billPatch.client_location = String(c3).trim()
  const route = String(titleRow[4] ?? '').trim()
  if (route) {
    const arrow = route.includes('→') ? '→' : route.includes('->') ? '->' : ''
    if (arrow) {
      const i = route.indexOf(arrow)
      billPatch.route_from = route.slice(0, i).trim()
      billPatch.route_to = route.slice(i + arrow.length).trim()
    }
  }
}

function findHeaderRowIndex(values, startAt) {
  const max = Math.min(values.length, 40)
  for (let i = startAt; i < max; i += 1) {
    const row = values[i]
    if (!row?.length) continue
    const key = headerToFixedKey(row[0])
    if (key === 'sr') return i
  }
  return -1
}

/**
 * Parse sheet grid → fields to merge into bill (and entries).
 * @param {string[][]} values
 * @param {object} client — current client (custom column defs)
 * @returns {{ billPatch: object } | null}
 */
export function parseBillFromSheetValues(values, client) {
  if (!values?.length) return null

  const a1 = String(values[0]?.[0] ?? '').trim()
  const isV3 = a1 === SHEET_SYNC_MARKER
  const isV2 = a1 === SHEET_SYNC_MARKER_V2

  let meta = {}
  let scanStart = 0
  if (isV3) {
    scanStart = 1
  } else if (isV2) {
    try {
      meta = JSON.parse(values[0][1] || '{}')
    } catch {
      meta = {}
    }
    scanStart = 1
  }

  const headerIdx = findHeaderRowIndex(values, scanStart)
  if (headerIdx < 0) return null

  const headers = (values[headerIdx] || []).map((h) => String(h ?? '').trim())
  const colByKey = {}
  headers.forEach((h, idx) => {
    const key = headerToFixedKey(h)
    if (key && colByKey[key] === undefined) colByKey[key] = idx
  })

  const customs = sortedCustomColumns(client)

  const used = new Set(Object.values(colByKey).filter((x) => x != null))
  const extraHeaderIndices = []
  headers.forEach((h, i) => {
    if (used.has(i)) return
    if (!normHeader(h)) return
    extraHeaderIndices.push(i)
  })

  const entries = []
  for (let r = headerIdx + 1; r < values.length; r += 1) {
    const row = values[r]
    if (!row?.length) continue
    const isEmpty = row.every((c) => c === '' || c == null)
    if (isEmpty) continue

    const srVal = colByKey.sr != null ? row[colByKey.sr] : row[0]
    if (srVal === '' || srVal == null) continue

    const custom = {}
    customs.forEach((c, j) => {
      const ci = extraHeaderIndices[j]
      custom[c.id] = ci != null ? row[ci] ?? '' : ''
    })

    const entry = {
      id: `imported-${r}-${Date.now()}`,
      date: colByKey.date != null ? row[colByKey.date] ?? '' : '',
      vehicle_number: colByKey.vehicle != null ? String(row[colByKey.vehicle] ?? '').trim() : '',
      invoice_number: colByKey.invoice != null ? String(row[colByKey.invoice] ?? '').trim() : '',
      from: colByKey.from != null ? String(row[colByKey.from] ?? '').trim() : '',
      to: colByKey.to != null ? String(row[colByKey.to] ?? '').trim() : '',
      weight: colByKey.weight != null ? numOrEmpty(row[colByKey.weight]) : '',
      rate: colByKey.rate != null ? numOrEmpty(row[colByKey.rate]) : '',
      advance: colByKey.advance != null ? numOrEmpty(row[colByKey.advance]) : 0,
      custom,
    }

    if (
      !entry.date &&
      !entry.vehicle_number &&
      !entry.invoice_number &&
      !entry.from &&
      !entry.to &&
      entry.weight === '' &&
      entry.rate === '' &&
      (!entry.advance || entry.advance === 0) &&
      Object.keys(custom).every((k) => !String(custom[k] ?? '').trim())
    ) {
      continue
    }

    entries.push(entry)
  }

  const billPatch = {
    entries,
  }

  if (isV3) {
    mergeV3LabelRowsIntoPatch(values, 1, headerIdx, billPatch)
  } else if (meta.v === 2 || meta.v === 3) {
    if (meta.bill_number != null) billPatch.bill_number = String(meta.bill_number)
    if (meta.bill_date != null) billPatch.bill_date = String(meta.bill_date)
    if (meta.client_name != null) billPatch.client_name = String(meta.client_name)
    if (meta.client_location != null) billPatch.client_location = String(meta.client_location)
    if (meta.route_from != null) billPatch.route_from = String(meta.route_from)
    if (meta.route_to != null) billPatch.route_to = String(meta.route_to)
    if (meta.rate_type != null) billPatch.rate_type = meta.rate_type
    if (meta.rate_fixed != null) billPatch.rate_fixed = Number(meta.rate_fixed) || 0
    if (meta.rate_base_weight != null) billPatch.rate_base_weight = Number(meta.rate_base_weight) || 0
    if (meta.rate_base_amount != null) billPatch.rate_base_amount = Number(meta.rate_base_amount) || 0
    if (meta.rate_extra_per_ton != null) billPatch.rate_extra_per_ton = Number(meta.rate_extra_per_ton) || 0
  }

  if (isV2) {
    mergeTitleRowIntoBillPatch(values[1], billPatch)
  }

  return { billPatch }
}

function sortKeysObj(obj) {
  if (!obj || typeof obj !== 'object') return {}
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => {
      acc[k] = obj[k]
      return acc
    }, {})
}

function stableEntryCompare(e) {
  return {
    date: String(e.date ?? ''),
    vehicle_number: String(e.vehicle_number ?? '').trim(),
    invoice_number: String(e.invoice_number ?? '').trim(),
    from: String(e.from ?? '').trim(),
    to: String(e.to ?? '').trim(),
    weight: e.weight === '' || e.weight == null ? '' : Number(e.weight),
    rate: e.rate === '' || e.rate == null ? '' : Number(e.rate),
    advance: e.advance == null || e.advance === '' ? 0 : Number(e.advance),
    custom: JSON.stringify(sortKeysObj(e.custom || {})),
  }
}

/** True if sheet-derived bill content differs from current bill (entries + rate fields). */
export function billContentDiffersFromPatch(bill, billPatch) {
  if (!bill || !billPatch) return true
  const keys = [
    'bill_number',
    'bill_date',
    'client_name',
    'client_location',
    'route_from',
    'route_to',
    'rate_type',
    'rate_fixed',
    'rate_base_weight',
    'rate_base_amount',
    'rate_extra_per_ton',
  ]
  for (const k of keys) {
    if (billPatch[k] === undefined) continue
    const a = bill[k]
    const b = billPatch[k]
    if (typeof b === 'number' && typeof a === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
      if (Math.abs(a - b) > 1e-6) return true
    } else if (String(a ?? '') !== String(b ?? '')) return true
  }
  const aE = bill.entries || []
  const bE = billPatch.entries || []
  if (aE.length !== bE.length) return true
  for (let i = 0; i < aE.length; i += 1) {
    const x = stableEntryCompare(aE[i])
    const y = stableEntryCompare(bE[i])
    if (JSON.stringify(x) !== JSON.stringify(y)) return true
  }
  return false
}
