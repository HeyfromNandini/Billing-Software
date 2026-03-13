export default function TotalsBlock({ grandTotal, onAddEntry, onExportPdf }) {
  return (
    <div className="block totals-block">
      <div className="grand-total-row">
        <span className="grand-total-label">Grand Total</span>
        <span className="grand-total-value">₹ {grandTotal.toLocaleString('en-IN')}</span>
      </div>
      <div className="actions no-print">
        <button type="button" className="btn btn-secondary" onClick={onAddEntry}>+ Add entry</button>
        <button type="button" className="btn btn-primary" onClick={onExportPdf}>Export PDF</button>
      </div>
    </div>
  )
}
