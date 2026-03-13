import { DEFAULT_ROUTE } from './sampleEntries'
import { SAMPLE_ENTRIES } from './sampleEntries'

/** My companies (3 fixed – for which you make bills). Shown in navbar. */
export const MY_COMPANIES = [
  { id: 'aadarsh', company_name: 'Aadarsh Logistics', address: '', pan_number: '', phone_1: '', phone_2: '' },
  { id: 'deva', company_name: 'Deva Lifters', address: '', pan_number: '', phone_1: '', phone_2: '' },
  {
    id: 'sangita',
    company_name: 'Sangita Logistics',
    address: 'Balaji Crest, Flat No. 1304, Plot No. 57, Sector 17, Roadpali, Kalamboli, Navi Mumbai – 410218',
    pan_number: 'DRBPS5123R',
    phone_1: '8652082121',
    phone_2: '9702082121',
  },
]

/** Default rate rule per bill: variable with base 27.273 ton → ₹7500; above that, full weight × ₹275/ton. */
const DEFAULT_BILL_RATE_RULE = {
  rate_type: 'variable',
  rate_fixed: 7500,
  rate_base_weight: 27.273,
  rate_base_amount: 7500,
  rate_extra_per_ton: 275,
}

/** Companies I work with (clients) – under each my company. custom_columns = extra bill table columns only for this client's bills. */
export const DEFAULT_CLIENTS = [
  {
    id: 'client-1',
    company_id: 'sangita',
    client_name: 'Calcutta Carriers',
    location: 'Kalamboli',
    custom_columns: [],
  },
]

/** Sample bill (Sangita-style format) for Calcutta Carriers. Rate rules are per bill. */
export const DEFAULT_BILL = {
  id: 'bill-1',
  company_id: 'sangita',
  client_id: 'client-1',
  bill_number: '146',
  bill_date: '05.02.2026',
  client_name: 'Calcutta Carriers',
  client_location: 'Kalamboli',
  route_from: DEFAULT_ROUTE.from,
  route_to: DEFAULT_ROUTE.to,
  entries: SAMPLE_ENTRIES.map((e, i) => ({ ...e, id: i + 1 })),
  ...DEFAULT_BILL_RATE_RULE,
}

export const STORAGE_KEY = 'billing-app-data'
