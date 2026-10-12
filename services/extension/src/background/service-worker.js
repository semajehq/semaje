// Background orchestrator. Owns session lifecycle; never touches audio itself
// on Chromium/Safari (no DOM in service workers). On Firefox the background is
// a page with a DOM, so the capture host runs in-process.
import { ext } from '../lib/ext.js'
import { MSG } from '../lib/protocol.js'
import { loadConfig, originPattern } from '../lib/config.js'
import { createClient, friendlyError } from '../lib/api.js'
import { chooseCaptureHost, chooseTabStrategy } from '../lib/capture-host.js'

const HOST_PAGE = 'src/host/host.html'
const PERMISSIONS_PAGE = 'src/permissions/permissions.html'
const sessions = new Map()   // sessionId → { kind, tabId, text: [] }
let inProcessHost = null     // Firefox background page
let hostWindowId = null      // Safari/other fallback

const hostMode = chooseCaptureHost({
  hasOffscreen: Boolean(ext.offscreen?.createDocument),
  backgroundHasDom: typeof window !== 'undefined' && typeof document !== 'undefined' && Boolean(globalThis.navigator?.mediaDevices),
})
const tabStrategy = chooseTabStrategy({ hasTabCapture: Boolean(ext.tabCapture?.getMediaStreamId) })

// ── Host plumbing ─────────────────────────────────────────────
async function ensureHost() {
  if (hostMode === 'offscreen') {
    const has = await ext.offscreen.hasDocument?.()
    if (!has) {
      await ext.offscreen.createDocument({
        url: `${HOST_PAGE}?mode=offscreen`,
        reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
        justification: 'Capture microphone/tab audio for transcription and play synthesized speech.',
      })
    }
    return
  }
  if (hostMode === 'background') {
    if (!inProcessHost) {
      const { createHost } = await import('../lib/host-core.js')
      inProcessHost = createHost({ send: msg => onHostMessage(msg) })
    }
    return
  }
  // Fallback: a small extension window hosts capture.
  if (hostWindowId != null) {
    try { await ext.windows.get(hostWindowId); return } catch { hostWindowId = null }
  }
  const win = await ext.windows.create({ url: ext.runtime.getURL(`${HOST_PAGE}?mode=window`), type: 'popup', width: 360, height: 220, focused: false })
  hostWindowId = win.id
  await new Promise(resolve => setTimeout(resolve, 400))
}

async function toHost(msg) {
  await ensureHost()
  if (inProcessHost) return inProcessHost.handle(msg)
  return ext.runtime.sendMessage({ ...msg, target: 'host' }).catch(() => undefined)
}

function toTab(tabId, msg) {
  if (tabId != null) ext.tabs.sendMessage(tabId, msg).catch(() => {})
}

function broadcast(msg) {
  ext.runtime.sendMessage({ ...msg, target: 'ui' }).catch(() => {})
}

async function inject(tabId, files) {
  try {
    await ext.scripting.executeScript({ target: { tabId }, files })
    return true
  } catch {
    return false  // chrome://, the Web Store, PDF viewer, etc. cannot be scripted
  }
}

async function notify(title, message) {
  try {
    await ext.notifications?.create({ type: 'basic', iconUrl: ext.runtime.getURL('icons/icon-128.png'), title, message })
  } catch { /* notifications permission optional */ }
}

async function openPermissions(reason) {
  await ext.tabs.create({ url: ext.runtime.getURL(`${PERMISSIONS_PAGE}?reason=${encodeURIComponent(reason)}`) })
}

async function ensureServerAccess(config) {
  const origins = [originPattern(config.apiBase)]
  const granted = await ext.permissions.contains({ origins }).catch(() => true)
  if (!granted) {
    await openPermissions('server')
    throw new Error(`semaje needs permission to reach ${config.apiBase}.`)
  }
}

