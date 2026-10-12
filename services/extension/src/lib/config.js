// Settings: defaults < user (storage.local) < enterprise policy (storage.managed).
import { ext } from './ext.js'

export const DEFAULTS = Object.freeze({
  apiBase: 'http://localhost:3001',
  apiKey: '',
  language: '',          // '' = auto-detect; any registry code/alias (sw, kik_Latn, Yoruba)
  engine: 'auto',        // auto | whisper | omnilingual
  ttsVoice: '',          // '' = best voice for the language
  ttsSpeed: 1,
  saveDictation: true,   // save dictation sessions to the transcript library
  captions: true,        // overlay live captions when transcribing a tab
  lockSettings: false,   // policy-only: users cannot change managed fields
  allowTts: true,        // policy-only
})

const USER_KEYS = ['apiBase', 'apiKey', 'language', 'engine', 'ttsVoice', 'ttsSpeed', 'saveDictation', 'captions']

export function normalizeBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) return DEFAULTS.apiBase
  const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Server URL must start with http:// or https://')
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

export function originPattern(apiBase) {
  const url = new URL(normalizeBase(apiBase))
  return `${url.protocol}//${url.hostname}/*`
}

/** Pure merge. Managed values always win; `locked` lists fields users cannot edit. */
export function mergeConfig(local = {}, managed = {}) {
  const out = { ...DEFAULTS }
  for (const key of USER_KEYS) if (local[key] !== undefined && local[key] !== null) out[key] = local[key]
  const locked = []
  for (const [key, value] of Object.entries(managed || {})) {
    if (!(key in DEFAULTS) || value === undefined || value === null || value === '') continue
    out[key] = value
    if (managed.lockSettings && USER_KEYS.includes(key)) locked.push(key)
  }
  out.apiBase = normalizeBase(out.apiBase)
  out.ttsSpeed = Math.min(4, Math.max(0.25, Number(out.ttsSpeed) || 1))
  if (!['auto', 'whisper', 'omnilingual'].includes(out.engine)) out.engine = 'auto'
  return { config: out, locked, managed: Object.keys(managed || {}).length > 0 }
}

async function readManaged() {
  try { return (await ext.storage.managed?.get(null)) || {} }
  catch { return {} }  // no policy installed, or browser lacks managed storage
}

export async function loadConfig() {
  const [local, managed] = await Promise.all([ext.storage.local.get(USER_KEYS), readManaged()])
  return mergeConfig(local, managed)
}

export async function saveConfig(patch) {
  const { locked } = await loadConfig()
  const clean = {}
  for (const [key, value] of Object.entries(patch)) {
    if (USER_KEYS.includes(key) && !locked.includes(key)) clean[key] = key === 'apiBase' ? normalizeBase(value) : value
  }
  await ext.storage.local.set(clean)
  return loadConfig()
}
