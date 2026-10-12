// The transcription worker — consumes the queue and runs the full pipeline:
// storage → stt → pipeline routing → (llm?) → transcripts. Progress and
// state land on the user-facing jobs row; webhook fires on terminal states.
import type pg from 'pg'
import { getPool } from '@semaje/db'
import { JobInput } from '@semaje/schemas'
import { getStorage } from '../../storage/src/index.ts'
import { sttTranscribe } from '../../stt/client/index.ts'
import { needsLlm, renderPlainTranscript, buildTranscriptContext } from '../../pipeline/src/index.ts'
import { runWithFallback } from '../../llm/src/index.ts'
import { runMeetingWithFallback } from '../../llm/src/structured.ts'
import { getWorkspaceLlmConfig } from '../../llm/src/settings.ts'
import { indexTranscriptEmbedding } from '../../search/src/index.ts'
import { emitIntegrationEvent } from '../../integrations/src/index.ts'
import { logError, logInfo, logWarn } from '../../observability/src/logger.ts'
import { createTranscript } from '../../transcripts/src/index.ts'
import {
  applyGlossary, cleanupPunctuation, speakerLabels, summarizeQuality,
} from '../../transcripts/src/quality.ts'
import { getBoss, markJob, notifyWebhook, QUEUE_TRANSCRIBE } from './index.ts'
// @ts-ignore — plain JS prompt library (single source of task prompts)
import { buildPrompt } from '../../../src/utils/promptBuilder.js'

