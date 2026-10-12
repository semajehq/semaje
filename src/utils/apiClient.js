// semaje platform API client — token custody + library/jobs/share calls.
// The single HTTP client for the web app.

const ACCESS_KEY = 'semaje_access_token'
const REFRESH_KEY = 'semaje_refresh_token'

export function getAccessToken() { return sessionStorage.getItem(ACCESS_KEY) || '' }
export function getRefreshToken() { return localStorage.getItem(REFRESH_KEY) || '' }

export function setTokens({ accessToken, refreshToken }) {
  if (accessToken) sessionStorage.setItem(ACCESS_KEY, accessToken)
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
}

export function clearTokens() {
  sessionStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

async function refreshAccess() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) { clearTokens(); return false }
  const data = await res.json()
  setTokens({ accessToken: data.accessToken })
  return true
}

/** Authenticated fetch with one automatic refresh-and-retry on 401. */
export async function api(path, opts = {}, retried = false) {
  const headers = { ...(opts.headers || {}) }
  const token = getAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(path, { ...opts, headers })
  if (res.status === 401 && !retried && getRefreshToken()) {
    if (await refreshAccess()) return api(path, opts, true)
  }
  return res
}

async function json(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data
}

// ── Auth ─────────────────────────────────────────────────────
export async function register(email, password, displayName) {
  const data = await json(await fetch('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  }))
  setTokens(data)
  return data.user
}

export async function login(email, password) {
  const data = await json(await fetch('/api/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))
  setTokens(data)
  return data.user
}

export async function acceptInvite(token, password, displayName) {
  const data = await json(await fetch('/api/auth/invites/accept', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password, displayName }),
  }))
  setTokens(data)
  return data
}

export async function me() { return json(await api('/api/me')) }

// ── Library ──────────────────────────────────────────────────
export async function listTranscripts({ q = '', limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit, offset })
  if (q) params.set('q', q)
  return (await json(await api(`/api/transcripts?${params}`))).transcripts
}

export async function searchKnowledge(filters = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value != null && value !== '' && (!Array.isArray(value) || value.length)) {
      params.set(key, Array.isArray(value) ? value.join(',') : value)
    }
  })
  return (await json(await api(`/api/search?${params}`))).results
}

export async function listCollections() {
  return (await json(await api('/api/collections'))).collections
}

export async function saveCollection(name, color = '#0f8f83') {
  return (await json(await api('/api/collections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  }))).collection
}

export async function deleteCollection(id) {
  return json(await api(`/api/collections/${id}`, { method: 'DELETE' }))
}

export async function listSavedSearches() {
  return (await json(await api('/api/saved-searches'))).savedSearches
}

export async function saveSearch(name, query) {
  return (await json(await api('/api/saved-searches', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, query }),
  }))).savedSearch
}

export async function deleteSavedSearch(id) {
  return json(await api(`/api/saved-searches/${id}`, { method: 'DELETE' }))
}

