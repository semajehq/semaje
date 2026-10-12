// Gate tests: extension libraries (config, api client, languages, realtime, capture choice).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore — plain JS modules
import { mergeConfig, normalizeBase, originPattern, DEFAULTS } from '../src/lib/config.js'
// @ts-ignore
import { createClient, ApiError, friendlyError } from '../src/lib/api.js'
// @ts-ignore
import { searchLanguages, findLanguage, describeRouting } from '../src/lib/languages.js'
// @ts-ignore
import { RealtimeSession, base64ToBytes, bytesToBase64 } from '../src/lib/realtime.js'
// @ts-ignore
import { chooseCaptureHost, chooseTabStrategy, preferredMimeType } from '../src/lib/capture-host.js'

// ── config ───────────────────────────────────────────────────
test('normalizeBase adds a scheme and trims slashes; rejects non-http', () => {
  assert.equal(normalizeBase('semaje.example.com/'), 'https://semaje.example.com')
  assert.equal(normalizeBase('http://localhost:3001///'), 'http://localhost:3001')
  assert.equal(normalizeBase(''), DEFAULTS.apiBase)
  assert.throws(() => normalizeBase('ftp://x.y'), /http/)
})

test('originPattern is a host-permission match pattern', () => {
  assert.equal(originPattern('https://semaje.corp:8443/app'), 'https://semaje.corp/*')
})

test('managed policy beats user settings and locks fields when lockSettings is set', () => {
  const { config, locked, managed } = mergeConfig(
    { apiBase: 'http://localhost:3001', language: 'fr', engine: 'whisper' },
    { apiBase: 'https://semaje.corp', language: 'sw', lockSettings: true },
  )
  assert.equal(config.apiBase, 'https://semaje.corp')
  assert.equal(config.language, 'sw')
  assert.equal(config.engine, 'whisper')          // not managed → user value kept
  assert.deepEqual(locked.sort(), ['apiBase', 'language'])
  assert.equal(managed, true)
})

test('mergeConfig sanitizes junk', () => {
  const { config, locked, managed } = mergeConfig({ engine: 'gpt', ttsSpeed: 99 }, {})
  assert.equal(config.engine, 'auto')
  assert.equal(config.ttsSpeed, 4)
  assert.deepEqual(locked, [])
  assert.equal(managed, false)
})

// ── api client ───────────────────────────────────────────────
function fakeFetch(routes: Record<string, (init: any) => any>) {
  const calls: Array<{ url: string; init: any }> = []
  const impl = async (url: string, init: any = {}) => {
    calls.push({ url, init })
    const path = new URL(url).pathname
    const handler = routes[path] || routes['*']
    const out = handler ? handler(init) : { status: 404, body: { error: 'nope' } }
    const status = out.status ?? 200
    return {
      ok: status < 400, status,
      json: async () => out.body ?? {},
      blob: async () => new Blob([out.raw ?? 'audio']),
      headers: { get: (k: string) => (out.headers || {})[k.toLowerCase()] ?? null },
    }
  }
  return { impl, calls }
}

test('client sends the bearer key and builds a ws URL with the token', async () => {
  const { impl, calls } = fakeFetch({ '/api/me': () => ({ body: { principal: { via: 'api-key' } } }) })
  const c = createClient({ apiBase: 'https://semaje.corp/', apiKey: 'smj_abc', fetchImpl: impl })
  await c.me()
  assert.equal(calls[0].url, 'https://semaje.corp/api/me')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer smj_abc')
  assert.equal(c.wsUrl(), 'wss://semaje.corp/ws?token=smj_abc')
  assert.equal(createClient({ apiBase: 'http://localhost:3001', fetchImpl: impl }).wsUrl(), 'ws://localhost:3001/ws')
})

