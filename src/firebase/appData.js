import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { getFirestoreDb } from './config'

const COLLECTION = 'billingAppData'
const DOC_ID = 'main'

function docRef() {
  const db = getFirestoreDb()
  if (!db) return null
  return doc(db, COLLECTION, DOC_ID)
}

/**
 * Subscribe to the single app document. If it does not exist, creates it from getInitial().
 * @param {(data: { companies: any[], clients: any[], bills: any[] }) => void} onData
 * @param {(err: Error) => void} [onError]
 * @param {() => { companies: any[], clients: any[], bills: any[] }} getInitial - used only when the Firestore doc is missing
 */
export function subscribeAppData(onData, onError, getInitial) {
  const ref = docRef()
  if (!ref) return () => {}

  return onSnapshot(
    ref,
    async (snap) => {
      try {
        if (!snap.exists()) {
          const initial = getInitial()
          await setDoc(ref, {
            companies: initial.companies,
            clients: initial.clients,
            bills: initial.bills,
          })
          return
        }
        const d = snap.data()
        onData({
          companies: Array.isArray(d.companies) ? d.companies : [],
          clients: Array.isArray(d.clients) ? d.clients : [],
          bills: Array.isArray(d.bills) ? d.bills : [],
        })
      } catch (e) {
        onError?.(e)
      }
    },
    (err) => onError?.(err)
  )
}

export async function saveAppDataToFirestore({ companies, clients, bills }) {
  const ref = docRef()
  if (!ref) return
  await setDoc(ref, { companies, clients, bills })
}
