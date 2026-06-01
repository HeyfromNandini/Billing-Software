/** Bill table column order: custom columns at `order` 1–11 sit before that fixed column; order 12 is after Balance. */
export function buildColumnLayout(customColumns) {
  const layout = []
  for (let pos = 1; pos <= 11; pos++) {
    const customsAtPos = (customColumns || []).filter((c) => (Number(c.order) || 12) === pos)
    customsAtPos.forEach((col) => layout.push({ type: 'custom', col }))
    layout.push({ type: 'fixed', index: pos })
  }
  const customsAt12 = (customColumns || []).filter((c) => (Number(c.order) || 12) === 12)
  customsAt12.forEach((col) => layout.push({ type: 'custom', col }))
  layout.push({ type: 'action' })
  return layout
}

export function buildPdfColumnLayout(customColumns) {
  return buildColumnLayout(customColumns).filter((item) => item.type !== 'action')
}
