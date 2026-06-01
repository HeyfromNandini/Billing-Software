import { useMemo, useRef, useEffect, useCallback, useState } from 'react'
import { formatDate, rowTotal, rowBalance, displayEntryRate, entryHasNumericRate } from '../utils/billing'
import EditableEntryRow from './EditableEntryRow'
import { FIXED_HEADERS } from '../sheets/fixedHeaders.js'
import { buildColumnLayout, buildPdfColumnLayout } from '../sheets/columnLayout.js'

export { FIXED_HEADERS, buildColumnLayout, buildPdfColumnLayout }

/** Relative width weight for PDF colgroup (normalized to 100% in appendPdfColgroup). */
function pdfColWeight(item) {
  if (item.type === 'custom') return 6
  switch (item.index) {
    case 1: return 4
    case 2: return 7
    case 3: return 8
    case 4: return 8
    case 5: return 9
    case 6: return 9
    case 7: return 5
    case 8: return 7
    case 9: return 9
    case 10: return 9
    case 11: return 9
    default: return 7
  }
}

export function isPdfMoneyColumn(item) {
  return item.type === 'fixed' && [9, 10, 11].includes(item.index)
}

export function isPdfEllipsisTextColumn(item) {
  if (item.type === 'custom') return true
  return item.type === 'fixed' && [5, 6].includes(item.index)
}

/** Inserts a <colgroup> before thead so money columns keep enough width in fixed layout. */
export function appendPdfColgroup(table, layout) {
  const weights = layout.map(pdfColWeight)
  const sum = weights.reduce((acc, w) => acc + w, 0) || 1
  const colgroup = document.createElement('colgroup')
  weights.forEach((w) => {
    const col = document.createElement('col')
    col.style.width = `${((w / sum) * 100).toFixed(2)}%`
    colgroup.appendChild(col)
  })
  table.insertBefore(colgroup, table.firstChild)
}

