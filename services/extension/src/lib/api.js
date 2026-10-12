// semaje server client for extension pages and the background worker.
// `fetchImpl` is injectable so the logic is gate-tested without a browser.

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function friendlyError(err) {
  if (!(err instanceof ApiError)) return 'Cannot reach the semaje server. Check the server URL in settings.'
  if (err.status === 401) return 'The server rejected the API key. Create one under Settings → API keys.'
  if (err.status === 403 && err.code === 'license_noncommercial') return err.message
  if (err.status === 413) return 'This recording is too large or too long for the server limits.'
  if (err.status === 415) return 'This file has no readable audio track.'
  if (err.status === 503) return 'The speech service is busy or offline. Try again in a moment.'
  return err.message
}

export function createClient({ apiBase, apiKey = '', fetchImpl = globalThis.fetch.bind(globalThis), sleep } = {}) {
  const base = String(apiBase || '').replace(/\/+$/, '')
  const wait = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}

  async function request(path, init = {}) {
    let res
    try {
      res = await fetchImpl(`${base}${path}`, { ...init, headers: { ...auth, ...(init.headers || {}) } })
    } catch (err) {
      throw new ApiError(`Network error: ${err.message}`, 0, 'network')
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new ApiError(data.error || `Server error ${res.status}`, res.status, data.code || 'http_error')
    }
    return res
  }
  const json = async (path, init) => (await request(path, init)).json()

  return {
    base,
    me: () => json('/api/me'),
    health: () => json('/api/health'),
    languages: () => json('/api/languages'),
    voices: language => json(`/api/tts/voices${language ? `?language=${encodeURIComponent(language)}` : ''}`),
    transcripts: (q = '', limit = 30) => {
      const params = new URLSearchParams({ limit: String(limit) })
      if (q) params.set('q', q)
      return json(`/api/transcripts?${params}`)
    },
    transcript: id => json(`/api/transcripts/${encodeURIComponent(id)}`),

    /** Queue a recording (any audio/video format) and wait for the transcript. */
    async transcribeFile(blob, filename, { language, engine, title, source = 'extension', onProgress, pollMs = 1500, timeoutMs = 6 * 3600 * 1000 } = {}) {
      const form = new FormData()
      form.append('audio', blob, filename)
      form.append('task', 'transcription')
      form.append('source', source)
      form.append('title', title || filename.replace(/\.[^.]+$/, '') || 'Recording')
      if (language) form.append('language', language)
      form.append('options', JSON.stringify(engine && engine !== 'auto' ? { engine } : {}))
      form.append('captureMeta', JSON.stringify({ client: 'browser-extension', size: blob.size, type: blob.type }))
      const { job } = await json('/api/ingest', { method: 'POST', body: form })
      const started = Date.now()
      let current = job
      while (!['succeeded', 'failed', 'canceled'].includes(current.status)) {
        if (Date.now() - started > timeoutMs) throw new ApiError('Timed out waiting for the transcript.', 504, 'timeout')
        onProgress?.(current)
        await wait(pollMs)
        current = (await json(`/api/jobs/${current.id}`)).job
      }
      if (current.status !== 'succeeded') throw new ApiError(current.error || `Job ${current.status}`, 500, 'job_failed')
      onProgress?.(current)
      return (await json(`/api/transcripts/${current.transcript_id}`)).transcript
    },

    /** Text → audio Blob through the server's open-source TTS. */
    async speak(text, { language, voice, speed = 1, format = 'mp3' } = {}) {
      const res = await request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: language || undefined, voice: voice || undefined, speed, format }),
      })
      return { blob: await res.blob(), voice: res.headers.get('x-semaje-voice'), engine: res.headers.get('x-semaje-engine') }
    },

    wsUrl() {
      const url = new URL(`${base}/ws`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      if (apiKey) url.searchParams.set('token', apiKey)
      return url.toString()
    },
  }
}
