import { getOptionSuggestions } from '../utils/fuzzyOptionSuggest'

/** Fleet list for searchable vehicle field (add/edit entry). */
export const VEHICLE_NUMBERS = [
  'MH46BB5966',
  'MH46BB5964',
  'MH02ER6045',
  'MH46BU5188',
  'MH46AF2918',
  'NL01AD8312',
]

export function getVehicleSuggestions(query) {
  return getOptionSuggestions(VEHICLE_NUMBERS, query)
}
