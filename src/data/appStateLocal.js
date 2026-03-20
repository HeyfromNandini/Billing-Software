import { MY_COMPANIES, DEFAULT_CLIENTS, DEFAULT_BILL, STORAGE_KEY } from './seedData'

function normalizeClientRow(c) {
  return {
    ...c,
    custom_columns: (Array.isArray(c.custom_columns) ? c.custom_columns : []).map((col, j) => ({
      ...col,
      order: typeof col.order === 'number' ? col.order : j + 1,
    })),
  }
}

/**
 * Returns parsed app state from localStorage only if the blob looks valid (not defaults).
 * Used to recover clients/bills into Firestore without inventing data when nothing is stored.
 */
export function tryLoadAppStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (
      Array.isArray(data.companies) &&
      Array.isArray(data.clients) &&
      Array.isArray(data.bills) &&
      data.companies.length >= 1
    ) {
      const companies = data.companies.map((c) => ({ ...c }))
      const clients = (data.clients || []).map(normalizeClientRow)
      return {
        companies,
        clients,
        bills: data.bills,
      }
    }
  } catch (_) {}
  return null
}

export function loadAppStateFromLocalStorage() {
  return (
    tryLoadAppStateFromLocalStorage() ?? {
      companies: MY_COMPANIES,
      clients: DEFAULT_CLIENTS,
      bills: [DEFAULT_BILL],
    }
  )
}

/**
 * If Firestore has no clients and no bills but this browser still has real data in
 * localStorage, copy clients + bills from local so a half-migrated cloud doc is repaired.
 */
export function mergeLocalClientsAndBillsIfFirestoreEmpty(firestoreData) {
  const fc = Array.isArray(firestoreData?.clients) ? firestoreData.clients : []
  const fb = Array.isArray(firestoreData?.bills) ? firestoreData.bills : []
  if (fc.length > 0 || fb.length > 0) return firestoreData

  const local = tryLoadAppStateFromLocalStorage()
  if (!local) return firestoreData

  return {
    ...firestoreData,
    clients: local.clients,
    bills: local.bills,
  }
}

export function saveAppStateToLocalStorage(companies, clients, bills) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ companies, clients, bills }))
  } catch (_) {}
}