test('transcribeFile ingests, polls the job, and returns the transcript', async () => {
  let polls = 0
  const { impl, calls } = fakeFetch({
    '/api/ingest': () => ({ status: 201, body: { job: { id: 'j1', status: 'queued' } } }),
    '/api/jobs/j1': () => ({ body: { job: { id: 'j1', status: ++polls < 2 ? 'running' : 'succeeded', progress: 70, transcript_id: 't1' } } }),
    '/api/transcripts/t1': () => ({ body: { transcript: { id: 't1', title: 'Clip', text: 'habari' } } }),
  })
  const progress: string[] = []
  const c = createClient({ apiBase: 'http://x.test', fetchImpl: impl, sleep: async () => {} })
  const t = await c.transcribeFile(new Blob(['RIFF']), 'clip.m4a', { language: 'sw', engine: 'omnilingual', onProgress: (j: any) => progress.push(j.status) })
  assert.equal(t.text, 'habari')
  const form = calls[0].init.body as FormData
  assert.equal(form.get('language'), 'sw')
  assert.equal(form.get('source'), 'extension')
  assert.deepEqual(JSON.parse(String(form.get('options'))), { engine: 'omnilingual' })
  assert.deepEqual(progress, ['queued', 'running', 'succeeded'])
})

test('transcribeFile surfaces failed jobs', async () => {
  const { impl } = fakeFetch({
    '/api/ingest': () => ({ body: { job: { id: 'j2', status: 'queued' } } }),
    '/api/jobs/j2': () => ({ body: { job: { id: 'j2', status: 'failed', error: 'audio_too_long' } } }),
  })
  const c = createClient({ apiBase: 'http://x.test', fetchImpl: impl, sleep: async () => {} })
  await assert.rejects(() => c.transcribeFile(new Blob(['x']), 'a.wav'), /audio_too_long/)
})

test('speak posts text and returns audio + provenance', async () => {
  const { impl, calls } = fakeFetch({ '/api/tts': () => ({ raw: 'ID3', headers: { 'x-semaje-voice': 'sw_CD-lanfrica-medium', 'x-semaje-engine': 'piper' } }) })
  const out = await createClient({ apiBase: 'http://x.test', fetchImpl: impl }).speak('Habari', { language: 'sw', speed: 1.2 })
  assert.equal(out.voice, 'sw_CD-lanfrica-medium')
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'Habari', language: 'sw', speed: 1.2, format: 'mp3' })
})

test('errors carry status/code and map to actionable messages', async () => {
  const { impl } = fakeFetch({ '*': () => ({ status: 403, body: { error: 'No commercial voice', code: 'license_noncommercial' } }) })
  const err = await createClient({ apiBase: 'http://x.test', fetchImpl: impl }).speak('x').catch((e: unknown) => e)
  assert.ok(err instanceof ApiError)
  assert.equal(err.status, 403)
  assert.equal(friendlyError(err), 'No commercial voice')
  assert.match(friendlyError(new ApiError('x', 401, 'u')), /API key/)
  assert.match(friendlyError(new Error('boom')), /Cannot reach/)
  const down = await createClient({ apiBase: 'http://x.test', fetchImpl: async () => { throw new Error('ECONNREFUSED') } }).me().catch((e: unknown) => e)
  assert.equal((down as any).code, 'network')
})

// ── languages ────────────────────────────────────────────────
const LANGS = [
  { code: 'eng_Latn', name: 'English', iso1: 'en', whisper: 'en', aliases: [], engines: ['whisper', 'omnilingual'], whisperStrong: true },
  { code: 'swh_Latn', name: 'Swahili', iso1: 'sw', whisper: 'sw', aliases: ['Kiswahili', 'swa'], engines: ['whisper', 'omnilingual'], whisperStrong: false, tts: { voices: 1 } },
  { code: 'kik_Latn', name: 'Kikuyu', iso1: 'ki', whisper: null, aliases: ['Gikuyu'], engines: ['omnilingual'], whisperStrong: false },
  { code: 'ssw_Latn', name: 'Swati', iso1: 'ss', whisper: null, aliases: [], engines: ['omnilingual'], whisperStrong: false },
]

