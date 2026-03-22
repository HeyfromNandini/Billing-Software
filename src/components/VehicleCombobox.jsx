import { useState, useEffect, useRef, useId, useMemo } from 'react'
import { VEHICLE_NUMBERS } from '../data/vehicleNumbers'
import { getOptionSuggestions } from '../utils/fuzzyOptionSuggest'

/**
 * Fuzzy-suggest text field: pick from `options` (default: fleet) or type any value; Enter selects highlight.
 */
export default function VehicleCombobox({
  value,
  onChange,
  options,
  placeholder = 'Search or select vehicle…',
  id: idProp,
  className = '',
  inputClassName = '',
  disabled = false,
  'aria-label': ariaLabel = 'Vehicle number',
}) {
  const uid = useId()
  const listId = `${uid}-list`
  const inputId = idProp ?? `${uid}-input`
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const blurTimer = useRef(null)

  const optionList = options ?? VEHICLE_NUMBERS
  const suggestions = useMemo(
    () => getOptionSuggestions(optionList, value ?? ''),
    [optionList, value]
  )

  useEffect(() => {
    setHighlight(0)
  }, [value, suggestions.length])

  const clearBlurTimer = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current)
      blurTimer.current = null
    }
  }

  const selectVehicle = (v) => {
    clearBlurTimer()
    onChange(v)
    setOpen(false)
  }

  const handleFocus = () => {
    clearBlurTimer()
    setOpen(true)
  }

  const handleBlur = () => {
    blurTimer.current = setTimeout(() => setOpen(false), 180)
  }

  const handleKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      e.preventDefault()
      return
    }
    if (!open || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = suggestions[highlight]
      if (pick) selectVehicle(pick)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const handleChange = (e) => {
    onChange(e.target.value)
    setOpen(true)
  }

  return (
    <div className={`vehicle-combobox ${className}`.trim()}>
      <input
        id={inputId}
        type="text"
        className={inputClassName}
        value={value ?? ''}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
      />
      {open && suggestions.length > 0 ? (
        <ul id={listId} className="vehicle-combobox-list" role="listbox">
          {suggestions.map((v, i) => (
            <li
              key={v}
              role="option"
              aria-selected={i === highlight}
              className={`vehicle-combobox-option${i === highlight ? ' is-highlighted' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(ev) => {
                ev.preventDefault()
                selectVehicle(v)
              }}
            >
              {v}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
