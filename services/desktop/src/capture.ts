import 'dotenv/config'
import { spawn } from 'node:child_process'
import { openAsBlob } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureCommand, deviceListCommand, type DesktopPlatform } from './capture-core.ts'

const argv = process.argv.slice(2)
const value = (flag: string) => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
const platform = process.platform as DesktopPlatform
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg'

function run(command: string, args: string[], allowInterrupted = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    let interrupted = false
    const stop = () => { interrupted = true; child.kill('SIGINT') }
    process.once('SIGINT', stop)
    child.once('error', reject)
    child.once('exit', code => {
      process.removeListener('SIGINT', stop)
      if (code === 0 || (allowInterrupted && interrupted)) resolve()
      else reject(new Error(`${command} exited with ${code}`))
    })
  })
}

if (argv.includes('--list-devices')) {
  await run(ffmpeg, deviceListCommand(platform))
  process.exit(0)
}

const workDir = await mkdtemp(join(tmpdir(), 'semaje-desktop-'))
const output = join(workDir, 'capture.wav')
const duration = Number(value('--seconds') || 0) || undefined
const input = value('--input') || process.env.DESKTOP_AUDIO_INPUT
const title = value('--title') || `Desktop capture ${new Date().toLocaleString()}`
const apiBase = (process.env.DESKTOP_API_BASE || 'http://localhost:3001').replace(/\/$/, '')
const apiKey = process.env.DESKTOP_API_KEY || ''

try {
  console.log(`[desktop] recording ${input || 'default input'}; press Ctrl-C to finish`)
  await run(ffmpeg, captureCommand(platform, output, { input, durationSec: duration }), !duration)
  const form = new FormData()
  form.append('audio', await openAsBlob(output, { type: 'audio/wav' }), 'desktop-capture.wav')
  form.append('source', 'desktop')
  form.append('title', title)
  form.append('captureMeta', JSON.stringify({ platform, input: input || 'default' }))
  const response = await fetch(`${apiBase}/api/ingest`, {
    method: 'POST',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: form,
  })
  const result = await response.json() as { job?: { id: string }; error?: string }
  if (!response.ok || !result.job) throw new Error(result.error || `Ingest returned ${response.status}`)
  console.log(`[desktop] queued job ${result.job.id}`)
} finally {
  await rm(workDir, { recursive: true, force: true })
}
