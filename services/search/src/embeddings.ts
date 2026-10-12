import { createHash } from 'node:crypto'

export interface EmbeddingConfig { endpoint?: string; model?: string }

export async function embedText(text: string, config: EmbeddingConfig = {}) {
  const endpoint = (config.endpoint || process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const model = config.model || process.env.EMBEDDING_MODEL || 'nomic-embed-text'
  const response = await fetch(`${endpoint}/api/embed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text.slice(0, 120_000) }),
    signal: AbortSignal.timeout(Number(process.env.EMBEDDING_TIMEOUT_MS || 120_000)),
  })
  const data: any = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Embedding endpoint returned ${response.status}`)
  const embedding = data.embeddings?.[0]
  if (!Array.isArray(embedding) || !embedding.length) throw new Error('Embedding endpoint returned no vector')
  return { embedding: embedding.map(Number), model, contentHash: createHash('sha256').update(text).digest('hex') }
}
