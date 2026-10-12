// Capture + playback host. Runs wherever a DOM with getUserMedia exists:
// Chromium's offscreen document, Firefox's background page, or the fallback
// host window. One implementation, three homes.
import { createClient } from './api.js'
import { MSG } from './protocol.js'
import { RealtimeSession, base64ToBytes } from './realtime.js'
import { preferredMimeType } from './capture-host.js'

const CHUNK_MS = 1000

export function createHost({ send, mediaDevices = globalThis.navigator?.mediaDevices, MediaRecorderImpl = globalThis.MediaRecorder, AudioContextImpl = globalThis.AudioContext, WebSocketImpl = globalThis.WebSocket }) {
  const sessions = new Map()
  let speaking = null

  async function openStream(msg) {
    if (msg.capture === 'mic') {
      return mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    }
    if (msg.capture === 'tab') {
      const stream = await mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } },
        video: false,
      })
      // Capturing a tab mutes it; route the audio back out so the user keeps hearing it.
      let ctx = null
      if (AudioContextImpl) {
        ctx = new AudioContextImpl()
        ctx.createMediaStreamSource(stream).connect(ctx.destination)
      }
      return Object.assign(stream, { __passthrough: ctx })
    }
    return null  // 'push': chunks arrive from a page media tap
  }

  async function start(msg) {
    if (sessions.has(msg.sessionId)) return
    const client = createClient({ apiBase: msg.apiBase, apiKey: msg.apiKey })
    const mimeType = msg.mimeType || (MediaRecorderImpl ? preferredMimeType(t => MediaRecorderImpl.isTypeSupported(t)) : '')
    const entry = { stream: null, recorder: null, rt: null }
    sessions.set(msg.sessionId, entry)
    const report = (state, detail) => send({ kind: MSG.HOST_STATE, sessionId: msg.sessionId, state, detail })

    try {
      entry.stream = await openStream(msg)
    } catch (err) {
      sessions.delete(msg.sessionId)
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
      report('error', denied ? 'permission-denied' : `Audio capture failed: ${err?.message || err}`)
      return
    }

    entry.rt = new RealtimeSession({
      url: client.wsUrl(),
      start: {
        mode: msg.mode || 'dictation',
        source: 'extension',
        language: msg.language || undefined,
        title: msg.title || undefined,
        mimeType: mimeType || undefined,
      },
      WebSocketImpl,
      onText: (text, frame) => send({ kind: MSG.HOST_TEXT, sessionId: msg.sessionId, text, tStart: frame.tStart, tEnd: frame.tEnd }),
      onState: (state, detail) => {
        if (entry.ended) return
        if (state === 'ended' || state === 'idle') {
          entry.ended = true
          if (entry.recorder && entry.recorder.state !== 'inactive') entry.recorder.stop()
          cleanup(msg.sessionId)
          send({ kind: MSG.HOST_END, sessionId: msg.sessionId, transcriptId: entry.rt?.transcriptId || null, text: entry.rt?.text || '' })
        } else if (state === 'error') {
          entry.ended = true
          if (entry.recorder && entry.recorder.state !== 'inactive') entry.recorder.stop()
          cleanup(msg.sessionId)
          report('error', detail)
        } else {
          report(state, detail)
        }
      },
    })

    try {
      await entry.rt.open()
    } catch (err) {
      if (!entry.ended) {  // onState may already have reported this failure
        entry.ended = true
        cleanup(msg.sessionId)
        report('error', err.message)
      }
      return
    }

    if (entry.stream && MediaRecorderImpl) {
      entry.recorder = new MediaRecorderImpl(entry.stream, mimeType ? { mimeType } : undefined)
      // Chunks are pushed strictly in order; stop() waits on this chain so the
      // final words are always sent before the stop frame.
      entry.pending = Promise.resolve()
      entry.recorder.ondataavailable = event => {
        if (!event.data?.size) return
        const data = event.data
        entry.pending = entry.pending.then(async () => entry.rt?.push(await data.arrayBuffer())).catch(() => {})
      }
      // Ending the source (tab closed, mic unplugged) ends the session cleanly.
      for (const track of entry.stream.getAudioTracks()) track.onended = () => stop(msg.sessionId)
      entry.recorder.start(CHUNK_MS)
    }
  }

  function push(msg) {
    const entry = sessions.get(msg.sessionId)
    if (entry?.rt && msg.data) entry.rt.push(base64ToBytes(msg.data).buffer)
  }

  function stop(sessionId) {
    const entry = sessions.get(sessionId)
    if (!entry) return
    if (entry.recorder && entry.recorder.state !== 'inactive') {
      // 'stop' fires after the last dataavailable; then wait for that chunk's push.
      entry.recorder.addEventListener('stop', () => { entry.pending.then(() => entry.rt?.stop()) }, { once: true })
      entry.recorder.stop()
    } else {
      entry.rt?.stop()
    }
    for (const track of entry.stream?.getTracks?.() || []) track.stop()
  }

  function cleanup(sessionId) {
    const entry = sessions.get(sessionId)
    if (!entry) return
    for (const track of entry.stream?.getTracks?.() || []) track.stop()
    entry.stream?.__passthrough?.close?.()
    sessions.delete(sessionId)
  }

  async function speak(msg) {
    stopSpeaking()
    const client = createClient({ apiBase: msg.apiBase, apiKey: msg.apiKey })
    try {
      const { blob, voice } = await client.speak(msg.text, { language: msg.language, voice: msg.voice, speed: msg.speed })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      speaking = { audio, url }
      audio.onended = () => { stopSpeaking(); send({ kind: MSG.HOST_STATE, sessionId: 'tts', state: 'idle' }) }
      await audio.play()
      send({ kind: MSG.HOST_STATE, sessionId: 'tts', state: 'speaking', detail: voice || '' })
    } catch (err) {
      send({ kind: MSG.HOST_STATE, sessionId: 'tts', state: 'error', detail: err.message })
    }
  }

  function stopSpeaking() {
    if (!speaking) return
    speaking.audio.pause()
    URL.revokeObjectURL(speaking.url)
    speaking = null
  }

  return {
    sessions,
    isBusy: () => sessions.size > 0 || speaking !== null,
    async handle(msg) {
      switch (msg?.kind) {
        case MSG.HOST_START: return start(msg)
        case MSG.HOST_PUSH: return push(msg)
        case MSG.HOST_STOP: return stop(msg.sessionId)
        case MSG.HOST_SPEAK: return speak(msg)
        case MSG.HOST_SPEAK_STOP: return stopSpeaking()
        case MSG.HOST_PING: return true
        default: return undefined
      }
    },
  }
}
