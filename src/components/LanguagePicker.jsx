import { useEffect, useMemo, useState } from 'react'
import { Languages } from 'lucide-react'
import { listLanguages } from '../utils/apiClient'

const ENGINES = [
  { id: 'auto', label: 'Auto', hint: 'Best engine per language' },
  { id: 'whisper', label: 'Whisper', hint: '99 languages, word timing' },
  { id: 'omnilingual', label: 'Omnilingual', hint: '1,600+ languages' },
]

function matches(lang, needle) {
  if (!needle) return true
  const n = needle.toLowerCase()
  return lang.name.toLowerCase().includes(n) || lang.code.toLowerCase().startsWith(n)
    || lang.iso1 === n || lang.whisper === n || (lang.aliases || []).some(a => a.toLowerCase().includes(n))
}

export default function LanguagePicker({ language, onLanguage, engine, onEngine, disabled }) {
  const [catalog, setCatalog] = useState(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    listLanguages().then(setCatalog).catch(err => setLoadError(err.message))
  }, [])

  const selected = useMemo(
    () => catalog?.languages.find(l => l.code === language || l.whisper === language || l.iso1 === language) || null,
    [catalog, language],
  )
  const results = useMemo(
    () => (catalog?.languages || []).filter(l => matches(l, query)).slice(0, 60),
    [catalog, query],
  )

  const routeLabel = selected
    ? (selected.engines.includes('whisper') && selected.whisperStrong ? 'Whisper' : selected.engines.includes('omnilingual') ? 'Omnilingual' : selected.engines[0] || 'unavailable')
    : 'auto-detect'

  return (
    <div className="language-picker">
      <div className="field-label flex items-center gap-2"><Languages size={13} /> Spoken language</div>
      <div className="flex flex-wrap gap-2 items-start">
        <div className="relative flex-1 min-w-[14rem]">
          <input
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            placeholder={catalog ? `Auto-detect, or search ${catalog.total.toLocaleString()} languages` : 'Loading languages...'}
            value={open ? query : (selected ? `${selected.name} · ${selected.code}` : '')}
            onFocus={() => { setOpen(true); setQuery('') }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={e => setQuery(e.target.value)}
            disabled={disabled || !catalog}
            aria-label="Spoken language"
            role="combobox"
            aria-expanded={open}
          />
          {open && catalog && (
            <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border text-sm shadow-lg"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} role="listbox">
              <li>
                <button type="button" className="w-full text-left px-3 py-2 hover:opacity-80"
                  onMouseDown={() => { onLanguage(''); setOpen(false) }}>
                  Auto-detect <span className="muted text-xs">(Whisper identifies the language)</span>
                </button>
              </li>
              {results.map(l => (
                <li key={l.code}>
                  <button type="button" className="w-full text-left px-3 py-2 flex justify-between gap-3 hover:opacity-80"
                    onMouseDown={() => { onLanguage(l.code); setOpen(false) }} role="option" aria-selected={l.code === language}>
                    <span>{l.name}</span>
                    <span className="muted text-xs font-mono">{l.code}{l.engines.length === 0 ? ' · no engine' : ''}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-3 py-2 muted">No language matches “{query}”.</li>}
            </ul>
          )}
        </div>
        <div className="flex gap-1" role="radiogroup" aria-label="Recognition engine">
          {ENGINES.map(e => (
            <button key={e.id} type="button" title={e.hint} disabled={disabled}
              onClick={() => onEngine(e.id)} role="radio" aria-checked={engine === e.id}
              className="px-3 py-2 rounded-lg text-xs font-mono border"
              style={{
                borderColor: engine === e.id ? 'var(--accent)' : 'var(--border)',
                color: engine === e.id ? 'var(--accent)' : 'var(--muted)',
                background: 'var(--surface)',
              }}>
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs muted mt-1">
        {loadError ? `Language list unavailable (${loadError}); auto-detect still works.`
          : engine === 'auto' ? `Routing: ${routeLabel}` : `Forced engine: ${engine}`}
      </p>
    </div>
  )
}