// ── Sessions ──────────────────────────────────────────────────
function newSessionId(kind) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function activeSession(kind, tabId) {
  for (const [id, s] of sessions) if (s.kind === kind && (tabId == null || s.tabId === tabId)) return id
  return null
}

async function startDictation(tabId) {
  const existing = activeSession('dictation')
  if (existing) return stopSession(existing)
  const { config } = await loadConfig()
  await ensureServerAccess(config)
  if (!(await inject(tabId, ['src/content/insert.js', 'src/content/widget.js']))) {
    return notify('semaje', 'Dictation is not available on this page.')
  }
  const sessionId = newSessionId('dictation')
  sessions.set(sessionId, { kind: 'dictation', tabId, text: [] })
  toTab(tabId, { kind: MSG.CS_STATE, sessionId, state: 'connecting', session: 'dictation' })
  await toHost({
    kind: MSG.HOST_START, sessionId, capture: 'mic', mode: 'dictation', apiBase: config.apiBase, apiKey: config.apiKey,
    language: config.language, title: config.saveDictation ? `Dictation · ${new Date().toLocaleString()}` : undefined,
  })
}

async function startTabTranscription(tab) {
  const existing = activeSession('tab', tab.id) || activeSession('media', tab.id)
  if (existing) return stopSession(existing)
  const { config } = await loadConfig()
  await ensureServerAccess(config)
  const title = `Tab · ${tab.title || new URL(tab.url || 'about:blank').hostname}`.slice(0, 280)
  if (config.captions) await inject(tab.id, ['src/content/captions.js'])

  if (tabStrategy === 'tab-capture') {
    let streamId
    try {
      streamId = await ext.tabCapture.getMediaStreamId({ targetTabId: tab.id })
    } catch (err) {
      return notify('semaje', `Cannot capture this tab: ${err.message}`)
    }
    const sessionId = newSessionId('tab')
    sessions.set(sessionId, { kind: 'tab', tabId: tab.id, text: [] })
    toTab(tab.id, { kind: MSG.CS_STATE, sessionId, state: 'connecting', session: 'tab' })
    return toHost({
      kind: MSG.HOST_START, sessionId, capture: 'tab', streamId, mode: 'meeting',
      apiBase: config.apiBase, apiKey: config.apiKey, language: config.language, title,
    })
  }

  // Firefox/Safari: tap the page's playing <video>/<audio> element.
  const sessionId = newSessionId('media')
  sessions.set(sessionId, { kind: 'media', tabId: tab.id, text: [] })
  await toHost({
    kind: MSG.HOST_START, sessionId, capture: 'push', mode: 'meeting', mimeType: 'audio/webm;codecs=opus',
    apiBase: config.apiBase, apiKey: config.apiKey, language: config.language, title,
  })
  if (!(await inject(tab.id, ['src/content/media-tap.js']))) {
    stopSession(sessionId)
    return notify('semaje', 'This page cannot be transcribed.')
  }
  toTab(tab.id, { kind: 'tap:start', sessionId })
}

async function stopSession(sessionId) {
  const s = sessions.get(sessionId)
  if (!s) return
  if (s.kind === 'media') toTab(s.tabId, { kind: 'tap:stop', sessionId })
  toTab(s.tabId, { kind: MSG.CS_STATE, sessionId, state: 'finishing', session: s.kind })
  await toHost({ kind: MSG.HOST_STOP, sessionId })
}

