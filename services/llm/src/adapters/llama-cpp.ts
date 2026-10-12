import { assemblePrompt, type LlmAdapter, type LlmRunMeta } from '../index.ts'

export interface LlamaCppConfig { endpoint?: string; model?: string; timeoutMs?: number }

export class LlamaCppAdapter implements LlmAdapter {
  readonly name = 'llama-cpp'
  readonly endpoint: string
  readonly model: string
  readonly timeoutMs: number
  lastRun?: LlmRunMeta

  constructor(config: LlamaCppConfig = {}) {
    this.endpoint = (config.endpoint || process.env.LLAMA_CPP_URL || 'http://127.0.0.1:8081').replace(/\/$/, '')
    this.model = config.model || process.env.LLAMA_CPP_MODEL || 'local-model'
    this.timeoutMs = config.timeoutMs || Number(process.env.LLAMA_CPP_TIMEOUT_MS || 180_000)
  }

  async run(taskPrompt: string, transcriptContext: string): Promise<string> {
    const prompt = assemblePrompt(taskPrompt, transcriptContext)
    const startedAt = performance.now()
    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: any) => { throw new Error(`llama.cpp unavailable at ${this.endpoint}: ${error.message}`) })
    const data: any = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error?.message || `llama.cpp HTTP ${response.status}`)
    const text = String(data.choices?.[0]?.message?.content || '').trim()
    if (!text) throw new Error('llama.cpp returned empty output')
    this.lastRun = {
      adapter: this.name, model: this.model, endpoint: this.endpoint,
      runtimeMs: Math.round(performance.now() - startedAt),
      promptChars: prompt.length, outputChars: text.length, local: true,
    }
    return text
  }
}
