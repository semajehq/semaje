import { readFile } from 'node:fs/promises'
import type pg from 'pg'
import type { Principal } from '@semaje/schemas'
import { getPool } from '@semaje/db'

const number = (value: unknown) => Number(value || 0)

export async function readWerReport(path = process.env.OBSERVABILITY_WER_REPORT || 'data/observability/stt-eval.json') {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch { return null }
}

export async function getOperationsSnapshot(
  principal: Principal, pool: pg.Pool = getPool(),
) {
  const orgId = principal.orgId
  const [jobs, failures, models, storage, quality, recent] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'queued')::int AS queued,
              count(*) FILTER (WHERE status = 'running')::int AS running,
              count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              avg(EXTRACT(epoch FROM started_at - created_at)) FILTER (WHERE started_at IS NOT NULL) AS queue_avg_sec,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM started_at - created_at)) FILTER (WHERE started_at IS NOT NULL) AS queue_p95_sec,
              avg(EXTRACT(epoch FROM finished_at - started_at)) FILTER (WHERE finished_at IS NOT NULL AND started_at IS NOT NULL) AS process_avg_sec,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM finished_at - started_at)) FILTER (WHERE finished_at IS NOT NULL AND started_at IS NOT NULL) AS process_p95_sec
       FROM jobs WHERE org_id = $1`, [orgId],
    ),
    pool.query(
      `SELECT left(error, 180) AS error, count(*)::int AS count, max(finished_at) AS last_seen
       FROM jobs WHERE org_id = $1 AND status = 'failed' AND error IS NOT NULL
       GROUP BY left(error, 180) ORDER BY count(*) DESC, max(finished_at) DESC LIMIT 8`, [orgId],
    ),
    pool.query(
      `SELECT processing_meta->>'backend' AS backend, processing_meta->>'model' AS model,
              count(*)::int AS jobs,
              sum(COALESCE((processing_meta->>'runtimeSec')::double precision, 0)) AS runtime_sec,
              sum(COALESCE((processing_meta->>'durationSec')::double precision, 0)) AS audio_sec,
              avg((processing_meta->>'realtimeFactor')::double precision) FILTER (WHERE processing_meta ? 'realtimeFactor') AS realtime_factor
       FROM jobs WHERE org_id = $1 AND processing_meta ? 'model'
       GROUP BY 1, 2 ORDER BY count(*) DESC`, [orgId],
    ),
    pool.query(
      `SELECT COALESCE(t.source, 'unlinked') AS source, count(DISTINCT b.id)::int AS blobs,
              COALESCE(sum(b.size_bytes), 0)::bigint AS bytes
       FROM audio_blobs b
       LEFT JOIN LATERAL (
         SELECT source FROM transcripts WHERE org_id = b.org_id AND audio_blob_id = b.id LIMIT 1
       ) t ON true
       WHERE b.org_id = $1 GROUP BY 1 ORDER BY sum(b.size_bytes) DESC`, [orgId],
    ),
    pool.query(
      `SELECT count(*)::int AS transcripts,
              avg(NULLIF(quality_meta->>'averageConfidence', '')::double precision) AS average_confidence,
              sum(COALESCE((quality_meta->>'lowConfidenceSegments')::int, 0))::int AS low_confidence_segments,
              avg(NULLIF(quality_meta->>'diarizationCoverage', '')::double precision) AS diarization_coverage,
              sum(COALESCE((quality_meta->>'timedSegments')::int, 0))::int AS timed_segments
       FROM transcripts WHERE org_id = $1`, [orgId],
    ),
    pool.query(
      `SELECT id, status, error, attempts, progress, created_at, started_at, finished_at,
              input->>'title' AS title, input->>'task' AS task, input->>'source' AS source,
              processing_meta, transcript_id
       FROM jobs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 20`, [orgId],
    ),
  ])
  const row = jobs.rows[0] || {}
  const storageRows = storage.rows.map(item => ({ ...item, bytes: number(item.bytes), blobs: number(item.blobs) }))
  const modelRows = models.rows.map(item => ({
    ...item, jobs: number(item.jobs), runtimeSec: number(item.runtime_sec), audioSec: number(item.audio_sec),
    realtimeFactor: number(item.realtime_factor),
  }))
  return {
    generatedAt: new Date().toISOString(),
    queue: {
      total: number(row.total), queued: number(row.queued), running: number(row.running),
      succeeded: number(row.succeeded), failed: number(row.failed),
      averageLatencySec: number(row.queue_avg_sec), p95LatencySec: number(row.queue_p95_sec),
      averageProcessingSec: number(row.process_avg_sec), p95ProcessingSec: number(row.process_p95_sec),
      workerSlots: Math.max(1, number(process.env.WORKER_CONCURRENCY || 1)),
    },
    failures: failures.rows,
    compute: modelRows,
    storage: {
      totalBytes: storageRows.reduce((sum, item) => sum + item.bytes, 0), sources: storageRows,
    },
    quality: {
      transcripts: number(quality.rows[0]?.transcripts),
      averageConfidence: quality.rows[0]?.average_confidence == null ? null : number(quality.rows[0].average_confidence),
      lowConfidenceSegments: number(quality.rows[0]?.low_confidence_segments),
      diarizationCoverage: quality.rows[0]?.diarization_coverage == null ? null : number(quality.rows[0].diarization_coverage),
      timedSegments: number(quality.rows[0]?.timed_segments),
      wer: await readWerReport(),
    },
    recentJobs: recent.rows,
  }
}

function metric(name: string, value: number, labels: Record<string, string> = {}) {
  const suffix = Object.keys(labels).length
    ? `{${Object.entries(labels).map(([key, label]) => `${key}=${JSON.stringify(label)}`).join(',')}}`
    : ''
  return `${name}${suffix} ${Number.isFinite(value) ? value : 0}`
}

export function renderPrometheus(snapshot: Awaited<ReturnType<typeof getOperationsSnapshot>>) {
  const lines = [
    '# HELP semaje_jobs_total Jobs by current state.', '# TYPE semaje_jobs_total gauge',
    ...(['queued', 'running', 'succeeded', 'failed'] as const).map(status => metric('semaje_jobs_total', snapshot.queue[status], { status })),
    '# HELP semaje_queue_latency_seconds Time spent waiting for a worker.', '# TYPE semaje_queue_latency_seconds gauge',
    metric('semaje_queue_latency_seconds', snapshot.queue.averageLatencySec, { quantile: 'average' }),
    metric('semaje_queue_latency_seconds', snapshot.queue.p95LatencySec, { quantile: 'p95' }),
    '# HELP semaje_processing_seconds End-to-end worker processing time.', '# TYPE semaje_processing_seconds gauge',
    metric('semaje_processing_seconds', snapshot.queue.averageProcessingSec, { quantile: 'average' }),
    metric('semaje_processing_seconds', snapshot.queue.p95ProcessingSec, { quantile: 'p95' }),
    '# HELP semaje_storage_bytes Audio storage by source.', '# TYPE semaje_storage_bytes gauge',
    ...snapshot.storage.sources.map(source => metric('semaje_storage_bytes', source.bytes, { source: source.source })),
    '# HELP semaje_stt_realtime_factor Mean STT runtime divided by audio duration.', '# TYPE semaje_stt_realtime_factor gauge',
    ...snapshot.compute.map(model => metric('semaje_stt_realtime_factor', model.realtimeFactor, { backend: model.backend || 'unknown', model: model.model || 'unknown' })),
    '# HELP semaje_transcript_confidence Mean transcript confidence.', '# TYPE semaje_transcript_confidence gauge',
    metric('semaje_transcript_confidence', snapshot.quality.averageConfidence || 0),
    '# HELP semaje_diarization_coverage Share of timed segments with a speaker.', '# TYPE semaje_diarization_coverage gauge',
    metric('semaje_diarization_coverage', snapshot.quality.diarizationCoverage || 0),
  ]
  if (snapshot.quality.wer?.average != null) {
    lines.push('# HELP semaje_wer Word error rate from the latest local evaluation.', '# TYPE semaje_wer gauge')
    lines.push(metric('semaje_wer', number(snapshot.quality.wer.average), { model: snapshot.quality.wer.model || 'unknown' }))
  }
  return `${lines.join('\n')}\n`
}
