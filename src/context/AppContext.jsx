import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { MY_COMPANIES, DEFAULT_CLIENTS, DEFAULT_BILL, STORAGE_KEY } from '../data/seedData'

const AppContext = createContext(null)

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (
        Array.isArray(data.companies) &&
        Array.isArray(data.clients) &&
        Array.isArray(data.bills) &&
        data.companies.length >= 3
      ) {
        const companies = data.companies.map((c) => ({ ...c }))
        const clients = (Array.isArray(data.clients) ? data.clients : []).map((c) => ({
          ...c,
          custom_columns: (Array.isArray(c.custom_columns) ? c.custom_columns : []).map((col, i) => ({
            ...col,
            order: typeof col.order === 'number' ? col.order : i + 1,
          })),
        }))
        return {
          companies,
          clients,
          bills: data.bills,
        }
      }
    }
  } catch (_) {}
  return {
    companies: MY_COMPANIES,
    clients: DEFAULT_CLIENTS,
    bills: [DEFAULT_BILL],
  }
}

function saveStored(companies, clients, bills) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ companies, clients, bills }))
  } catch (_) {}
}

export function AppProvider({ children }) {
  const [companies, setCompanies] = useState([])
  const [clients, setClients] = useState([])
  const [bills, setBills] = useState([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const data = loadStored()
    setCompanies(data.companies)
    setClients(data.clients)
    setBills(data.bills)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveStored(companies, clients, bills)
  }, [hydrated, companies, clients, bills])

  const getCompany = useCallback(
    (id) => companies.find((c) => c.id === id),
    [companies]
  )

  const getClientsByCompany = useCallback(
    (companyId) => clients.filter((c) => c.company_id === companyId),
    [clients]
  )

  const getClient = useCallback(
    (id) => clients.find((c) => c.id === id),
    [clients]
  )

  const addClient = useCallback((companyId, client) => {
    const id = `client-${Date.now()}`
    setClients((prev) => [...prev, { ...client, id, company_id: companyId, custom_columns: client.custom_columns ?? [] }])
    return id
  }, [])

  const updateClient = useCallback((id, updates) => {
    setClients((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    )
  }, [])

  const deleteClient = useCallback((id) => {
    setClients((prev) => prev.filter((c) => c.id !== id))
    setBills((prev) => prev.filter((b) => b.client_id !== id))
  }, [])

  const getBillsByClient = useCallback(
    (companyId, clientId) =>
      bills.filter((b) => b.company_id === companyId && b.client_id === clientId),
    [bills]
  )

  const getNextBillNumber = useCallback(
    (companyId) => {
      const companyBills = bills.filter((b) => b.company_id === companyId)
      const max = companyBills.reduce(
        (acc, b) => Math.max(acc, parseInt(b.bill_number, 10) || 0),
        0
      )
      return String(max + 1)
    },
    [bills]
  )

  const addBill = useCallback((companyId, clientId, bill = {}) => {
    const client = clients.find((c) => c.id === clientId)
    const today = new Date().toISOString().slice(0, 10)
    const ddmmyyyy = today.split('-').reverse().join('.')
    const id = `bill-${Date.now()}`
    let newBill
    setBills((prev) => {
      const companyBills = prev.filter((b) => b.company_id === companyId)
      const max = companyBills.reduce(
        (acc, b) => Math.max(acc, parseInt(b.bill_number, 10) || 0),
        0
      )
      const billNumber = String(max + 1)
      newBill = {
        id,
        company_id: companyId,
        client_id: clientId,
        bill_number: billNumber,
        bill_date: bill.bill_date ?? ddmmyyyy,
        client_name: bill.client_name ?? client?.client_name ?? '',
        client_location: bill.client_location ?? client?.location ?? '',
        route_from: bill.route_from ?? 'Kalamboli',
        route_to: bill.route_to ?? 'Khopoli',
        entries: bill.entries ?? [],
        rate_type: bill.rate_type ?? 'variable',
        rate_fixed: bill.rate_fixed ?? 7500,
        rate_base_weight: bill.rate_base_weight ?? 27.273,
        rate_base_amount: bill.rate_base_amount ?? 7500,
        rate_extra_per_ton: bill.rate_extra_per_ton ?? 275,
      }
      return [...prev, newBill]
    })
    return id
  }, [clients])

  const updateBill = useCallback((billId, updates) => {
    setBills((prev) =>
      prev.map((b) => (b.id === billId ? { ...b, ...updates } : b))
    )
  }, [])

  const deleteBill = useCallback((billId) => {
    setBills((prev) => prev.filter((b) => b.id !== billId))
  }, [])

  const getBill = useCallback(
    (id) => bills.find((b) => b.id === id),
    [bills]
  )

  const updateCompany = useCallback((id, updates) => {
    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    )
  }, [])

  const value = {
    companies,
    clients,
    bills,
    hydrated,
    getCompany,
    getClientsByCompany,
    getClient,
    addClient,
    updateClient,
    deleteClient,
    getBillsByClient,
    getNextBillNumber,
    addBill,
    updateBill,
    deleteBill,
    getBill,
    updateCompany,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
