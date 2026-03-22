export const BILLING_BACKEND_NETWORK_HELP = [
  '“Failed to fetch” usually means the billing API is not reachable from this page.',
  'Run npm run dev so both Vite and the API start; use http://localhost:5173 (not WebStorm’s :63342 preview).',
  'Confirm the API is up: open http://localhost:8787/api/billing/health in a browser (expect {"ok":true,...}).',
  'If the API uses another port, set BILLING_API_PORT in .env.local and match vite.config.js proxy (or set VITE_BILLING_API_BASE to the full API URL).',
].join('\n')

function isLikelyNetworkFetchFailure(err) {
  const m = err?.message || String(err)
  return (
    m === 'Failed to fetch' ||
    m.includes('NetworkError') ||
    m.includes('Load failed') ||
    err?.name === 'TypeError'
  )
}

export async function fetchBillingBackend(url, init, contextLabel) {
  try {
    return await fetch(url, init)
  } catch (e) {
    if (isLikelyNetworkFetchFailure(e)) {
      throw new Error(`${contextLabel}: Failed to fetch\n\n${BILLING_BACKEND_NETWORK_HELP}`)
    }
    throw e
  }
}
