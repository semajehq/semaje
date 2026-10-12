// Host page: Chromium offscreen document, or the fallback host window (Safari).
import { ext } from '../lib/ext.js'
import { createHost } from '../lib/host-core.js'

const status = document.getElementById('status')
const host = createHost({
  send: msg => {
    if (status && msg.state) status.textContent = `${msg.sessionId}: ${msg.state}${msg.detail ? ` (${msg.detail})` : ''}`
    ext.runtime.sendMessage(msg).catch(() => {})
  },
})

// Only the offscreen document or the fallback window may act as the host; any
// other copy of this page (opened by hand) must not double-capture audio.
const mode = new URLSearchParams(location.search).get('mode')
const IS_HOST = mode === 'offscreen' || mode === 'window'

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'host' || !IS_HOST) return undefined
  Promise.resolve(host.handle(msg)).then(result => sendResponse(result ?? true))
  return true
})

// The fallback host window (not the offscreen document) closes itself once idle.
if (mode === 'window') {
  setInterval(() => { if (!host.isBusy()) window.close() }, 60_000)
}
