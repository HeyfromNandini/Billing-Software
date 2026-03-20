import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import {
  loadAppStateFromLocalStorage,
  saveAppStateToLocalStorage,
  mergeLocalClientsAndBillsIfFirestoreEmpty,
} from '../data/appStateLocal'
import { mergeCompaniesWithDefaults } from '../data/seedData'
import { isFirebaseConfigured } from '../firebase/config'
import { subscribeAppData, saveAppDataToFirestore } from '../firebase/appData'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [companies, setCompanies] = useState([])
  const [clients, setClients] = useState([])
  const [bills, setBills] = useState([])
  const [hydrated, setHydrated] = useState(false)
  const skipSaveFromRemote = useRef(false)
  const latestRef = useRef({ companies: [], clients: [], bills: [] })
  latestRef.current = { companies, clients, bills }

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      const data = loadAppStateFromLocalStorage()
      setCompanies(mergeCompaniesWithDefaults(data.companies))
      setClients(data.clients)
      setBills(data.bills)
      setHydrated(true)
      return
    }
    const unsub = subscribeAppData(
      (data) => {
        const recovered = mergeLocalClientsAndBillsIfFirestoreEmpty(data)
        const mergedCompanies = mergeCompaniesWithDefaults(recovered.companies)
        const mergedDiffers =
          JSON.stringify(mergedCompanies) !== JSON.stringify(data.companies ?? []) ||
          JSON.stringify(recovered.clients ?? []) !== JSON.stringify(data.clients ?? []) ||
          JSON.stringify(recovered.bills ?? []) !== JSON.stringify(data.bills ?? [])
        // If we merged defaults or restored localStorage clients/bills, persist to Firestore.
        skipSaveFromRemote.current = !mergedDiffers
        setCompanies(mergedCompanies)
        setClients(Array.isArray(recovered.clients) ? recovered.clients : [])
        setBills(Array.isArray(recovered.bills) ? recovered.bills : [])
        setHydrated(true)
      },
      (err) => console.error('[Firestore]', err),
      () => loadAppStateFromLocalStorage()
    )
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (!isFirebaseConfigured()) {
      saveAppStateToLocalStorage(companies, clients, bills)
      return
    }
    if (skipSaveFromRemote.current) {
      skipSaveFromRemote.current = false
      return
    }
    const t = setTimeout(() => {
      saveAppDataToFirestore({ companies, clients, bills }).catch((e) => console.error('[Firestore save]', e))
    }, 450)
    return () => clearTimeout(t)
  }, [hydrated, companies, clients, bills])

  useEffect(() => {
    return () => {
      if (!isFirebaseConfigured()) return
      const s = latestRef.current
      saveAppDataToFirestore(s).catch(() => {})
    }
  }, [])

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

  const addCompany = useCallback((company) => {
    const id = `company-${Date.now()}`
    setCompanies((prev) => [...prev, { ...company, id }])
    return id
  }, [])

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

  const deleteCompany = useCallback((id) => {
    setCompanies((prev) => prev.filter((c) => c.id !== id))
    setClients((prev) => prev.filter((c) => c.company_id !== id))
    setBills((prev) => prev.filter((b) => b.company_id !== id))
  }, [])

  const value = {
    companies,
    clients,
    bills,
    hydrated,
    useCloudStorage: isFirebaseConfigured(),
    getCompany,
    getClientsByCompany,
    getClient,
    addCompany,
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
    deleteCompany,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
