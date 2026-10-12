import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import type pg from 'pg'
import type { IntegrationEvent, Principal } from '@semaje/schemas'
import { getPool } from '@semaje/db'
import { exportTranscript, type ExportFormat, type ExportableTranscript } from '../../transcripts/src/exports.ts'
import { nextWebhookDelayMs, signWebhookBody } from '../../jobs/src/state.ts'

export type DeliveryAdapter = 'local' | 'nextcloud' | 'slack' | 'teams' | 'email'

export function integrationStatus() {
  const strictLocal = process.env.STRICT_LOCAL_MODE === 'true'
  return {
    sharing: {
      enabled: !strictLocal && process.env.SHARING_ENABLED !== 'false',
      localOnly: process.env.SHARE_LOCAL_ONLY === 'true',
    },
    adapters: {
      local: Boolean(process.env.INTEGRATION_FILE_SYNC_DIR),
      nextcloud: !strictLocal && Boolean(process.env.NEXTCLOUD_WEBDAV_URL && process.env.NEXTCLOUD_USERNAME && process.env.NEXTCLOUD_PASSWORD),
      slack: !strictLocal && Boolean(process.env.SLACK_WEBHOOK_URL),
      teams: !strictLocal && Boolean(process.env.TEAMS_WEBHOOK_URL),
      email: !strictLocal && Boolean(process.env.SMTP_URL),
    },
    webhookSigning: !strictLocal && Boolean(process.env.WEBHOOK_SECRET),
    strictLocal,
  }
}

async function recordDelivery(
  principal: Principal, adapter: string, event: string, status: 'succeeded' | 'failed',
  destination: string, transcriptId: string | null, error: string | null,
  pool: pg.Pool,
) {
  await pool.query(
    `INSERT INTO integration_deliveries
       (org_id, transcript_id, event, adapter, destination, status, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [principal.orgId, transcriptId, event, adapter, destination, status, error],
  )
}

async function postWebhook(url: string, body: string) {
  const secret = process.env.WEBHOOK_SECRET || 'change-me-webhooks'
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
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
    } catch (error) {
      if (attempt === 3) throw error
      await new Promise(resolve => setTimeout(resolve, nextWebhookDelayMs(attempt)))
    }
  }
}

export async function emitIntegrationEvent(
  principal: Principal, event: IntegrationEvent, data: Record<string, unknown>,
  pool: pg.Pool = getPool(),
) {
  if (process.env.STRICT_LOCAL_MODE === 'true') return []
  const rows = (await pool.query(
    `SELECT id, url FROM webhooks
     WHERE org_id = $1 AND disabled_at IS NULL AND $2 = ANY(events)`,
    [principal.orgId, event],
  )).rows
  const body = JSON.stringify({ event, data, ts: new Date().toISOString() })
  const results = []
  for (const row of rows) {
    const destination = new URL(row.url).host
    try {
      await postWebhook(row.url, body)
      await recordDelivery(principal, 'webhook', event, 'succeeded', destination, String(data.transcriptId || '') || null, null, pool)
      results.push({ id: row.id, status: 'succeeded' })
    } catch (error: any) {
      await recordDelivery(principal, 'webhook', event, 'failed', destination, String(data.transcriptId || '') || null, error.message, pool)
      results.push({ id: row.id, status: 'failed', error: error.message })
    }
  }
  return results
}

function safeFilename(title: string) {
  return title.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'transcript'
}

export async function deliverTranscript(
  principal: Principal, transcript: ExportableTranscript, adapter: DeliveryAdapter,
  format: Extract<ExportFormat, 'md' | 'json' | 'actions.csv'>, recipient?: string,
  pool: pg.Pool = getPool(),
) {
  const status = integrationStatus().adapters
  if (process.env.STRICT_LOCAL_MODE === 'true' && adapter !== 'local') {
    const error = new Error('External connectors are disabled in strict local mode') as Error & { status?: number }
    error.status = 403
    throw error
  }
  if (!status[adapter]) {
    const error = new Error(`${adapter} integration is not configured`) as Error & { status?: number }
    error.status = 409
    throw error
  }
  const exported = exportTranscript(format, transcript)
  const filename = `${safeFilename(transcript.title)}.${exported.extension}`
  let destination: string = adapter
  try {
    if (adapter === 'local') {
      const directory = process.env.INTEGRATION_FILE_SYNC_DIR!
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, filename), exported.body, 'utf8')
      destination = directory
    } else if (adapter === 'nextcloud') {
      const root = process.env.NEXTCLOUD_WEBDAV_URL!.replace(/\/$/, '')
      const response = await fetch(`${root}/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.NEXTCLOUD_USERNAME}:${process.env.NEXTCLOUD_PASSWORD}`).toString('base64')}`,
          'Content-Type': exported.mimeType,
        },
        body: exported.body,
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`Nextcloud returned HTTP ${response.status}`)
      destination = new URL(root).host
    } else if (adapter === 'slack' || adapter === 'teams') {
      const url = adapter === 'slack' ? process.env.SLACK_WEBHOOK_URL! : process.env.TEAMS_WEBHOOK_URL!
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: exported.body.slice(0, 35_000) }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`${adapter} returned HTTP ${response.status}`)
      destination = new URL(url).host
    } else {
      if (!recipient) {
        const error = new Error('Email delivery requires a recipient') as Error & { status?: number }
        error.status = 400
        throw error
      }
      const transport = nodemailer.createTransport(process.env.SMTP_URL!)
      await transport.sendMail({
        from: process.env.SMTP_FROM || 'semaje@localhost', to: recipient,
        subject: `semaje notes: ${transcript.title}`, text: exported.body,
        attachments: [{ filename, content: exported.body, contentType: exported.mimeType }],
      })
      destination = recipient
    }
    await recordDelivery(principal, adapter, 'transcript.delivered', 'succeeded', destination, transcript.id || null, null, pool)
    return { adapter, filename, destination, status: 'succeeded' as const }
  } catch (error: any) {
    await recordDelivery(principal, adapter, 'transcript.delivered', 'failed', destination, transcript.id || null, error.message, pool)
    throw error
  }
}
