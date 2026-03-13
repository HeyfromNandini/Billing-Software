import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import Header from '../components/Header'
import CompanyBlock from '../components/CompanyBlock'
import BillInfoBlock from '../components/BillInfoBlock'
import TransportTable from '../components/TransportTable'
import TotalsBlock from '../components/TotalsBlock'
import EntryModal from '../components/EntryModal'
import { grandTotal } from '../utils/billing'

let nextEntryId = 1000

const defaultRateRule = {
  rate_type: 'variable',
  rate_fixed: 7500,
  rate_base_weight: 27.273,
  rate_base_amount: 7500,
  rate_extra_per_ton: 275,
}

export default function BillPage() {
  const { companyId, billId } = useParams()
  const { getCompany, getBill, getClient, updateBill, updateClient } = useApp()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [billInfoEditing, setBillInfoEditing] = useState(false)
  const [billEditForm, setBillEditForm] = useState({
    bill_number: '',
    bill_date: '',
    client_name: '',
    client_location: '',
    route_from: '',
    route_to: '',
  })
  const [rateType, setRateType] = useState(defaultRateRule.rate_type)
  const [rateFixed, setRateFixed] = useState(defaultRateRule.rate_fixed)
  const [rateVariable, setRateVariable] = useState({
    rate_base_weight: defaultRateRule.rate_base_weight,
    rate_base_amount: defaultRateRule.rate_base_amount,
    rate_extra_per_ton: defaultRateRule.rate_extra_per_ton,
  })
  const [newColumnName, setNewColumnName] = useState('')
  const [newColumnOrder, setNewColumnOrder] = useState('12')
  const [editingColumnId, setEditingColumnId] = useState(null)
  const [editingColumnName, setEditingColumnName] = useState('')
  const [editingColumnOrder, setEditingColumnOrder] = useState('')

  const company = getCompany(companyId)
  const bill = getBill(billId)
  const client = bill ? getClient(bill.client_id) : null
  const rawCustomColumns = client?.custom_columns ?? []
  const customColumns = [...rawCustomColumns].map((c) => ({ ...c, order: Math.max(1, Math.min(Number(c.order) || 12, 12)) }))
  const entries = bill?.entries ?? []
  const totalAmount = grandTotal(entries)

  useEffect(() => {
    if (bill) {
      setRateType(bill.rate_type ?? defaultRateRule.rate_type)
      setRateFixed(bill.rate_fixed ?? defaultRateRule.rate_fixed)
      setRateVariable({
        rate_base_weight: bill.rate_base_weight ?? defaultRateRule.rate_base_weight,
        rate_base_amount: bill.rate_base_amount ?? defaultRateRule.rate_base_amount,
        rate_extra_per_ton: bill.rate_extra_per_ton ?? defaultRateRule.rate_extra_per_ton,
      })
    }
  }, [bill?.id, bill?.rate_type, bill?.rate_fixed, bill?.rate_base_weight, bill?.rate_base_amount, bill?.rate_extra_per_ton])

  const startBillInfoEdit = useCallback(() => {
    if (!bill) return
    let dateForInput = ''
    if (bill.bill_date) {
      if (bill.bill_date.includes('-')) dateForInput = bill.bill_date
      else {
        const parts = bill.bill_date.split('.')
        if (parts.length === 3) dateForInput = [parts[2], parts[1], parts[0]].join('-')
      }
    }
    if (!dateForInput) dateForInput = new Date().toISOString().slice(0, 10)
    setBillEditForm({
      bill_number: bill.bill_number ?? '',
      bill_date: dateForInput,
      client_name: bill.client_name ?? '',
      client_location: bill.client_location ?? '',
      route_from: bill.route_from ?? 'Kalamboli',
      route_to: bill.route_to ?? 'Khopoli',
    })
    setBillInfoEditing(true)
  }, [bill])

  const handleBillEditChange = useCallback((e) => {
    const { name, value } = e.target
    setBillEditForm((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleSaveBillInfo = useCallback(
    (e) => {
      e?.preventDefault?.()
      const d = billEditForm.bill_date
      const billDateDisplay = d && d.includes('-') ? d.split('-').reverse().join('.') : d
      updateBill(billId, {
        bill_number: billEditForm.bill_number.trim(),
        bill_date: billDateDisplay,
        client_name: billEditForm.client_name.trim(),
        client_location: billEditForm.client_location.trim(),
        route_from: billEditForm.route_from.trim(),
        route_to: billEditForm.route_to.trim(),
      })
      setBillInfoEditing(false)
    },
    [billId, updateBill, billEditForm]
  )

  const cancelBillInfoEdit = useCallback(() => setBillInfoEditing(false), [])

  const addCustomColumn = useCallback(
    (e) => {
      e?.preventDefault?.()
      const name = newColumnName.trim()
      if (!name || !client) return
      const cols = client.custom_columns || []
      const position = Math.max(1, Math.min(12, parseInt(newColumnOrder, 10) || 12))
      const newCol = { id: `col-${Date.now()}`, name, order: position }
      updateClient(client.id, { custom_columns: [...cols, newCol] })
      setNewColumnName('')
      setNewColumnOrder('12')
    },
    [client, newColumnName, newColumnOrder, updateClient]
  )

  const updateCustomColumn = useCallback(
    (colId, name, orderValue) => {
      if (!client || !name.trim()) return
      const order = Math.max(1, Math.min(12, parseInt(orderValue, 10) || 12))
      const next = (client.custom_columns || []).map((c) =>
        c.id === colId ? { ...c, name: name.trim(), order } : c
      )
      updateClient(client.id, { custom_columns: next })
      setEditingColumnId(null)
      setEditingColumnName('')
      setEditingColumnOrder('')
    },
    [client, updateClient]
  )

  const removeCustomColumn = useCallback(
    (colId) => {
      if (!client) return
      const next = (client.custom_columns || []).filter((c) => c.id !== colId)
      updateClient(client.id, { custom_columns: next })
      if (editingColumnId === colId) {
        setEditingColumnId(null)
        setEditingColumnName('')
        setEditingColumnOrder('')
      }
    },
    [client, updateClient, editingColumnId]
  )

  const startEditColumn = useCallback((col) => {
    setEditingColumnId(col.id)
    setEditingColumnName(col.name || '')
    setEditingColumnOrder(String(Number(col.order) || 12))
  }, [])

  const cancelEditColumn = useCallback(() => {
    setEditingColumnId(null)
    setEditingColumnName('')
    setEditingColumnOrder('')
  }, [])

  const openAdd = useCallback(() => {
    setEditingId(null)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((id) => setEditingId(id), [])
  const cancelEditEntry = useCallback(() => setEditingId(null), [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
  }, [])

  const handleSaveEntry = useCallback(
    (payload, id) => {
      if (!bill) return
      const newEntry = {
        ...payload,
        id: id ?? nextEntryId++,
      }
      let newEntries
      if (id != null) {
        newEntries = (bill.entries ?? []).map((e) => (e.id === id ? { ...e, ...newEntry } : e))
      } else {
        newEntries = [...(bill.entries ?? []), newEntry]
      }
      updateBill(billId, { entries: newEntries })
      closeModal()
    },
    [bill, billId, updateBill, closeModal]
  )

  const handleDeleteEntry = useCallback(
    (id) => {
      if (!bill || !window.confirm('Remove this entry?')) return
      const newEntries = (bill.entries ?? []).filter((e) => e.id !== id)
      updateBill(billId, { entries: newEntries })
      if (editingId === id) setEditingId(null)
    },
    [bill, billId, updateBill, editingId]
  )

  const billCardRef = useRef(null)

  const handleExportPdf = useCallback(() => {
    const el = billCardRef.current
    if (!el) return
    import('html2pdf.js').then(({ default: html2pdf }) => {
      const clone = el.cloneNode(true)
      clone.querySelectorAll('.no-print').forEach((n) => n.remove())
      const pdfStyles = document.createElement('style')
      pdfStyles.textContent = `
        .bill-card { width: 100% !important; box-sizing: border-box; }
        .bill-card .table-scroll { overflow: visible !important; width: 100% !important; max-width: none !important; margin: 0 !important; }
        .bill-card .transport-table { width: 100% !important; table-layout: fixed !important; font-size: 11px !important; }
        .bill-card .transport-table th, .bill-card .transport-table td { padding: 5px 6px !important; box-sizing: border-box; }
        .bill-card .transport-table th { width: auto !important; }
      `
      clone.insertBefore(pdfStyles, clone.firstChild)
      const wrapper = document.createElement('div')
      wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:1060px;box-sizing:border-box;'
      wrapper.appendChild(clone)
      document.body.appendChild(wrapper)
      const filename = `bill-${bill?.bill_number ? bill.bill_number : 'bill'}.pdf`
      html2pdf()
        .set({
          margin: 8,
          filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        })
        .from(clone)
        .save()
        .then(() => { wrapper.remove() })
        .catch(() => { wrapper.remove() })
    })
  }, [bill])

  const handleRateRuleSave = useCallback(
    (e) => {
      e.preventDefault()
      updateBill(billId, {
        rate_type: rateType,
        rate_fixed: rateFixed,
        rate_base_weight: rateVariable.rate_base_weight,
        rate_base_amount: rateVariable.rate_base_amount,
        rate_extra_per_ton: rateVariable.rate_extra_per_ton,
      })
    },
    [billId, updateBill, rateType, rateFixed, rateVariable]
  )

  const billRateRule =
    rateType === 'variable' && (rateVariable.rate_base_weight != null || rateVariable.rate_base_amount != null)
      ? {
          rate_type: 'variable',
          rate_base_weight: rateVariable.rate_base_weight,
          rate_base_amount: rateVariable.rate_base_amount,
          rate_extra_per_ton: rateVariable.rate_extra_per_ton,
        }
      : null

  if (!company || !bill) {
    return (
      <div className="page">
        <p>Bill not found.</p>
        <Link to={companyId ? `/company/${companyId}` : '/'}>← Back</Link>
      </div>
    )
  }

  const billDateDisplay = bill.bill_date ? bill.bill_date.replace(/-/g, '.') : '—'

  const backTo = bill.client_id
    ? `/company/${companyId}/client/${bill.client_id}`
    : `/company/${companyId}`

  return (
    <div className="app-wrap">
      <Header companyName={company.company_name} backTo={backTo} />
      <main className="main bill-page-main">
        <div className="bill-page-layout">
          <section className="bill-main">
            <div className="bill-card" ref={billCardRef}>
              <CompanyBlock company={company} />
              <div className="bill-info-row-wrap">
                {billInfoEditing ? (
                  <form onSubmit={handleSaveBillInfo} className="bill-info-inline-edit">
                    <div className="bill-info-edit-grid">
                      <label>
                        <span>Bill No.</span>
                        <input type="text" name="bill_number" value={billEditForm.bill_number} onChange={handleBillEditChange} required />
                      </label>
                      <label>
                        <span>Date</span>
                        <input type="date" name="bill_date" value={billEditForm.bill_date} onChange={handleBillEditChange} required />
                      </label>
                      <label>
                        <span>M/s</span>
                        <input type="text" name="client_name" value={billEditForm.client_name} onChange={handleBillEditChange} placeholder="Client name" />
                      </label>
                      <label>
                        <span>Location</span>
                        <input type="text" name="client_location" value={billEditForm.client_location} onChange={handleBillEditChange} placeholder="Location" />
                      </label>
                      <label>
                        <span>From</span>
                        <input type="text" name="route_from" value={billEditForm.route_from} onChange={handleBillEditChange} />
                      </label>
                      <label>
                        <span>To</span>
                        <input type="text" name="route_to" value={billEditForm.route_to} onChange={handleBillEditChange} />
                      </label>
                    </div>
                    <div className="form-actions no-print">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={cancelBillInfoEdit}>Cancel</button>
                      <button type="submit" className="btn btn-primary btn-sm">Save</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <BillInfoBlock
                      billNumber={bill.bill_number}
                      billDate={billDateDisplay}
                      clientName={bill.client_name}
                      clientLocation={bill.client_location}
                      routeFrom={bill.route_from}
                      routeTo={bill.route_to}
                    />
                    <button type="button" className="btn btn-secondary btn-edit-bill no-print" onClick={startBillInfoEdit}>
                      Edit bill
                    </button>
                  </>
                )}
              </div>
              <TransportTable
                entries={entries}
                editingId={editingId}
                customColumns={customColumns}
                onEdit={openEdit}
                onDelete={handleDeleteEntry}
                onSaveEntry={handleSaveEntry}
                onCancelEdit={cancelEditEntry}
                defaultRouteFrom={bill.route_from}
                defaultRouteTo={bill.route_to}
                rateType={rateType}
                rateFixed={rateFixed}
                rateRule={billRateRule}
              />
              <TotalsBlock
                grandTotal={totalAmount}
                onAddEntry={openAdd}
                onExportPdf={handleExportPdf}
              />
            </div>
          </section>

          <aside className="bill-sidebar no-print" aria-label="Rate rules for this bill">
            <div className="bill-sidebar-inner">
              <h3 className="bill-sidebar-title">Rate rules (this bill)</h3>
              <p className="rate-rules-hint">
                Used when adding entries. Not shown on PDF.
              </p>
              <form onSubmit={handleRateRuleSave} className="card rate-rules-card">
                <div className="rate-type-options">
                  <label className="rate-type-option">
                    <input
                      type="radio"
                      name="rate_type"
                      value="fixed"
                      checked={rateType === 'fixed'}
                      onChange={() => setRateType('fixed')}
                    />
                    <span>Fixed</span>
                  </label>
                  <label className="rate-type-option">
                    <input
                      type="radio"
                      name="rate_type"
                      value="variable"
                      checked={rateType === 'variable'}
                      onChange={() => setRateType('variable')}
                    />
                    <span>Variable</span>
                  </label>
                </div>
                {rateType === 'fixed' ? (
                  <div className="rate-rules-grid">
                    <label>
                      <span>Rate (₹) per trip</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={rateFixed}
                        onChange={(e) => setRateFixed(e.target.value === '' ? '' : Number(e.target.value))}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="rate-rules-grid">
                    <label>
                      <span>Base weight (tons)</span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={rateVariable.rate_base_weight}
                        onChange={(e) => setRateVariable((prev) => ({ ...prev, rate_base_weight: e.target.value === '' ? '' : Number(e.target.value) }))}
                      />
                    </label>
                    <label>
                      <span>Base rate (₹)</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={rateVariable.rate_base_amount}
                        onChange={(e) => setRateVariable((prev) => ({ ...prev, rate_base_amount: e.target.value === '' ? '' : Number(e.target.value) }))}
                      />
                    </label>
                    <label>
                      <span>Extra per ton (₹)</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={rateVariable.rate_extra_per_ton}
                        onChange={(e) => setRateVariable((prev) => ({ ...prev, rate_extra_per_ton: e.target.value === '' ? '' : Number(e.target.value) }))}
                      />
                    </label>
                  </div>
                )}
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary btn-sm">Save rules</button>
                </div>
              </form>

              <div className="custom-columns-section">
                <h3 className="bill-sidebar-title">Custom columns</h3>
                <p className="rate-rules-hint">Column no 1 = first column, 12 = after Balance (before Action). Only for this client&apos;s bills.</p>
                <ul className="custom-columns-list">
                  {customColumns.map((col) => (
                    <li key={col.id} className="custom-column-item">
                      <span className="custom-column-no">#{Number(col.order) || 12}</span>
                      {editingColumnId === col.id ? (
                        <div className="custom-column-edit-fields">
                          <label className="custom-column-edit-field">
                            <span>Column no</span>
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={editingColumnOrder}
                              onChange={(e) => setEditingColumnOrder(e.target.value)}
                              onBlur={(e) => {
                                const v = e.target.value
                                if (v === '' || Number.isNaN(parseInt(v, 10))) return
                                const n = Math.max(1, Math.min(12, parseInt(v, 10)))
                                if (String(n) !== v) setEditingColumnOrder(String(n))
                              }}
                              className="custom-column-order-input"
                              aria-label="Column position"
                            />
                          </label>
                          <label className="custom-column-edit-field">
                            <span>Name</span>
                            <input
                              type="text"
                              value={editingColumnName}
                              onChange={(e) => setEditingColumnName(e.target.value)}
                              className="custom-column-input-inline"
                              placeholder="Column name"
                              aria-label="Edit column name"
                            />
                          </label>
                          <div className="custom-column-edit-actions">
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => updateCustomColumn(col.id, editingColumnName, editingColumnOrder)}>Save</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEditColumn}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="custom-column-name">{col.name}</span>
                          <div className="custom-column-actions">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditColumn(col)} aria-label={`Edit ${col.name}`}>Edit</button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeCustomColumn(col.id)} aria-label={`Remove ${col.name}`}>Remove</button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <form onSubmit={addCustomColumn} className="custom-column-add-form">
                  <div className="custom-column-add-row">
                    <label className="custom-column-add-label">
                      <span>Column no</span>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={newColumnOrder}
                        onChange={(e) => setNewColumnOrder(e.target.value)}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v === '' || Number.isNaN(parseInt(v, 10))) return
                          const n = Math.max(1, Math.min(12, parseInt(v, 10)))
                          if (String(n) !== v) setNewColumnOrder(String(n))
                        }}
                        className="custom-column-order-input"
                        aria-label="Column position (1=first, 12=before Action)"
                        title="1 = first column, 12 = after Balance"
                      />
                    </label>
                    <label className="custom-column-add-label custom-column-add-label-name">
                      <span>Name</span>
                      <input
                        type="text"
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        placeholder="Column name"
                        className="custom-column-input"
                        aria-label="New column name"
                      />
                    </label>
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!newColumnName.trim() || !client}>Add column</button>
                </form>
              </div>
            </div>
          </aside>
        </div>

        <EntryModal
          isOpen={modalOpen}
          editingEntry={null}
          customColumns={customColumns}
          defaultRouteFrom={bill.route_from}
          defaultRouteTo={bill.route_to}
          rateType={rateType}
          rateFixed={rateFixed != null ? rateFixed : null}
          rateRule={billRateRule}
          onClose={closeModal}
          onSave={handleSaveEntry}
        />
      </main>
      <footer className="footer">
        <p>Billing – {company.company_name}</p>
      </footer>
    </div>
  )
}
