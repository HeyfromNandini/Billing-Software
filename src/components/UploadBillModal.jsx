import { useState, useRef } from 'react'
import { importBillFromFile, importBillFromText } from '../utils/billImport'

export default function UploadBillModal({ isOpen, client, onClose, onImported }) {
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const fileRef = useRef(null)

  const resetState = () => {
    setError(null)
    setPreview(null)
    setBusy(false)
  }

  const handleClose = () => {
    resetState()
    setPaste('')
    if (fileRef.current) fileRef.current.value = ''
    onClose()
  }

  const runImport = async (fn) => {
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const result = await fn()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPreview(result)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    void runImport(() => importBillFromFile(file, client))
  }

  const handlePastePreview = () => {
    void runImport(async () => importBillFromText(paste, client))
  }

  const handleCreate = () => {
    if (!preview?.ok || !preview.bill) return
    onImported(preview.bill)
    handleClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal" aria-hidden="false" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={handleClose} aria-hidden="true" />
      <div className="modal-box modal-box-wide upload-bill-modal">
        <h3 className="modal-title">Upload bill</h3>
        <p className="upload-bill-intro text-muted">
          Use a file or paste from Google Sheets / Excel. The table must include a header row with{' '}
          <strong>Sr. no</strong>, <strong>Date</strong>, <strong>Vehicle No</strong>, and the same columns as in
          the app (Weight, Rate, …). Exported company sheets with <code>__BILL_SYNC_V3__</code> work as-is.
        </p>

        <div className="upload-bill-actions">
          <label className="btn btn-secondary upload-bill-file-label">
            {busy ? 'Reading…' : 'Choose file'}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
              onChange={handleFile}
              disabled={busy}
              className="upload-bill-file-input"
            />
          </label>
          <span className="text-muted upload-bill-hint">CSV, TSV, Excel (.xlsx), or PDF (best effort)</span>
        </div>

        <div className="upload-bill-paste-block">
          <label className="upload-bill-paste-label" htmlFor="upload-bill-paste">
            Or paste copied rows
          </label>
          <textarea
            id="upload-bill-paste"
            className="upload-bill-paste"
            rows={6}
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value)
              setPreview(null)
              setError(null)
            }}
            placeholder="Paste from Sheets (Ctrl+V) — include header row"
            disabled={busy}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handlePastePreview}
            disabled={busy || !paste.trim()}
          >
            Preview paste
          </button>
        </div>

        {error ? (
          <div className="upload-bill-error" role="alert">
            {error}
          </div>
        ) : null}

        {preview?.ok ? (
          <div className="upload-bill-preview">
            <p>
              <strong>{preview.rowCount}</strong> trip{preview.rowCount === 1 ? '' : 's'} found
              {preview.bill.bill_date ? (
                <>
                  {' '}
                  · date <strong>{preview.bill.bill_date}</strong>
                </>
              ) : null}
              .
            </p>
            {(preview.warnings || []).map((w) => (
              <p key={w} className="upload-bill-warn">
                {w}
              </p>
            ))}
          </div>
        ) : null}

        <div className="form-actions upload-bill-form-actions">
          <button type="button" className="btn btn-secondary btn-cancel" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!preview?.ok || busy}
          >
            Create bill
          </button>
        </div>
      </div>
    </div>
  )
}
