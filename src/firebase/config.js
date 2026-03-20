import { initializeApp, getApps } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

function getFirebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }
}

/** True when Vite env has the minimum fields needed for the web app + Firestore. */
export function isFirebaseConfigured() {
  const c = getFirebaseConfig()
  return Boolean(c.apiKey && c.projectId && c.appId)
}

let dbInstance = null

export function getFirestoreDb() {
  if (!isFirebaseConfigured()) return null
  if (!dbInstance) {
    const config = getFirebaseConfig()
    const app = getApps().length ? getApps()[0] : initializeApp(config)
    dbInstance = getFirestore(app)
  }
  return dbInstance
}
