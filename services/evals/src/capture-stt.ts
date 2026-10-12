import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { sttHealth, sttTranscribe } from '../../speech/stt-client.ts'

const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '../../..')
const manifest = JSON.parse(await readFile(resolve(root, 'services/evals/fixtures/stt-smoke.json'), 'utf8'))
const audioDirectory = process.env.EVAL_AUDIO_DIR
const temporary = await mkdtemp(join(tmpdir(), 'semaje-eval-'))
const health = await sttHealth()
const hypotheses: Record<string, string> = {}
let runtimeMs = 0

for (const fixture of manifest.fixtures) {
  let wav = audioDirectory ? resolve(audioDirectory, `${fixture.id}.wav`) : join(temporary, `${fixture.id}.wav`)
  if (!audioDirectory) {
    const aiff = join(temporary, `${fixture.id}.aiff`)
    await exec('say', ['-o', aiff, fixture.reference])
    await exec('ffmpeg', ['-nostdin', '-y', '-i', aiff, '-ar', '16000', '-ac', '1', wav])
  }
  const audio = await readFile(wav)
  const started = performance.now()
  const result = await sttTranscribe(audio, `${fixture.id}.wav`, 'audio/wav', { language: 'en' })
  runtimeMs += performance.now() - started
  hypotheses[fixture.id] = result.text
}

const candidate = {
  backend: health.backend || 'unknown', model: health.model || 'unknown',
  runtimeMs: Math.round(runtimeMs), hypotheses,
}
const output = resolve(root, process.env.EVAL_CANDIDATE_FILE || '.eval-results/stt-candidate.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8')
console.log(`captured ${manifest.fixtures.length} fixture(s) with ${candidate.backend}/${candidate.model} in ${candidate.runtimeMs}ms`)
console.log(`candidate: ${output}`)
