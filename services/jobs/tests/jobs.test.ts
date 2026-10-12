// Gate tests: job state machine + webhook payload shape. Pure, no DB/queue.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canTransition, assertTransition, buildWebhookPayload,
  nextWebhookDelayMs, signWebhookBody, verifyWebhookSignature,
} from '../src/state.ts'

test('legal transitions', () => {
  assert.equal(canTransition('queued', 'running'), true)
  assert.equal(canTransition('queued', 'canceled'), true)
  assert.equal(canTransition('running', 'succeeded'), true)
  assert.equal(canTransition('running', 'failed'), true)
  assert.equal(canTransition('failed', 'queued'), true) // manual retry
})

test('illegal transitions throw', () => {
  assert.equal(canTransition('queued', 'succeeded'), false)   // must run first
  assert.equal(canTransition('succeeded', 'running'), false)  // terminal
  assert.equal(canTransition('canceled', 'queued'), false)    // terminal
  assert.throws(() => assertTransition('succeeded', 'failed'), /Illegal job transition/)
})

test('webhook payload has the stable contract shape', () => {
  const p = buildWebhookPayload({
    id: 'job-1', status: 'succeeded' as never, transcript_id: 't-1', error: null,
  })
  assert.equal(p.event, 'job.succeeded')
  assert.equal(p.jobId, 'job-1')
  assert.equal(p.transcriptId, 't-1')
  assert.equal(p.error, null)
  assert.ok(!Number.isNaN(Date.parse(p.ts)))
  assert.deepEqual(Object.keys(p).sort(), ['error', 'event', 'jobId', 'status', 'transcriptId', 'ts'])
})

test('failed webhook payload carries the error', () => {
  const p = buildWebhookPayload({
    id: 'job-2', status: 'failed' as never, transcript_id: null, error: 'stt unreachable',
  })
  assert.equal(p.event, 'job.failed')
  assert.equal(p.error, 'stt unreachable')
  assert.equal(p.transcriptId, null)
})

test('webhook signatures are HMAC timestamped and verified with tolerance', () => {
  const body = JSON.stringify({ event: 'job.succeeded' })
  const header = signWebhookBody(body, 'secret', 1_000)
  const realNow = Date.now
  Date.now = () => 1_100_000
  try {
    assert.equal(verifyWebhookSignature(body, header, 'secret'), true)
    assert.equal(verifyWebhookSignature(body, header, 'wrong'), false)
  } finally {
    Date.now = realNow
  }
})

test('webhook retry delay backs off with a cap', () => {
  assert.equal(nextWebhookDelayMs(0), 1000)
  assert.equal(nextWebhookDelayMs(3), 8000)
  assert.equal(nextWebhookDelayMs(20), 60000)
})
