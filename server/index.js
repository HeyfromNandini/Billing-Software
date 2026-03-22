import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { existsSync } from 'fs'
import {
  readAppData,
  saveAppData,
  handleRpc,
  getSpreadsheetMeta,
  readBillSheet,
} from './googleHandlers.js'

dotenv.config({ path: '.env' })
if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local', override: true })
}

const PORT = Number(process.env.BILLING_API_PORT || process.env.PORT || 8787)
const app = express()

function noStoreJson(res, fn) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.set('Pragma', 'no-cache')
  fn()
}

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-billing-api-secret'],
  })
)

function billingSecretOk(req) {
  const secret = process.env.BILLING_API_SECRET?.trim()
  if (!secret) return true
  return req.headers['x-billing-api-secret'] === secret
}

function requireBillingSecret(req, res, next) {
  if (!billingSecretOk(req)) {
    noStoreJson(res, () =>
      res.status(401).json({ ok: false, error: 'Unauthorized (BILLING_API_SECRET)' })
    )
    return
  }
  next()
}

const jsonBody = express.json({ limit: '32mb' })

app.get('/api/billing/health', (_req, res) => {
  noStoreJson(res, () => res.json({ ok: true, service: 'billing-google-api' }))
})

app.get('/api/billing/app-data', requireBillingSecret, async (_req, res) => {
  try {
    const data = await readAppData()
    noStoreJson(res, () => res.json(data))
  } catch (e) {
    console.error('[billing-api] GET app-data', e)
    noStoreJson(res, () =>
      res.status(500).json({
        ok: false,
        error: e?.message || String(e),
      })
    )
  }
})

app.post('/api/billing/app-data', requireBillingSecret, jsonBody, async (req, res) => {
  try {
    const out = await saveAppData(req.body || {})
    noStoreJson(res, () => res.json(out))
  } catch (e) {
    console.error('[billing-api] POST app-data', e)
    noStoreJson(res, () =>
      res.status(500).json({
        ok: false,
        error: e?.message || String(e),
      })
    )
  }
})

app.post('/api/billing/rpc', requireBillingSecret, jsonBody, async (req, res) => {
  try {
    const body = { ...(req.body || {}) }
    const action = body.__billingAction
    delete body.__billingAction
    if (!action) {
      noStoreJson(res, () => res.status(400).json({ ok: false, error: 'missing __billingAction' }))
      return
    }
    const out = await handleRpc(action, body)
    const status = out.ok === false ? 400 : 200
    noStoreJson(res, () => res.status(status).json(out))
  } catch (e) {
    console.error('[billing-api] rpc', e)
    noStoreJson(res, () => res.status(500).json({ ok: false, error: e?.message || String(e) }))
  }
})

app.get('/api/billing/drive/spreadsheet-meta', requireBillingSecret, async (req, res) => {
  try {
    const out = await getSpreadsheetMeta({ spreadsheetId: req.query.spreadsheetId })
    const status = out.ok === false ? 400 : 200
    noStoreJson(res, () => res.status(status).json(out))
  } catch (e) {
    console.error('[billing-api] meta', e)
    noStoreJson(res, () => res.status(500).json({ ok: false, error: e?.message || String(e) }))
  }
})

app.get('/api/billing/drive/bill-sheet', requireBillingSecret, async (req, res) => {
  try {
    const out = await readBillSheet({
      spreadsheetId: req.query.spreadsheetId,
      sheetName: req.query.sheetName,
    })
    noStoreJson(res, () => res.status(200).json(out))
  } catch (e) {
    console.error('[billing-api] read bill', e)
    noStoreJson(res, () =>
      res.status(500).json({ ok: false, error: e?.message || String(e), values: [] })
    )
  }
})

app.listen(PORT, () => {
  console.log(`[billing-api] http://localhost:${PORT}  (master sheet + Drive via service account)`)
})
