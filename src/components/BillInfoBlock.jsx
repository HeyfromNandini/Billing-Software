export default function BillInfoBlock({
  billNumber = '146',
  billDate = '05.02.2026',
  clientName = 'Calcutta Carriers',
  clientLocation = 'Kalamboli',
  routeFrom = '',
  routeTo = '',
}) {
  const fromDisplay = (routeFrom || '').trim() || '—'
  const toDisplay = (routeTo || '').trim() || '—'
  return (
    <div className="block bill-info-block">
      <div className="bill-info-row">
        <div className="bill-info-item">
          <span className="label">Bill No.</span>
          <span className="value">{billNumber}</span>
        </div>
        <div className="bill-info-item">
          <span className="label">M/s</span>
          <span className="value">{clientName}</span>
        </div>
        <div className="bill-info-item">
          <span className="label">Location</span>
          <span className="value">{clientLocation}</span>
        </div>
        <div className="bill-info-item">
          <span className="label">Date</span>
          <span className="value">{billDate}</span>
        </div>
      </div>
      <div className="route-row">
        <span className="label">From</span>
        <span className="value">{fromDisplay}</span>
        <span className="label">To</span>
        <span className="value">{toDisplay}</span>
      </div>
    </div>
  )
}
