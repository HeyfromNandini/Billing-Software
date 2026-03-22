function normalize(s) {
  return String(s).toUpperCase().replace(/\s+/g, '')
}

function isSubsequence(needle, hay) {
  let i = 0
  for (let j = 0; j < hay.length && i < needle.length; j += 1) {
    if (hay[j] === needle[i]) i += 1
  }
  return i === needle.length
}

/**
 * Rank strings in `options` for a typed query: exact > prefix > substring > subsequence.
 * Empty query returns all options in original order.
 */
export function getOptionSuggestions(options, query) {
  const list = Array.isArray(options) ? options : []
  const q = normalize(query)
  if (!q) return [...list]

  const scored = []
  for (const raw of list) {
    const n = normalize(raw)
    if (n === q) {
      scored.push({ raw, score: 4000 })
      continue
    }
    if (n.startsWith(q)) {
      scored.push({ raw, score: 3000 - n.length })
      continue
    }
    const idx = n.indexOf(q)
    if (idx !== -1) {
      scored.push({ raw, score: 2000 - idx * 10 - n.length * 0.01 })
      continue
    }
    if (isSubsequence(q, n)) {
      scored.push({ raw, score: 1000 - n.length * 0.01 })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.raw)
}
