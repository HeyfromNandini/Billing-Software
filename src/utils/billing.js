/**
 * Trip freight uses `total` when present, else `rate` (legacy). Balance = trip total − Advance.
 * Trip weight is stored in kg. Base weight in rules is stored in kg (same as trips); legacy bills may
 * still have tons (e.g. 27.273 or whole 24) — see {@link rateBaseWeightKgFromStored}.
 * Variable rule: up to base weight (kg) → base_rate (₹). Above base: base_rate + extra tons × extra_per_ton.
 */
export function rateBaseWeightKgFromStored(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n >= 1000) return n
  if (n % 1 !== 0) return n * 1000
  if (n <= 100) return n * 1000
  return n
}

export function rateBaseWeightKg(rule) {
  return rateBaseWeightKgFromStored(rule?.rate_base_weight)
}

export function calculateRateFromWeight(weightKg, rule) {
  if (!rule || weightKg == null || weightKg === '' || Number.isNaN(Number(weightKg))) return null
  const wtKg = Number(weightKg)
  const baseKg = rateBaseWeightKg(rule)
  const baseRate = Number(rule.rate_base_amount)
  const extra = Number(rule.rate_extra_per_ton) || 0
  if (baseRate === 0 && baseKg === 0) return null
  if (wtKg <= baseKg) return Math.round(baseRate)
  const extraTons = (wtKg - baseKg) / 1000
  return Math.round(baseRate + extraTons * extra)
}

/** Freight amount for the row: uses `total` when set, otherwise `rate` (legacy rows). */
export function entryTripTotal(row) {
  const t = row?.total
  if (t !== '' && t != null && Number.isFinite(Number(t))) return Number(t)
  return Number(row?.rate) || 0
}

export function rowTotal(row) {
  return entryTripTotal(row)
}

export function rowBalance(row) {
  return entryTripTotal(row) - (Number(row.advance) || 0)
}

/** True when the row has a numeric value in `rate` (the Rate column), including 0. */
export function entryHasNumericRate(row) {
  const r = row?.rate
  return r !== '' && r != null && Number.isFinite(Number(r))
}

/**
 * Value for the Rate column: use the row’s stored `rate` when set; otherwise optional bill-level PDF text.
 * Fallback text is usually “extra per ton” (₹) when the row has no numeric `rate`.
 */
export function displayEntryRate(row, rateColumnFallback = '', emptyPlaceholder = '—') {
  if (entryHasNumericRate(row)) return row.rate
  const fb = String(rateColumnFallback ?? '').trim()
  if (fb) return fb
  const r = row?.rate
  if (r === '' || r == null) return emptyPlaceholder
  return r
}

/**
 * Parse trip date from DB / Sheets / imports into a local Date (noon), or null.
 * Supports yyyy-mm-dd, dd.mm.yyyy, dd.mm.yy, dd/mm/yyyy, dd.mm (year = current).
 */
export function parseBillDate(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!s) return null

  const compact = s.replace(/\s+/g, '')
  const cleaned = compact.replace(/[./-]+$/, '')

  // Excel/Sheets serial date (days since 1899-12-30).
  if (/^\d{4,6}$/.test(cleaned)) {
    const serial = Number(cleaned)
    if (Number.isFinite(serial) && serial >= 20000 && serial <= 80000) {
      const epoch = new Date(1899, 11, 30, 12, 0, 0, 0)
      const dt = new Date(epoch.getTime() + serial * 24 * 60 * 60 * 1000)
      if (!Number.isNaN(dt.getTime())) return dt
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10))
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const dt = new Date(y, mo - 1, d, 12, 0, 0, 0)
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
    return dt
  }

  const m = cleaned.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/)
  if (m) {
    const d = parseInt(m[1], 10)
    const mo = parseInt(m[2], 10)
    let y =
      m[3] != null && String(m[3]).trim() !== ''
        ? parseInt(m[3], 10)
        : new Date().getFullYear()
    if (y < 100) y += 2000
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const dt = new Date(y, mo - 1, d, 12, 0, 0, 0)
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
    return dt
  }

  const t = Date.parse(cleaned)
  if (!Number.isFinite(t)) return null
  const dt = new Date(t)
  if (Number.isNaN(dt.getTime())) return null
  return dt
}

/** Display trip date as DD.MM (day.month, no year in the table). */
export function formatDate(raw) {
  const dt = parseBillDate(raw)
  if (!dt) return '—'
  const day = String(dt.getDate()).padStart(2, '0')
  const month = String(dt.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}`
}

/** Distinct non-empty “To” values from trip rows, in first-seen order. */
export function uniqueEntryDestinations(entries) {
  const seen = new Set()
  const out = []
  for (const e of entries || []) {
    const t = String(e?.to ?? '').trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * Bill header / PDF “To”: all trip destinations joined with “, ” when rows have To;
 * otherwise falls back to bill.route_to.
 */
export function displayBillHeaderRouteTo(bill) {
  const uniq = uniqueEntryDestinations(bill?.entries)
  if (uniq.length > 0) return uniq.join(', ')
  const fb = String(bill?.route_to ?? '').trim()
  return fb || '—'
}

/** Sum of balances (trip total − advance) — amount due for the bill. */
export function grandTotal(entries) {
  return entries.reduce((acc, r) => acc + rowBalance(r), 0)
}

/** Move item from fromIndex to toIndex (0-based). Sr. no follows array order after reorder. */
export function reorderEntriesByIndex(entries, fromIndex, toIndex) {
  if (!Array.isArray(entries) || fromIndex === toIndex) return entries
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= entries.length || toIndex >= entries.length) {
    return entries
  }
  const next = [...entries]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}
