import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import {
  loadAppStateFromLocalStorage,
  saveAppStateToLocalStorage,
  mergeLocalClientsAndBillsIfFirestoreEmpty,
} from '../data/appStateLocal'
import { mergeCompaniesWithDefaults } from '../data/seedData'
import {
  isGoogleSheetsConfigured,
  isDriveLayoutConfigured,
  companySpreadsheetId,
  getGoogleSyncSetupWarnings,
} from '../sheets/config'
import { fetchAppDataFromSheets, saveAppDataToSheets } from '../sheets/appData'
import {
  registerDriveSyncContext,
  queueBillDriveSyncWithBill,
  cancelBillDriveSync,
  removeBillSheetFromDrive,
} from '../sheets/billDriveSync'

const AppContext = createContext(null)

function applyRemotePayload(data, setSkipSave) {
  const recovered = mergeLocalClientsAndBillsIfFirestoreEmpty(data)
  const mergedCompanies = mergeCompaniesWithDefaults(recovered.companies)
  const mergedDiffers =
    JSON.stringify(mergedCompanies) !== JSON.stringify(data.companies ?? []) ||
    JSON.stringify(recovered.clients ?? []) !== JSON.stringify(data.clients ?? []) ||
    JSON.stringify(recovered.bills ?? []) !== JSON.stringify(data.bills ?? [])
  setSkipSave(!mergedDiffers)
  return {
    companies: mergedCompanies,
    clients: Array.isArray(recovered.clients) ? recovered.clients : [],
    bills: Array.isArray(recovered.bills) ? recovered.bills : [],
  }
}

