// Gate tests: the capture host's session lifecycle with fake media + socket.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore
import { createHost } from '../src/lib/host-core.js'
// @ts-ignore
import { MSG } from '../src/lib/protocol.js'

class FakeTrack { stopped = false; onended?: () => void; stop() { this.stopped = true } }
class FakeStream {
  tracks = [new FakeTrack()]
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks }
}
class FakeRecorder {
  static isTypeSupported(t: string) { return t === 'audio/webm;codecs=opus' }
  state = 'inactive'
  ondataavailable?: (e: any) => void
  listeners: Record<string, () => void> = {}
  constructor(public stream: FakeStream, public opts: any) {}
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: { size: 3, arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer } }); this.listeners.stop?.() }
  addEventListener(name: string, fn: () => void) { this.listeners[name] = fn }
}
class FakeWS {
  static all: FakeWS[] = []
  sent: any[] = []
  readyState = 0
  onopen?: () => void
  onmessage?: (e: any) => void
  onerror?: () => void
  onclose?: () => void
  binaryType = ''
  constructor(public url: string) { FakeWS.all.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
  send(d: any) { this.sent.push(d); if (typeof d === 'string' && JSON.parse(d).type === 'stop') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'end', transcriptId: 'tx-9' }) })) }
  close() { this.readyState = 3; this.onclose?.() }
}

function setup(getUserMedia: (c: any) => Promise<any>) {
  const out: any[] = []
  const host = createHost({
    send: (m: any) => out.push(m),
    mediaDevices: { getUserMedia },
    MediaRecorderImpl: FakeRecorder,
    AudioContextImpl: class { createMediaStreamSource() { return { connect() {} } } close() {} destination = {} },
    WebSocketImpl: FakeWS,
  })
  return { host, out }
}

const flush = () => new Promise(r => setTimeout(r, 10))

test('mic session: opens socket with start frame, streams, stops, reports end with transcript id', async () => {
  const stream = new FakeStream()
  const { host, out } = setup(async () => stream)
  await host.handle({ kind: MSG.HOST_START, sessionId: 's1', capture: 'mic', apiBase: 'http://x.test', apiKey: 'smj_k', language: 'sw', mode: 'dictation', title: 'T' })
  const ws = FakeWS.all.at(-1)!
  assert.equal(ws.url, 'ws://x.test/ws?token=smj_k')
  assert.deepEqual(JSON.parse(ws.sent[0]), { type: 'start', mode: 'dictation', source: 'extension', language: 'sw', title: 'T', mimeType: 'audio/webm;codecs=opus' })
  ws.onmessage?.({ data: JSON.stringify({ type: 'final', text: 'habari', tStart: 0, tEnd: 5 }) })
  assert.deepEqual(out.find(m => m.kind === MSG.HOST_TEXT), { kind: MSG.HOST_TEXT, sessionId: 's1', text: 'habari', tStart: 0, tEnd: 5 })
  assert.equal(host.isBusy(), true)
  await host.handle({ kind: MSG.HOST_STOP, sessionId: 's1' })
  await flush()
  await flush()
  const end = out.find(m => m.kind === MSG.HOST_END)
  assert.deepEqual({ ...end }, { kind: MSG.HOST_END, sessionId: 's1', transcriptId: 'tx-9', text: 'habari' })
  assert.ok(stream.tracks[0].stopped, 'mic released')
  assert.equal(host.sessions.size, 0)
  assert.ok(ws.sent.some(d => d instanceof ArrayBuffer && d.byteLength === 3), 'final chunk flushed before stop')
})

test('tab session requests the tab stream by id', async () => {
  let constraints: any = null
  const { host } = setup(async c => { constraints = c; return new FakeStream() })
  await host.handle({ kind: MSG.HOST_START, sessionId: 't1', capture: 'tab', streamId: 'stream-42', apiBase: 'http://x.test' })
  assert.deepEqual(constraints.audio.mandatory, { chromeMediaSource: 'tab', chromeMediaSourceId: 'stream-42' })
})

test('permission denial is reported as permission-denied, not a crash', async () => {
  const { host, out } = setup(async () => { const e = new Error('denied'); (e as any).name = 'NotAllowedError'; throw e })
  await host.handle({ kind: MSG.HOST_START, sessionId: 'p1', capture: 'mic', apiBase: 'http://x.test' })
  assert.deepEqual(out.at(-1), { kind: MSG.HOST_STATE, sessionId: 'p1', state: 'error', detail: 'permission-denied' })
  assert.equal(host.sessions.size, 0)
})

test('push session relays base64 chunks from a page media tap', async () => {
  const { host } = setup(async () => { throw new Error('should not capture') })
  await host.handle({ kind: MSG.HOST_START, sessionId: 'm1', capture: 'push', apiBase: 'http://x.test', mimeType: 'audio/webm' })
  await host.handle({ kind: MSG.HOST_PUSH, sessionId: 'm1', data: Buffer.from([1, 2, 3, 4]).toString('base64') })
  const ws = FakeWS.all.at(-1)!
  assert.equal(ws.sent.at(-1).byteLength, 4)
})

test('a dropped connection mid-stream ends the session and releases the mic', async () => {
  const stream = new FakeStream()
  const { host, out } = setup(async () => stream)
  await host.handle({ kind: MSG.HOST_START, sessionId: 'd1', capture: 'mic', apiBase: 'http://x.test' })
  FakeWS.all.at(-1)!.close()
  assert.ok(out.some(m => m.kind === MSG.HOST_END && m.sessionId === 'd1'))
  assert.ok(stream.tracks[0].stopped)
  assert.equal(host.isBusy(), false)
})
