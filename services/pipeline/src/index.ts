// ═══════════════════════════════════════════════════════════════
// services/pipeline — pure, deterministic routing between the two
// engines. Whisper does STT; the LLM does language tasks over the
// Whisper transcript. No I/O here so it's unit-testable for free.
// (Lifted from server/pipeline.js — same logic, now typed.)
// ═══════════════════════════════════════════════════════════════
import type { SttResult } from '@semaje/schemas'

// Tasks where the LLM needs accurate timing → feed it the Whisper
// segment timestamps. Everything else gets plain text.
export const TIMING_TASKS = new Set([
  'subtitles', 'captions', 'chapters', 'diarization',
  'interview', 'legal', 'lyrics',
])

export interface TaskOptions {
  speakerLabels?: boolean
  polish?: boolean
  timestamps?: boolean
  [key: string]: unknown
}

// The base "transcription" task is pure Whisper UNLESS the user asked
// for something Whisper can't do on its own (speaker labels / polish).
// Every other task is language work → LLM.
export function needsLlm(task: string, options: TaskOptions = {}): boolean {
  if (task === 'transcription') {
    return !!(options.speakerLabels || options.polish)
  }
  return true
}

// HH:MM:SS.mmm — precise enough for the LLM to build SRT/VTT.
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(hh)}:${p(mm)}:${p(ss)}.${p(ms, 3)}`
}

// [mm:ss] for human-readable inline timestamps in the plain transcript.
function shortTs(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0)
  const mm = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}]`
}

// Pure-Whisper transcription output (no LLM). Honors the timestamps option.
export function renderPlainTranscript(
  stt: Pick<SttResult, 'text' | 'segments'>,
  options: TaskOptions = {},
): string {
  const segs = stt?.segments || []
  if (!stt?.text) return '[No speech detected]'
  if (!options.timestamps || segs.length === 0) return stt.text
  return segs.map(s => `${shortTs(s.start)} ${s.text}`).join('\n')
}

// Build the transcript block appended to the LLM task prompt.
export function buildTranscriptContext(
  task: string,
  stt: Pick<SttResult, 'text' | 'segments' | 'language'>,
): string {
  const lang = stt?.language || 'unknown'
  const header =
    `SOURCE: The text below is a verbatim speech-to-text transcript produced ` +
    `by Whisper (detected language: ${lang}). Perform the requested TASK on ` +
    `THIS transcript only. Do not invent content that is not present. ` +
    (TIMING_TASKS.has(task)
      ? `Segment timestamps are provided as [start --> end]; use them for any timing.`
      : ``)

  let body: string
  const segs = stt?.segments || []
  if (TIMING_TASKS.has(task) && segs.length > 0) {
    body = segs
      .map(s => `[${formatTimestamp(s.start)} --> ${formatTimestamp(s.end)}] ${s.text}`)
      .join('\n')
  } else {
    body = stt?.text || '[No speech detected]'
  }

  return `${header}\n\nTRANSCRIPT:\n${body}`
}
