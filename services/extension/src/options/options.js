import { ext } from '../lib/ext.js'
import { MSG } from '../lib/protocol.js'
import { loadConfig, saveConfig, originPattern, normalizeBase } from '../lib/config.js'
import { createClient, friendlyError } from '../lib/api.js'
import { mountLanguagePicker } from '../lib/language-picker.js'

const $ = id => document.getElementById(id)
const status = (id, text, kind = '') => { $(id).textContent = text; $(id).className = `status ${kind}` }
if (new URLSearchParams(location.search).has('welcome')) $('welcome').hidden = false

let state = await loadConfig()
let picker = null

function fill() {
  const { config, locked, managed } = state
  $('policy').hidden = !managed
  for (const key of ['apiBase', 'apiKey', 'engine', 'ttsSpeed']) $(key).value = config[key]
  $('saveDictation').value = String(config.saveDictation)
  $('captions').value = String(config.captions)
  $('speed-value').textContent = `${Number(config.ttsSpeed).toFixed(1)}×`
  for (const key of ['apiBase', 'apiKey', 'engine', 'saveDictation', 'captions', 'ttsVoice', 'ttsSpeed']) $(key).disabled = locked.includes(key)
  $('try').disabled = !config.allowTts
}

async function loadServerData() {
  const { config, locked } = state
  const client = createClient({ apiBase: config.apiBase, apiKey: config.apiKey })
  try {
    const [me, catalog] = await Promise.all([client.me(), client.languages()])
    status('server-status', `Connected to ${config.apiBase} · ${catalog.total.toLocaleString()} languages · ${catalog.withTts} with read-aloud voices${me?.principal?.via ? ` · auth: ${me.principal.via}` : ''}`, 'ok')
    picker = mountLanguagePicker({
      input: $('lang'), results: $('lang-results'), hint: $('lang-hint'), languages: catalog.languages,
      value: config.language, disabled: locked.includes('language'),
      onChange: async code => { state = await saveConfig({ language: code }); loadVoices(client) },
    })
    loadVoices(client)
  } catch (err) {
    status('server-status', friendlyError(err), 'error')
  }
}

async function loadVoices(client) {
  const select = $('ttsVoice')
  const keep = state.config.ttsVoice
  select.length = 1
  try {
    const { voices } = await client.voices(state.config.language || undefined)
    for (const v of voices.slice(0, 200)) {
      const opt = document.createElement('option')
      opt.value = v.id
      opt.textContent = `${v.id} · ${v.engine}${v.noncommercial ? ' · non-commercial' : ''}`
      select.appendChild(opt)
    }
    select.value = voices.some(v => v.id === keep) ? keep : ''
  } catch { /* TTS optional */ }
}

$('save').addEventListener('click', async () => {
  try {
    const apiBase = normalizeBase($('apiBase').value)
    // Optional host permission must be requested from a user gesture.
    const granted = await ext.permissions.request({ origins: [originPattern(apiBase)] }).catch(() => true)
    if (!granted) return status('server-status', `semaje needs permission to reach ${apiBase}.`, 'error')
    state = await saveConfig({ apiBase, apiKey: $('apiKey').value.trim() })
    fill()
    status('server-status', 'Testing…')
    await loadServerData()
  } catch (err) { status('server-status', err.message, 'error') }
})

$('mic').addEventListener('click', () => ext.tabs.create({ url: ext.runtime.getURL('src/permissions/permissions.html?reason=microphone') }))
for (const key of ['engine', 'ttsVoice']) $(key).addEventListener('change', async () => { state = await saveConfig({ [key]: $(key).value }) })
for (const key of ['saveDictation', 'captions']) $(key).addEventListener('change', async () => { state = await saveConfig({ [key]: $(key).value === 'true' }) })
$('ttsSpeed').addEventListener('input', () => { $('speed-value').textContent = `${Number($('ttsSpeed').value).toFixed(1)}×` })
$('ttsSpeed').addEventListener('change', async () => { state = await saveConfig({ ttsSpeed: Number($('ttsSpeed').value) }) })
$('try').addEventListener('click', async () => {
  status('tts-status', 'Synthesizing…')
  const res = await ext.runtime.sendMessage({ kind: MSG.UI_ACTION, action: 'speak', text: $('sample').value })
  if (res?.error) status('tts-status', res.error, 'error')
})
ext.runtime.onMessage.addListener(m => {
  if (m?.target !== 'ui' || m.kind !== MSG.UI_STATUS || !m.tts) return
  if (m.tts === 'speaking') status('tts-status', `Speaking${m.detail ? ` with ${m.detail}` : ''}.`, 'ok')
  if (m.tts === 'error') status('tts-status', m.detail || 'Read aloud failed.', 'error')
})

fill()
loadServerData()
