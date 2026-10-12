// Gate tests: WindowBuffer init-segment handling + RealtimeSession protocol
// with a fake transcriber. No Whisper, no sockets, fake timers via windowMs=10.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WindowBuffer } from '../src/window-buffer.ts'
import { RealtimeSession, type Transcriber } from '../src/session.ts'
import type { RTServerMessage } from '@semaje/schemas'

const P = { userId: '11111111-1111-4111-8111-111111111111', orgId: '22222222-2222-4222-8222-222222222222', role: 'owner' as const, scopes: [], via: 'jwt' as const }

test('WindowBuffer: window 1 is raw chunks; window 2+ gets the init segment prepended', () => {
  const b = new WindowBuffer()
  const init = Buffer.from('INIT-HEADER-')
  b.feed(init)
  b.feed(Buffer.from('aaaa'))
  const w1 = b.flush(4)
  assert.ok(w1)
  assert.equal(w1!.toString(), 'INIT-HEADER-aaaa') // no double header on window 1

  b.feed(Buffer.from('bbbb'))
  const w2 = b.flush(4)
  assert.ok(w2)
  assert.equal(w2!.toString(), 'INIT-HEADER-bbbb') // header prepended for decodability
})

test('WindowBuffer: below-minimum stays buffered; drain flushes everything', () => {
  const b = new WindowBuffer()
  b.feed(Buffer.from('xy'))
  assert.equal(b.flush(100), null)
  assert.equal(b.bufferedBytes, 2)
  const drained = b.drain()
  assert.equal(drained!.toString(), 'xy')
  assert.equal(b.drain(), null) // empty after drain
})

function collect(): { sent: RTServerMessage[]; send: (m: RTServerMessage) => void } {
  const sent: RTServerMessage[] = []
  return { sent, send: m => sent.push(m) }
}

const fakeTranscriber: Transcriber = async (audio) => ({
  text: `heard:${audio.length}b`, duration: 5, language: 'en',
})

test('session: start → audio → stop emits ready, finals with running offsets, end', async () => {
  const out = collect()
  const s = new RealtimeSession(P, fakeTranscriber, null, out, 1_000_000) // timer never fires
  await s.handleMessage(JSON.stringify({ type: 'start', mode: 'dictation' }))
  assert.deepEqual(out.sent[0], { type: 'ready' })

  s.handleAudio(Buffer.alloc(4000))
  s.handleAudio(Buffer.alloc(4000))
  await s.handleMessage(JSON.stringify({ type: 'stop' }))

  const finals = out.sent.filter(m => m.type === 'final') as Extract<RTServerMessage, { type: 'final' }>[]
  assert.equal(finals.length, 1) // drained as one window on stop
  assert.equal(finals[0].tStart, 0)
  assert.equal(finals[0].tEnd, 5)
  assert.equal(out.sent.at(-1)!.type, 'end')
})

test('session: meeting mode persists and returns transcriptId in end', async () => {
  const out = collect()
  let persisted: unknown = null
  const s = new RealtimeSession(P, fakeTranscriber, async (_p, data) => {
    persisted = data
    return { id: '33333333-3333-4333-8333-333333333333' }
  }, out, 1_000_000)
  await s.handleMessage(JSON.stringify({ type: 'start', mode: 'meeting', title: 'Standup' }))
  s.handleAudio(Buffer.alloc(5000))
  await s.handleMessage(JSON.stringify({ type: 'stop' }))

  const end = out.sent.at(-1) as Extract<RTServerMessage, { type: 'end' }>
  assert.equal(end.type, 'end')
  assert.equal(end.transcriptId, '33333333-3333-4333-8333-333333333333')
  assert.equal((persisted as { source: string }).source, 'meeting')
  assert.equal((persisted as { title: string }).title, 'Standup')
})

test('session: extension source persists into the shared transcript model', async () => {
  const out = collect()
  let source = ''
  const s = new RealtimeSession(P, fakeTranscriber, async (_p, data) => {
    source = data.source
    return { id: '33333333-3333-4333-8333-333333333333' }
  }, out, 1_000_000)
  await s.handleMessage(JSON.stringify({
    type: 'start', mode: 'dictation', source: 'extension', title: 'Browser dictation',
  }))
  s.handleAudio(Buffer.alloc(5000))
  await s.handleMessage(JSON.stringify({ type: 'stop' }))
  assert.equal(source, 'extension')
})

test('session: dictation without title does NOT persist', async () => {
  const out = collect()
  let persistCalled = false
  const s = new RealtimeSession(P, fakeTranscriber, async () => {
    persistCalled = true
    return { id: 'x' }
  }, out, 1_000_000)
  await s.handleMessage(JSON.stringify({ type: 'start', mode: 'dictation' }))
  s.handleAudio(Buffer.alloc(5000))
  await s.handleMessage(JSON.stringify({ type: 'stop' }))
  assert.equal(persistCalled, false)
  assert.equal((out.sent.at(-1) as { transcriptId?: string }).transcriptId, undefined)
})

test('session: invalid control message → error, session survives', async () => {
  const out = collect()
  const s = new RealtimeSession(P, fakeTranscriber, null, out, 1_000_000)
  await s.handleMessage(JSON.stringify({ type: 'bogus' }))
  assert.equal(out.sent[0].type, 'error')
  await s.handleMessage(JSON.stringify({ type: 'start', mode: 'dictation' }))
  assert.equal(out.sent.at(-1)!.type, 'ready')
})

test('session: transcriber failure emits error but stream continues', async () => {
  const out = collect()
  let calls = 0
  const flaky: Transcriber = async (audio) => {
    calls++
    if (calls === 1) throw new Error('stt hiccup')
    return { text: 'recovered', duration: 5, language: 'en' }
  }
  const s = new RealtimeSession(P, flaky, null, out, 1_000_000)
  await s.handleMessage(JSON.stringify({ type: 'start', mode: 'dictation' }))
  s.handleAudio(Buffer.alloc(5000))
  ;(s as never as { enqueueWindow(d: boolean): void })['enqueueWindow'](true)
  s.handleAudio(Buffer.alloc(5000))
  await s.handleMessage(JSON.stringify({ type: 'stop' }))

  assert.ok(out.sent.some(m => m.type === 'error' && /hiccup/.test((m as { error: string }).error)))
  assert.ok(out.sent.some(m => m.type === 'final' && (m as { text: string }).text === 'recovered'))
})
