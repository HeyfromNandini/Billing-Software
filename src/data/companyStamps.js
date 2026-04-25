/**
 * Company stamp images for bills / PDFs. Place files in `public/stamps/` (served from site root).
 * Paths must match real filenames (e.g. `.jpeg` vs `.png`).
 */
export const COMPANY_STAMP_SRC = {
  aadarsh: '/stamps/aadarsh.jpeg',
  deva: '/stamps/deva.jpeg',
  sangita: '/stamps/sangita.png',
}

/**
 * @param {string} [companyId]
 * @param {{ stamp_src?: string }} [company] — optional override: public URL under `public/` (e.g. `/stamps/my.png`)
 */
export function companyStampSrc(companyId, company) {
  if (company && typeof company.stamp_src === 'string') {
    const s = company.stamp_src.trim()
    if (s) return s.startsWith('/') ? s : `/${s}`
  }
  if (!companyId || typeof companyId !== 'string') return null
  return COMPANY_STAMP_SRC[companyId] ?? null
}

/**
 * Load stamp file as a data URL so html2canvas / html2pdf always paint it (remote img src often misses in PDF).
 */
export async function fetchStampDataUrlForPdf(stampPath) {
  if (!stampPath || typeof window === 'undefined') return null
  try {
    const abs = new URL(stampPath, window.location.href).href
    const res = await fetch(abs, { cache: 'force-cache' })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(fr.error)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
