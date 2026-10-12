import { ClaudeLocalAdapter } from './adapters/claude-local.ts'
import { OllamaAdapter } from './adapters/ollama.ts'
import { LlamaCppAdapter } from './adapters/llama-cpp.ts'

export interface LlmRunMeta {
  adapter: string
  model: string
  endpoint?: string
  runtimeMs: number
  promptChars: number
  outputChars: number
  local: boolean
}

export interface LlmAdapter {
  readonly name: string
  lastRun?: LlmRunMeta
  run(taskPrompt: string, transcriptContext: string): Promise<string>
}

export interface LlmConfig { endpoint?: string; model?: string }

export function assemblePrompt(taskPrompt: string, transcriptContext: string): string {
  return `${taskPrompt}\n\n${'═'.repeat(40)}\n\n${transcriptContext}`
}

export function createLlm(name: string, config: LlmConfig = {}): LlmAdapter {
  if (name === 'ollama') return new OllamaAdapter(config)
  if (name === 'llama-cpp') return new LlamaCppAdapter(config)
  if (name === 'claude-local') return new ClaudeLocalAdapter()
  throw new Error(`Unknown LLM_ADAPTER=${name}. Use one of: ollama, llama-cpp, claude-local`)
}

let active: LlmAdapter | null = null

export function getLlm(name = process.env.LLM_ADAPTER || 'ollama'): LlmAdapter {
  if (active && active.name === name) return active
  active = createLlm(name)
  return active
}

export async function runWithFallback(
  primary: { adapter: string; endpoint?: string; model?: string },
  taskPrompt: string,
  transcriptContext: string,
  fallbackNames = (process.env.LLM_FALLBACKS || 'llama-cpp,claude-local').split(',').map(value => value.trim()).filter(Boolean),
) {
  const attempts = [primary.adapter, ...fallbackNames.filter(name => name !== primary.adapter)]
  const errors: string[] = []
  for (const name of attempts) {
    const adapter = createLlm(name, name === primary.adapter ? primary : {})
    try {
      const text = await adapter.run(taskPrompt, transcriptContext)
      return { text, meta: adapter.lastRun, fallbackUsed: name !== primary.adapter }
    } catch (error: any) {
      errors.push(`${name}: ${error.message}`)
    }
  }
  throw new Error(`All local LLM adapters failed. ${errors.join(' | ')}`)
}

export function _setLlm(adapter: LlmAdapter | null): void { active = adapter }
