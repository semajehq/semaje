// media-tap — Firefox/Safari fallback for "transcribe this tab": record the
// page's playing <video>/<audio> element and relay chunks to the extension.
(() => {
  if (window.__semajeTap) return
  const api = globalThis.browser ?? globalThis.chrome
  let recorder = null
  let current = null

  function pickMedia() {
    const all = [...document.querySelectorAll('video, audio')]
    const playing = all.filter(m => !m.paused && !m.ended && m.readyState > 2)
    const pool = playing.length ? playing : all
    // Prefer the biggest visible element: the main player, not an ad thumbnail.
    return pool.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null
  }

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }

  function start(sessionId) {
    stop()
    const media = pickMedia()
    const capture = media && (media.captureStream || media.mozCaptureStream)
    if (!capture) return api.runtime.sendMessage({ kind: 'tap:state', sessionId, state: 'no-media' })
    let stream
    try { stream = capture.call(media) } catch {
      return api.runtime.sendMessage({ kind: 'tap:state', sessionId, state: 'no-media' })  // DRM-protected media
    }
    const audio = new MediaStream(stream.getAudioTracks())
    if (!audio.getAudioTracks().length) return api.runtime.sendMessage({ kind: 'tap:state', sessionId, state: 'no-media' })
    // Firefox's mozCaptureStream silences the element; route it back to the speakers.
    if (media.mozCaptureStream && !media.captureStream) {
      try { const ctx = new AudioContext(); ctx.createMediaStreamSource(audio).connect(ctx.destination); current = { ctx } } catch { /* best effort */ }
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || ''
    recorder = new MediaRecorder(audio, mimeType ? { mimeType } : undefined)
    recorder.ondataavailable = async e => {
      if (e.data?.size) api.runtime.sendMessage({ kind: 'tap:chunk', sessionId, data: toBase64(await e.data.arrayBuffer()) })
    }
    recorder.start(1000)
    media.addEventListener('ended', () => api.runtime.sendMessage({ kind: 'ui:action', action: 'stop' }), { once: true })
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    recorder = null
    current?.ctx?.close?.()
    current = null
  }

  api.runtime.onMessage.addListener(msg => {
    if (msg?.kind === 'tap:start') start(msg.sessionId)
    else if (msg?.kind === 'tap:stop') stop()
  })
  window.__semajeTap = { pickMedia, start, stop }
})()
