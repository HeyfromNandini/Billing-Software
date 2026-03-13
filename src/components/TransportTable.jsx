import { useMemo } from 'react'
import { formatDate, rowTotal, rowBalance } from '../utils/billing'
import EditableEntryRow from './EditableEntryRow'

const FIXED_HEADERS = ['Sr. no', 'Date', 'Vehicle No', 'Invoice no', 'From', 'To', 'Weight', 'Rate', 'Total', 'Advance', 'Balance']

function buildColumnLayout(customColumns) {
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

export default function TransportTable({
  entries,
  editingId,
  customColumns = [],
  onEdit,
  onDelete,
  onSaveEntry,
  onCancelEdit,
  defaultRouteFrom,
  defaultRouteTo,
  rateType,
  rateFixed,
  rateRule,
}) {
  const layout = useMemo(() => buildColumnLayout(customColumns), [customColumns])

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
                return <th key={`fixed-${item.index}`}>{FIXED_HEADERS[item.index - 1]}</th>
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
                <tr key={row.id}>
                  {layout.map((item) => {
                    if (item.type === 'action') {
                      return (
                        <td key="action" className="no-print">
                          <div className="row-actions">
                            <button type="button" className="btn-edit" aria-label="Edit" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(row.id); }}>Edit</button>
                            <span className="row-actions-sep" aria-hidden="true">|</span>
                            <button type="button" className="btn-delete" aria-label="Delete" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(row.id); }}>Delete</button>
                          </div>
                        </td>
                      )
                    }
                    if (item.type === 'custom') {
                      return <td key={item.col.id}>{row.custom?.[item.col.id] ?? '—'}</td>
                    }
                    const val = renderFixedCell(row, index, item.index)
                    const isNum = [1, 7, 8, 9, 10, 11].includes(item.index)
                    return <td key={`fixed-${item.index}`} className={isNum ? 'num' : ''}>{val}</td>
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
