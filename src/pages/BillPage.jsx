import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import Header from '../components/Header'
import CompanyBlock from '../components/CompanyBlock'
import BillInfoBlock from '../components/BillInfoBlock'
import TransportTable, { buildPdfColumnLayout, FIXED_HEADERS } from '../components/TransportTable'
import TotalsBlock from '../components/TotalsBlock'
import EntryModal from '../components/EntryModal'
import { grandTotal, formatDate, rowTotal, rowBalance } from '../utils/billing'

const ROWS_PER_PAGE = 15

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
    if (!company || !bill) return
    import('html2pdf.js').then(({ default: html2pdf }) => {
      const pdfLayout = buildPdfColumnLayout(customColumns)
      const entriesList = bill.entries ?? []
      const chunks = []
      for (let i = 0; i < entriesList.length; i += ROWS_PER_PAGE) {
        chunks.push(entriesList.slice(i, i + ROWS_PER_PAGE))
      }
      if (chunks.length === 0) chunks.push([])
      const totalGrand = grandTotal(entriesList)

      const renderFixedCell = (row, index, key) => {
        const tot = rowTotal(row)
        const bal = rowBalance(row)
        const advanceStr = row.advance ? String(row.advance) : '—'
        switch (key) {
          case 1: return index + 1
          case 2: return formatDate(row.date)
          case 3: return row.vehicle_number || '—'
          case 4: return row.invoice_number ?? '—'
          case 5: return row.from || '—'
          case 6: return row.to || '—'
          case 7: return row.weight ?? '—'
          case 8: return row.rate ?? '—'
          case 9: return tot
          case 10: return advanceStr
          case 11: return bal
          default: return '—'
        }
      }

      const root = document.createElement('div')
      root.className = 'pdf-bill-root'
      const pdfStyles = document.createElement('style')
      pdfStyles.textContent = `
        .pdf-bill-root { width: 100%; box-sizing: border-box; }
        .pdf-page { page-break-after: always; padding: 2mm 4mm 2mm 4mm; box-sizing: border-box; }
        .pdf-page:last-child { page-break-after: auto; }
        .pdf-bill-root .company-block { padding: 0.25rem 0 0.15rem 0 !important; margin-bottom: 0.15rem !important; border-bottom: none !important; text-align: center !important; }
        .pdf-bill-root .company-block .company-name { margin: 0 0 0.1em !important; font-size: 2.6rem !important; font-weight: 900 !important; color: #b91c1c !important; }
        .pdf-bill-root .company-block .company-address { margin: 0 0 0.2em !important; font-size: 0.95rem !important; line-height: 1.3 !important; }
        .pdf-bill-root .company-block .company-meta { margin: 0 !important; font-size: 0.9rem !important; }
        .pdf-bill-root .bill-info-block { padding: 0.2rem 0 0.35rem 0 !important; margin-bottom: 0 !important; border-bottom: none !important; gap: 0.25rem !important; }
        .pdf-bill-root .bill-info-block .bill-info-row { gap: 0.35rem 1rem !important; }
        .pdf-bill-root .bill-info-block .bill-info-item .label { font-size: 0.6rem !important; }
        .pdf-bill-root .bill-info-block .bill-info-item .value { font-size: 0.85rem !important; }
        .pdf-bill-root .bill-info-block .route-row { display: flex !important; flex-wrap: wrap !important; align-items: center !important; gap: 0.35rem 1rem !important; margin-top: 0.15rem !important; font-size: 0.85rem !important; }
        .pdf-bill-root .bill-info-block .route-row .label { font-size: 0.6rem !important; }
        .pdf-bill-root .bill-info-block .route-row .value { font-size: 0.85rem !important; }
        .pdf-bill-root .table-scroll { overflow: visible !important; width: 100% !important; margin: 0 !important; }
        .pdf-bill-root .transport-table { width: 100% !important; table-layout: fixed !important; font-size: 11px !important; border-collapse: collapse; }
        .pdf-bill-root .transport-table th, .pdf-bill-root .transport-table td { padding: 5px 6px !important; box-sizing: border-box; border-bottom: 1px solid #ccc; text-align: center !important; }
        .pdf-bill-root .transport-table th.col-sr-no, .pdf-bill-root .transport-table td.col-sr-no { width: 3.25rem !important; min-width: 3.25rem !important; max-width: 3.25rem !important; }
        .pdf-bill-root .transport-table th { font-weight: 600; background: #f5f5f5; }
        .pdf-bill-root .transport-table .num { text-align: center !important; }
        .pdf-bill-root .transport-table tr.pdf-page-total td { font-weight: 600; border-top: 2px solid #333; padding-top: 6px !important; }
        .pdf-bill-root .transport-table tr.pdf-grand-total-row td { font-weight: 700; border-top: 2px solid #111; padding-top: 8px !important; font-size: 0.95rem !important; }
        .pdf-bill-root .transport-table tr.pdf-grand-total-row td.grand-total-label-cell { white-space: nowrap !important; min-width: 5rem !important; width: auto !important; max-width: none !important; color: #0d6e2e !important; }
        .pdf-bill-root .transport-table tr.pdf-grand-total-row td.grand-total-value-cell { color: #0d6e2e !important; }
        .pdf-bill-root .pdf-sign-stamp-block { margin-top: 2.5rem !important; text-align: right !important; padding-right: 0.5rem !important; }
        .pdf-bill-root .pdf-sign-stamp-inner { display: inline-block; font-size: 0.75rem !important; color: #666 !important; border: 1px solid #ccc !important; padding: 0.5rem 1.5rem !important; min-width: 8rem !important; text-align: center !important; }
      `
      root.appendChild(pdfStyles)

      function escapeHtml(s) {
        const div = document.createElement('div')
        div.textContent = s
        return div.innerHTML
      }

      const billDateDisplay = bill.bill_date ? bill.bill_date.replace(/-/g, '.') : '—'
      const phones = [company.phone_1, company.phone_2].filter(Boolean).join(' / ')

      chunks.forEach((chunk, pageIndex) => {
        const pageDiv = document.createElement('div')
        pageDiv.className = 'pdf-page'
        if (pageIndex < chunks.length - 1) pageDiv.style.pageBreakAfter = 'always'

        const companyBlock = document.createElement('div')
        companyBlock.className = 'block company-block'
        companyBlock.innerHTML = `<h2 class="company-name">${escapeHtml(company.company_name)}</h2><p class="company-address">${escapeHtml(company.address || '')}</p><p class="company-meta">${company.pan_number ? `<span>PAN:</span> ${escapeHtml(company.pan_number)}` : ''}${phones ? ` &nbsp; <span>Mobile:</span> ${escapeHtml(phones)}` : ''}</p>`
        pageDiv.appendChild(companyBlock)

        const billInfoWrap = document.createElement('div')
        billInfoWrap.className = 'block bill-info-block'
        const routeFromPdf = (bill.route_from || '').trim() || '—'
        const routeToPdf = (bill.route_to || '').trim() || '—'
        billInfoWrap.innerHTML = `<div class="bill-info-row"><div class="bill-info-item"><span class="label">Bill No.</span><span class="value">${escapeHtml(bill.bill_number)}</span></div><div class="bill-info-item"><span class="label">M/s</span><span class="value">${escapeHtml(bill.client_name || '')}</span></div><div class="bill-info-item"><span class="label">Location</span><span class="value">${escapeHtml(bill.client_location || '')}</span></div><div class="bill-info-item"><span class="label">Date</span><span class="value">${escapeHtml(billDateDisplay)}</span></div></div><div class="route-row"><span class="label">From</span><span class="value">${escapeHtml(routeFromPdf)}</span><span class="label">To</span><span class="value">${escapeHtml(routeToPdf)}</span></div>`
        pageDiv.appendChild(billInfoWrap)

        const tableBlock = document.createElement('div')
        tableBlock.className = 'block table-block'
        const tableScroll = document.createElement('div')
        tableScroll.className = 'table-scroll'
        const table = document.createElement('table')
        table.className = 'transport-table'

        const thead = document.createElement('thead')
        const headerRow = document.createElement('tr')
        pdfLayout.forEach((item) => {
          const th = document.createElement('th')
          if (item.type === 'fixed') {
            th.textContent = FIXED_HEADERS[item.index - 1]
            if (item.index === 1) th.className = 'col-sr-no'
          } else if (item.type === 'custom') th.textContent = item.col.name
          headerRow.appendChild(th)
        })
        thead.appendChild(headerRow)
        table.appendChild(thead)

        const tbody = document.createElement('tbody')
        const startIndex = pageIndex * ROWS_PER_PAGE
        chunk.forEach((row, idx) => {
          const tr = document.createElement('tr')
          const globalIndex = startIndex + idx
          pdfLayout.forEach((item) => {
            const td = document.createElement('td')
            if (item.type === 'custom') {
              td.textContent = row.custom?.[item.col.id] ?? '—'
            } else {
              const val = renderFixedCell(row, globalIndex, item.index)
              td.textContent = val
              td.className = [1, 7, 8, 9, 10, 11].includes(item.index) ? 'num' : ''
              if (item.index === 1) td.className += ' col-sr-no'
            }
            tr.appendChild(td)
          })
          tbody.appendChild(tr)
        })

        const pageTotal = chunk.reduce((sum, r) => sum + rowTotal(r), 0)
        const totalRow = document.createElement('tr')
        totalRow.className = 'pdf-page-total'
        pdfLayout.forEach((item) => {
          const td = document.createElement('td')
          if (item.type === 'fixed' && item.index === 1) { td.textContent = 'Total'; td.className = 'col-sr-no' }
          else if (item.type === 'fixed' && (item.index === 9 || item.index === 11)) { td.textContent = pageTotal.toLocaleString('en-IN'); td.className = 'num' }
          else td.textContent = ''
          totalRow.appendChild(td)
        })
        tbody.appendChild(totalRow)

        const isLastPage = pageIndex === chunks.length - 1
        if (isLastPage) {
          const grandRow = document.createElement('tr')
          grandRow.className = 'pdf-grand-total-row'
          pdfLayout.forEach((item) => {
            const td = document.createElement('td')
            if (item.type === 'fixed' && item.index === 1) { td.textContent = 'Grand Total'; td.className = 'grand-total-label-cell' }
            else if (item.type === 'fixed' && (item.index === 9 || item.index === 11)) { td.textContent = totalGrand.toLocaleString('en-IN'); td.className = 'num grand-total-value-cell' }
            else td.textContent = ''
            grandRow.appendChild(td)
          })
          tbody.appendChild(grandRow)
        }

        table.appendChild(tbody)
        tableScroll.appendChild(table)
        tableBlock.appendChild(tableScroll)
        pageDiv.appendChild(tableBlock)

        if (isLastPage) {
          const signStampBlock = document.createElement('div')
          signStampBlock.className = 'pdf-sign-stamp-block'
          signStampBlock.innerHTML = '<div class="pdf-sign-stamp-inner">Sign & Stamp</div>'
          pageDiv.appendChild(signStampBlock)
        }

        root.appendChild(pageDiv)
      })

      const wrapper = document.createElement('div')
      wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:1060px;box-sizing:border-box;'
      wrapper.appendChild(root)
      document.body.appendChild(wrapper)

      const companyName = (company.company_name || '').replace(/[/\\:*?"<>|]/g, '').trim() || 'Bill'
      const billNo = bill.bill_number || 'bill'
      const filename = `${companyName} ${billNo}.pdf`
      html2pdf()
        .set({
          margin: 3,
          filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 1.65, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        })
        .from(root)
        .save()
        .then(() => { wrapper.remove() })
        .catch(() => { wrapper.remove() })
    })
  }, [bill, company, customColumns])

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
                        <span>M/s</span>
                        <input type="text" name="client_name" value={billEditForm.client_name} onChange={handleBillEditChange} placeholder="Client name" />
                      </label>
                      <label>
                        <span>Location</span>
                        <input type="text" name="client_location" value={billEditForm.client_location} onChange={handleBillEditChange} placeholder="Location" />
                      </label>
                      <label>
                        <span>Date</span>
                        <input type="date" name="bill_date" value={billEditForm.bill_date} onChange={handleBillEditChange} required />
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
              <div className="sign-stamp-block">
                <div className="sign-stamp-inner">Sign & Stamp</div>
              </div>
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
