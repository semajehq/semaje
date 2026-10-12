# LLM Service — Contract

Swappable text-task engine. The ONLY place semaje talks to an LLM.
The LLM only ever sees transcript text — never audio.

```ts
getLlm(name?: string): LlmAdapter          // name defaults to env LLM_ADAPTER, then 'ollama'
LlmAdapter.run(taskPrompt, transcriptContext): Promise<string>
```

## Adapters

| Adapter | Engine | Notes |
|---|---|---|
| `ollama` (default) | Ollama HTTP API | Fully local, retry x3, model and endpoint configurable per workspace. |
| `llama-cpp` | llama.cpp OpenAI-compatible server | Fully local GGUF runtime. |
| `claude-local` | Local Claude Code CLI (`claude -p`, stdin) | Optional; routes through the operator's own Claude Code install. |

There is no hosted-API adapter. `ollama` and `llama-cpp` run open-weight models
(Qwen, Llama, Mistral, Gemma) on your own hardware, which keeps the whole
platform open source end to end. A gate test asserts no hosted adapter is
registered.

Meeting enrichment is validated as structured JSON containing summary,
decisions, action items with owners/dates, risks, follow-ups, and chapters.
Malformed model output receives one repair pass before the job fails safely.

Task prompts come from `services/llm/src/prompts.js` (the 15-task prompt library,
served to clients as metadata by `GET /api/tasks`);
transcript context from `services/pipeline`.
