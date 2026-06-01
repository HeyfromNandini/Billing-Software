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
import { dedupeBillEntries, dedupeBills } from '../utils/billing'

const AppContext = createContext(null)

/** Avoid `{ ...b, ...{ entries: undefined } }` wiping nested state from sloppy patches. */
function omitUndefinedPatch(updates) {
  if (!updates || typeof updates !== 'object') return {}
  return Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined))
}

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
  const forceNextSaveRef = useRef(false)
  const latestAppStateRef = useRef({ companies: [], clients: [], bills: [] })
  const saveGenerationRef = useRef(0)

  const clearDriveSyncError = useCallback(() => setDriveSyncError(null), [])
  const clearSheetsConnectionError = useCallback(() => setSheetsConnectionError(null), [])

  useEffect(() => {
    latestAppStateRef.current = { companies, clients, bills }
  }, [companies, clients, bills])

  const persistAppStateNow = useCallback(async (patch, { force = false } = {}) => {
    const snap = latestAppStateRef.current
    const payload = {
      companies: patch.companies ?? snap.companies,
      clients: patch.clients ?? snap.clients,
      bills: patch.bills ?? snap.bills,
    }
    latestAppStateRef.current = payload
    saveAppStateToLocalStorage(payload.companies, payload.clients, payload.bills)
    if (!isGoogleSheetsConfigured()) return
    clearSheetsConnectionError()
    await saveAppDataToSheets(payload, { force })
  }, [clearSheetsConnectionError])

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

  /** One-time clean of duplicate bills / trip ids after load. */
  useEffect(() => {
    if (!hydrated) return
    setBills((prev) => {
      const deduped = dedupeBills(prev)
      if (deduped !== prev) return deduped
      let any = false
      const next = prev.map((b) => {
        const raw = b.entries ?? []
        const entries = dedupeBillEntries(raw)
        if (entries !== raw) {
          any = true
          return { ...b, entries }
        }
        return b
      })
      return any ? next : prev
    })
  }, [hydrated])

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
    const generation = ++saveGenerationRef.current
    const t = setTimeout(() => {
      if (generation !== saveGenerationRef.current) return
      saveAppStateToLocalStorage(companies, clients, bills)
      const force = forceNextSaveRef.current
      forceNextSaveRef.current = false
      saveAppDataToSheets({ companies, clients, bills }, { force }).catch((e) => {
        console.error('[Google Sheets save]', e)
        setSheetsConnectionError(e?.message || String(e))
      })
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
      const snap = latestAppStateRef.current
      const cli = snap.clients.find((c) => c.id === clientId)
      if (cli && isDriveLayoutConfigured()) {
        snap.bills
          .filter((b) => b.client_id === clientId)
          .forEach((b) => {
            void removeBillSheetFromDrive(b).catch((e) =>
              console.error('[Drive] delete client bill tabs', e)
            )
          })
      }
      const nextClients = snap.clients.filter((c) => c.id !== clientId)
      const nextBills = snap.bills.filter((b) => b.client_id !== clientId)
      saveGenerationRef.current += 1
      setClients(nextClients)
      setBills(nextBills)
      void persistAppStateNow(
        { companies: snap.companies, clients: nextClients, bills: nextBills },
        { force: true }
      ).catch((e) => {
        console.error('[Google Sheets save]', e)
        setSheetsConnectionError(e?.message || String(e))
      })
    },
    [persistAppStateNow]
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
        entries: dedupeBillEntries(bill.entries ?? []),
        rate_type: bill.rate_type ?? 'variable',
        rate_fixed: bill.rate_fixed ?? 7500,
        rate_base_weight: bill.rate_base_weight ?? 27273,
        rate_base_amount: bill.rate_base_amount ?? 7500,
        rate_extra_per_ton: bill.rate_extra_per_ton ?? 275,
        pdf_rate_column_text: bill.pdf_rate_column_text ?? '',
      }
      queueBillDriveSyncWithBill(newBill)
      return [...prev, newBill]
    })
    return id
  }, [clients])

  const updateBill = useCallback((billId, updatesOrFn) => {
    setBills((prev) =>
      prev.map((b) => {
        if (b.id !== billId) return b
        const raw =
          typeof updatesOrFn === 'function' ? updatesOrFn(b) : updatesOrFn
        if (!raw || typeof raw !== 'object') return b
        const updates = omitUndefinedPatch(raw)
        if (Object.keys(updates).length === 0) return b
        let merged = { ...b, ...updates }
        if (Array.isArray(merged.entries)) {
          const entries = dedupeBillEntries(merged.entries)
          if (entries !== merged.entries) {
            merged = { ...merged, entries }
          }
        }
        queueBillDriveSyncWithBill(merged)
        return merged
      })
    )
  }, [])

  const deleteBill = useCallback(
    (billId) => {
      const snap = latestAppStateRef.current
      const bill = snap.bills.find((b) => b.id === billId)
      cancelBillDriveSync(billId)
      driveBackfillBillIdsRef.current.delete(billId)
      if (bill) {
        void removeBillSheetFromDrive(bill).catch((e) =>
          console.error('[Drive] delete bill sheet', e)
        )
      }
      const nextBills = snap.bills.filter((b) => b.id !== billId)
      saveGenerationRef.current += 1
      setBills(nextBills)
      void persistAppStateNow({ bills: nextBills }, { force: true }).catch((e) => {
        console.error('[Google Sheets save]', e)
        setSheetsConnectionError(e?.message || String(e))
      })
    },
    [persistAppStateNow]
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
      const snap = latestAppStateRef.current
      if (isDriveLayoutConfigured()) {
        snap.bills
          .filter((b) => b.company_id === id)
          .forEach((b) => {
            void removeBillSheetFromDrive(b).catch((e) =>
              console.error('[Drive] delete company bill tabs', e)
            )
          })
      }
      const nextCompanies = snap.companies.filter((c) => c.id !== id)
      const nextClients = snap.clients.filter((c) => c.company_id !== id)
      const nextBills = snap.bills.filter((b) => b.company_id !== id)
      saveGenerationRef.current += 1
      setCompanies(nextCompanies)
      setClients(nextClients)
      setBills(nextBills)
      void persistAppStateNow(
        { companies: nextCompanies, clients: nextClients, bills: nextBills },
        { force: true }
      ).catch((e) => {
        console.error('[Google Sheets save]', e)
        setSheetsConnectionError(e?.message || String(e))
      })
    },
    [persistAppStateNow]
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