async function onHostMessage(msg) {
  const s = sessions.get(msg.sessionId)
  if (msg.kind === MSG.HOST_TEXT && s) {
    s.text.push(msg.text)
    toTab(s.tabId, { kind: MSG.CS_TEXT, sessionId: msg.sessionId, session: s.kind, text: msg.text })
  } else if (msg.kind === MSG.HOST_STATE) {
    if (msg.sessionId === 'tts') return broadcast({ kind: MSG.UI_STATUS, tts: msg.state, detail: msg.detail })
    if (msg.state === 'error' && msg.detail === 'permission-denied') {
      sessions.delete(msg.sessionId)
      toTab(s?.tabId, { kind: MSG.CS_STATE, sessionId: msg.sessionId, state: 'error', detail: 'Microphone access is needed.' })
      return openPermissions('microphone')
    }
    if (s) toTab(s.tabId, { kind: MSG.CS_STATE, sessionId: msg.sessionId, state: msg.state, detail: msg.detail, session: s.kind })
    if (msg.state === 'error') sessions.delete(msg.sessionId)
    broadcast({ kind: MSG.UI_STATUS, sessions: [...sessions.entries()].map(([id, v]) => ({ id, kind: v.kind })) })
  } else if (msg.kind === MSG.HOST_END && s) {
    sessions.delete(msg.sessionId)
    toTab(s.tabId, { kind: MSG.CS_STATE, sessionId: msg.sessionId, state: 'idle', session: s.kind, transcriptId: msg.transcriptId })
    if (msg.transcriptId && s.kind !== 'dictation') notify('semaje', 'Transcript saved to your library.')
    broadcast({ kind: MSG.UI_STATUS, sessions: [...sessions.entries()].map(([id, v]) => ({ id, kind: v.kind })), saved: msg.transcriptId })
  }
}

// ── Read aloud ────────────────────────────────────────────────
async function speak(text, languageOverride) {
  const { config } = await loadConfig()
  if (!config.allowTts) return notify('semaje', 'Read aloud is disabled by your administrator.')
  await ensureServerAccess(config)
  const clean = String(text || '').trim()
  if (!clean) return
  await toHost({
    kind: MSG.HOST_SPEAK, text: clean.slice(0, 5000), apiBase: config.apiBase, apiKey: config.apiKey,
    language: languageOverride || config.language || undefined, voice: config.ttsVoice || undefined, speed: config.ttsSpeed,
  })
}

// ── Transcribe media from the page / a link ───────────────────
async function transcribeUrl(srcUrl, tab) {
  if (!srcUrl || srcUrl.startsWith('blob:') || srcUrl.startsWith('mediastream:')) {
    return startTabTranscription(tab)  // streamed media: capture it live instead
  }
  const { config } = await loadConfig()
  await ensureServerAccess(config)
  const origin = new URL(srcUrl).origin
  const permitted = await ext.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false)
  if (!permitted) return openPermissions(`media:${origin}`)
  notify('semaje', 'Downloading media for transcription…')
  try {
    const res = await fetch(srcUrl)
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const blob = await res.blob()
    const name = decodeURIComponent(new URL(srcUrl).pathname.split('/').pop() || 'media') || 'media'
    const client = createClient({ apiBase: config.apiBase, apiKey: config.apiKey })
    const transcript = await client.transcribeFile(blob, name, { language: config.language, engine: config.engine })
    await ext.storage.local.set({ lastTranscriptId: transcript.id })
    notify('semaje', `Transcribed “${transcript.title}”. Open the semaje panel to read it.`)
  } catch (err) {
    notify('semaje', friendlyError(err))
  }
}

// ── Wiring ────────────────────────────────────────────────────
ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'host') return undefined  // addressed to the host page, not us
  if ([MSG.HOST_STATE, MSG.HOST_TEXT, MSG.HOST_END].includes(msg?.kind)) {
    onHostMessage(msg)
    return undefined
  }
  if (msg?.kind === MSG.DICTATION_TOGGLE && sender.tab?.id != null) {
    startDictation(sender.tab.id).catch(err => notify('semaje', err.message))
    return undefined
  }
  if (msg?.kind === MSG.TAP_CHUNK) {
    toHost({ kind: MSG.HOST_PUSH, sessionId: msg.sessionId, data: msg.data })
    return undefined
  }
  if (msg?.kind === MSG.TAP_STATE && msg.state === 'no-media') {
    stopSession(msg.sessionId)
    notify('semaje', 'No playing audio or video found on this page. Press play, then try again.')
    return undefined
  }
  if (msg?.kind === MSG.UI_ACTION) {
    handleUiAction(msg).then(sendResponse, err => sendResponse({ error: err.message }))
    return true  // async response
  }
  return undefined
})

