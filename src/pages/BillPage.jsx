import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import Header from '../components/Header'
import CompanyBlock from '../components/CompanyBlock'
import BillInfoBlock from '../components/BillInfoBlock'
import TransportTable, {
  appendPdfColgroup,
  buildPdfColumnLayout,
  FIXED_HEADERS,
  isPdfEllipsisTextColumn,
  isPdfMoneyColumn,
} from '../components/TransportTable'
import TotalsBlock from '../components/TotalsBlock'
import EntryModal from '../components/EntryModal'
import VehicleCombobox from '../components/VehicleCombobox'
import { COMMON_TO_DESTINATIONS } from '../data/routeDestinations'
import { companyStampSrc, fetchStampDataUrlForPdf } from '../data/companyStamps'
import {
  grandTotal,
  formatDate,
  rowTotal,
  rowBalance,
  reorderEntriesByIndex,
  displayBillHeaderRouteTo,
  rateBaseWeightKgFromStored,
  displayEntryRate,
  entryHasNumericRate,
  newBillEntryId,
} from '../utils/billing'
import { isDriveLayoutConfigured, companySpreadsheetId } from '../sheets/config'
import { getSpreadsheetMeta, readBillSheet } from '../sheets/driveLayout'
import {
  billSheetTitle,
  legacyBillSheetTitle,
  parseBillFromSheetValues,
  mergeCustomColumnDefs,
  mergeEntryCustomFromSheetEntries,
  billContentDiffersFromPatch,
} from '../sheets/billSheetRows'
import { flushBillToDriveNow, queueBillDriveSyncWithBill } from '../sheets/billDriveSync'

const ROWS_PER_PAGE = 12

/** html2canvas runs before async <img> loads — PDF stamp would be blank without this. */
function waitForImagesLoaded(container) {
  const imgs = container.querySelectorAll('img')
  if (!imgs.length) return Promise.resolve()
  return Promise.all(
    Array.from(imgs).map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve()
            return
          }
          const finish = () => {
            img.removeEventListener('load', finish)
            img.removeEventListener('error', finish)
            resolve()
          }
          img.addEventListener('load', finish)
          img.addEventListener('error', finish)
          setTimeout(finish, 12000)
        })
    )
  )
}

const defaultRateRule = {
  rate_type: 'variable',
  rate_fixed: 7500,
  rate_base_weight: 27273,
  rate_base_amount: 7500,
  rate_extra_per_ton: 275,
}