export function AppProvider({ children }) {
  const [companies, setCompanies] = useState([])
  const [clients, setClients] = useState([])
  const [bills, setBills] = useState([])
  const [hydrated, setHydrated] = useState(false)
  const [driveSyncError, setDriveSyncError] = useState(null)
  const [sheetsConnectionError, setSheetsConnectionError] = useState(null)
  const skipSaveFromRemote = useRef(false)

  const clearDriveSyncError = useCallback(() => setDriveSyncError(null), [])
  const clearSheetsConnectionError = useCallback(() => setSheetsConnectionError(null), [])

  useEffect(() => {
    let cancelled = false

    if (!isGoogleSheetsConfigured()) {
      const d = loadAppStateFromLocalStorage()
      setCompanies(mergeCompaniesWithDefaults(d.companies))
      setClients(d.clients)
      setBills(d.bills)
      setHydrated(true)
      return undefined
    }

    ;(async () => {
      try {
        const raw = await fetchAppDataFromSheets()
        if (cancelled) return
        if (raw?.masterDisabled) {
          const d = loadAppStateFromLocalStorage()
          setCompanies(mergeCompaniesWithDefaults(d.companies))
          setClients(d.clients)
          setBills(d.bills)
        } else {
          const next = applyRemotePayload(raw, (v) => { skipSaveFromRemote.current = v })
          setCompanies(next.companies)
          setClients(next.clients)
          setBills(next.bills)
        }
      } catch (e) {
        console.error('[Google Sheets]', e)
        if (cancelled) return
        setSheetsConnectionError(e?.message || String(e))
        const d = loadAppStateFromLocalStorage()
        setCompanies(mergeCompaniesWithDefaults(d.companies))
        setClients(d.clients)
        setBills(d.bills)
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const patchBillDriveMeta = useCallback((billId, updates) => {
    setBills((prev) => prev.map((b) => (b.id === billId ? { ...b, ...updates } : b)))
  }, [])

  useEffect(() => {
    registerDriveSyncContext(() => ({ companies, clients, patchBillDriveMeta }))
  }, [companies, clients, patchBillDriveMeta])

  const driveBackfillBillIdsRef = useRef(new Set())
  useEffect(() => {
    if (!hydrated || !isDriveLayoutConfigured()) return
    bills.forEach((b) => {
      if (!b?.id || !companySpreadsheetId(b.company_id)) return
      if (driveBackfillBillIdsRef.current.has(b.id)) return
      driveBackfillBillIdsRef.current.add(b.id)
      queueBillDriveSyncWithBill(b)
    })
  }, [hydrated, bills])

  useEffect(() => {
    if (!hydrated) return
    // Without a master sheet, POST /app-data is skipped — localStorage must still be updated on every change.
    if (isGoogleSheetsConfigured() && skipSaveFromRemote.current) {
      skipSaveFromRemote.current = false
      saveAppStateToLocalStorage(companies, clients, bills)
      return
    }
    if (!isGoogleSheetsConfigured()) {
      saveAppStateToLocalStorage(companies, clients, bills)
      return
    }
    const t = setTimeout(() => {
      saveAppStateToLocalStorage(companies, clients, bills)
      saveAppDataToSheets({ companies, clients, bills }).catch((e) => console.error('[Google Sheets save]', e))
    }, 450)
    return () => clearTimeout(t)
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

  const addCompany = useCallback((company) => {
    const id = `company-${Date.now()}`
    setCompanies((prev) => [...prev, { ...company, id }])
    return id
  }, [])

  const addClient = useCallback(
    (companyId, client) => {
      const id = `client-${Date.now()}`
      const company = companies.find((c) => c.id === companyId)
      setClients((prev) => [
        ...prev,
        { ...client, id, company_id: companyId, custom_columns: client.custom_columns ?? [] },
      ])
      return id
    },
    [companies]
  )

  const updateClient = useCallback((id, updates) => {
    setClients((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    )
  }, [])

  const deleteClient = useCallback(
    (clientId) => {
      const cli = clients.find((c) => c.id === clientId)
      if (cli && isDriveLayoutConfigured()) {
        bills
          .filter((b) => b.client_id === clientId)
          .forEach((b) => {
            void removeBillSheetFromDrive(b).catch((e) =>
              console.error('[Drive] delete client bill tabs', e)
            )
          })
      }
      setClients((prev) => prev.filter((c) => c.id !== clientId))
      setBills((prev) => prev.filter((b) => b.client_id !== clientId))
    },
    [clients, bills]
  )

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
      queueBillDriveSyncWithBill(newBill)
      return [...prev, newBill]
    })
    return id
  }, [clients])

  const updateBill = useCallback((billId, updates) => {
    setBills((prev) =>
      prev.map((b) => {
        if (b.id !== billId) return b
        const merged = { ...b, ...updates }
        queueBillDriveSyncWithBill(merged)
        return merged
      })
    )
  }, [])

  const deleteBill = useCallback(
    (billId) => {
      const bill = bills.find((b) => b.id === billId)
      cancelBillDriveSync(billId)
      if (bill) {
        void removeBillSheetFromDrive(bill).catch((e) =>
          console.error('[Drive] delete bill sheet', e)
        )
      }
      setBills((prev) => prev.filter((b) => b.id !== billId))
    },
    [bills]
  )

  const getBill = useCallback(
    (id) => bills.find((b) => b.id === id),
    [bills]
  )

  const updateCompany = useCallback((id, updates) => {
    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    )
  }, [])

  const deleteCompany = useCallback(
    (id) => {
      if (isDriveLayoutConfigured()) {
        bills
          .filter((b) => b.company_id === id)
          .forEach((b) => {
            void removeBillSheetFromDrive(b).catch((e) =>
              console.error('[Drive] delete company bill tabs', e)
            )
          })
      }
      setCompanies((prev) => prev.filter((c) => c.id !== id))
      setClients((prev) => prev.filter((c) => c.company_id !== id))
      setBills((prev) => prev.filter((b) => b.company_id !== id))
    },
    [bills]
  )

  const value = {
    companies,
    clients,
    bills,
    hydrated,
    useGoogleSheets: isGoogleSheetsConfigured(),
    driveSyncError,
    clearDriveSyncError,
    sheetsConnectionError,
    clearSheetsConnectionError,
    googleSyncSetupWarnings: getGoogleSyncSetupWarnings(),
    /** @deprecated use useGoogleSheets — Firebase was removed */
    useCloudStorage: false,
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
    patchBillDriveMeta,
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