test('searchLanguages ranks exact codes, then name prefixes, then substrings', () => {
  assert.deepEqual(searchLanguages(LANGS, 'sw').map((l: any) => l.code), ['swh_Latn', 'ssw_Latn'])
  assert.deepEqual(searchLanguages(LANGS, 'gikuyu').map((l: any) => l.code), ['kik_Latn'])
  assert.equal(searchLanguages(LANGS, '').length, 4)
  assert.equal(searchLanguages(LANGS, 'zzz').length, 0)
})

test('findLanguage and describeRouting', () => {
  assert.equal(findLanguage(LANGS, 'sw').code, 'swh_Latn')
  assert.equal(findLanguage(LANGS, 'kik_Latn').name, 'Kikuyu')
  assert.equal(describeRouting(null), 'Auto-detect')
  assert.equal(describeRouting(LANGS[0]), 'Whisper')
  assert.equal(describeRouting(LANGS[1]), 'Omnilingual ASR')
  assert.equal(describeRouting({ ...LANGS[2], engines: [] }), 'Not available on this server')
})

// ── capture host choice ──────────────────────────────────────
test('capture host and tab strategy per browser', () => {
  assert.equal(chooseCaptureHost({ hasOffscreen: true, backgroundHasDom: false }), 'offscreen')   // Chromium
  assert.equal(chooseCaptureHost({ hasOffscreen: false, backgroundHasDom: true }), 'background')  // Firefox
  assert.equal(chooseCaptureHost({ hasOffscreen: false, backgroundHasDom: false }), 'window')     // Safari
  assert.equal(chooseTabStrategy({ hasTabCapture: true }), 'tab-capture')
  assert.equal(chooseTabStrategy({ hasTabCapture: false }), 'media-tap')
  assert.equal(preferredMimeType((t: string) => t === 'audio/mp4'), 'audio/mp4')                 // Safari
  assert.equal(preferredMimeType(() => { throw new Error('x') }), '')
})

// ── realtime session ─────────────────────────────────────────
class FakeWS {
  static last: FakeWS
  sent: any[] = []
  readyState = 0
  binaryType = ''
  onopen?: () => void
  onmessage?: (e: { data: any }) => void
  onerror?: () => void
  onclose?: () => void
  constructor(public url: string) { FakeWS.last = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
  send(d: any) { this.sent.push(d) }
  close() { this.readyState = 3; this.onclose?.() }
  serverSays(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

test('realtime: start frame first, queued audio flushed, finals collected, end closes', async () => {
  const texts: string[] = []
  const states: string[] = []
  const rt = new RealtimeSession({
    url: 'ws://x/ws', start: { mode: 'dictation', language: 'sw' }, WebSocketImpl: FakeWS,
    onText: (t: string) => texts.push(t), onState: (s: string) => states.push(s),
  })
  rt.push(new Uint8Array([1, 2, 3]).buffer)  // before open → queued
  await rt.open()
  const ws = FakeWS.last
  assert.deepEqual(JSON.parse(ws.sent[0]), { type: 'start', mode: 'dictation', language: 'sw' })
  assert.equal(ws.sent[1].byteLength, 3)
  rt.push(new Uint8Array(0).buffer)           // empty chunks are dropped
  assert.equal(ws.sent.length, 2)
  ws.serverSays({ type: 'final', text: 'habari', tStart: 0, tEnd: 5 })
  ws.serverSays({ type: 'error', error: 'window failed' })   // stream continues
  ws.serverSays({ type: 'final', text: 'yako', tStart: 5, tEnd: 10 })
  rt.stop()
  assert.deepEqual(JSON.parse(ws.sent.at(-1)), { type: 'stop' })
  ws.serverSays({ type: 'end', transcriptId: 't-1' })
  assert.deepEqual(texts, ['habari', 'yako'])
  assert.equal(rt.text, 'habari yako')
  assert.equal(rt.transcriptId, 't-1')
  assert.deepEqual(states.filter(s => s !== 'listening').slice(0, 1), ['connecting'])
  assert.ok(states.includes('ended'))
})

test('base64 helpers round-trip binary audio', () => {
  const bytes = new Uint8Array(70000).map((_, i) => i % 256)
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes)
})
