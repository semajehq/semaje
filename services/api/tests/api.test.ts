// Gate tests: the gateway with a fake pool — validation 400s, auth 401s,
// tenancy-scoped reads, share flow. No Postgres, no Whisper, no network
// beyond localhost loopback to the ephemeral test server.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { _setPool } from '@semaje/db'
import { signAccessToken, _resetSeed } from '../../auth/src/index.ts'
import { createApp } from '../src/app.ts'

const ORG_A = '22222222-2222-4222-8222-222222222222'
const USER_A = '11111111-1111-4111-8111-111111111111'
const T_ID = '44444444-4444-4444-8444-444444444444'

// Scriptable fake pg pool: routes by SQL shape.
const db = {
  transcripts: new Map<string, Record<string, unknown>>(),
  shares: new Map<string, Record<string, unknown>>(),
  botRuns: [] as Record<string, unknown>[],
  revisions: [] as Record<string, unknown>[],
}
const fakePool = {
  connect() {
    return Promise.resolve({ ...fakePool, release() {} })
  },
  query(text: string, values: unknown[] = []) {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return Promise.resolve({ rows: [] })
    if (text.includes('SELECT id FROM orgs ORDER BY created_at')) return Promise.resolve({ rows: [{ id: ORG_A }] })
    if (text.includes('INSERT INTO transcripts')) {
      const row = {
        id: T_ID, org_id: values[0], owner_id: values[1], title: values[2],
        source: values[3], task: values[4], language: values[5], duration_sec: values[6],
        text: values[7], segments: values[8], result: values[9], audio_blob_id: values[10],
        status: 'complete', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      db.transcripts.set(`${row.org_id}:${row.id}`, row)
      return Promise.resolve({ rows: [row] })
    }
    if (text.includes('FROM transcripts') && text.includes('WHERE org_id = $1 AND id = $2')) {
      const row = db.transcripts.get(`${values[0]}:${values[1]}`)
      return Promise.resolve({ rows: row ? [row] : [] })
    }
    if (text.includes('FROM transcripts') && text.includes('WHERE org_id = $1')) {
      const rows = [...db.transcripts.values()].filter(r => r.org_id === values[0])
      return Promise.resolve({ rows })
    }
    if (text.includes('INSERT INTO transcript_revisions')) {
      const row = { id: `revision-${db.revisions.length + 1}`, transcript_id: values[0], reason: values[6], created_at: new Date().toISOString() }
      db.revisions.unshift(row)
      return Promise.resolve({ rows: [row] })
    }
    if (text.includes('SELECT id, reason, created_at FROM transcript_revisions')) {
      return Promise.resolve({ rows: db.revisions.filter(row => row.transcript_id === values[0]) })
    }
    if (text.includes('UPDATE transcripts SET') && text.includes('updated_at = now()')) {
      const row = db.transcripts.get(`${values[0]}:${values[1]}`)
      if (!row) return Promise.resolve({ rows: [] })
      row.title = values[2] || row.title
      row.text = values[3]
      row.segments = values[4]
      row.updated_at = new Date().toISOString()
      return Promise.resolve({ rows: [row] })
    }
    if (text.includes('INSERT INTO shares')) {
      const row = { id: 'share-1', transcript_id: values[0], token: values[1], permission: values[2], expires_at: values[3] }
      db.shares.set(String(values[1]), row)
      return Promise.resolve({ rows: [row] })
    }
    if (text.includes('FROM shares s JOIN transcripts t')) {
      const share = db.shares.get(String(values[0]))
      if (!share) return Promise.resolve({ rows: [] })
      const t = [...db.transcripts.values()].find(r => r.id === share.transcript_id)
      return Promise.resolve({ rows: t ? [{ ...t, permission: share.permission, expires_at: null }] : [] })
    }
    if (text.includes('INSERT INTO meeting_bot_runs')) {
      const row = {
        id: 'bot-run-1',
        org_id: values[0],
        calendar_event_id: values[1],
        provider: values[2],
        join_url: values[3],
        state: 'invited',
        job_id: null,
        transcript_id: null,
        error: null,
        started_at: null,
        finished_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      db.botRuns.unshift(row)
      return Promise.resolve({ rows: [row] })
    }
    if (text.includes('FROM meeting_bot_runs WHERE org_id = $1 AND id = $2')) {
      const row = db.botRuns.find(r => r.org_id === values[0] && r.id === values[1])
      return Promise.resolve({ rows: row ? [row] : [] })
    }
    if (text.includes('UPDATE meeting_bot_runs')) {
      const row = db.botRuns.find(r => r.org_id === values[0] && r.id === values[1])
      if (!row) return Promise.resolve({ rows: [] })
      row.state = 'left'
      row.transcript_id = values[2]
      row.started_at = new Date().toISOString()
      row.finished_at = new Date().toISOString()
      row.updated_at = new Date().toISOString()
      return Promise.resolve({ rows: [row] })
    }
    if (text.includes('FROM meeting_bot_runs WHERE org_id = $1')) {
      return Promise.resolve({ rows: db.botRuns.filter(r => r.org_id === values[0]) })
    }
    return Promise.resolve({ rows: [] })
  },
}

let server: Server
let base = ''
const tokenA = signAccessToken({ userId: USER_A, orgId: ORG_A, role: 'owner', scopes: [] })
const tokenB = signAccessToken({
  userId: '55555555-5555-4555-8555-555555555555',
  orgId: '66666666-6666-4666-8666-666666666666', role: 'owner', scopes: [],
})

before(async () => {
  process.env.AUTH_ADAPTER = 'local-db' // force credentialed mode for auth tests
  _resetSeed()
  _setPool(fakePool)
  server = createServer(createApp({ enableJobs: false }))
  await new Promise<void>(r => server.listen(0, () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await new Promise<void>(r => server.close(() => r()))
  _setPool(null)
  process.env.AUTH_ADAPTER = 'single-user'
})

test('health endpoint answers without auth', async () => {
  const res = await fetch(`${base}/api/health`)
  assert.equal(res.status, 200)
  const body = await res.json() as { name: string }
  assert.equal(body.name, 'semaje')
})

test('Prometheus metrics require the configured bearer token', async () => {
  process.env.METRICS_TOKEN = 'metrics-test-token'
  try {
    const denied = await fetch(`${base}/metrics`)
    assert.equal(denied.status, 403)
    const allowed = await fetch(`${base}/metrics`, { headers: { Authorization: 'Bearer metrics-test-token' } })
    assert.equal(allowed.status, 200)
    assert.match(await allowed.text(), /semaje_jobs_total/)
  } finally { delete process.env.METRICS_TOKEN }
})

test('local-db mode: transcript routes require auth (401)', async () => {
  const res = await fetch(`${base}/api/transcripts`)
  assert.equal(res.status, 401)
})

test('zod validation rejects a bad create payload (400 with details)', async () => {
  const res = await fetch(`${base}/api/transcripts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ task: 'nonsense-task' }), // missing text, bad enum
  })
  assert.equal(res.status, 400)
  const body = await res.json() as { error: string; details: string[] }
  assert.equal(body.error, 'Invalid request')
  assert.ok(body.details.some(d => d.startsWith('text')))
})

test('create + fetch a transcript with a valid JWT', async () => {
  const create = await fetch(`${base}/api/transcripts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ text: 'hello library', task: 'transcription', source: 'upload' }),
  })
  assert.equal(create.status, 201)
  const { transcript } = await create.json() as { transcript: { id: string } }

  const get = await fetch(`${base}/api/transcripts/${transcript.id}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert.equal(get.status, 200)
})

test('manual correction persists and creates a revision entry', async () => {
  const patch = await fetch(`${base}/api/transcripts/${T_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ text: 'hello corrected library', reason: 'fixed product name' }),
  })
  assert.equal(patch.status, 200)
  const body = await patch.json() as { transcript: { text: string } }
  assert.equal(body.transcript.text, 'hello corrected library')

  const history = await fetch(`${base}/api/transcripts/${T_ID}/revisions`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert.equal(history.status, 200)
  const historyBody = await history.json() as { revisions: { reason: string }[] }
  assert.equal(historyBody.revisions[0].reason, 'fixed product name')
})