export default function BillPage() {
  const { companyId, billId } = useParams()
  const { getCompany, getBill, getClient, updateBill, updateClient, patchBillDriveMeta } = useApp()
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
  const [sheetConflict, setSheetConflict] = useState(null)
  const lastLocalEditRef = useRef(0)
  const billRef = useRef(null)
  const clientRef = useRef(null)

  const company = getCompany(companyId)
  const bill = getBill(billId)
  const client = bill ? getClient(bill.client_id) : null
  const rawCustomColumns = client?.custom_columns ?? []
  const customColumns = [...rawCustomColumns].map((c) => ({ ...c, order: Math.max(1, Math.min(Number(c.order) || 12, 12)) }))
  const entries = bill?.entries ?? []
  const rateColumnFallback = useMemo(
    () => String(rateVariable.rate_extra_per_ton ?? '').trim(),
    [rateVariable.rate_extra_per_ton]
  )

  const totalAmount = grandTotal(entries)
  const stampCompany = (bill?.company_id && getCompany(bill.company_id)) || company
  const stampSrc = companyStampSrc(stampCompany?.id, stampCompany)

  billRef.current = bill
  clientRef.current = client

  const touchLocal = useCallback(() => {
    lastLocalEditRef.current = Date.now()
  }, [])

  const touchLocalAndUpdateBill = useCallback(
    (id, updatesOrFn) => {
      touchLocal()
      updateBill(id, updatesOrFn)
    },
    [updateBill, touchLocal]
  )

  useEffect(() => {
    setSheetConflict(null)
  }, [billId])

  /** Pull custom-column cell values from this bill's Google tab when cloud/local rows are missing them. */
  useEffect(() => {
    if (!isDriveLayoutConfigured() || !bill || !client) return undefined
    const sid = companySpreadsheetId(bill.company_id)
    if (!sid) return undefined

    let cancelled = false
    ;(async () => {
      const colIds = (client.custom_columns || []).map((c) => c.id)
      const missingCustom =
        colIds.length === 0 ||
        (bill.entries || []).some((e) => colIds.some((id) => !String(e.custom?.[id] ?? '').trim()))
      if (!missingCustom) return

      const names = [billSheetTitle(bill), legacyBillSheetTitle(bill)]
      let values = null
      for (const sheetName of names) {
        const data = await readBillSheet({ spreadsheetId: sid, sheetName })
        if (cancelled) return
        if (data.ok && data.values?.length) {
          values = data.values
          break
        }
      }
      if (!values || cancelled) return

      const parsed = parseBillFromSheetValues(values, client)
      if (!parsed?.billPatch?.entries?.length) return

      if (parsed.customColumns?.length) {
        const mergedCols = mergeCustomColumnDefs(client.custom_columns, parsed.customColumns)
        if (JSON.stringify(mergedCols) !== JSON.stringify(client.custom_columns ?? [])) {
          updateClient(client.id, { custom_columns: mergedCols })
        }
      }

      const ids = mergeCustomColumnDefs(client.custom_columns, parsed.customColumns).map((c) => c.id)
      const { entries: mergedEntries, changed } = mergeEntryCustomFromSheetEntries(
        bill.entries || [],
        parsed.billPatch.entries,
        ids
      )
      if (!changed || cancelled) return
      updateBill(bill.id, { entries: mergedEntries })
    })()

    return () => {
      cancelled = true
    }
  }, [billId, bill?.id, client?.id, client?.custom_columns, bill?.entries, updateBill, updateClient])

  useEffect(() => {
    if (!isDriveLayoutConfigured() || !bill || !client) return undefined
    const sid0 = companySpreadsheetId(bill.company_id)
    if (!sid0) return undefined

    let cancelled = false

    const poll = async () => {
      const cur = billRef.current
      const cli = clientRef.current
      const sid = cur ? companySpreadsheetId(cur.company_id) : ''
      if (!cur || !cli || !sid) return
      const snapshotBillId = cur.id
      const primarySheetName = billSheetTitle(cur)
      const legacySheetName = legacyBillSheetTitle(cur)

      try {
        const localAt = cur.drive_file_updated_at
        if (localAt) {
          const meta = await getSpreadsheetMeta(sid)
          if (cancelled) return
          if (!billRef.current || billRef.current.id !== snapshotBillId) return
          const remote = meta.fileLastUpdated
          if (!remote) return
          if (new Date(remote) <= new Date(localAt)) return
        }

        let data = await readBillSheet({ spreadsheetId: sid, sheetName: primarySheetName })
        if (cancelled) return
        if (!billRef.current || billRef.current.id !== snapshotBillId) return

        if (
          (!data.ok || !data.values?.length) &&
          legacySheetName !== primarySheetName
        ) {
          const dataLegacy = await readBillSheet({ spreadsheetId: sid, sheetName: legacySheetName })
          if (cancelled) return
          if (!billRef.current || billRef.current.id !== snapshotBillId) return
          if (dataLegacy.ok && dataLegacy.values?.length) {
            data = dataLegacy
          }
        }

        if (cancelled) return
        const curFinal = billRef.current
        if (!curFinal || curFinal.id !== snapshotBillId) return

        if (!data.ok || !data.values) return

        const parsed = parseBillFromSheetValues(data.values, cli)
        if (!parsed) return

        if (!billContentDiffersFromPatch(curFinal, parsed.billPatch)) {
          if (data.fileLastUpdated) {
            patchBillDriveMeta(snapshotBillId, { drive_file_updated_at: data.fileLastUpdated })
          }
          return
        }

        if (Date.now() - lastLocalEditRef.current < 3000) return

        if (cancelled) return
        if (billRef.current?.id !== snapshotBillId) return

        setSheetConflict({
          forBillId: snapshotBillId,
          billPatch: parsed.billPatch,
          customColumns: parsed.customColumns ?? [],
          fileLastUpdated: data.fileLastUpdated,
        })
      } catch (e) {
        console.error('[Drive] poll bill sheet', e)
      }
    }

    const iv = setInterval(poll, 20000)
    poll()
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [
    billId,
    bill?.company_id,
    client?.id,
    bill?.bill_number,
    bill?.id,
    patchBillDriveMeta,
  ])

  useEffect(() => {
    if (bill) {
      setRateType(bill.rate_type ?? defaultRateRule.rate_type)
      setRateFixed(bill.rate_fixed ?? defaultRateRule.rate_fixed)
      setRateVariable({
        rate_base_weight:
          bill.rate_base_weight != null && bill.rate_base_weight !== ''
            ? rateBaseWeightKgFromStored(bill.rate_base_weight)
            : defaultRateRule.rate_base_weight,
        rate_base_amount: bill.rate_base_amount ?? defaultRateRule.rate_base_amount,
        rate_extra_per_ton: bill.rate_extra_per_ton ?? defaultRateRule.rate_extra_per_ton,
      })
    }
  }, [
    bill?.id,
    bill?.rate_type,
    bill?.rate_fixed,
    bill?.rate_base_weight,
    bill?.rate_base_amount,
    bill?.rate_extra_per_ton,
  ])

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
      touchLocalAndUpdateBill(billId, {
        bill_number: billEditForm.bill_number.trim(),
        bill_date: billDateDisplay,
        client_name: billEditForm.client_name.trim(),
        client_location: billEditForm.client_location.trim(),
        route_from: billEditForm.route_from.trim(),
        route_to: billEditForm.route_to.trim(),
      })
      setBillInfoEditing(false)
    },
    [billId, touchLocalAndUpdateBill, billEditForm]
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
      if (bill && isDriveLayoutConfigured()) {
        touchLocal()
        queueBillDriveSyncWithBill(bill)
      }
    },
    [client, newColumnName, newColumnOrder, updateClient, bill, touchLocal]
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
      if (bill && isDriveLayoutConfigured()) {
        touchLocal()
        queueBillDriveSyncWithBill(bill)
      }
    },
    [client, updateClient, bill, touchLocal]
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
      if (bill && isDriveLayoutConfigured()) {
        touchLocal()
        queueBillDriveSyncWithBill(bill)
      }
    },
    [client, updateClient, editingColumnId, bill, touchLocal]
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
      touchLocalAndUpdateBill(billId, (b) => {
        const cur = b.entries ?? []
        if (id != null) {
          const newEntry = { ...payload, id }
          return { entries: cur.map((e) => (e.id === id ? { ...e, ...newEntry } : e)) }
        }
        const newEntry = { ...payload, id: newBillEntryId() }
        return { entries: [...cur, newEntry] }
      })
      closeModal()
    },
    [bill, billId, touchLocalAndUpdateBill, closeModal]
  )

  const handleDeleteEntry = useCallback(
    (id) => {
      if (!bill || !window.confirm('Remove this entry?')) return
      touchLocalAndUpdateBill(billId, (b) => ({
        entries: (b.entries ?? []).filter((e) => e.id !== id),
      }))
      if (editingId === id) setEditingId(null)
    },
    [bill, billId, touchLocalAndUpdateBill, editingId]
  )

  const handleReorderEntries = useCallback(
    (fromIndex, toIndex) => {
      if (!bill) return
      touchLocalAndUpdateBill(billId, (b) => ({
        entries: reorderEntriesByIndex(b.entries ?? [], fromIndex, toIndex),
      }))
    },
    [bill, billId, touchLocalAndUpdateBill]
  )

  const billCardRef = useRef(null)

  const handleExportPdf = useCallback(() => {
    if (!company || !bill) return
    import('html2pdf.js').then(async ({ default: html2pdf }) => {
      const pdfLayout = buildPdfColumnLayout(customColumns)
      const entriesList = bill.entries ?? []
      const chunks = []
      for (let i = 0; i < entriesList.length; i += ROWS_PER_PAGE) {
        chunks.push(entriesList.slice(i, i + ROWS_PER_PAGE))
      }
      if (chunks.length === 0) chunks.push([])
      const grandTotalBalance = grandTotal(entriesList)
      const grandTotalFreight = entriesList.reduce((acc, r) => acc + rowTotal(r), 0)
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
          case 8: return displayEntryRate(row, rateColumnFallback)
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
        .pdf-bill-root { width: 100%; box-sizing: border-box; padding-right: 4px; }
        .pdf-page { page-break-after: always; padding: 2mm 6mm 2mm 4mm; box-sizing: border-box; }
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
        .pdf-bill-root .table-scroll { overflow: visible !important; width: 100% !important; margin: 0 !important; padding-right: 2px !important; }
        .pdf-bill-root .transport-table { width: 99% !important; table-layout: fixed !important; font-size: 11px !important; border-collapse: collapse; }
        .pdf-bill-root .transport-table th, .pdf-bill-root .transport-table td { padding: 5px 6px !important; box-sizing: border-box; border-bottom: 1px solid #ccc; text-align: center !important; }
        .pdf-bill-root .transport-table th.col-money, .pdf-bill-root .transport-table td.col-money {
          min-width: 5.25rem !important;
          white-space: nowrap !important;
          overflow: visible !important;
          font-variant-numeric: tabular-nums !important;
        }
        .pdf-bill-root .transport-table th.col-pdf-text, .pdf-bill-root .transport-table td.col-pdf-text {
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }
        .pdf-bill-root .transport-table td.pdf-rate-cell-display-text { white-space: pre-wrap !important; text-align: center !important; line-height: 1.25 !important; }
        .pdf-bill-root .transport-table th.col-sr-no, .pdf-bill-root .transport-table td.col-sr-no { width: 3.25rem !important; min-width: 3.25rem !important; max-width: 3.25rem !important; }
        .pdf-bill-root .transport-table th { font-weight: 600; background: #f5f5f5; }
        .pdf-bill-root .transport-table .num { text-align: center !important; }
        .pdf-bill-root .transport-table tr.pdf-page-total td { font-weight: 600; border-top: 2px solid #333; padding-top: 6px !important; }
        .pdf-bill-root .transport-table tr.pdf-grand-total-row td { font-weight: 700; border-top: 2px solid #111; padding-top: 8px !important; font-size: 0.95rem !important; }
        .pdf-bill-root .transport-table tr.pdf-grand-total-row td.grand-total-label-cell { white-space: nowrap !important; min-width: 5rem !important; width: auto !important; max-width: none !important; color: #0d6e2e !important; }
        .pdf-bill-root .transport-table tr.pdf-grand-total-row td.grand-total-value-cell {
          color: #0d6e2e !important;
          white-space: nowrap !important;
          overflow: visible !important;
          padding-right: 8px !important;
        }
        .pdf-bill-root .pdf-sign-stamp-block {
          margin-top: 0.35rem !important;
          padding-top: 0 !important;
          text-align: right !important;
          padding-right: 2.25rem !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
          -webkit-column-break-inside: avoid !important;
        }
        .pdf-bill-root .pdf-sign-stamp-inner {
          display: inline-block;
          font-size: 0.75rem !important;
          color: #666 !important;
          border: 1px solid #ccc !important;
          padding: 0.5rem 1.5rem !important;
          min-width: 8rem !important;
          text-align: center !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        .pdf-bill-root .pdf-sign-stamp-inner--stamp { border: none !important; padding: 0 !important; min-width: 0 !important; }
        .pdf-bill-root .pdf-company-stamp {
          display: block;
          max-height: 20mm !important;
          max-width: 48mm !important;
          width: auto !important;
          height: auto !important;
          object-fit: contain !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
      `
      root.appendChild(pdfStyles)

      function escapeHtml(s) {
        const div = document.createElement('div')
        div.textContent = s
        return div.innerHTML
      }

      function pdfLayoutCellClasses(item, extra = '') {
        const parts = []
        if (item.type === 'fixed' && item.index === 1) parts.push('col-sr-no')
        if (isPdfMoneyColumn(item)) parts.push('col-money')
        if (isPdfEllipsisTextColumn(item)) parts.push('col-pdf-text')
        if (extra) parts.push(extra)
        return parts.filter(Boolean).join(' ')
      }

      const billDateDisplay = bill.bill_date ? bill.bill_date.replace(/-/g, '.') : '—'
      const phones = [company.phone_1, company.phone_2].filter(Boolean).join(' / ')

      const pdfStampCompany = (bill?.company_id && getCompany(bill.company_id)) || company
      const stampPathForPdf = companyStampSrc(pdfStampCompany?.id, pdfStampCompany)
      let stampPdfSrc = null
      if (stampPathForPdf) {
        stampPdfSrc =
          (await fetchStampDataUrlForPdf(stampPathForPdf)) ||
          new URL(stampPathForPdf, window.location.href).href
      }

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
        const routeToPdf = displayBillHeaderRouteTo(bill)
        billInfoWrap.innerHTML = `<div class="bill-info-row"><div class="bill-info-item"><span class="label">Bill No.</span><span class="value">${escapeHtml(bill.bill_number)}</span></div><div class="bill-info-item"><span class="label">M/s</span><span class="value">${escapeHtml(bill.client_name || '')}</span></div><div class="bill-info-item"><span class="label">Location</span><span class="value">${escapeHtml(bill.client_location || '')}</span></div><div class="bill-info-item"><span class="label">Date</span><span class="value">${escapeHtml(billDateDisplay)}</span></div></div><div class="route-row"><span class="label">From</span><span class="value">${escapeHtml(routeFromPdf)}</span><span class="label">To</span><span class="value">${escapeHtml(routeToPdf)}</span></div>`
        pageDiv.appendChild(billInfoWrap)

        const tableBlock = document.createElement('div')
        tableBlock.className = 'block table-block'
        const tableScroll = document.createElement('div')
        tableScroll.className = 'table-scroll'
        const table = document.createElement('table')
        table.className = 'transport-table'
        appendPdfColgroup(table, pdfLayout)

        const thead = document.createElement('thead')
        const headerRow = document.createElement('tr')
        pdfLayout.forEach((item) => {
          const th = document.createElement('th')
          if (item.type === 'fixed') {
            th.textContent = FIXED_HEADERS[item.index - 1]
          } else if (item.type === 'custom') {
            th.textContent = item.col.name
          }
          const cn = pdfLayoutCellClasses(item)
          if (cn) th.className = cn
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
              const cn = pdfLayoutCellClasses(item)
              if (cn) td.className = cn
            } else {
              const val = renderFixedCell(row, globalIndex, item.index)
              td.textContent = val
              const extra = [
                [1, 7, 8, 9, 10, 11].includes(item.index) ? 'num' : '',
                item.index === 8 && rateColumnFallback && !entryHasNumericRate(row) ? 'pdf-rate-cell-display-text' : '',
              ]
                .filter(Boolean)
                .join(' ')
              const cn = pdfLayoutCellClasses(item, extra)
              if (cn) td.className = cn
            }
            tr.appendChild(td)
          })
          tbody.appendChild(tr)
        })

        const pageTotalFreight = chunk.reduce((sum, r) => sum + rowTotal(r), 0)
        const pageTotalBalance = chunk.reduce((sum, r) => sum + rowBalance(r), 0)
        const totalRow = document.createElement('tr')
        totalRow.className = 'pdf-page-total'
        pdfLayout.forEach((item) => {
          const td = document.createElement('td')
          if (item.type === 'fixed' && item.index === 1) td.textContent = 'Total'
          else if (item.type === 'fixed' && item.index === 9) td.textContent = pageTotalFreight.toLocaleString('en-IN')
          else if (item.type === 'fixed' && item.index === 11) td.textContent = pageTotalBalance.toLocaleString('en-IN')
          else td.textContent = ''
          const extra =
            item.type === 'fixed' && (item.index === 9 || item.index === 11) ? 'num' : ''
          const cn = pdfLayoutCellClasses(item, extra)
          if (cn) td.className = cn
          totalRow.appendChild(td)
        })
        tbody.appendChild(totalRow)

        const isLastPage = pageIndex === chunks.length - 1
        if (isLastPage) {
          const grandRow = document.createElement('tr')
          grandRow.className = 'pdf-grand-total-row'
          pdfLayout.forEach((item) => {
            const td = document.createElement('td')
            if (item.type === 'fixed' && item.index === 1) td.textContent = 'Grand Total'
            else if (item.type === 'fixed' && item.index === 9) td.textContent = grandTotalFreight.toLocaleString('en-IN')
            else if (item.type === 'fixed' && item.index === 11) td.textContent = grandTotalBalance.toLocaleString('en-IN')
            else td.textContent = ''
            const extra = [
              item.type === 'fixed' && item.index === 1 ? 'grand-total-label-cell' : '',
              item.type === 'fixed' && (item.index === 9 || item.index === 11) ? 'num grand-total-value-cell' : '',
            ]
              .filter(Boolean)
              .join(' ')
            const cn = pdfLayoutCellClasses(item, extra)
            if (cn) td.className = cn
            grandRow.appendChild(td)
          })
          tbody.appendChild(grandRow)
        }

        table.appendChild(tbody)
        tableScroll.appendChild(table)
        tableBlock.appendChild(tableScroll)
        pageDiv.appendChild(tableBlock)

        const signStampBlock = document.createElement('div')
        signStampBlock.className = 'pdf-sign-stamp-block'
        const inner = document.createElement('div')
        inner.className = stampPathForPdf
          ? 'pdf-sign-stamp-inner pdf-sign-stamp-inner--stamp'
          : 'pdf-sign-stamp-inner'
        if (stampPathForPdf && stampPdfSrc) {
          const img = document.createElement('img')
          img.className = 'pdf-company-stamp'
          img.alt = ''
          img.src = stampPdfSrc
          inner.appendChild(img)
        } else {
          inner.textContent = 'Sign & Stamp'
        }
        signStampBlock.appendChild(inner)
        pageDiv.appendChild(signStampBlock)

        root.appendChild(pageDiv)
      })

      const wrapper = document.createElement('div')
      wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:1060px;box-sizing:border-box;padding:0 10px 0 0;'
      wrapper.appendChild(root)
      document.body.appendChild(wrapper)
      await waitForImagesLoaded(wrapper)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

      const companyName = (company.company_name || '').replace(/[/\\:*?"<>|]/g, '').trim() || 'Bill'
      const billNo = bill.bill_number || 'bill'
      const filename = `${companyName} ${billNo}.pdf`
      try {
        await html2pdf()
          .set({
            margin: [3, 3, 3, 6],
            filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
              scale: 1.65,
              useCORS: true,
              logging: false,
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
            pagebreak: {
              mode: ['css', 'legacy'],
              avoid: ['.pdf-sign-stamp-block', '.pdf-sign-stamp-inner', '.pdf-company-stamp'],
            },
          })
          .from(root)
          .save()
      } finally {
        wrapper.remove()
      }
    })
  }, [bill, company, customColumns, rateColumnFallback, getCompany])

  const handleRateRuleSave = useCallback(
    (e) => {
      e.preventDefault()
      touchLocalAndUpdateBill(billId, {
        rate_type: rateType,
        rate_fixed: rateFixed,
        rate_base_weight: rateVariable.rate_base_weight,
        rate_base_amount: rateVariable.rate_base_amount,
        rate_extra_per_ton: rateVariable.rate_extra_per_ton,
        pdf_rate_column_text: '',
      })
    },
    [billId, touchLocalAndUpdateBill, rateType, rateFixed, rateVariable]
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

  const handleLoadFromSheet = useCallback(() => {
    if (!sheetConflict || !bill) return
    if (sheetConflict.forBillId != null && sheetConflict.forBillId !== billId) return
    touchLocal()
    const conflict = sheetConflict
    if (client && conflict.customColumns?.length) {
      const merged = mergeCustomColumnDefs(client.custom_columns, conflict.customColumns)
      if (JSON.stringify(merged) !== JSON.stringify(client.custom_columns ?? [])) {
        updateClient(client.id, { custom_columns: merged })
      }
    }
    updateBill(billId, (b) => {
      const patch = { ...conflict.billPatch }
      if (Array.isArray(patch.entries) && Array.isArray(b.entries) && patch.entries.length === b.entries.length) {
        patch.entries = patch.entries.map((e, i) => ({ ...e, id: b.entries[i].id }))
      }
      return patch
    })
    if (conflict.fileLastUpdated) {
      patchBillDriveMeta(billId, { drive_file_updated_at: conflict.fileLastUpdated })
    }
    setSheetConflict(null)
  }, [sheetConflict, bill, client, billId, updateBill, updateClient, patchBillDriveMeta, touchLocal])

  const handlePushToSheet = useCallback(async () => {
    const b = billRef.current
    if (!b) return
    touchLocal()
    try {
      await flushBillToDriveNow(b)
    } catch (e) {
      console.error('[Drive] overwrite sheet', e)
    }
    setSheetConflict(null)
  }, [touchLocal])

  const handleDismissSheetConflict = useCallback(() => {
    if (sheetConflict?.forBillId != null && sheetConflict.forBillId !== billId) {
      setSheetConflict(null)
      return
    }
    if (sheetConflict?.fileLastUpdated) {
      patchBillDriveMeta(billId, { drive_file_updated_at: sheetConflict.fileLastUpdated })
    }
    setSheetConflict(null)
  }, [sheetConflict, billId, patchBillDriveMeta])

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
        {sheetConflict ? (
          <div className="drive-sync-banner" role="alert">
            <p>
              This bill’s Google Sheet was updated outside the app (or in another tab). Choose how to resolve it.
            </p>
            <div className="drive-sync-banner-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={handleLoadFromSheet}>
                Load from sheet
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handlePushToSheet}>
                Overwrite sheet with app
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleDismissSheetConflict}>
                Ignore for now
              </button>
            </div>
          </div>
        ) : null}
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
                        <VehicleCombobox
                          options={COMMON_TO_DESTINATIONS}
                          value={billEditForm.route_to}
                          onChange={(route_to) => setBillEditForm((prev) => ({ ...prev, route_to }))}
                          placeholder="Khopoli, Taloja, or other…"
                          aria-label="Route To"
                        />
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
                      routeTo={displayBillHeaderRouteTo(bill)}
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
                onReorderEntries={handleReorderEntries}
                defaultRouteFrom={bill.route_from}
                defaultRouteTo={bill.route_to}
                rateType={rateType}
                rateFixed={rateFixed}
                rateRule={billRateRule}
                rateColumnFallback={rateColumnFallback}
                extraPerTonRaw={rateVariable.rate_extra_per_ton}
              />
              <TotalsBlock
                grandTotal={totalAmount}
                onAddEntry={openAdd}
                onExportPdf={handleExportPdf}
              />
              <div className="sign-stamp-block">
                <div className={stampSrc ? 'sign-stamp-inner sign-stamp-inner--stamp' : 'sign-stamp-inner'}>
                  {stampSrc ? (
                    <img className="company-stamp-img" src={stampSrc} alt="" />
                  ) : (
                    'Sign & Stamp'
                  )}
                </div>
              </div>
            </div>
          </section>

          <aside className="bill-sidebar no-print" aria-label="Rate rules for this bill">
            <div className="bill-sidebar-inner">
              <form onSubmit={handleRateRuleSave} className="card rate-rules-card">
                <h3 className="bill-sidebar-title">Rate rules (this bill)</h3>
                <p className="rate-rules-hint">
                  Extra per ton (₹) is the default for new trips and for rows with no rate. Click Edit on a row to set or change Rate for that trip, then Save.
                </p>
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
                      <span>Base weight (kg)</span>
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
