import { parseBillFromSheetValues } from '../sheets/billSheetRows'

/** Sheet dates are often dd.mm.yyyy; `<input type="date">` needs yyyy-mm-dd. */
function normalizeImportDate(s) {
  const t = String(s ?? '').trim()
  if (!t) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (!m) return t
  const d = m[1].padStart(2, '0')
  const mo = m[2].padStart(2, '0')
  let y = m[3]
  if (y.length === 2) y = `20${y}`
  return `${y}-${mo}-${d}`
}

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === '"') {
      inQ = !inQ
      continue
    }
    if (!inQ && c === ',') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur.trim())
  return out
}

/** Split pasted / exported text into a 2D grid (CSV or tab). */
export function textToGrid(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd())
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0)
  if (nonEmpty.length === 0) return []

  const tabCount = (nonEmpty[0].match(/\t/g) || []).length
  const commaCount = (nonEmpty[0].match(/,/g) || []).length
  const useTab = tabCount > commaCount

  return nonEmpty.map((l) =>
    useTab ? l.split('\t').map((c) => c.trim()) : parseCsvLine(l)
  )
}

function stripUndefined(obj) {
  const o = { ...obj }
  Object.keys(o).forEach((k) => {
    if (o[k] === undefined) delete o[k]
  })
  return o
}

/**
 * @param {string[][]} values — rows like Google Sheet / CSV
 * @param {object} client — for custom column headers
 * @returns {{ ok: true, bill: object, rowCount: number, warnings: string[] } | { ok: false, error: string }}
 */
export function importBillFromGrid(values, client) {
  if (!values?.length) {
    return { ok: false, error: 'No rows found.' }
  }
  const parsed = parseBillFromSheetValues(values, client)
  if (!parsed?.billPatch) {
    return {
      ok: false,
      error:
        'Could not find a transport table header. Include a row with “Sr. no” (or “Sr no”) and columns like Date, Vehicle No, Weight, Rate — same as the app table.',
    }
  }
  const { billPatch } = parsed
  const entries = (billPatch.entries || []).map((e, i) => ({
    ...e,
    id: `import-${Date.now()}-${i}`,
    date: normalizeImportDate(e.date),
  }))

  const bill = stripUndefined({
    entries,
    bill_date: billPatch.bill_date,
    client_name: billPatch.client_name,
    client_location: billPatch.client_location,
    route_from: billPatch.route_from,
    route_to: billPatch.route_to,
    rate_type: billPatch.rate_type,
    rate_fixed: billPatch.rate_fixed,
    rate_base_weight: billPatch.rate_base_weight,
    rate_base_amount: billPatch.rate_base_amount,
    rate_extra_per_ton: billPatch.rate_extra_per_ton,
  })

  const warnings = []
  if (entries.length === 0) {
    warnings.push('No data rows under the header — bill was created with an empty table.')
  }

  return { ok: true, bill, rowCount: entries.length, warnings }
}

export function importBillFromText(text, client) {
  return importBillFromGrid(textToGrid(text), client)
}

async function gridFromXlsx(file) {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const name = wb.SheetNames[0]
  if (!name) return []
  const sheet = wb.Sheets[name]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }).map((row) => {
    if (!Array.isArray(row)) return []
    return row.map((c) => (c == null ? '' : String(c)))
  })
}

/** Heuristic: PDF text lines → rows of cells (split on 2+ spaces). */
function linesToGrid(lines) {
  return lines
    .map((line) => line.split(/\s{2,}|\t+/).map((c) => c.trim()))
    .filter((row) => row.some((c) => c.length > 0))
}

async function pdfFileToLines(file) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const allLines = []

  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items = content.items.filter((it) => it.str && String(it.str).trim())

    const positioned = items.map((it) => ({
      str: String(it.str),
      x: it.transform[4],
      y: it.transform[5],
    }))
    positioned.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 4) return b.y - a.y
      return a.x - b.x
    })

    let row = []
    let y0 = null
    for (const it of positioned) {
      if (y0 != null && Math.abs(it.y - y0) > 4) {
        const line = row.join(' ').replace(/\s+/g, ' ').trim()
        if (line) allLines.push(line)
        row = []
      }
      row.push(it.str)
      y0 = it.y
    }
    if (row.length) {
      const line = row.join(' ').replace(/\s+/g, ' ').trim()
      if (line) allLines.push(line)
    }
  }

  return allLines
}

/**
 * @param {File} file
 * @param {object} client
 */
export async function importBillFromFile(file, client) {
  const name = (file.name || '').toLowerCase()

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const grid = await gridFromXlsx(file)
    return importBillFromGrid(grid, client)
  }

  if (name.endsWith('.pdf')) {
    try {
      const lines = await pdfFileToLines(file)
      const grid = linesToGrid(lines)
      const result = importBillFromGrid(grid, client)
      if (!result.ok) {
        return {
          ok: false,
          error:
            `${result.error} PDF layout is often messy — try exporting the table to Excel/CSV or copy the sheet from Google Sheets and paste below.`,
        }
      }
      return {
        ...result,
        warnings: [
          ...(result.warnings || []),
          'Imported from PDF (best effort). Check every row — spacing may be wrong.',
        ],
      }
    } catch (e) {
      return {
        ok: false,
        error: `Could not read PDF: ${e?.message || String(e)}`,
      }
    }
  }

  const text = await file.text()
  return importBillFromText(text, client)
}
