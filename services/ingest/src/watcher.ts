import 'dotenv/config'
import { createHash } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import { copyFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  archiveName, buildFolderIngestKey, isSupportedMedia, mediaMimeType,
} from './watcher-core.ts'
import { logError, logInfo } from '../../observability/src/logger.ts'

const watchDir = process.env.WATCH_DIR || './data/watch'
const apiBase = (process.env.WATCH_API_BASE || 'http://localhost:3001').replace(/\/$/, '')
const apiKey = process.env.WATCH_API_KEY || ''
const webhookUrl = process.env.WATCH_WEBHOOK_URL || ''
const scanMs = Math.max(1000, Number(process.env.WATCH_SCAN_MS || 4000))
const settleMs = Math.max(1000, Number(process.env.WATCH_SETTLE_MS || 5000))
const stateDir = join(watchDir, '.semaje')
const processingDir = join(stateDir, 'processing')
const completedDir = join(stateDir, 'completed')
const failedDir = join(stateDir, 'failed')
const active = new Set<string>()
let scanning = false

function headers(extra: Record<string, string> = {}) {
  return { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...extra }
}

async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

async function move(path: string, destination: string) {
  await mkdir(join(destination, '..'), { recursive: true })
  try { await rename(path, destination) }
  catch (error: any) {
    if (error.code !== 'EXDEV') throw error
    await copyFile(path, destination)
    await unlink(path)
  }
}

async function getJob(id: string) {
  const response = await fetch(`${apiBase}/api/jobs/${id}`, { headers: headers() })
  const data = await response.json() as { job?: { status: string; error?: string }; error?: string }
  if (!response.ok || !data.job) throw new Error(data.error || `Job lookup returned ${response.status}`)
  return data.job
}

async function trackJob(path: string, job: { id: string; status: string }) {
  let status = job.status
  try {
    while (!['succeeded', 'failed', 'canceled'].includes(status)) {
      await new Promise(resolve => setTimeout(resolve, scanMs))
      status = (await getJob(job.id)).status
    }
    const targetDir = status === 'succeeded' ? completedDir : failedDir
    await move(path, join(targetDir, basename(path)))
    logInfo('watcher.job_finished', { file: basename(path), jobId: job.id, status })
  } catch (error: any) {
    logError('watcher.tracking_failed', { file: basename(path), jobId: job.id, error: error.message })
  } finally {
    active.delete(path)
  }
}

async function ingest(path: string) {
  active.add(path)
  try {
    const digest = await checksum(path)
    const body = new FormData()
    body.append('audio', await openAsBlob(path, { type: mediaMimeType(path) }), basename(path))
    body.append('source', 'folder')
    body.append('title', basename(path).replace(/\.[^.]+$/, ''))
    body.append('idempotencyKey', buildFolderIngestKey(digest))
    body.append('captureMeta', JSON.stringify({ watchedPath: basename(path), checksum: digest }))
    if (webhookUrl) body.append('webhookUrl', webhookUrl)

    const response = await fetch(`${apiBase}/api/ingest`, {
      method: 'POST', headers: headers(), body,
    })
    const data = await response.json() as { job?: { id: string; status: string }; error?: string }
    if (!response.ok || !data.job) throw new Error(data.error || `Ingest returned ${response.status}`)
    const processingPath = join(processingDir, archiveName(path, data.job.id))
    await move(path, processingPath)
    active.delete(path)
    active.add(processingPath)
    void trackJob(processingPath, data.job)
    logInfo('watcher.accepted', { file: basename(path), jobId: data.job.id })
  } catch (error: any) {
    active.delete(path)
    logError('watcher.ingest_failed', { file: basename(path), error: error.message })
  }
}

async function scan() {
  if (scanning) return
  scanning = true
  try {
    const entries = await readdir(watchDir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(watchDir, entry.name)
      if (!entry.isFile() || !isSupportedMedia(path) || active.has(path)) continue
      const info = await stat(path)
      if (Date.now() - info.mtimeMs < settleMs) continue
      void ingest(path)
    }
  } catch (error: any) {
    logError('watcher.scan_failed', { watchDir, error: error.message })
  } finally {
    scanning = false
  }
}

await Promise.all([
  mkdir(watchDir, { recursive: true }), mkdir(processingDir, { recursive: true }),
  mkdir(completedDir, { recursive: true }), mkdir(failedDir, { recursive: true }),
])
logInfo('watcher.ready', { watchDir, stateDir, scanMs, settleMs })
await scan()
setInterval(scan, scanMs)
