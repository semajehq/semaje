import { assemblePrompt, type LlmAdapter, type LlmRunMeta } from '../index.ts'

export interface OllamaConfig { endpoint?: string; model?: string; timeoutMs?: number }

export class OllamaAdapter implements LlmAdapter {
  readonly name = 'ollama'
  readonly endpoint: string
  readonly model: string
  readonly timeoutMs: number
  lastRun?: LlmRunMeta

  constructor(config: OllamaConfig = {}) {
    this.endpoint = (config.endpoint || process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
    this.model = config.model || process.env.OLLAMA_MODEL || 'qwen2.5:3b'
    this.timeoutMs = config.timeoutMs || Number(process.env.OLLAMA_TIMEOUT_MS || 180_000)
  }

  async run(taskPrompt: string, transcriptContext: string): Promise<string> {
    const prompt = assemblePrompt(taskPrompt, transcriptContext)
    let lastError = ''
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedAt = performance.now()
      try {
        const response = await fetch(`${this.endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt, stream: false, options: { temperature: 0.1 } }),
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        const data: any = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `Ollama HTTP ${response.status}`)
        const text = String(data.response || '').trim()
        if (!text) throw new Error('Ollama returned empty output')
        this.lastRun = {
          adapter: this.name, model: this.model, endpoint: this.endpoint,
          runtimeMs: Math.round(performance.now() - startedAt),
          promptChars: prompt.length, outputChars: text.length, local: true,
        }
        return text
      } catch (error: any) {
        lastError = error.message
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
      }
    }
    throw new Error(`Ollama unavailable at ${this.endpoint}: ${lastError}`)
  }
}
