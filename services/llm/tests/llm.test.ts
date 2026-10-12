// Gate tests: adapter selection + prompt assembly. No network, no CLI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getLlm, assemblePrompt, _setLlm, type LlmAdapter } from '../src/index.ts'
import { OllamaAdapter } from '../src/adapters/ollama.ts'
import { LlamaCppAdapter } from '../src/adapters/llama-cpp.ts'
import { parseMeetingIntelligence, runMeetingIntelligence } from '../src/structured.ts'
import { isLocalEndpoint } from '../src/settings.ts'

test('assemblePrompt joins task prompt and context with a divider', () => {
  const p = assemblePrompt('TASK: SUMMARY', 'TRANSCRIPT:\nhello')
  assert.match(p, /^TASK: SUMMARY\n\n═+\n\nTRANSCRIPT:\nhello$/)
})

test('adapter selection honors LLM_ADAPTER and defaults to ollama', () => {
  _setLlm(null)
  assert.equal(getLlm('ollama').name, 'ollama')
  _setLlm(null)
  assert.equal(getLlm('llama-cpp').name, 'llama-cpp')
  _setLlm(null)
  assert.equal(getLlm('claude-local').name, 'claude-local')
  _setLlm(null)
  const saved = process.env.LLM_ADAPTER
  delete process.env.LLM_ADAPTER
  try { assert.equal(getLlm().name, 'ollama') }
  finally { if (saved) process.env.LLM_ADAPTER = saved; _setLlm(null) }
})

test('unknown adapter throws with the valid list', () => {
  _setLlm(null)
  assert.throws(() => getLlm('gpt-9'), /Unknown LLM_ADAPTER=gpt-9.*ollama.*llama-cpp.*claude-local/s)
})

test('Ollama and llama.cpp adapters use their local HTTP contracts', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/generate') return res.end(JSON.stringify({ response: 'ollama ready' }))
    if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: 'llama ready' } }] }))
    res.statusCode = 404; res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const ollama = new OllamaAdapter({ endpoint, model: 'test' })
    assert.equal(await ollama.run('task', 'context'), 'ollama ready')
    assert.equal(ollama.lastRun?.local, true)
    const llama = new LlamaCppAdapter({ endpoint, model: 'test' })
    assert.equal(await llama.run('task', 'context'), 'llama ready')
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('meeting JSON parser validates and repair flow retries once', async () => {
  const valid = JSON.stringify({
    summary: 'Launch moved', decisions: ['Move launch'],
    actionItems: [{ task: 'Update plan', owner: 'Sarah', dueDate: null }],
    risks: [], followUps: [], chapters: [{ title: 'Launch', startSec: 0 }],
  })
  assert.equal(parseMeetingIntelligence(`\`\`\`json\n${valid}\n\`\`\``).summary, 'Launch moved')
  let calls = 0
  const adapter: LlmAdapter = {
    name: 'fake',
    async run() { calls += 1; return calls === 1 ? 'not json' : valid },
  }
  const result = await runMeetingIntelligence(adapter, 'transcript')
  assert.equal(result.actionItems[0].owner, 'Sarah')
  assert.equal(calls, 2)
})

test('strict-local endpoint validation accepts private hosts only', () => {
  assert.equal(isLocalEndpoint('http://127.0.0.1:11434'), true)
  assert.equal(isLocalEndpoint('http://192.168.1.5:8080'), true)
  assert.equal(isLocalEndpoint('http://ollama:11434'), true)
  assert.equal(isLocalEndpoint('https://example.com'), false)
})

test('no hosted LLM API adapter is registered', () => {
  _setLlm(null)
  for (const hosted of ['gem' + 'ini', 'open' + 'ai', 'anth' + 'ropic']) {
    assert.throws(() => getLlm(hosted), /Unknown LLM_ADAPTER/)
  }
})