export async function processJob(jobId: string, pool: pg.Pool = getPool()): Promise<void> {
  const found = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [jobId])
  const job = found.rows[0]
  if (!job || job.status !== 'queued') return

  const running = await markJob(jobId, 'queued', 'running', {}, pool)
  if (!running) return
  const queueLatencySec = Math.max(0, (Date.now() - new Date(job.created_at).getTime()) / 1000)
  logInfo('job.started', { jobId, orgId: job.org_id, queueLatencySec: Number(queueLatencySec.toFixed(3)), attempt: Number(job.attempts || 0) + 1 })

  const principal = {
    userId: job.owner_id, orgId: job.org_id,
    role: 'owner' as const, scopes: [], via: 'jwt' as const,
  }

  try {
    const input = JobInput.parse(job.input)

    // 1. Fetch audio from storage
    const blobRow = (await pool.query(
      `SELECT * FROM audio_blobs WHERE id = $1 AND org_id = $2`,
      [input.audioBlobId, job.org_id],
    )).rows[0]
    if (!blobRow) throw new Error(`audio blob ${input.audioBlobId} not found`)
    const storage = await getStorage()
    const audio = await storage.get(blobRow.storage_key)
    await pool.query(`UPDATE jobs SET progress = 20 WHERE id = $1`, [jobId])

    // 2. Speech-to-text (engine chosen per language by the STT service)
    const sttStartedAt = performance.now()
    const engine = String(input.options.engine || 'auto')
    let stt = await sttTranscribe(
      audio, blobRow.storage_key.split('/').pop() || 'audio.bin', blobRow.mime_type,
      {
        language: input.language,
        diarize: input.task === 'diarization' || input.options.speakerLabels === true,
        engine: engine === 'whisper' || engine === 'omnilingual' ? engine : 'auto',
        enhance: input.options.enhance === true,
        requestId: `job-${jobId}`,
      },
    )
    const glossaryTerms = (await pool.query(
      `SELECT term, replacement FROM glossary_terms WHERE org_id = $1 ORDER BY length(term) DESC`,
      [job.org_id],
    )).rows
    const glossaryResult = applyGlossary(stt, glossaryTerms)
    stt = input.options.polish ? cleanupPunctuation(glossaryResult) : glossaryResult
    const qualityMeta = summarizeQuality(stt, glossaryResult.glossaryMatches)
    const runtimeSec = (performance.now() - sttStartedAt) / 1000
    const processingMeta: Record<string, unknown> = {
      backend: stt.backend,
      engine: stt.engine ?? 'whisper',
      model: stt.model,
      language: stt.language,
      languageCode: stt.languageCode ?? null,
      routing: stt.routing ?? null,
      audio: stt.audio ?? null,
      durationSec: stt.duration,
      runtimeSec: Number(runtimeSec.toFixed(3)),
      realtimeFactor: Number((runtimeSec / Math.max(stt.duration, 0.001)).toFixed(3)),
      device: process.env.STT_DEVICE || process.env.WHISPER_DEVICE || 'auto',
      queueLatencySec: Number(queueLatencySec.toFixed(3)),
    }
    await pool.query(
      `UPDATE jobs SET progress = 70, processing_meta = processing_meta || $2::jsonb WHERE id = $1`,
      [jobId, JSON.stringify(processingMeta)],
    )

    // 3. Route: plain Whisper or LLM task
    let text: string
    let result: unknown = null
    if (!needsLlm(input.task, input.options)) {
      text = renderPlainTranscript(stt, input.options)
    } else {
      const ctx = buildTranscriptContext(input.task, stt)
      const config = await getWorkspaceLlmConfig(job.org_id, pool)
      if (input.task === 'meeting') {
        const enriched = await runMeetingWithFallback(config, ctx, config.preset)
        text = stt.text
        result = enriched.result
        processingMeta.llm = { ...enriched.meta, fallbackUsed: enriched.fallbackUsed }
      } else {
        const prompt = buildPrompt(input.task, input.options)
        const generated = await runWithFallback(config, prompt, ctx)
        text = input.task === 'transcription' ? generated.text : stt.text
        result = input.task === 'transcription' ? null : generated.text
        processingMeta.llm = { ...generated.meta, fallbackUsed: generated.fallbackUsed }
      }
    }
    await pool.query(
      `UPDATE jobs SET progress = 90, processing_meta = $2::jsonb WHERE id = $1`,
      [jobId, JSON.stringify(processingMeta)],
    )

    // 4. Persist transcript
    const transcript = await createTranscript(principal, {
      title: input.title,
      source: input.source,
      task: input.task,
      language: stt.languageCode || stt.language,
      durationSec: stt.duration,
      text,
      segments: stt.segments,
      result,
      audioBlobId: input.audioBlobId,
      speakerLabels: speakerLabels(stt.segments),
      qualityMeta,
    }, pool)
    await pool.query(
      `UPDATE transcripts SET processing_meta = $2::jsonb WHERE id = $1`,
      [transcript.id, JSON.stringify(processingMeta)],
    )
    if (process.env.EMBEDDING_ENABLED === 'true') {
      try {
        const config = await getWorkspaceLlmConfig(job.org_id, pool)
        const embedded = await indexTranscriptEmbedding(principal, transcript, {
          endpoint: config.endpoint, model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
        }, pool)
        processingMeta.embedding = embedded
        await pool.query(
          `UPDATE transcripts SET processing_meta = $2::jsonb WHERE id = $1`,
          [transcript.id, JSON.stringify(processingMeta)],
        )
      } catch (error: any) {
        logWarn('embedding.skipped', { jobId, transcriptId: transcript.id, error: error.message })
      }
    }

    const done = await markJob(jobId, 'running', 'succeeded',
      { transcript_id: transcript.id, progress: 100 }, pool)
    if (done) {
      logInfo('job.succeeded', { jobId, orgId: job.org_id, transcriptId: transcript.id, model: stt.model, runtimeSec: processingMeta.runtimeSec, realtimeFactor: processingMeta.realtimeFactor })
      await notifyWebhook(done)
      try {
        await emitIntegrationEvent(principal, 'job.succeeded', {
          jobId: done.id, transcriptId: transcript.id, title: transcript.title,
        }, pool)
      } catch (error: any) {
        logWarn('integration.skipped', { jobId, event: 'job.succeeded', error: error.message })
      }
    }
  } catch (e: any) {
    logError('job.failed', { jobId, orgId: job.org_id, error: e.message })
    const failed = await markJob(jobId, 'running', 'failed', { error: e.message }, pool)
    if (failed) {
      await notifyWebhook(failed)
      try {
        await emitIntegrationEvent(principal, 'job.failed', {
          jobId: failed.id, transcriptId: failed.transcript_id, error: failed.error,
        }, pool)
      } catch (error: any) {
        logWarn('integration.skipped', { jobId, event: 'job.failed', error: error.message })
      }
    }
  }
}

export async function startWorker(): Promise<void> {
  const boss = await getBoss()
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1))
  for (let slot = 0; slot < concurrency; slot += 1) {
    await boss.work(QUEUE_TRANSCRIBE, { batchSize: 1 }, async (jobs) => {
      for (const j of jobs) {
        const { jobId } = j.data as { jobId: string }
        await processJob(jobId)
      }
    })
  }
  logInfo('worker.ready', { queue: QUEUE_TRANSCRIBE, concurrency })
}
