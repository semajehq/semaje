// Searchable language picker used by the popup and options pages.
import { searchLanguages, findLanguage, describeRouting } from './languages.js'

export function mountLanguagePicker({ input, results, hint, languages, value, onChange, disabled = false }) {
  let current = value || ''
  const show = q => {
    const hits = searchLanguages(languages, q, 40)
    results.innerHTML = ''
    const auto = document.createElement('button')
    auto.type = 'button'
    auto.innerHTML = '<span>Auto-detect</span><span class="muted mono">auto</span>'
    auto.addEventListener('mousedown', () => pick(''))
    results.appendChild(auto)
    for (const lang of hits) {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'option')
      b.setAttribute('aria-selected', String(lang.code === current))
      const name = document.createElement('span')
      name.textContent = lang.name
      const meta = document.createElement('span')
      meta.className = 'muted mono'
      meta.textContent = `${lang.code}${lang.tts?.voices ? ' · voice' : ''}`
      b.append(name, meta)
      b.addEventListener('mousedown', () => pick(lang.code))
      results.appendChild(b)
    }
    results.hidden = false
  }
  const render = () => {
    const lang = findLanguage(languages, current)
    input.value = lang ? `${lang.name} (${lang.code})` : ''
    input.placeholder = `Auto-detect · search ${languages.length.toLocaleString()} languages`
    if (hint) hint.textContent = lang ? `Recognized by ${describeRouting(lang)}${lang.tts?.voices ? ' · read-aloud available' : ''}` : 'Auto-detect: the server identifies the language.'
  }
  const pick = code => {
    current = code
    results.hidden = true
    render()
    onChange(code)
  }
  input.disabled = disabled
  input.addEventListener('focus', () => { input.select(); show('') })
  input.addEventListener('input', () => show(input.value))
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; render() }, 150))
  results.hidden = true
  render()
  return { set: code => { current = code; render() } }
}
