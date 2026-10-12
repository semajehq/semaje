// Language search over the server's /api/languages list. Pure.
export function matchLanguage(lang, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  return lang.name.toLowerCase().includes(q)
    || lang.code.toLowerCase().startsWith(q)
    || lang.iso1 === q
    || lang.whisper === q
    || (lang.aliases || []).some(alias => alias.toLowerCase().includes(q))
}

/** Exact code/alias hits first, then name-prefix hits, then substring hits. */
export function searchLanguages(languages, query, limit = 50) {
  const q = String(query || '').trim().toLowerCase()
  const hits = languages.filter(lang => matchLanguage(lang, q))
  if (!q) return hits.slice(0, limit)
  const score = lang => {
    if (lang.code.toLowerCase() === q || lang.iso1 === q || lang.whisper === q) return 0
    if ((lang.aliases || []).some(a => a.toLowerCase() === q) || lang.name.toLowerCase() === q) return 1
    if (lang.name.toLowerCase().startsWith(q)) return 2
    return 3
  }
  return hits.map((lang, i) => [score(lang), i, lang]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, limit).map(([, , lang]) => lang)
}

export function findLanguage(languages, value) {
  if (!value) return null
  const v = String(value).toLowerCase()
  return languages.find(l => l.code.toLowerCase() === v || l.iso1 === v || l.whisper === v) || null
}

export function describeRouting(lang) {
  if (!lang) return 'Auto-detect'
  if (!lang.engines?.length) return 'Not available on this server'
  if (lang.engines.includes('whisper') && lang.whisperStrong) return 'Whisper'
  return lang.engines.includes('omnilingual') ? 'Omnilingual ASR' : 'Whisper'
}
