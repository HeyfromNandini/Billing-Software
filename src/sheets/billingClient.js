import { billingApiSecretHeaders, billingApiUrl } from './config'
import { fetchBillingBackend } from './billingBackendFetch'
import { parseBillingApiJson } from './billingApiResponse'

export async function readBillingResponse(res, label) {
  const text = await res.text()
  if (!String(text ?? '').trim()) {
    throw new Error(
      `${label}: empty response (HTTP ${res.status} ${res.statusText || ''}). ` +
        `URL: ${res.url || '(unknown)'} — is the billing API running on the same port Vite proxies to? ` +
        `Try http://localhost:8787/api/billing/health in the browser.`
    )
  }
  const json = parseBillingApiJson(text, label)
  if (!res.ok) {
    throw new Error(json.error || `${label}: HTTP ${res.status}`)
  }
  if (json && json.ok === false) {
    throw new Error(json.error || `${label} failed`)
  }
  return json
}

function secretHeaders() {
  return billingApiSecretHeaders()
}

export async function billingGet(path, label) {
  const url = billingApiUrl(path)
  const res = await fetchBillingBackend(
    url,
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store',
        Pragma: 'no-cache',
        ...secretHeaders(),
      },
    },
    label
  )
  return readBillingResponse(res, label)
}

/** @param {string} path */
export async function billingPostJson(path, body, label) {
  const url = billingApiUrl(path)
  const res = await fetchBillingBackend(
    url,
    {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store',
        Pragma: 'no-cache',
        ...secretHeaders(),
      },
      body: JSON.stringify(body),
    },
    label
  )
  return readBillingResponse(res, label)
}