async function handleUiAction(msg) {
  // Callers may name a tab (the library panel, tests); otherwise act on the active tab.
  const tab = msg.tabId != null ? await ext.tabs.get(msg.tabId) : (await ext.tabs.query({ active: true, currentWindow: true }))[0]
  switch (msg.action) {
    case 'dictate': if (tab?.id != null) await startDictation(tab.id); break
    case 'tab': if (tab?.id != null) await startTabTranscription(tab); break
    case 'speak-selection': {
      if (tab?.id == null) break
      const [result] = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() || '') }).catch(() => [])
      await speak(result?.result || '')
      break
    }
    case 'speak': await speak(msg.text, msg.language); break
    case 'stop-speaking': await toHost({ kind: MSG.HOST_SPEAK_STOP }); break
    case 'stop': for (const id of [...sessions.keys()]) await stopSession(id); break
    case 'status': break
    default: throw new Error(`Unknown action ${msg.action}`)
  }
  return { ok: true, hostMode, tabStrategy, sessions: [...sessions.entries()].map(([id, v]) => ({ id, kind: v.kind, tabId: v.tabId })) }
}

ext.commands?.onCommand.addListener(async (command, tabArg) => {
  const tab = tabArg || (await ext.tabs.query({ active: true, currentWindow: true }))[0]
  if (!tab?.id) return
  try {
    if (command === 'toggle-dictation') await startDictation(tab.id)
    else if (command === 'transcribe-tab') await startTabTranscription(tab)
    else if (command === 'read-selection') await handleUiAction({ action: 'speak-selection' })
  } catch (err) {
    notify('semaje', err.message)
  }
})

ext.contextMenus?.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'semaje-read') await speak(info.selectionText)
    else if (info.menuItemId === 'semaje-transcribe-media') await transcribeUrl(info.srcUrl || info.linkUrl, tab)
    else if (info.menuItemId === 'semaje-transcribe-tab') await startTabTranscription(tab)
    else if (info.menuItemId === 'semaje-dictate' && tab?.id != null) await startDictation(tab.id)
  } catch (err) {
    notify('semaje', err.message)
  }
})

ext.runtime.onInstalled.addListener(async details => {
  ext.contextMenus?.removeAll?.()
  ext.contextMenus?.create({ id: 'semaje-read', title: 'Read aloud with semaje', contexts: ['selection'] })
  ext.contextMenus?.create({ id: 'semaje-transcribe-media', title: 'Transcribe with semaje', contexts: ['audio', 'video', 'link'] })
  ext.contextMenus?.create({ id: 'semaje-transcribe-tab', title: 'Transcribe this tab live', contexts: ['page'] })
  ext.contextMenus?.create({ id: 'semaje-dictate', title: 'Dictate here', contexts: ['editable'] })
  if (details.reason === 'install') {
    const { managed } = await loadConfig()
    // Managed installs are pre-configured by IT; only prompt for the mic.
    await ext.tabs.create({ url: ext.runtime.getURL(managed ? `${PERMISSIONS_PAGE}?reason=microphone` : 'src/options/options.html?welcome=1') })
  }
})

// Chromium: toolbar opens the popup; the panel is opened from there.
ext.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {})

// Diagnostics hook (inspect the service worker console, or drive e2e tests).
globalThis.semajeDebug = {
  hostMode, tabStrategy, sessions,
  startDictation, startTabTranscription, speak,
  stopAll: () => Promise.all([...sessions.keys()].map(stopSession)),
}

console.info(`[semaje] background ready · host=${hostMode} · tab-audio=${tabStrategy}`)
