import { ext } from '../lib/ext.js'
import { MSG } from '../lib/protocol.js'
import { loadConfig, saveConfig } from '../lib/config.js'
import { createClient, friendlyError } from '../lib/api.js'
import { mountLanguagePicker } from '../lib/language-picker.js'

const $ = id => document.getElementById(id)
const msg = (text, kind = '') => { $('msg').textContent = text; $('msg').className = `status ${kind}` }
const isMac = navigator.platform.toUpperCase().includes('MAC')
if (!isMac) for (const [id, n] of [['key-dictate', 1], ['key-tab', 2], ['key-read', 3]]) $(id).textContent = `Ctrl+Shift+${n}`

async function action(name, extra = {}) {
  const res = await ext.runtime.sendMessage({ kind: MSG.UI_ACTION, action: name, ...extra })
  if (res?.error) throw new Error(res.error)
  renderSessions(res?.sessions || [])
  return res
}

function renderSessions(sessions) {
  $('stop').hidden = sessions.length === 0
  $('live-kind').textContent = sessions.map(s => s.kind).join(', ')
}

// sidePanel.open / sidebarAction.open only work synchronously inside the click
// handler (an await first loses the user gesture), so the window id is fetched
// up front.
let windowId = null
ext.windows?.getCurrent().then(w => { windowId = w.id }).catch(() => {})

function openPanel() {
  if (ext.sidePanel?.open && windowId != null) return ext.sidePanel.open({ windowId })
  if (ext.sidebarAction?.open) return ext.sidebarAction.open()
  return ext.tabs.create({ url: ext.runtime.getURL('src/panel/panel.html') })
}

for (const [id, name] of [['dictate', 'dictate'], ['tab', 'tab'], ['speak', 'speak-selection'], ['stop', 'stop']]) {
  $(id).addEventListener('click', async () => {
    try {
      await action(name)
      if (name !== 'stop' && name !== 'speak-selection') window.close()
      else msg(name === 'stop' ? 'Stopped.' : 'Reading…', 'ok')
    } catch (err) { msg(err.message, 'error') }
  })
}
// File pickers close Firefox popups, so files are handled in the panel.
for (const id of ['file', 'library']) {
  $(id).addEventListener('click', () => {
    Promise.resolve(openPanel()).finally(() => window.close())
  })
}
$('settings').addEventListener('click', () => ext.runtime.openOptionsPage())

const { config, locked } = await loadConfig()
const client = createClient({ apiBase: config.apiBase, apiKey: config.apiKey })
action('status').catch(() => {})

try {
  const languages = (await client.languages()).languages
  $('server-badge').textContent = 'connected'
  mountLanguagePicker({
    input: $('lang'), results: $('lang-results'), hint: $('lang-hint'), languages, value: config.language,
    disabled: locked.includes('language'), onChange: code => saveConfig({ language: code }),
  })
} catch (err) {
  $('server-badge').textContent = 'offline'
  $('server-badge').classList.add('live')
  $('lang').disabled = true
  msg(friendlyError(err), 'error')
}

ext.runtime.onMessage.addListener(m => {
  if (m?.target !== 'ui' || m.kind !== MSG.UI_STATUS) return
  if (m.sessions) renderSessions(m.sessions)
  if (m.tts === 'error') msg(m.detail || 'Read aloud failed.', 'error')
  if (m.tts === 'speaking') msg(`Speaking${m.detail ? ` · ${m.detail}` : ''}`, 'ok')
})
