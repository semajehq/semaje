// Realtime session over the server's /ws protocol (services/realtime/contract.md).
// Transport-agnostic: give it a WebSocket constructor and audio chunks.

export class RealtimeSession {
  /**
   * @param {object} o
   * @param {string} o.url        ws(s)://host/ws?token=...
   * @param {object} o.start      {mode, source, language, title, mimeType}
   * @param {(text: string, msg: object) => void} o.onText
   * @param {(state: string, detail?: string) => void} o.onState
   * @param {Function} [o.WebSocketImpl]
   */
  constructor({ url, start, onText, onState, WebSocketImpl = globalThis.WebSocket }) {
    this.url = url
    this.startMsg = { type: 'start', ...start }
    this.onText = onText || (() => {})
    this.onState = onState || (() => {})
    this.WebSocketImpl = WebSocketImpl
    this.ws = null
    this.queue = []          // audio that arrived before the socket opened
    this.state = 'idle'
    this.transcriptId = null
    this.finals = []
  }

  setState(state, detail) {
    if (this.state === state && !detail) return
    this.state = state
    this.onState(state, detail)
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws
      this.setState('connecting')
      let opened = false
      ws.onopen = () => {
        opened = true
        ws.send(JSON.stringify(this.startMsg))
        for (const chunk of this.queue.splice(0)) ws.send(chunk)
        this.setState('listening')
        resolve()
      }
      ws.onmessage = event => this.handle(event.data)
      ws.onerror = () => {
        if (!opened) reject(new Error('Cannot connect to the semaje realtime service.'))
        this.setState('error', 'Connection to the semaje server failed.')
      }
      ws.onclose = () => {
        if (this.state !== 'error') this.setState('idle')
        this.ws = null
      }
    })
  }

  handle(data) {
    if (typeof data !== 'string') return
    let msg
    try { msg = JSON.parse(data) } catch { return }
    if (msg.type === 'final' && msg.text) {
      this.finals.push(msg.text)
      this.onText(msg.text, msg)
    } else if (msg.type === 'error') {
      this.onState(this.state, msg.error)   // a window failed; the stream continues
    } else if (msg.type === 'end') {
      this.transcriptId = msg.transcriptId || null
      this.setState('ended', this.transcriptId || '')
      try { this.ws?.close() } catch { /* already closed */ }
    }
  }

  push(chunk) {
    if (!chunk || (chunk.byteLength ?? chunk.size ?? 0) === 0) return
    if (this.ws && this.ws.readyState === 1) this.ws.send(chunk)
    else this.queue.push(chunk)
  }

  stop() {
    if (this.ws && this.ws.readyState === 1) {
      this.setState('finishing')
      this.ws.send(JSON.stringify({ type: 'stop' }))
    } else {
      this.setState('idle')
    }
  }

  get text() { return this.finals.join(' ') }
}

export function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < view.length; i += 0x8000) bin += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(bin)
}
