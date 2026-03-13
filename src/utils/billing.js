/**
 * Total = Rate (flat per trip). Balance = Total - Advance.
 * Weight is stored in kg.
 * Variable rule: up to base_weight (tons) → base_rate (₹). If weight exceeds base, then full weight × extra_per_ton (e.g. 30 tons → 30 × 275).
 */
export function calculateRateFromWeight(weightKg, rule) {
  if (!rule || weightKg == null || weightKg === '' || Number.isNaN(Number(weightKg))) return null
  const wt = Number(weightKg) / 1000
  const base = Number(rule.rate_base_weight)
  const baseRate = Number(rule.rate_base_amount)
  const extra = Number(rule.rate_extra_per_ton) || 0
  if (baseRate === 0 && base === 0) return null
  if (wt <= base) return Math.round(baseRate)
  return Math.round(wt * extra)
}

export function rowTotal(row) {
  return row.rate ?? 0
}

export function rowBalance(row) {
  return (row.rate ?? 0) - (row.advance ?? 0)
}

export function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${day}.${m}`
}

export function grandTotal(entries) {
  return entries.reduce((acc, r) => acc + rowTotal(r), 0)
}
