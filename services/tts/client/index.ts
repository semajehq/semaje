// TypeScript client for the TTS service (services/tts/contract.md). The only
// way Node code talks to text-to-speech.
const TTS_URL = () => process.env.TTS_URL || 'http://localhost:8012'

export class TtsError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = 'TtsError'
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = process.env.TTS_API_TOKEN
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }
}

async function fail(res: Response): Promise<never> {
  const data: any = await res.json().catch(() => ({}))
  throw new TtsError(data.error || `TTS service error ${res.status}`, res.status, data.code || 'tts_error')
}

async function request(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  try {
    return await fetch(`${TTS_URL()}${path}`, {
      ...init, headers: headers(init.headers as Record<string, string>), signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err: any) {
    throw new TtsError(`TTS service unreachable at ${TTS_URL()} (${err.message})`, 503, 'unreachable')
  }
}

export async function ttsHealth(): Promise<{ ok: boolean; allowNoncommercial?: boolean }> {
  try {
    const res = await request('/health', {}, 2000)
    return res.ok ? await res.json() as never : { ok: false }
  } catch {
    return { ok: false }
  }
}

export async function ttsVoices(language?: string): Promise<{ voices: Array<Record<string, any>>; allowNoncommercial: boolean }> {
  const res = await request(`/voices${language ? `?language=${encodeURIComponent(language)}` : ''}`)
  if (!res.ok) return fail(res)
  return res.json() as never
}

export interface SynthesizeInput {
  text: string
  language?: string
  voice?: string
  format?: 'wav' | 'mp3' | 'ogg' | 'webm' | 'flac'
  speed?: number
  requestId?: string
}

export async function ttsSynthesize(input: SynthesizeInput): Promise<{ audio: Buffer; contentType: string; headers: Record<string, string> }> {
  const { requestId, ...body } = input
  const res = await request('/synthesize', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(requestId ? { 'x-request-id': requestId } : {}) },
  }, 5 * 60 * 1000)
  if (!res.ok) return fail(res)
  const passthrough: Record<string, string> = {}
  res.headers.forEach((value, key) => { if (key.startsWith('x-semaje-')) passthrough[key] = value })
  return { audio: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'audio/wav', headers: passthrough }
}
