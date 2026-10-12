import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderPrometheus } from '../src/index.ts'

test('Prometheus output includes queues, storage, compute, and quality without invalid numbers', () => {
  const snapshot = {
    generatedAt: new Date(0).toISOString(),
    queue: { total: 8, queued: 2, running: 1, succeeded: 4, failed: 1, averageLatencySec: 3.2, p95LatencySec: 8, averageProcessingSec: 12, p95ProcessingSec: 30, workerSlots: 1 },
    failures: [],
    compute: [{ backend: 'faster-whisper', model: 'base', jobs: 4, runtimeSec: 40, audioSec: 100, realtimeFactor: 0.4 }],
    storage: { totalBytes: 2048, sources: [{ source: 'meeting', bytes: 2048, blobs: 2 }] },
    quality: { transcripts: 4, averageConfidence: 0.91, lowConfidenceSegments: 2, diarizationCoverage: 0.75, timedSegments: 18, wer: { average: 0.12, model: 'base' } },
    recentJobs: [],
  }
  const output = renderPrometheus(snapshot as never)
  assert.match(output, /semaje_jobs_total\{status="queued"\} 2/)
  assert.match(output, /semaje_storage_bytes\{source="meeting"\} 2048/)
  assert.match(output, /semaje_stt_realtime_factor\{backend="faster-whisper",model="base"\} 0.4/)
  assert.match(output, /semaje_wer\{model="base"\} 0.12/)
  assert.equal(output.includes('NaN'), false)
})
