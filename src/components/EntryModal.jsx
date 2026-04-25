import { useState, useEffect } from 'react'
import { DEFAULT_ROUTE } from '../data/sampleEntries'
import { calculateRateFromWeight } from '../utils/billing'
import VehicleCombobox from './VehicleCombobox'
import { COMMON_TO_DESTINATIONS } from '../data/routeDestinations'

const emptyForm = {
  date: '',
  vehicle_number: '',
  invoice_number: '',
  from: DEFAULT_ROUTE.from,
  to: DEFAULT_ROUTE.to,
  weight: '',
  rate: '',
  total: '',
  advance: 0,
  custom: {},
}

export default function EntryModal({ isOpen, editingEntry, customColumns = [], defaultRouteFrom, defaultRouteTo, rateType, rateFixed, rateRule, onClose, onSave }) {
  const [form, setForm] = useState(emptyForm)
  const [entryRateType, setEntryRateType] = useState('fixed') // per-entry: fixed (default) or variable, follows bill rate rule
  const from = defaultRouteFrom ?? DEFAULT_ROUTE.from
  const to = defaultRouteTo ?? DEFAULT_ROUTE.to

  useEffect(() => {
    if (editingEntry) {
      const custom = {}
      ;(customColumns || []).forEach((col) => { custom[col.id] = (editingEntry.custom && editingEntry.custom[col.id]) ?? '' })
      setForm({
        date: editingEntry.date || '',
        vehicle_number: editingEntry.vehicle_number || '',
        invoice_number: editingEntry.invoice_number || '',
        from: editingEntry.from || from,
        to: editingEntry.to || to,
        weight: editingEntry.weight ?? '',
        rate: editingEntry.rate ?? '',
        total: editingEntry.total ?? editingEntry.rate ?? '',
        advance: editingEntry.advance ?? 0,
        custom: Object.keys(custom).length ? custom : (customColumns || []).reduce((acc, col) => ({ ...acc, [col.id]: '' }), {}),
      })
    } else {
      const initial = { ...emptyForm, from, to }
      initial.custom = (customColumns || []).reduce((acc, col) => ({ ...acc, [col.id]: '' }), {})
      if (rateType === 'variable' && rateRule) {
        setEntryRateType('variable')
        const ept = Number(rateRule.rate_extra_per_ton)
        initial.rate = Number.isFinite(ept) ? ept : ''
        initial.total = ''
      } else {
        setEntryRateType('fixed')
        const fixedRate = rateFixed != null ? rateFixed : 0
        initial.rate = fixedRate
        initial.total = fixedRate
      }
      setForm(initial)
    }
  }, [isOpen, editingEntry?.id, from, to, rateFixed, rateType, rateRule])

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name.startsWith('custom.')) {
      const colId = name.replace('custom.', '')
      setForm((prev) => ({ ...prev, custom: { ...(prev.custom || {}), [colId]: value } }))
      return
    }
    const isNum = name === 'advance' || name === 'weight' || name === 'rate' || name === 'total'
    const parsed = isNum ? (value === '' ? '' : Number(value)) : value
    setForm((prev) => {
      const next = { ...prev, [name]: parsed }
      if (name === 'weight' && entryRateType === 'variable' && rateRule && (parsed !== '' || parsed === 0)) {
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

  const handleEntryRateTypeChange = (type) => {
    setEntryRateType(type)
    setForm((prev) => {
      if (type === 'fixed') {
        const r = rateFixed != null ? rateFixed : 0
        return { ...prev, rate: r, total: r }
      }
      if (type === 'variable' && rateRule && (prev.weight !== '' || prev.weight === 0)) {
        const calculated = calculateRateFromWeight(prev.weight, rateRule)
        const t = calculated != null ? calculated : 0
        const ept = Number(rateRule.rate_extra_per_ton)
        const r = Number.isFinite(ept) ? ept : 0
        return { ...prev, rate: r, total: t }
      }
      if (type === 'variable' && rateRule) {
        const ept = Number(rateRule.rate_extra_per_ton)
        const r = Number.isFinite(ept) ? ept : 0
        return { ...prev, rate: r, total: prev.total }
      }
      return { ...prev, rate: 0, total: 0 }
    })
  }

  const displayedRate =
    entryRateType === 'fixed'
      ? (rateFixed != null ? rateFixed : 0)
      : rateRule
        ? (Number(form.rate) || Number(rateRule.rate_extra_per_ton) || '—')
        : '—'

  const handleSubmit = (e) => {
    e.preventDefault()
    let rate = Number(form.rate) || 0
    if (entryRateType === 'variable' && rateRule && (form.weight === '' || form.weight == null)) {
      const ept = Number(rateRule.rate_extra_per_ton)
      rate = Number.isFinite(ept) ? ept : rate
    }
    const totalNum =
      form.total === '' || form.total == null ? rate : Number(form.total) || 0
    const payload = {
      ...form,
      vehicle_number: (form.vehicle_number || '').trim(),
      invoice_number: (form.invoice_number || '').trim(),
      from: (form.from || '').trim(),
      to: (form.to || '').trim(),
      weight: Number(form.weight) || 0,
      rate,
      total: totalNum,
      advance: Number(form.advance) || 0,
      custom: form.custom || {},
    }
    onSave(payload, editingEntry?.id)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal" aria-hidden="false" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal-box">
        <h3 className="modal-title">{editingEntry ? 'Edit transport entry' : 'Add transport entry'}</h3>
        <form className="entry-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              <span>Date</span>
              <input type="date" name="date" value={form.date} onChange={handleChange} required />
            </label>
            <label>
              <span>Vehicle No</span>
              <VehicleCombobox
                value={form.vehicle_number}
                onChange={(vehicle_number) => setForm((prev) => ({ ...prev, vehicle_number }))}
                placeholder="Type to search (e.g. 51)…"
              />
            </label>
            <label>
              <span>Invoice no</span>
              <input type="text" name="invoice_number" value={form.invoice_number} onChange={handleChange} required />
            </label>
            <label>
              <span>From</span>
              <input type="text" name="from" value={form.from} onChange={handleChange} placeholder="Kalamboli" />
            </label>
            <label>
              <span>To</span>
              <VehicleCombobox
                options={COMMON_TO_DESTINATIONS}
                value={form.to}
                onChange={(to) => setForm((prev) => ({ ...prev, to }))}
                placeholder="Khopoli, Taloja, or type another…"
                aria-label="To"
              />
            </label>
            <label>
              <span>Weight</span>
              <input type="number" name="weight" min={0} step={1} value={form.weight} onChange={handleChange} placeholder="0" />
            </label>
            <label className="entry-rate-type-label">
              <span>Rate</span>
              <div className="entry-rate-type-options">
                <label className="entry-rate-type-option">
                  <input
                    type="radio"
                    name="entry_rate_type"
                    value="fixed"
                    checked={entryRateType === 'fixed'}
                    onChange={() => handleEntryRateTypeChange('fixed')}
                  />
                  <span>Fixed</span>
                </label>
                <label className="entry-rate-type-option">
                  <input
                    type="radio"
                    name="entry_rate_type"
                    value="variable"
                    checked={entryRateType === 'variable'}
                    onChange={() => handleEntryRateTypeChange('variable')}
                  />
                  <span>Variable</span>
                </label>
              </div>
              <span className="entry-rate-display">₹ {typeof displayedRate === 'number' ? displayedRate.toLocaleString('en-IN') : displayedRate}</span>
            </label>
            <label>
              <span>Total (freight ₹)</span>
              <input
                type="number"
                name="total"
                min={0}
                step={1}
                value={form.total === '' || form.total == null ? '' : form.total}
                onChange={handleChange}
                placeholder="Trip amount"
              />
            </label>
            <label>
              <span>Advance (₹)</span>
              <input type="number" name="advance" min={0} step={1} value={form.advance} onChange={handleChange} />
            </label>
            {customColumns.map((col) => (
              <label key={col.id}>
                <span>{col.name}</span>
                <input
                  type="text"
                  name={`custom.${col.id}`}
                  value={form.custom?.[col.id] ?? ''}
                  onChange={handleChange}
                  placeholder={col.name}
                />
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary btn-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}
