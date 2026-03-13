import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'

const emptyForm = {
  company_name: '',
  address: '',
  pan_number: '',
  phone_1: '',
  phone_2: '',
}

export default function HomePage() {
  const { companies, addCompany, updateCompany, deleteCompany } = useApp()
  const [showForm, setShowForm] = useState(false)
  const [editingCompany, setEditingCompany] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')

  const searchLower = search.trim().toLowerCase()
  const filteredCompanies = searchLower
    ? companies.filter(
        (c) =>
          (c.company_name || '').toLowerCase().includes(searchLower) ||
          (c.pan_number || '').toLowerCase().includes(searchLower) ||
          (c.address || '').toLowerCase().includes(searchLower) ||
          (c.phone_1 || '').includes(search) ||
          (c.phone_2 || '').includes(search)
      )
    : companies

  useEffect(() => {
    if (editingCompany) {
      setForm({
        company_name: editingCompany.company_name ?? '',
        address: editingCompany.address ?? '',
        pan_number: editingCompany.pan_number ?? '',
        phone_1: editingCompany.phone_1 ?? '',
        phone_2: editingCompany.phone_2 ?? '',
      })
    } else if (!showForm) {
      setForm(emptyForm)
    }
  }, [editingCompany, showForm])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editingCompany) {
      updateCompany(editingCompany.id, form)
      setEditingCompany(null)
    } else {
      addCompany(form)
      setShowForm(false)
    }
    setForm(emptyForm)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingCompany(null)
    setForm(emptyForm)
  }

  const handleDeleteCompany = (e, company) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm(`Delete "${company.company_name}" and all its bills?`)) {
      deleteCompany(company.id)
    }
  }

  const showAddForm = showForm && !editingCompany

  return (
    <div className="page homepage">
      <p className="home-intro">Create a company, then add and edit bills for it.</p>
      <div className="page-header">
        <h2>Companies</h2>
        <button type="button" className="btn btn-primary" onClick={() => { setEditingCompany(null); setShowForm(true) }}>
          + Add company
        </button>
      </div>

      <div className="search-bar-wrap">
        <input
          type="search"
          className="search-input"
          placeholder="Search companies by name, PAN, address, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search companies"
        />
      </div>

      {showAddForm && (
        <div className="card form-card">
          <h3>New company</h3>
          <form onSubmit={handleSubmit} className="company-form">
            <label>
              <span>Company name</span>
              <input type="text" name="company_name" value={form.company_name} onChange={handleChange} required placeholder="e.g. SANGITA LOGISTICS" />
            </label>
            <label>
              <span>Address</span>
              <textarea name="address" value={form.address} onChange={handleChange} rows={2} placeholder="Full address" />
            </label>
            <label>
              <span>PAN number</span>
              <input type="text" name="pan_number" value={form.pan_number} onChange={handleChange} placeholder="e.g. DRBPS5123R" />
            </label>
            <label>
              <span>Phone 1</span>
              <input type="text" name="phone_1" value={form.phone_1} onChange={handleChange} placeholder="e.g. 8652082121" />
            </label>
            <label>
              <span>Phone 2</span>
              <input type="text" name="phone_2" value={form.phone_2} onChange={handleChange} placeholder="Optional" />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create company</button>
            </div>
          </form>
        </div>
      )}

      {filteredCompanies.length === 0 ? (
        <p className="empty-state">
          {search.trim() ? 'No companies match your search.' : 'No companies yet. Add one with “+ Add company”.'}
        </p>
      ) : (
      <ul className="company-list">
        {filteredCompanies.map((company) => (
          <li key={company.id}>
            <div className="company-card card">
              {editingCompany?.id === company.id ? (
                <form onSubmit={handleSubmit} className="company-form company-form-inline">
                  <label>
                    <span>Company name</span>
                    <input type="text" name="company_name" value={form.company_name} onChange={handleChange} required placeholder="e.g. SANGITA LOGISTICS" />
                  </label>
                  <label>
                    <span>Address</span>
                    <textarea name="address" value={form.address} onChange={handleChange} rows={2} placeholder="Full address" />
                  </label>
                  <label>
                    <span>PAN number</span>
                    <input type="text" name="pan_number" value={form.pan_number} onChange={handleChange} placeholder="e.g. DRBPS5123R" />
                  </label>
                  <label>
                    <span>Phone 1</span>
                    <input type="text" name="phone_1" value={form.phone_1} onChange={handleChange} placeholder="e.g. 8652082121" />
                  </label>
                  <label>
                    <span>Phone 2</span>
                    <input type="text" name="phone_2" value={form.phone_2} onChange={handleChange} placeholder="Optional" />
                  </label>
                  <div className="form-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingCompany(null); setForm(emptyForm) }}>Cancel</button>
                    <button type="submit" className="btn btn-primary btn-sm">Save</button>
                  </div>
                </form>
              ) : (
                <>
                  <Link to={`/company/${company.id}`} className="company-card-link">
                    <h3 className="company-card-name">{company.company_name}</h3>
                    <p className="company-card-meta">{company.pan_number ? `PAN: ${company.pan_number}` : ''}</p>
                    <span className="company-card-arrow" aria-hidden="true">→</span>
                  </Link>
                  <div className="company-card-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.preventDefault(); setEditingCompany(company) }}>Edit</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={(e) => handleDeleteCompany(e, company)}>Delete</button>
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}
