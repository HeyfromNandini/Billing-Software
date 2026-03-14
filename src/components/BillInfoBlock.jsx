export default function BillInfoBlock({ billNumber = '146', billDate = '05.02.2026', clientName = 'Calcutta Carriers', clientLocation = 'Kalamboli' }) {
  return (
    <div className="block bill-info-block">
      <div className="bill-info-row">
        <div className="bill-info-item">
          <span className="label">Bill No.</span>
          <span className="value">{billNumber}</span>
        </div>
        <div className="bill-info-item">
          <span className="label">Date</span>
          <span className="value">{billDate}</span>
        </div>
        <div className="bill-info-item">
          <span className="label">M/s</span>
          <span className="value">{clientName}</span>
        </div>
        <div className="bill-info-item">
          <span className="label">Location</span>
          <span className="value">{clientLocation}</span>
        </div>
      </div>
    </div>
  )
}
