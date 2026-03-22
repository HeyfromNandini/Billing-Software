import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { grandTotal } from '../utils/billing'
import UploadBillModal from '../components/UploadBillModal'

export default function ClientBillsPage() {
  const { companyId, clientId } = useParams()
  const navigate = useNavigate()
  const { getCompany, getClient, getBillsByClient, addBill, deleteBill } = useApp()
  const [uploadOpen, setUploadOpen] = useState(false)

  const company = getCompany(companyId)
  const client = getClient(clientId)
  const bills = getBillsByClient(companyId, clientId) ?? []

  if (!company || !client) {
    return (
      <div className="page">
        <p>Not found.</p>
        <Link to={companyId ? `/company/${companyId}` : '/'}>← Back</Link>
      </div>
    )
  }

  const handleNewBill = () => {
    const billId = addBill(companyId, clientId, {
      client_name: client.client_name,
      client_location: client.location,
    })
    navigate(`/company/${companyId}/bill/${billId}`)
  }

  const handleImportedBill = (imported) => {
    const billId = addBill(companyId, clientId, {
      ...imported,
      client_name: (imported.client_name && String(imported.client_name).trim()) || client.client_name,
      client_location:
        (imported.client_location && String(imported.client_location).trim()) || client.location,
    })
    navigate(`/company/${companyId}/bill/${billId}`)
  }

  const handleDeleteBill = (e, bill) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm(`Delete Bill #${bill.bill_number}?`)) {
      deleteBill(bill.id)
    }
  }

  return (
    <div className="page client-bills-page">
      <div className="page-header">
        <Link to={`/company/${companyId}`} className="back-link">← {company.company_name}</Link>
        <h2>{client.client_name}</h2>
        <div className="client-bills-header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setUploadOpen(true)}>
            Upload bill
          </button>
          <button type="button" className="btn btn-primary" onClick={handleNewBill}>
            + New bill
          </button>
        </div>
      </div>

      {client.location && (
        <p className="client-location text-muted">{client.location}</p>
      )}

      <UploadBillModal
        isOpen={uploadOpen}
        client={client}
        onClose={() => setUploadOpen(false)}
        onImported={handleImportedBill}
      />

      <section className="bills-section">
        <h3>Bills</h3>
        {bills.length === 0 ? (
          <p className="empty-state">No bills yet. Create one with “New bill”.</p>
        ) : (
          <ul className="bill-list">
            {bills.map((bill) => {
              const total = grandTotal(bill.entries ?? [])
              const billDateDisplay = bill.bill_date ? bill.bill_date.replace(/-/g, '.') : '—'
              return (
                <li key={bill.id}>
                  <div className="bill-item card">
                    <Link to={`/company/${companyId}/bill/${bill.id}`} className="bill-item-link">
                      <span className="bill-item-number">Bill #{bill.bill_number}</span>
                      <span className="bill-item-date">{billDateDisplay}</span>
                      <span className="bill-item-total">₹ {total.toLocaleString('en-IN')}</span>
                      <span className="bill-item-arrow" aria-hidden="true">→</span>
                    </Link>
                    <div className="bill-item-actions">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={(e) => handleDeleteBill(e, bill)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
