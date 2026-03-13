import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'

const emptyClient = { client_name: '', location: '' }

const emptyCompanyInfo = { address: '', pan_number: '', phone_1: '', phone_2: '' }

export default function CompanyPage() {
  const { companyId } = useParams()
  const { getCompany, getClientsByCompany, addClient, updateClient, deleteClient, updateCompany } = useApp()
  const [showForm, setShowForm] = useState(false)
  const [editingClient, setEditingClient] = useState(null)
  const [form, setForm] = useState(emptyClient)
  const [companyInfoEditing, setCompanyInfoEditing] = useState(false)
  const [companyInfoForm, setCompanyInfoForm] = useState(emptyCompanyInfo)

  const company = getCompany(companyId)
  const clients = getClientsByCompany(companyId) ?? []

  useEffect(() => {
    if (editingClient) {
      setForm({
        client_name: editingClient.client_name ?? '',
        location: editingClient.location ?? '',
      })
    } else if (!showForm) {
      setForm(emptyClient)
    }
  }, [editingClient, showForm])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editingClient) {
      updateClient(editingClient.id, form)
      setEditingClient(null)
    } else {
      addClient(companyId, form)
      setShowForm(false)
    }
    setForm(emptyClient)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingClient(null)
    setForm(emptyClient)
  }

  const startCompanyInfoEdit = () => {
    setCompanyInfoForm({
      address: company?.address ?? '',
      pan_number: company?.pan_number ?? '',
      phone_1: company?.phone_1 ?? '',
      phone_2: company?.phone_2 ?? '',
    })
    setCompanyInfoEditing(true)
  }

  const handleCompanyInfoChange = (e) => {
    const { name, value } = e.target
    setCompanyInfoForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSaveCompanyInfo = (e) => {
    e?.preventDefault?.()
    if (!company) return
    updateCompany(company.id, {
      address: companyInfoForm.address.trim(),
      pan_number: companyInfoForm.pan_number.trim(),
      phone_1: companyInfoForm.phone_1.trim(),
      phone_2: companyInfoForm.phone_2.trim(),
    })
    setCompanyInfoEditing(false)
  }

  const cancelCompanyInfoEdit = () => setCompanyInfoEditing(false)

  const handleDeleteClient = (e, client) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm(`Delete "${client.client_name}" and all their bills?`)) {
      deleteClient(client.id)
    }
  }

  if (!company) {
    return (
      <div className="page">
        <p>Company not found.</p>
        <Link to="/">← Home</Link>
      </div>
    )
  }

  const showAddForm = showForm && !editingClient

  return (
    <div className="page company-page">
      <div className="page-header">
        <h2>{company.company_name}</h2>
      </div>

      <div className="company-info card">
        {companyInfoEditing ? (
          <form onSubmit={handleSaveCompanyInfo} className="company-form company-info-form">
            <label>
              <span>Address</span>
              <textarea name="address" value={companyInfoForm.address} onChange={handleCompanyInfoChange} rows={2} placeholder="Full address" />
            </label>
            <label>
              <span>PAN number</span>
              <input type="text" name="pan_number" value={companyInfoForm.pan_number} onChange={handleCompanyInfoChange} placeholder="e.g. DRBPS5123R" />
            </label>
            <label>
              <span>Phone 1</span>
              <input type="text" name="phone_1" value={companyInfoForm.phone_1} onChange={handleCompanyInfoChange} placeholder="e.g. 8652082121" />
            </label>
            <label>
              <span>Phone 2</span>
              <input type="text" name="phone_2" value={companyInfoForm.phone_2} onChange={handleCompanyInfoChange} placeholder="Optional" />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={cancelCompanyInfoEdit}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm">Save</button>
            </div>
          </form>
        ) : (
          <>
            {(company.address || company.pan_number || company.phone_1 || company.phone_2) ? (
              <>
                {company.address && <p className="company-address">{company.address}</p>}
                <p className="company-meta">
                  {company.pan_number && <span>PAN: {company.pan_number}</span>}
                  {(company.phone_1 || company.phone_2) && (
                    <span> &nbsp; Mobile: {[company.phone_1, company.phone_2].filter(Boolean).join(' / ')}</span>
                  )}
                </p>
              </>
            ) : (
              <p className="company-address text-muted">No contact details yet.</p>
            )}
            <button type="button" className="btn btn-secondary btn-sm company-info-edit-btn" onClick={startCompanyInfoEdit}>
              Edit
            </button>
          </>
        )}
      </div>

      <section className="clients-section">
        <div className="section-header">
          <h3>Companies I work with</h3>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setEditingClient(null); setShowForm(true) }}
          >
            + Add company
          </button>
        </div>

        {showAddForm && (
          <div className="card form-card">
            <h4>New company</h4>
            <form onSubmit={handleSubmit} className="company-form">
              <label>
                <span>Company name (M/s)</span>
                <input
                  type="text"
                  name="client_name"
                  value={form.client_name}
                  onChange={handleChange}
                  required
                  placeholder="e.g. Calcutta Carriers"
                />
              </label>
              <label>
                <span>Location</span>
                <input
                  type="text"
                  name="location"
                  value={form.location}
                  onChange={handleChange}
                  placeholder="e.g. Kalamboli"
                />
              </label>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add</button>
              </div>
            </form>
          </div>
        )}

        {clients.length === 0 && !showAddForm ? (
          <p className="empty-state">No companies yet. Add one to create bills for them.</p>
        ) : (
          <ul className="client-list">
            {clients.map((client) => (
              <li key={client.id}>
                <div className="client-card card">
                  {editingClient?.id === client.id ? (
                    <form onSubmit={handleSubmit} className="company-form client-form-inline">
                      <label>
                        <span>Company name (M/s)</span>
                        <input
                          type="text"
                          name="client_name"
                          value={form.client_name}
                          onChange={handleChange}
                          required
                          placeholder="e.g. Calcutta Carriers"
                        />
                      </label>
                      <label>
                        <span>Location</span>
                        <input
                          type="text"
                          name="location"
                          value={form.location}
                          onChange={handleChange}
                          placeholder="e.g. Kalamboli"
                        />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingClient(null); setForm(emptyClient) }}>Cancel</button>
                        <button type="submit" className="btn btn-primary btn-sm">Save</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <Link to={`/company/${companyId}/client/${client.id}`} className="client-card-link">
                        <span className="client-card-name">{client.client_name}</span>
                        <span className="client-card-meta">{client.location || '—'}</span>
                        <span className="client-card-arrow" aria-hidden="true">→</span>
                      </Link>
                      <div className="client-card-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingClient(client)}>Edit</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={(e) => handleDeleteClient(e, client)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
