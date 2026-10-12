// ═══════════════════════════════════════════════════════════════
// services/jobs — async transcription jobs on pg-boss (Postgres-
// backed queue: no Redis for self-host). API enqueues; the worker
// (worker.ts) consumes; status is polled from the jobs table.
// ═══════════════════════════════════════════════════════════════
import PgBoss from 'pg-boss'
import type pg from 'pg'
import { getPool } from '@semaje/db'
import type { Principal, JobInput } from '@semaje/schemas'
import { assertTransition, buildWebhookPayload, nextWebhookDelayMs, signWebhookBody } from './state.ts'
import { logError, logWarn } from '../../observability/src/logger.ts'

export { canTransition, assertTransition, buildWebhookPayload } from './state.ts'

export const QUEUE_TRANSCRIBE = 'transcribe'

let boss: PgBoss | null = null

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss(process.env.DATABASE_URL || 'postgres://semaje:semaje@localhost:5432/semaje')
    boss.on('error', e => logError('queue.error', { error: e.message }))
    await boss.start()
    await boss.createQueue(QUEUE_TRANSCRIBE)
  }
  return boss
}

export async function stopBoss(): Promise<void> {
  if (boss) { await boss.stop(); boss = null }
}

/** Creates the user-facing job row and enqueues the work. */
export async function enqueueTranscribeJob(
  principal: Principal, input: JobInput, webhookUrl: string | null,
  options: { idempotencyKey?: string; captureMeta?: Record<string, unknown> } = {},
  pool: pg.Pool = getPool(),
) {
  if (options.idempotencyKey) {
    const existing = await pool.query(
      `SELECT * FROM jobs WHERE org_id = $1 AND ingest_key = $2`,
      [principal.orgId, options.idempotencyKey],
    )
    if (existing.rows[0]) return existing.rows[0]
  }
  const maxQueued = Math.max(1, Number(process.env.MAX_QUEUED_JOBS || 100))
  const active = await pool.query(
    `SELECT count(*)::int AS count FROM jobs
     WHERE org_id = $1 AND status IN ('queued', 'running')`,
    [principal.orgId],
  )
  if (Number(active.rows[0]?.count || 0) >= maxQueued) {
    const error = new Error(`Queue capacity reached (${maxQueued}). Retry after a running job finishes.`)
    ;(error as Error & { status?: number }).status = 429
    throw error
  }
  const res = await pool.query(
    `INSERT INTO jobs (org_id, owner_id, type, status, input, webhook_url, ingest_key, capture_meta)
     VALUES ($1, $2, 'transcribe', 'queued', $3, $4, $5, $6) RETURNING *`,
    [
      principal.orgId, principal.userId, JSON.stringify(input), webhookUrl,
      options.idempotencyKey ?? null, JSON.stringify(options.captureMeta ?? {}),
    ],
  )
  const job = res.rows[0]
  const b = await getBoss()
  await b.send(QUEUE_TRANSCRIBE, { jobId: job.id })
  return job
}

export async function getJob(principal: Principal, id: string, pool: pg.Pool = getPool()) {
  const res = await pool.query(
    `SELECT * FROM jobs WHERE org_id = $1 AND id = $2`,
    [principal.orgId, id],
  )
  return res.rows[0] ?? null
}

export async function listJobs(
  principal: Principal, limit = 30, pool: pg.Pool = getPool(),
) {
  const boundedLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 30
  const res = await pool.query(
    `SELECT * FROM jobs WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [principal.orgId, boundedLimit],
  )
  return res.rows
}

export async function retryJob(
  principal: Principal, id: string, pool: pg.Pool = getPool(),
) {
  const found = await getJob(principal, id, pool)
  if (!found) return null
  assertTransition(found.status, 'queued')
  const result = await pool.query(
    `UPDATE jobs SET status = 'queued', error = NULL, progress = 0,
       started_at = NULL, finished_at = NULL
     WHERE id = $1 AND org_id = $2 AND status = 'failed' RETURNING *`,
    [id, principal.orgId],
  )
  const job = result.rows[0]
  if (!job) return null
  const b = await getBoss()
  await b.send(QUEUE_TRANSCRIBE, { jobId: job.id })
  return job
}

export async function markJob(
  id: string, from: string, to: string,
  patch: { transcript_id?: string; error?: string; progress?: number } = {},
  pool: pg.Pool = getPool(),
) {
  assertTransition(from as never, to as never)
  const res = await pool.query(
    `UPDATE jobs SET status = $2,
       transcript_id = COALESCE($3, transcript_id),
       error = $4,
       progress = COALESCE($5, progress),
       started_at = CASE WHEN $2 = 'running' THEN now() ELSE started_at END,
       finished_at = CASE WHEN $2 IN ('succeeded','failed','canceled') THEN now() ELSE finished_at END,
       attempts = attempts + CASE WHEN $2 = 'running' THEN 1 ELSE 0 END
     WHERE id = $1 AND status = $6 RETURNING *`,
    [id, to, patch.transcript_id ?? null, patch.error ?? null, patch.progress ?? null, from],
  )
  return res.rows[0] ?? null
}

/** Fire-and-forget webhook on terminal states. */
export async function notifyWebhook(job: {
  id: string; status: never; transcript_id: string | null; error: string | null; webhook_url: string | null
}): Promise<void> {
  if (!job.webhook_url) return
  if (process.env.STRICT_LOCAL_MODE === 'true') {
    try {
      const host = new URL(job.webhook_url).hostname.toLowerCase()
      const privateHost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
        || host.startsWith('10.') || host.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || !host.includes('.')
      if (!privateHost) return
    } catch { return }
  }
  const payload = buildWebhookPayload(job)
  const body = JSON.stringify(payload)
  const secret = process.env.WEBHOOK_SECRET || 'change-me-webhooks'
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(job.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Semaje-Signature': signWebhookBody(body, secret),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return
    } catch (e: any) {
      if (attempt === 3) {
        logWarn('webhook.delivery_failed', { jobId: job.id, error: e.message })
        return
      }
      await new Promise(resolve => setTimeout(resolve, nextWebhookDelayMs(attempt)))
    }
  }
}
