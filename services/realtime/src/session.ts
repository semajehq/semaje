// A realtime session: WS messages in, transcript segments out.
// Transcription is injected so gate tests never touch Whisper.
import { RTClientMessage, type RTServerMessage, type Principal, type SttResult } from '@semaje/schemas'
import { WindowBuffer, WINDOW_MS } from './window-buffer.ts'

export type Transcriber = (
  audio: Buffer, mimeType: string, language?: string,
) => Promise<Pick<SttResult, 'text' | 'duration' | 'language'>>

export type Persister = (
  principal: Principal,
  data: { title: string; source: 'dictation' | 'meeting' | 'extension' | 'desktop'; text: string; segments: { start: number; end: number; text: string }[]; language: string | null; durationSec: number },
) => Promise<{ id: string }>

export interface SessionEvents {
  send(msg: RTServerMessage): void
}

export class RealtimeSession {
  private buffer = new WindowBuffer()
  private started = false
  private stopped = false
  private mode: 'dictation' | 'meeting' = 'dictation'
  private source: 'dictation' | 'meeting' | 'extension' | 'desktop' = 'dictation'
  private language: string | undefined
  private mimeType = 'audio/webm'
  private title = ''
  private tOffset = 0
  private finals: { start: number; end: number; text: string }[] = []
  private detectedLanguage: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private processing: Promise<void> = Promise.resolve()

  constructor(
    private principal: Principal,
    private transcribe: Transcriber,
    private persist: Persister | null,
    private events: SessionEvents,
    private windowMs = WINDOW_MS,
  ) {}

  /** Text control message from the client. */
  async handleMessage(raw: string): Promise<void> {
    const parsed = RTClientMessage.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      this.events.send({ type: 'error', error: 'invalid message' })
      return
    }
    const msg = parsed.data
    if (msg.type === 'start') {
      if (this.started) return
      this.started = true
      this.mode = msg.mode
      this.source = msg.source || msg.mode
      this.language = msg.language
      this.mimeType = msg.mimeType || 'audio/webm'
      this.title = msg.title || ''
      this.events.send({ type: 'ready' })
      this.timer = setInterval(() => this.enqueueWindow(false), this.windowMs)
      this.timer.unref?.()
    } else if (msg.type === 'stop') {
      await this.stop()
    }
  }

  /** Binary audio frame from the client. */
  handleAudio(chunk: Buffer): void {
    if (!this.started || this.stopped) return
    this.buffer.feed(chunk)
  }

  private enqueueWindow(drain: boolean): void {
    const audio = drain ? this.buffer.drain() : this.buffer.flush()
    if (!audio) return
    // Serialize windows so segments stay ordered even if Whisper is slow.
    this.processing = this.processing.then(() => this.processWindow(audio)).catch(() => {})
  }

  private async processWindow(audio: Buffer): Promise<void> {
    try {
      const res = await this.transcribe(audio, this.mimeType, this.language)
      const text = (res.text || '').trim()
      const dur = Math.max(0, res.duration || 0)
      const tStart = this.tOffset
      const tEnd = tStart + dur
      this.tOffset = tEnd
      if (res.language && !this.detectedLanguage) this.detectedLanguage = res.language
      if (text) {
        this.finals.push({ start: tStart, end: tEnd, text })
        this.events.send({ type: 'final', text, tStart, tEnd, language: res.language })
      }
    } catch (e: any) {
      this.events.send({ type: 'error', error: e.message || 'transcription failed' })
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.enqueueWindow(true)
    await this.processing

    let transcriptId: string | undefined
    // Meetings persist automatically; dictation persists when a title was given.
    if (this.persist && this.finals.length > 0 && (this.mode === 'meeting' || this.title)) {
      try {
        const saved = await this.persist(this.principal, {
          title: this.title || `${this.mode} ${new Date().toISOString().slice(0, 16)}`,
          source: this.source,
          text: this.finals.map(f => f.text).join(' '),
          segments: this.finals,
          language: this.detectedLanguage,
          durationSec: this.tOffset,
        })
        transcriptId = saved.id
      } catch (e: any) {
        this.events.send({ type: 'error', error: `save failed: ${e.message}` })
      }
    }
    this.events.send({ type: 'end', transcriptId })
  }

  get segments(): readonly { start: number; end: number; text: string }[] { return this.finals }
}
