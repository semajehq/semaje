import type pg from 'pg'
import { getPool } from '@semaje/db'
import { DEFAULT_ENRICHMENT_PRESET } from './structured.ts'

export interface WorkspaceLlmConfig {
  adapter: 'ollama' | 'llama-cpp' | 'claude-local'
  endpoint?: string
  model: string
  preset: Record<string, boolean>
}

export function defaultLlmConfig(): WorkspaceLlmConfig {
  const adapter = (process.env.LLM_ADAPTER || 'ollama') as WorkspaceLlmConfig['adapter']
  return {
    adapter,
    endpoint: adapter === 'ollama'
      ? process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
      : adapter === 'llama-cpp' ? process.env.LLAMA_CPP_URL || 'http://127.0.0.1:8081' : undefined,
    model: adapter === 'ollama'
      ? process.env.OLLAMA_MODEL || 'qwen2.5:3b'
      : adapter === 'llama-cpp' ? process.env.LLAMA_CPP_MODEL || 'local-model' : 'claude-local',
    preset: DEFAULT_ENRICHMENT_PRESET,
  }
}

export function isLocalEndpoint(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (['localhost', '127.0.0.1', '::1', 'ollama', 'llama-cpp', 'host.docker.internal'].includes(host)) return true
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
    const match = host.match(/^172\.(\d+)\./)
    if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true
    return !host.includes('.')
  } catch { return false }
}

export async function getWorkspaceLlmConfig(
  orgId: string, pool: pg.Pool = getPool(),
): Promise<WorkspaceLlmConfig> {
  const row = (await pool.query(`SELECT llm_config FROM org_settings WHERE org_id = $1`, [orgId])).rows[0]
  return { ...defaultLlmConfig(), ...(row?.llm_config || {}), preset: { ...DEFAULT_ENRICHMENT_PRESET, ...(row?.llm_config?.preset || {}) } }
}

export async function saveWorkspaceLlmConfig(
  orgId: string, config: WorkspaceLlmConfig, pool: pg.Pool = getPool(),
) {
  const row = (await pool.query(
    `INSERT INTO org_settings (org_id, llm_config) VALUES ($1,$2)
     ON CONFLICT (org_id) DO UPDATE SET llm_config = EXCLUDED.llm_config, updated_at = now()
     RETURNING llm_config, updated_at`,
    [orgId, JSON.stringify(config)],
  )).rows[0]
  return row
}
