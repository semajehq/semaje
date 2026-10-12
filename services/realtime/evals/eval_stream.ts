// Periodic eval: stream a synthesized fixture through the RealtimeSession
// using the REAL whisper service, assert the assembled transcript's WER
// stays within tolerance of the reference. Needs whisper on WHISPER_URL
// and macOS `say` + ffmpeg (same recipe as services/whisper/evals).
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RealtimeSession } from '../src/session.ts'
import { sttTranscribe } from '../../stt/client/index.ts'
import type { RTServerMessage } from '@semaje/schemas'

const REF = 'The quick brown fox jumps over the lazy dog and then takes a well deserved rest in the shade.'
const WER_THRESHOLD = Number(process.env.EVAL_WER_THRESHOLD || 0.25)
const P = { userId: '11111111-1111-4111-8111-111111111111', orgId: '22222222-2222-4222-8222-222222222222', role: 'owner' as const, scopes: [], via: 'jwt' as const }

function norm(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}
function wer(ref: string, hyp: string): number {
  const r = norm(ref); const h = norm(hyp)
  const dp = Array.from({ length: h.length + 1 }, (_, j) => j)
  for (let i = 1; i <= r.length; i++) {
    let prev = dp[0]; dp[0] = i
    for (let j = 1; j <= h.length; j++) {
      const cur = dp[j]
      dp[j] = r[i - 1] === h[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = cur
    }
  }
  return dp[h.length] / Math.max(r.length, 1)
}

const tmp = mkdtempSync(join(tmpdir(), 'semaje-rt-eval-'))
const aiff = join(tmp, 'ref.aiff')
const wav = join(tmp, 'ref.wav')
execFileSync('say', ['-o', aiff, REF])
execFileSync('ffmpeg', ['-nostdin', '-y', '-i', aiff, '-ar', '16000', '-ac', '1', wav], { stdio: 'ignore' })
const audio = readFileSync(wav)

const sent: RTServerMessage[] = []
const session = new RealtimeSession(
  P,
  (buf, _mime, lang) => sttTranscribe(buf, 'win.wav', 'audio/wav', { language: lang }),
  null,
  { send: m => sent.push(m) },
  1_000_000, // we drive windows manually
)

await session.handleMessage(JSON.stringify({ type: 'start', mode: 'dictation', language: 'en', mimeType: 'audio/wav' }))
// Stream in 3 slices, then drain once at stop. WAV byte slices are not valid
// standalone audio files; WindowBuffer header behavior is covered by unit tests.
const third = Math.floor(audio.length / 3)
for (const slice of [audio.subarray(0, third), audio.subarray(third, 2 * third), audio.subarray(2 * third)]) {
  session.handleAudio(Buffer.from(slice))
}
await session.handleMessage(JSON.stringify({ type: 'stop' }))

const finals = sent.filter(m => m.type === 'final') as Extract<RTServerMessage, { type: 'final' }>[]
const errors = sent.filter(m => m.type === 'error') as Extract<RTServerMessage, { type: 'error' }>[]
const assembled = finals.map(f => f.text).join(' ')
const score = wer(REF, assembled)
console.log(`windows: ${finals.length}`)
if (errors.length) console.log(`errors: ${errors.map(e => e.error).join(' | ')}`)
console.log(`ref: ${REF}`)
console.log(`hyp: ${assembled}`)
console.log(`WER=${score.toFixed(3)} threshold=${WER_THRESHOLD}`)
console.log(score <= WER_THRESHOLD ? 'EVAL PASS' : 'EVAL FAIL')
process.exit(score <= WER_THRESHOLD ? 0 : 1)
