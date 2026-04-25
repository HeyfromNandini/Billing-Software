import { useState, useEffect } from 'react'
import { DEFAULT_ROUTE } from '../data/sampleEntries'
import { calculateRateFromWeight, entryTripTotal, rowBalance } from '../utils/billing'
import VehicleCombobox from './VehicleCombobox'
import { COMMON_TO_DESTINATIONS } from '../data/routeDestinations'

/** Parse stored or typed numeric cell values; avoids NaN breaking controlled number inputs. */
function coerceNumericField(raw) {
  if (raw === '' || raw == null) return ''
  const n = Number(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : ''
}

function initialRateForEdit(entry, rateColumnFallback, extraPerTonRaw) {
  const r = coerceNumericField(entry?.rate)
  if (r !== '') return r
  if (extraPerTonRaw !== undefined && extraPerTonRaw !== '' && extraPerTonRaw != null) {
    if (typeof extraPerTonRaw === 'number' && Number.isFinite(extraPerTonRaw)) return extraPerTonRaw
    const fromExtra = coerceNumericField(extraPerTonRaw)
    if (fromExtra !== '') return fromExtra
  }
  const t = String(rateColumnFallback ?? '').trim()
  if (!t) return ''
  return coerceNumericField(t)
}

export default function EditableEntryRow({
  entry,
  index,
  layout = [],
  customColumns = [],
  defaultRouteFrom,
  defaultRouteTo,
  rateType,
  rateFixed,
  rateRule,
  rateColumnFallback = '',
  extraPerTonRaw,
  onSave,
  onCancel,
}) {
  const from = defaultRouteFrom ?? DEFAULT_ROUTE.from
  const to = defaultRouteTo ?? DEFAULT_ROUTE.to

  const [form, setForm] = useState({
    date: '',
    vehicle_number: '',
    invoice_number: '',
    from,
    to,
    weight: '',
    rate: '',
    total: '',
    advance: 0,
    custom: {},
  })

  // Sync form from entry only when we start editing this row (by id). Do not depend on
  // entry fields or customColumns — a new [] each render would reset form and block typing.
  const entryId = entry?.id
  useEffect(() => {
    if (!entry) return
    const custom = {}
    ;(customColumns || []).forEach((col) => { custom[col.id] = (entry.custom && entry.custom[col.id]) ?? '' })
    setForm({
      date: entry.date || '',
      vehicle_number: entry.vehicle_number || '',
      invoice_number: entry.invoice_number || '',
      from: entry.from || from,
      to: entry.to || to,
      weight: entry.weight ?? '',
      rate: initialRateForEdit(entry, rateColumnFallback, extraPerTonRaw),
      total: coerceNumericField(entry.total ?? entry.rate),
      advance: entry.advance ?? 0,
      custom: Object.keys(custom).length ? custom : (customColumns || []).reduce((acc, col) => ({ ...acc, [col.id]: '' }), {}),
    })
  }, [entryId])

  const handleBalanceChange = (e) => {
    const raw = e.target.value
    const b = raw === '' ? 0 : Number(raw)
    if (Number.isNaN(b)) return
    const trip = entryTripTotal({ rate: form.rate, total: form.total })
    setForm((prev) => ({ ...prev, advance: Math.max(0, trip - b) }))
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name.startsWith('custom.')) {
      const colId = name.replace('custom.', '')
      setForm((prev) => ({ ...prev, custom: { ...(prev.custom || {}), [colId]: value } }))
      return
    }
    const isNum = name === 'advance' || name === 'rate' || name === 'total' || name === 'weight'
    let parsed
    if (isNum) {
      if (value === '') {
        parsed = ''
      } else {
        const n = Number(String(value).replace(/,/g, '').trim())
        if (!Number.isFinite(n)) return
        parsed = n
      }
    } else {
      parsed = value
    }
    setForm((prev) => {
      const next = { ...prev, [name]: parsed }
      if (name === 'weight' && rateType === 'variable' && rateRule && (parsed !== '' || parsed === 0)) {
        const calculated = calculateRateFromWeight(parsed, rateRule)
        if (calculated != null) {
          next.total = calculated
          const ept = Number(rateRule.rate_extra_per_ton)
          if (Number.isFinite(ept)) next.rate = ept
        }
      }
      return next
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const rateNum = Number(form.rate) || 0
    const totalNum =
      form.total === '' || form.total == null ? rateNum : Number(form.total) || 0
    const payload = {
      date: form.date,
      vehicle_number: (form.vehicle_number || '').trim(),
      invoice_number: (form.invoice_number || '').trim(),
      from: (form.from || '').trim(),
      to: (form.to || '').trim(),
      weight: Number(form.weight) || 0,
      rate: rateNum,
      total: totalNum,
      advance: Number(form.advance) || 0,
      custom: form.custom || {},
    }
    onSave(payload, entry.id)
  }

  const rowData = {
    rate: form.rate,
    total: form.total,
    advance: Number(form.advance) || 0,
  }
  const bal = rowBalance(rowData)

  const renderFixedCell = (key) => {
    switch (key) {
      case 1: return <td key="fixed-1" className="num col-sr-no">{index + 1}</td>
      case 2: return <td key="fixed-2"><input type="date" name="date" value={form.date ?? ''} onChange={handleChange} required className="cell-input" aria-label="Date" /></td>
      case 3: return (
        <td key="fixed-3">
          <VehicleCombobox
            value={form.vehicle_number ?? ''}
            onChange={(vehicle_number) => setForm((prev) => ({ ...prev, vehicle_number }))}
            inputClassName="cell-input"
            placeholder="Search vehicle…"
            aria-label="Vehicle No"
          />
        </td>
      )
      case 4: return <td key="fixed-4"><input type="text" name="invoice_number" value={form.invoice_number ?? ''} onChange={handleChange} required className="cell-input" placeholder="Invoice no" aria-label="Invoice no" /></td>
      case 5: return <td key="fixed-5"><input type="text" name="from" value={form.from ?? ''} onChange={handleChange} className="cell-input" placeholder="From" aria-label="From" /></td>
      case 6: return (
        <td key="fixed-6">
          <VehicleCombobox
            options={COMMON_TO_DESTINATIONS}
            value={form.to ?? ''}
            onChange={(to) => setForm((prev) => ({ ...prev, to }))}
            inputClassName="cell-input"
            placeholder="To…"
            aria-label="To"
          />
        </td>
      )
      case 7: return <td key="fixed-7" className="num"><input type="number" name="weight" min={0} step={1} value={form.weight === '' || form.weight == null ? '' : form.weight} onChange={handleChange} className="cell-input num" aria-label="Weight" /></td>
      case 8: return (
        <td key="fixed-8" className="num col-rate">
          <input
            type="number"
            name="rate"
            min={0}
            step={1}
            value={form.rate === '' || form.rate == null ? '' : form.rate}
            onChange={handleChange}
            required
            className="cell-input num cell-rate-input"
            aria-label="Rate"
          />
        </td>
      )
      case 9: return (
        <td key="fixed-9" className="num">
          <input
            type="number"
            name="total"
            min={0}
            step={1}
            value={form.total === '' || form.total == null ? '' : form.total}
            onChange={handleChange}
            required
            className="cell-input num"
            aria-label="Total"
          />
        </td>
      )
      case 10: return <td key="fixed-10" className="num"><input type="number" name="advance" min={0} step={1} value={form.advance === '' || form.advance == null ? '' : form.advance} onChange={handleChange} className="cell-input num" aria-label="Advance" /></td>
      case 11: return (
        <td key="fixed-11" className="num">
          <input
            type="number"
            min={0}
            step={1}
            value={bal}
            onChange={handleBalanceChange}
            className="cell-input num"
            aria-label="Balance"
          />
        </td>
      )
      default: return <td key={`fixed-${key}`}>—</td>
    }
  }

  if (!layout.length) {
    return (
      <tr className="editable-entry-row">
        <td className="num">{index + 1}</td>
        <td><input type="date" name="date" value={form.date ?? ''} onChange={handleChange} required className="cell-input" /></td>
        <td>
          <VehicleCombobox
            value={form.vehicle_number ?? ''}
            onChange={(vehicle_number) => setForm((prev) => ({ ...prev, vehicle_number }))}
            inputClassName="cell-input"
            placeholder="Search vehicle…"
            aria-label="Vehicle No"
          />
        </td>
        <td><input type="text" name="invoice_number" value={form.invoice_number ?? ''} onChange={handleChange} required className="cell-input" /></td>
        <td><input type="text" name="from" value={form.from ?? ''} onChange={handleChange} className="cell-input" /></td>
        <td>
          <VehicleCombobox
            options={COMMON_TO_DESTINATIONS}
            value={form.to ?? ''}
            onChange={(to) => setForm((prev) => ({ ...prev, to }))}
            inputClassName="cell-input"
            placeholder="To…"
            aria-label="To"
          />
        </td>
        <td className="num"><input type="number" name="weight" min={0} step={1} value={form.weight === '' || form.weight == null ? '' : form.weight} onChange={handleChange} className="cell-input num" /></td>
        <td className="num col-rate">
          <input
            type="number"
            name="rate"
            min={0}
            step={1}
            value={form.rate === '' || form.rate == null ? '' : form.rate}
            onChange={handleChange}
            required
            className="cell-input num cell-rate-input"
            aria-label="Rate"
          />
        </td>
        <td className="num">
          <input
            type="number"
            name="total"
            min={0}
            step={1}
            value={form.total === '' || form.total == null ? '' : form.total}
            onChange={handleChange}
            required
            className="cell-input num"
            aria-label="Total"
          />
        </td>
        <td className="num"><input type="number" name="advance" min={0} step={1} value={form.advance === '' || form.advance == null ? '' : form.advance} onChange={handleChange} className="cell-input num" aria-label="Advance" /></td>
        <td className="num">
          <input type="number" min={0} step={1} value={bal} onChange={handleBalanceChange} className="cell-input num" aria-label="Balance" />
        </td>
        {customColumns.map((col) => (
          <td key={col.id}><input type="text" name={`custom.${col.id}`} value={(form.custom && form.custom[col.id]) ?? ''} onChange={handleChange} className="cell-input" placeholder={col.name} /></td>
        ))}
        <td className="no-print"><div className="row-actions"><button type="button" className="btn-edit" onClick={onCancel}>Cancel</button><span className="row-actions-sep">|</span><button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit}>Save</button></div></td>
      </tr>
    )
  }

  return (
    <tr className="editable-entry-row">
      {layout.map((item) => {
        if (item.type === 'action') {
          return (
            <td key="action" className="no-print">
              <div className="row-actions">
                <button type="button" className="btn-edit" onClick={onCancel}>Cancel</button>
                <span className="row-actions-sep" aria-hidden="true">|</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit}>Save</button>
              </div>
            </td>
          )
        }
        if (item.type === 'custom') {
          const col = item.col
          return (
            <td key={col.id}>
              <input
                type="text"
                name={`custom.${col.id}`}
                value={(form.custom && form.custom[col.id]) ?? ''}
                onChange={handleChange}
                className="cell-input"
                placeholder={col.name}
              />
            </td>
          )
        }
        return renderFixedCell(item.index)
      })}
    </tr>
  )
}
