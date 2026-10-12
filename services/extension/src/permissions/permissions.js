import { ext } from '../lib/ext.js'
import { loadConfig, originPattern } from '../lib/config.js'

const $ = id => document.getElementById(id)
const reason = new URLSearchParams(location.search).get('reason') || 'microphone'

function setStatus(id, text, kind = '') {
  $(id).textContent = text
  $(id).className = `status ${kind}`
}

$('mic').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop())
    setStatus('mic-status', 'Microphone allowed. You can start dictating.', 'ok')
  } catch (err) {
    setStatus('mic-status', err.name === 'NotAllowedError'
      ? 'Blocked. Click the camera/mic icon in the address bar, allow the microphone, then try again.'
      : `Microphone unavailable: ${err.message}`, 'error')
  }
})

const { config } = await loadConfig()
$('server').textContent = config.apiBase
const serverOrigin = originPattern(config.apiBase)
if (await ext.permissions.contains({ origins: [serverOrigin] }).catch(() => true)) {
  setStatus('server-status', 'Already allowed.', 'ok')
  $('grant-server').disabled = true
}
$('grant-server').addEventListener('click', async () => {
  const ok = await ext.permissions.request({ origins: [serverOrigin] }).catch(() => false)
  setStatus('server-status', ok ? 'Server access allowed.' : 'Not allowed. semaje cannot reach your server without it.', ok ? 'ok' : 'error')
})

if (reason.startsWith('media:')) {
  const origin = reason.slice('media:'.length)
  $('media-card').hidden = false
  $('media-origin').textContent = origin
  $('grant-media').addEventListener('click', async () => {
    const ok = await ext.permissions.request({ origins: [`${origin}/*`] }).catch(() => false)
    setStatus('media-status', ok ? 'Allowed. Right-click the media and choose “Transcribe with semaje” again.' : 'Not allowed.', ok ? 'ok' : 'error')
  })
}
if (reason === 'server') $('server-card').scrollIntoView()