export async function askKnowledge(payload) {
  return json(await api('/api/knowledge/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

export async function indexTranscript(id) {
  return json(await api(`/api/search/index/${id}`, { method: 'POST' }))
}

export async function getTranscript(id) {
  return (await json(await api(`/api/transcripts/${id}`))).transcript
}

export async function saveTranscript(payload) {
  return (await json(await api('/api/transcripts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).transcript
}

export async function deleteTranscript(id) {
  return json(await api(`/api/transcripts/${id}`, { method: 'DELETE' }))
}

export async function updateTranscript(id, patch) {
  return (await json(await api(`/api/transcripts/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))).transcript
}

export async function renameTranscriptSpeaker(id, speaker, name) {
  return (await json(await api(`/api/transcripts/${id}/speakers/${encodeURIComponent(speaker)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }))).transcript
}

export async function listTranscriptRevisions(id) {
  return (await json(await api(`/api/transcripts/${id}/revisions`))).revisions
}

export async function getTranscriptAudio(id) {
  const res = await api(`/api/transcripts/${id}/audio`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Source audio unavailable')
  }
  return URL.createObjectURL(await res.blob())
}

export async function listGlossary() {
  return (await json(await api('/api/glossary'))).terms
}

export async function saveGlossaryTerm(term, replacement) {
  return (await json(await api('/api/glossary', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term, replacement }),
  }))).term
}

export async function removeGlossaryTerm(id) {
  return json(await api(`/api/glossary/${id}`, { method: 'DELETE' }))
}

export function exportUrl(id, format) { return `/api/transcripts/${id}/export/${format}` }

export async function createShare(id, expiresInDays) {
  return (await json(await api(`/api/transcripts/${id}/shares`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expiresInDays ? { expiresInDays } : {}),
  }))).share
}

export async function getIntegrations() {
  return json(await api('/api/integrations'))
}

export async function createWebhook(payload) {
  return (await json(await api('/api/integrations/webhooks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).webhook
}

export async function deleteWebhook(id) {
  return json(await api(`/api/integrations/webhooks/${id}`, { method: 'DELETE' }))
}

export async function deliverTranscript(id, payload) {
  return (await json(await api(`/api/transcripts/${id}/deliver`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).delivery
}

export async function createActionItem(id, payload) {
  return json(await api(`/api/transcripts/${id}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

export async function getShared(token) {
  return (await json(await fetch(`/api/share/${token}`))).transcript
}

// ── Uploads + async jobs (large files) ───────────────────────
export async function uploadAudio(file) {
  const form = new FormData()
  form.append('audio', file)
  return (await json(await api('/api/uploads', { method: 'POST', body: form }))).audioBlob
}

export async function ingestAudio(file, input = {}) {
  const form = new FormData()
  form.append('audio', file)
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === '') continue
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  return json(await api('/api/ingest', { method: 'POST', body: form }))
}

export async function createJob({ audioBlobId, task, options, language, title }) {
  return (await json(await api('/api/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBlobId, task, options, language, title }),
  }))).job
}

export async function getJob(id) {
  return (await json(await api(`/api/jobs/${id}`))).job
}

export async function listJobs(limit = 30) {
  return (await json(await api(`/api/jobs?limit=${limit}`))).jobs
}

export async function retryJob(id) {
  return (await json(await api(`/api/jobs/${id}/retry`, { method: 'POST' }))).job
}

export async function pollJob(id, { intervalMs = 2000, onProgress } = {}) {
  for (;;) {
    const job = await getJob(id)
    onProgress?.(job)
    if (['succeeded', 'failed', 'canceled'].includes(job.status)) return job
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

// ── API keys ─────────────────────────────────────────────────
// ── Languages + speech synthesis ────────────────────────────
let languagesCache = null
export async function listLanguages() {
  if (!languagesCache) {
    languagesCache = json(await api('/api/languages')).catch(err => { languagesCache = null; throw err })
  }
  return languagesCache
}

export async function synthesizeSpeech({ text, language, voice, format = 'mp3', speed = 1 }) {
  const res = await api('/api/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, voice, format, speed }),
  })
  if (!res.ok) await json(res)
  return { blob: await res.blob(), voice: res.headers.get('x-semaje-voice'), engine: res.headers.get('x-semaje-engine') }
}

export async function listApiKeys() { return (await json(await api('/api/api-keys'))).apiKeys }
export async function createApiKey(name, scopes = ['transcribe', 'read']) {
  return json(await api('/api/api-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scopes }),
  }))
}
export async function revokeApiKey(id) {
  return json(await api(`/api/api-keys/${id}`, { method: 'DELETE' }))
}

export async function getSecurityAdmin() {
  return json(await api('/api/admin/security'))
}

export async function getObservability() {
  return json(await api('/api/admin/observability'))
}

export async function createInvite(payload) {
  return json(await api('/api/admin/invites', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }))
}

export async function updateMemberRole(userId, role) {
  return json(await api(`/api/admin/members/${userId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
  }))
}

export async function createWorkspace(name) {
  return json(await api('/api/admin/workspaces', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }))
}

export async function saveRetentionPolicy(payload) {
  return json(await api('/api/admin/retention', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }))
}

export async function runRetention(dryRun = true) {
  return (await json(await api('/api/admin/retention/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun }),
  }))).run
}

// ── Local STT runtime ───────────────────────────────────────
export async function getSttRuntime() {
  return json(await api('/api/admin/stt'))
}

export async function downloadSttModel(backend, model) {
  return json(await api('/api/admin/stt/models/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend, model }),
  }))
}

export async function activateSttModel(backend, model) {
  return json(await api('/api/admin/stt/models/activate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend, model }),
  }))
}

export async function deleteSttModel(backend, model) {
  return json(await api(`/api/admin/stt/models/${encodeURIComponent(backend)}/${encodeURIComponent(model)}`, {
    method: 'DELETE',
  }))
}

export async function getLlmSettings() {
  return (await json(await api('/api/admin/llm'))).config
}

export async function saveLlmSettings(config) {
  return (await json(await api('/api/admin/llm', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }))).config
}

export async function testLlmSettings(config) {
  return json(await api('/api/admin/llm/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  }))
}

// ── Meeting bot ─────────────────────────────────────────────
export async function createMeetingBotRun({ joinUrl, title, startsAt, provider }) {
  return (await json(await api('/api/meeting-bot/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ joinUrl, title, startsAt, provider }),
  }))).run
}

export async function startMeetingBotRun(id) {
  return json(await api(`/api/meeting-bot/runs/${id}/start`, { method: 'POST' }))
}

export async function listMeetingBotRuns() {
  return (await json(await api('/api/meeting-bot/runs'))).runs
}
