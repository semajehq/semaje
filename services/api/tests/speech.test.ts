// Gate tests: gateway ↔ STT/TTS contracts, against fake STT and TTS servers
// on ephemeral localhost ports. Covers language enrichment, TTS proxying,
// option pass-through, error mapping, request-id propagation, busy retry.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createServer, type Server, type IncomingMessage } from 'node:http'
import { _setPool } from '@semaje/db'
import { signAccessToken, _resetSeed } from '../../auth/src/index.ts'
import { createApp } from '../src/app.ts'
import { sttTranscribe, SttError } from '../../stt/client/index.ts'

const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '11111111-1111-4111-8111-111111111111'
const token = signAccessToken({ userId: USER, orgId: ORG, role: 'owner', scopes: [] })
const fakePool = {
  connect() { return Promise.resolve({ ...fakePool, release() {} }) },
  query() { return Promise.resolve({ rows: [] }) },
}

type Seen = { path: string; headers: IncomingMessage['headers']; body: string }
const sttSeen: Seen[] = []
const ttsSeen: Seen[] = []
let sttMode: 'ok' | 'bad-audio' | 'busy-once' = 'ok'
let busyServed = false

function read(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let data = ''
    req.setEncoding('latin1')
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
  })
}

const fakeStt = createServer(async (req, res) => {
  const body = await read(req)
  sttSeen.push({ path: req.url || '', headers: req.headers, body })
  res.setHeader('Content-Type', 'application/json')
  if (req.url?.startsWith('/languages')) {
    return res.end(JSON.stringify({
      total: 3, available: ['omnilingual', 'whisper'],
      languages: [
        { code: 'eng_Latn', name: 'English', iso1: 'en', whisper: 'en', aliases: [], engines: ['whisper', 'omnilingual'], whisperStrong: true, translate: true },
        { code: 'swh_Latn', name: 'Swahili', iso1: 'sw', whisper: 'sw', aliases: ['Kiswahili'], engines: ['whisper', 'omnilingual'], whisperStrong: false, translate: true },
        { code: 'kik_Latn', name: 'Kikuyu', iso1: 'ki', whisper: null, aliases: [], engines: ['omnilingual'], whisperStrong: false, translate: false },
      ],
    }))
  }
  if (req.url === '/transcribe') {
    if (sttMode === 'bad-audio') {
      res.statusCode = 415
      return res.end(JSON.stringify({ error: 'Could not read this file as audio.', code: 'undecodable_audio' }))
    }
    if (sttMode === 'busy-once' && !busyServed) {
      busyServed = true
      res.statusCode = 503
      res.setHeader('Retry-After', '0')
      return res.end(JSON.stringify({ error: 'busy', code: 'busy' }))
    }
    return res.end(JSON.stringify({
      text: 'habari ya asubuhi', language: 'sw', duration: 2, backend: 'omnilingual', model: 'omniASR_CTC_300M_v2',
      segments: [{ start: 0, end: 2, text: 'habari ya asubuhi' }], engine: 'omnilingual',
      languageCode: 'swh_Latn', languageName: 'Swahili',
      routing: { engine: 'omnilingual', language: 'swh_Latn', canonical: 'swh_Latn', reason: 'test' },
    }))
  }
  res.end(JSON.stringify({ ok: true, backend: 'faster-whisper' }))
})

const fakeTts = createServer(async (req, res) => {
  const body = await read(req)
  ttsSeen.push({ path: req.url || '', headers: req.headers, body })
  if (req.url?.startsWith('/voices')) {
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ allowNoncommercial: false, voices: [
      { id: 'sw_CD-lanfrica-medium', engine: 'piper', language: 'swh_Latn' },
      { id: 'en_US-lessac-high', engine: 'piper', language: 'eng_Latn' },
      { id: 'en_GB-alba-medium', engine: 'piper', language: 'eng_Latn' },
    ] }))
  }
  if (req.url === '/synthesize') {
    const input = JSON.parse(body)
    if (input.language === 'kik') {
      res.statusCode = 403
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ error: 'non-commercial only', code: 'license_noncommercial' }))
    }
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('x-semaje-voice', 'sw_CD-lanfrica-medium')
    res.setHeader('x-semaje-engine', 'piper')
    return res.end(Buffer.from('ID3fake-mp3'))
  }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ ok: true }))
})

let app: Server
let base = ''
const listen = (s: Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))
const auth = { Authorization: `Bearer ${token}` }

before(async () => {
  process.env.AUTH_ADAPTER = 'local-db'
  process.env.STT_URL = `http://127.0.0.1:${await listen(fakeStt)}`
  process.env.TTS_URL = `http://127.0.0.1:${await listen(fakeTts)}`
  _resetSeed()
  _setPool(fakePool)
  app = createServer(createApp({ enableJobs: false }))
  base = `http://127.0.0.1:${await listen(app)}`
})

