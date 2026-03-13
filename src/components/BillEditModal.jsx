import { useState, useEffect } from 'react'

export default function BillEditModal({ isOpen, bill, onClose, onSave }) {
  const [form, setForm] = useState({
    bill_number: '',
    bill_date: '',
    client_name: '',
    client_location: '',
    route_from: '',
    route_to: '',
  })

  useEffect(() => {
    if (bill) {
      let dateForInput = ''
      if (bill.bill_date) {
        if (bill.bill_date.includes('-')) {
          dateForInput = bill.bill_date
        } else {
          const parts = bill.bill_date.split('.')
          if (parts.length === 3) {
            dateForInput = [parts[2], parts[1], parts[0]].join('-')
          }
        }
      }
      if (!dateForInput) dateForInput = new Date().toISOString().slice(0, 10)
      setForm({
        bill_number: bill.bill_number ?? '',
        bill_date: dateForInput,
        client_name: bill.client_name ?? '',
        client_location: bill.client_location ?? '',
        route_from: bill.route_from ?? 'Kalamboli',
        route_to: bill.route_to ?? 'Khopoli',
      })
    }
  }, [isOpen, bill])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const d = form.bill_date
    const billDateDisplay = d && d.includes('-') ? d.split('-').reverse().join('.') : d
    onSave({
      bill_number: form.bill_number.trim(),
      bill_date: billDateDisplay,
      client_name: form.client_name.trim(),
      client_location: form.client_location.trim(),
      route_from: form.route_from.trim(),
      route_to: form.route_to.trim(),
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal" aria-hidden="false" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal-box">
        <h3 className="modal-title">Edit bill</h3>
        <form className="entry-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              <span>Bill No.</span>
              <input type="text" name="bill_number" value={form.bill_number} onChange={handleChange} required />
            </label>
            <label>
              <span>Date (DD.MM.YYYY)</span>
              <input type="date" name="bill_date" value={form.bill_date} onChange={handleChange} required />
            </label>
            <label>
              <span>M/s (Client name)</span>
              <input type="text" name="client_name" value={form.client_name} onChange={handleChange} placeholder="e.g. Calcutta Carriers" />
            </label>
            <label>
              <span>Location</span>
              <input type="text" name="client_location" value={form.client_location} onChange={handleChange} placeholder="e.g. Kalamboli" />
            </label>
            <label>
              <span>Route From</span>
              <input type="text" name="route_from" value={form.route_from} onChange={handleChange} placeholder="Kalamboli" />
            </label>
            <label>
              <span>Route To</span>
              <input type="text" name="route_to" value={form.route_to} onChange={handleChange} placeholder="Khopoli" />
            </label>
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