export default function TransportTable({
  entries,
  editingId,
  customColumns = [],
  onEdit,
  onDelete,
  onSaveEntry,
  onCancelEdit,
  onReorderEntries,
  defaultRouteFrom,
  defaultRouteTo,
  rateType,
  rateFixed,
  rateRule,
  /** When a row has no saved rate, show this (Extra per ton from bill rules). */
  rateColumnFallback = '',
  /** Raw Extra per ton for seeding the rate field while editing a row. */
  extraPerTonRaw,
}) {
  const layout = useMemo(() => buildColumnLayout(customColumns), [customColumns])
  const fallbackDisplay = String(rateColumnFallback ?? '').trim()
  const [draggingIndex, setDraggingIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const pointerFromRef = useRef(null)
  const latestOverRef = useRef(null)
  const reorderSlopMetRef = useRef(false)
  const pointerDownPosRef = useRef(null)
  const onReorderRef = useRef(onReorderEntries)
  const canReorder = typeof onReorderEntries === 'function' && !editingId

  useEffect(() => {
    onReorderRef.current = onReorderEntries
  }, [onReorderEntries])

  const rowFromClientPoint = useCallback((clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY)
    return el?.closest?.('tr[data-entry-row-index]') ?? null
  }, [])

  const handleRowHandlePointerDown = useCallback(
    (e, rowIndex) => {
      if (!canReorder || pointerFromRef.current !== null) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      pointerFromRef.current = rowIndex
      latestOverRef.current = rowIndex
      reorderSlopMetRef.current = false
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY }
      setDraggingIndex(rowIndex)
      setDragOverIndex(rowIndex)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [canReorder]
  )

  const handleRowHandlePointerMove = useCallback(
    (e) => {
      if (pointerFromRef.current === null) return
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
      const start = pointerDownPosRef.current
      if (start) {
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (dx * dx + dy * dy >= REORDER_DRAG_SLOP_PX * REORDER_DRAG_SLOP_PX) {
          reorderSlopMetRef.current = true
        }
      }
      const tr = rowFromClientPoint(e.clientX, e.clientY)
      if (tr) {
        const idx = parseInt(tr.getAttribute('data-entry-row-index'), 10)
        if (!Number.isNaN(idx)) {
          latestOverRef.current = idx
          setDragOverIndex(idx)
        }
      }
    },
    [rowFromClientPoint]
  )

  const handleRowHandlePointerUp = useCallback(
    (e) => {
      if (pointerFromRef.current === null) return
      const from = pointerFromRef.current
      const tr = rowFromClientPoint(e.clientX, e.clientY)
      let to = tr ? parseInt(tr.getAttribute('data-entry-row-index'), 10) : NaN
      if (Number.isNaN(to) && latestOverRef.current != null) {
        to = latestOverRef.current
      }
      const start = pointerDownPosRef.current
      if (start) {
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (dx * dx + dy * dy >= REORDER_DRAG_SLOP_PX * REORDER_DRAG_SLOP_PX) {
          reorderSlopMetRef.current = true
        }
      }
      pointerFromRef.current = null
      latestOverRef.current = null
      pointerDownPosRef.current = null
      const slopOk = reorderSlopMetRef.current
      reorderSlopMetRef.current = false
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch (_) {
          /* already released */
        }
      }
      setDraggingIndex(null)
      setDragOverIndex(null)
      if (slopOk && !Number.isNaN(to) && from !== to) {
        onReorderRef.current?.(from, to)
      }
    },
    [rowFromClientPoint]
  )

  const handleRowHandleLostCapture = useCallback(() => {
    pointerFromRef.current = null
    latestOverRef.current = null
    pointerDownPosRef.current = null
    reorderSlopMetRef.current = false
    setDraggingIndex(null)
    setDragOverIndex(null)
  }, [])

  const renderFixedCell = (row, index, key) => {
    const tot = rowTotal(row)
    const bal = rowBalance(row)
    const advanceStr = row.advance ? String(row.advance) : '—'
    switch (key) {
      case 1: return index + 1
      case 2: return formatDate(row.date)
      case 3: return row.vehicle_number || '—'
      case 4: return row.invoice_number
      case 5: return row.from || '—'
      case 6: return row.to || '—'
      case 7: return row.weight || '—'
      case 8: return displayEntryRate(row, rateColumnFallback)
      case 9: return tot
      case 10: return advanceStr
      case 11: return bal
      default: return '—'
    }
  }

  return (
    <div className="block table-block">
      <div className="table-scroll">
        <table className="transport-table">
          <thead>
            <tr>
              {layout.map((item, idx) => {
                if (item.type === 'action') return <th key="action" className="no-print action-col">Action</th>
                if (item.type === 'custom') return <th key={item.col.id}>{item.col.name}</th>
                return (
                  <th
                    key={`fixed-${item.index}`}
                    className={[item.index === 1 && 'col-sr-no', item.index === 8 && 'col-rate'].filter(Boolean).join(' ') || undefined}
                    title={item.index === 1 && canReorder ? 'Sr. no is automatic. Drag ⋮⋮ to move a row — numbers update after you drop.' : undefined}
                  >
                    {FIXED_HEADERS[item.index - 1]}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {entries.map((row, index) => {
              if (editingId === row.id) {
                return (
                  <EditableEntryRow
                    key={row.id}
                    entry={row}
                    index={index}
                    layout={layout}
                    customColumns={customColumns}
                    defaultRouteFrom={defaultRouteFrom}
                    defaultRouteTo={defaultRouteTo}
                    rateType={rateType}
                    rateFixed={rateFixed}
                    rateRule={rateRule}
                    rateColumnFallback={rateColumnFallback}
                    extraPerTonRaw={extraPerTonRaw}
                    onSave={onSaveEntry}
                    onCancel={onCancelEdit}
                  />
                )
              }
              return (
                <tr
                  key={row.id}
                  data-entry-row-index={index}
                  className={[
                    draggingIndex === index ? 'is-row-dragging' : '',
                    dragOverIndex === index && draggingIndex != null && draggingIndex !== index ? 'is-row-drag-over' : '',
                  ].filter(Boolean).join(' ') || undefined}
                >
                  {layout.map((item) => {
                    if (item.type === 'action') {
                      return (
                        <td key="action" className="no-print">
                          <div className="row-actions">
                            <button type="button" className="btn-edit" draggable={false} aria-label="Edit" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(row.id); }}>Edit</button>
                            <span className="row-actions-sep" aria-hidden="true">|</span>
                            <button type="button" className="btn-delete" draggable={false} aria-label="Delete" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(row.id); }}>Delete</button>
                          </div>
                        </td>
                      )
                    }
                    if (item.type === 'custom') {
                      return <td key={item.col.id}>{row.custom?.[item.col.id] ?? '—'}</td>
                    }
                    if (item.index === 1 && canReorder) {
                      return (
                        <td key="fixed-1" className="num col-sr-no col-drag-cell">
                          <span
                            className="row-drag-handle no-print"
                            role="button"
                            tabIndex={0}
                            style={{ touchAction: 'none' }}
                            onPointerDown={(e) => handleRowHandlePointerDown(e, index)}
                            onPointerMove={handleRowHandlePointerMove}
                            onPointerUp={handleRowHandlePointerUp}
                            onPointerCancel={handleRowHandleLostCapture}
                            onLostPointerCapture={handleRowHandleLostCapture}
                            title="Drag to move this row — Sr. no updates to the new position when you release"
                            aria-label={`Drag to reorder row ${index + 1}`}
                          >
                            ⋮⋮
                          </span>
                          <span className="sr-no-value" aria-hidden="true">{index + 1}</span>
                        </td>
                      )
                    }
                    const val = renderFixedCell(row, index, item.index)
                    const rateUsesPdfText =
                      item.index === 8 &&
                      Boolean(fallbackDisplay) &&
                      !entryHasNumericRate(row)
                    const isNum =
                      [1, 7, 9, 10, 11].includes(item.index) || (item.index === 8 && !rateUsesPdfText)
                    const cn = [
                      isNum && 'num',
                      item.index === 1 && 'col-sr-no',
                      item.index === 8 && 'col-rate',
                      rateUsesPdfText && 'rate-cell-pdf-text',
                    ]
                      .filter(Boolean)
                      .join(' ')
                    return <td key={`fixed-${item.index}`} className={cn || undefined}>{val}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