test('cross-org access is blocked: org B cannot read org A transcripts', async () => {
  const res = await fetch(`${base}/api/transcripts/${T_ID}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  })
  assert.equal(res.status, 404) // org-scoped query: the row simply doesn't exist for B
  const list = await fetch(`${base}/api/transcripts`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  })
  const body = await list.json() as { transcripts: unknown[] }
  assert.equal(body.transcripts.length, 0)
})

test('share flow: create link share, resolve it WITHOUT auth', async () => {
  const create = await fetch(`${base}/api/transcripts/${T_ID}/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({}),
  })
  assert.equal(create.status, 201)
  const { share } = await create.json() as { share: { token: string } }

  const pub = await fetch(`${base}/api/share/${share.token}`) // no auth header
  assert.equal(pub.status, 200)
  const body = await pub.json() as { transcript: { text: string } }
  assert.equal(body.transcript.text, 'hello corrected library')
})

test('strict deployment mode disables public share resolution globally', async () => {
  const previous = process.env.SHARING_ENABLED
  process.env.SHARING_ENABLED = 'false'
  try {
    const res = await fetch(`${base}/api/share/any-token`)
    assert.equal(res.status, 404)
    const body = await res.json() as { error: string }
    assert.match(body.error, /disabled/i)
  } finally {
    if (previous == null) delete process.env.SHARING_ENABLED
    else process.env.SHARING_ENABLED = previous
  }
})