after(async () => {
  for (const s of [app, fakeStt, fakeTts]) await new Promise<void>(r => s.close(() => r()))
  _setPool(null)
  process.env.AUTH_ADAPTER = 'single-user'
  delete process.env.STT_URL
  delete process.env.TTS_URL
})

test('/api/languages requires auth and enriches STT languages with TTS coverage', async () => {
  assert.equal((await fetch(`${base}/api/languages`)).status, 401)
  const res = await fetch(`${base}/api/languages`, { headers: auth })
  assert.equal(res.status, 200)
  const body = await res.json() as any
  assert.equal(body.total, 3)
  assert.equal(body.withTts, 2)
  const byCode = Object.fromEntries(body.languages.map((l: any) => [l.code, l]))
  assert.deepEqual(byCode.eng_Latn.tts, { voices: 2, engines: ['piper'] })
  assert.deepEqual(byCode.kik_Latn.tts, { voices: 0, engines: [] })
  assert.deepEqual(byCode.kik_Latn.engines, ['omnilingual'])
})

test('/api/tts proxies audio and provenance headers', async () => {
  const res = await fetch(`${base}/api/tts`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'x-request-id': 'trace-tts-1' },
    body: JSON.stringify({ text: 'Habari', language: 'sw', format: 'mp3' }),
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'audio/mpeg')
  assert.equal(res.headers.get('x-semaje-voice'), 'sw_CD-lanfrica-medium')
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'ID3fake-mp3')
  const call = ttsSeen.find(s => s.path === '/synthesize')!
  assert.equal(call.headers['x-request-id'], 'trace-tts-1')
  assert.deepEqual(JSON.parse(call.body), { text: 'Habari', language: 'sw', format: 'mp3' })
})

test('/api/tts maps TTS license refusals and validates text', async () => {
  const blocked = await fetch(`${base}/api/tts`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Wĩ mwega', language: 'kik' }),
  })
  assert.equal(blocked.status, 403)
  assert.equal((await blocked.json() as any).code, 'license_noncommercial')
  const empty = await fetch(`${base}/api/tts`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ' ' }),
  })
  assert.equal(empty.status, 400)
})

function audioForm(fields: Record<string, string> = {}) {
  const form = new FormData()
  form.append('audio', new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }), 'clip.wav')
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return form
}

test('/api/transcribe forwards language, engine, and request id to STT', async () => {
  sttMode = 'ok'
  const res = await fetch(`${base}/api/transcribe`, {
    method: 'POST', headers: { ...auth, 'x-request-id': 'trace-stt-1' },
    body: audioForm({ task: 'transcription', language: 'sw', engine: 'omnilingual', enhance: 'true' }),
  })
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal(res.headers.get('x-request-id'), 'trace-stt-1')
  const body = await res.json() as any
  assert.equal(body.transcript, 'habari ya asubuhi')
  assert.equal(body.stt.engine, 'omnilingual')
  assert.equal(body.stt.languageCode, 'swh_Latn')
  const call = sttSeen.filter(s => s.path === '/transcribe').at(-1)!
  assert.equal(call.headers['x-request-id'], 'trace-stt-1')
  for (const [name, value] of [['language', 'sw'], ['engine', 'omnilingual'], ['enhance', 'true']]) {
    assert.match(call.body, new RegExp(`name="${name}"\\r\\n\\r\\n${value}\\r\\n`))
  }
})

test('/api/transcribe passes STT client errors through with their status', async () => {
  sttMode = 'bad-audio'
  const res = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: auth, body: audioForm() })
  assert.equal(res.status, 415)
  const body = await res.json() as any
  assert.equal(body.code, 'undecodable_audio')
  assert.ok(body.requestId)
  sttMode = 'ok'
})

test('STT client retries once on 503 busy, honoring Retry-After', async () => {
  sttMode = 'busy-once'
  busyServed = false
  const before = sttSeen.length
  const result = await sttTranscribe(Buffer.from('RIFF'), 'a.wav', 'audio/wav', { language: 'sw' })
  assert.equal(result.text, 'habari ya asubuhi')
  assert.equal(sttSeen.slice(before).filter(s => s.path === '/transcribe').length, 2)
  sttMode = 'ok'
})

test('STT client reports an unreachable service as 503 SttError', async () => {
  const saved = process.env.STT_URL
  process.env.STT_URL = 'http://127.0.0.1:1'
  try {
    await assert.rejects(() => sttTranscribe(Buffer.from('x'), 'a.wav', 'audio/wav'),
      (err: unknown) => err instanceof SttError && err.status === 503 && err.code === 'unreachable')
  } finally { process.env.STT_URL = saved }
})
