export const BILLING_API_JSON_HELP = [
  'Expected JSON from the billing API. If you see HTML, the request hit the wrong server or path.',
  'Run npm run dev (starts Vite + the billing API). Open the app on the URL Vite prints (e.g. http://localhost:5173).',
  'Optional: set VITE_BILLING_API_BASE to your API origin if the UI is not served with /api/billing proxied.',
].join('\n')

/**
 * Parse billing API response body (always JSON from our Express server).
 * @param {string} text
 * @param {string} contextLabel
 * @returns {object}
 */
export function parseBillingApiJson(text, contextLabel) {
  const t = String(text ?? '').trim()
  if (!t) {
    throw new Error(`${contextLabel}: empty response.\n\n${BILLING_API_JSON_HELP}`)
  }
  if (t.startsWith('<!DOCTYPE') || t.startsWith('<html')) {
    throw new Error(
      `${contextLabel}: server returned HTML instead of JSON.\n\n${BILLING_API_JSON_HELP}`
    )
  }
  const trimmed = t.replace(/^\)\]\}'\s*/, '')
  let json
  try {
    json = JSON.parse(trimmed)
  } catch {
    throw new Error(
      `${contextLabel}: response is not JSON.\n\n${BILLING_API_JSON_HELP}\n\nFirst 280 characters:\n${t.slice(0, 280)}`
    )
  }
  return json
}