test('integration status is credential-free and starts with empty routes', async () => {
  const res = await fetch(`${base}/api/integrations`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert.equal(res.status, 200)
  const body = await res.json() as { adapters: Record<string, boolean>; webhooks: unknown[]; deliveries: unknown[] }
  assert.ok(Object.hasOwn(body.adapters, 'local'))
  assert.deepEqual(body.webhooks, [])
  assert.deepEqual(body.deliveries, [])
  assert.equal(JSON.stringify(body).includes('PASSWORD'), false)
})

test('garbage token → 401, garbage share token → 404', async () => {
  const bad = await fetch(`${base}/api/transcripts`, {
    headers: { Authorization: 'Bearer not-a-jwt' },
  })
  assert.equal(bad.status, 401)
  const noShare = await fetch(`${base}/api/share/does-not-exist`)
  assert.equal(noShare.status, 404)
})

test('export validates format', async () => {
  const res = await fetch(`${base}/api/transcripts/${T_ID}/export/docx`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert.equal(res.status, 400)
})

test('meeting bot invite creates an org-scoped invited run', async () => {
  const create = await fetch(`${base}/api/meeting-bot/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ joinUrl: 'https://meet.google.com/abc-defg-hij', title: 'Weekly review' }),
  })
  assert.equal(create.status, 201)
  const body = await create.json() as { run: { provider: string; state: string; join_url: string } }
  assert.equal(body.run.provider, 'meet')
  assert.equal(body.run.state, 'invited')
  assert.equal(body.run.join_url, 'https://meet.google.com/abc-defg-hij')

  const list = await fetch(`${base}/api/meeting-bot/runs`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  const listed = await list.json() as { runs: unknown[] }
  assert.equal(listed.runs.length, 1)
})

test('meeting bot start completes a run and creates meeting notes', async () => {
  const create = await fetch(`${base}/api/meeting-bot/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ joinUrl: 'https://meet.google.com/def-ghij-klm', title: 'Customer call' }),
  })
  assert.equal(create.status, 201)
  const { run } = await create.json() as { run: { id: string } }

  const start = await fetch(`${base}/api/meeting-bot/runs/${run.id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert.equal(start.status, 200)
  const body = await start.json() as { run: { state: string; transcript_id: string }; transcript: { source: string; task: string; text: string }; mode: string }
  assert.equal(body.mode, 'simulated')
  assert.equal(body.run.state, 'left')
  assert.equal(body.run.transcript_id, T_ID)
  assert.equal(body.transcript.source, 'meeting')
  assert.equal(body.transcript.task, 'meeting')
  assert.match(body.transcript.text, /Meeting bot joined/)
})
