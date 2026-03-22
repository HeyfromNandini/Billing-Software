import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { formatDate, rowTotal, rowBalance } from '../utils/billing'
import EditableEntryRow from './EditableEntryRow'

export const FIXED_HEADERS = [
  'Sr. no',
  'Date',
  'Vehicle No',
  'Invoice no',
  'From',
  'To',
  'Weight',
  'Rate',
  'Total',
  'Advance',
  'Balance',
]

export function buildColumnLayout(customColumns) {
  const layout = []
  for (let pos = 1; pos <= 11; pos++) {
    const customsAtPos = (customColumns || []).filter((c) => (Number(c.order) || 12) === pos)
    customsAtPos.forEach((col) => layout.push({ type: 'custom', col }))
    layout.push({ type: 'fixed', index: pos })
  }
  const customsAt12 = (customColumns || []).filter((c) => (Number(c.order) || 12) === 12)
  customsAt12.forEach((col) => layout.push({ type: 'custom', col }))
  layout.push({ type: 'action' })
  return layout
}

export function buildPdfColumnLayout(customColumns) {
  return buildColumnLayout(customColumns).filter((item) => item.type !== 'action')
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
}) {
  const layout = useMemo(() => buildColumnLayout(customColumns), [customColumns])
  const [draggingIndex, setDraggingIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const pointerFromRef = useRef(null)
  const latestOverRef = useRef(null)
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
      pointerFromRef.current = null
      latestOverRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch (_) {
          /* already released */
        }
      }
      setDraggingIndex(null)
      setDragOverIndex(null)
      if (!Number.isNaN(to) && from !== to) {
        onReorderRef.current?.(from, to)
      }
    },
    [rowFromClientPoint]
  )

  const handleRowHandleLostCapture = useCallback(() => {
    pointerFromRef.current = null
    latestOverRef.current = null
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
      case 8: return row.rate
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
                    className={item.index === 1 ? 'col-sr-no' : ''}
                    title={item.index === 1 && canReorder ? 'Drag ⋮⋮ beside a row’s number to change order' : undefined}
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
                            title="Hold and drag to reorder rows"
                            aria-label={`Drag to reorder row ${index + 1}`}
                          >
                            ⋮⋮
                          </span>
                          <span className="sr-no-value">{index + 1}</span>
                        </td>
                      )
                    }
                    const val = renderFixedCell(row, index, item.index)
                    const isNum = [1, 7, 8, 9, 10, 11].includes(item.index)
                    const cn = [isNum && 'num', item.index === 1 && 'col-sr-no'].filter(Boolean).join(' ')
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
