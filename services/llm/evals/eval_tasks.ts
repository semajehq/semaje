// ═══════════════════════════════════════════════════════════════
// Periodic eval: run all 15 promptBuilder tasks through the chosen
// adapter(s) on a fixture transcript, score with per-task rubrics.
// This is THE gate for making claude-local the default engine.
//
// Usage:
//   npm run eval:llm                       # adapters from EVAL_ADAPTERS
//   EVAL_ADAPTERS=claude-local npm run eval:llm
//   EVAL_ADAPTERS=ollama,claude-local npm run eval:llm
// ═══════════════════════════════════════════════════════════════
import { getLlm, _setLlm } from '../src/index.ts'
import { buildTranscriptContext } from '../../pipeline/src/index.ts'
// The frontend prompt library is the single source of task prompts.
// @ts-ignore — plain JS module
import { buildPrompt, getDefaultOptions, TASK_DEFINITIONS } from '../../../src/utils/promptBuilder.js'

const FIXTURE = {
  text:
    'Good morning everyone thanks for joining. First item the launch date moves to March 10. ' +
    'Sarah will own the marketing rollout and Tom agreed to finish the billing integration by Friday. ' +
    'We decided to drop the legacy importer. Overall the team felt positive though Tom raised concerns ' +
    'about testing time. Next steps are a full regression run and a go no go call on March 3.',
  language: 'en',
  segments: [
    { start: 0, end: 6, text: 'Good morning everyone thanks for joining.' },
    { start: 6, end: 12, text: 'First item the launch date moves to March 10.' },
    { start: 12, end: 20, text: 'Sarah will own the marketing rollout and Tom agreed to finish the billing integration by Friday.' },
    { start: 20, end: 24, text: 'We decided to drop the legacy importer.' },
    { start: 24, end: 32, text: 'Overall the team felt positive though Tom raised concerns about testing time.' },
    { start: 32, end: 40, text: 'Next steps are a full regression run and a go no go call on March 3.' },
  ],
}

// Per-task rubric: cheap deterministic checks that the output is the right SHAPE
// and grounded in the fixture. Quality bar, not exact-match.
const RUBRICS: Record<string, (out: string) => string[]> = {
  transcription: out => [
    out.length > 100 ? '' : 'too short',
    /march 10/i.test(out) ? '' : 'missing key fact (March 10)',
  ],
  subtitles: out => [
    /^\d+\s*$/m.test(out) ? '' : 'missing SRT index lines',
    /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(out) ? '' : 'missing SRT timecodes',
  ],
  captions: out => [
    /WEBVTT/.test(out) ? '' : 'missing WEBVTT header',
    /\d{2}:\d{2}[:.]\d{2,3}\s*-->\s*/.test(out) ? '' : 'missing VTT timecodes',
  ],
  summary: out => [
    /march 10/i.test(out) ? '' : 'missing launch date',
    /sarah|tom/i.test(out) ? '' : 'missing owners',
  ],
  sentiment: out => [
    /positive/i.test(out) ? '' : 'missing overall positive tone',
    /concern|worri|negative|caution/i.test(out) ? '' : 'missing Tom\'s concern',
  ],
  chapters: out => [
    /\d{1,2}:\d{2}/.test(out) ? '' : 'missing chapter timestamps',
    out.split('\n').filter(l => l.trim()).length >= 2 ? '' : 'needs 2+ chapters',
  ],
  translation: out => [out.length > 50 ? '' : 'too short'],
  multilingual: out => [out.length > 50 ? '' : 'too short'],
  diarization: out => [/speaker|sarah|tom/i.test(out) ? '' : 'no speaker attribution'],
  interview: out => [out.length > 100 ? '' : 'too short'],
  meeting: out => [
    /action|task/i.test(out) ? '' : 'missing action items',
    /decision|decided|drop/i.test(out) ? '' : 'missing decisions',
    /march 10/i.test(out) ? '' : 'missing launch date',
  ],
  medical: out => [out.length > 50 ? '' : 'too short'],
  legal: out => [out.length > 50 ? '' : 'too short'],
  lyrics: out => [out.length > 20 ? '' : 'too short'],
  voicemail: out => [out.length > 30 ? '' : 'too short'],
}

async function evalAdapter(name: string): Promise<{ pass: number; fail: number }> {
  _setLlm(null)
  const llm = getLlm(name)
  let pass = 0
  let fail = 0
  for (const taskId of Object.keys(TASK_DEFINITIONS)) {
    const prompt = buildPrompt(taskId, getDefaultOptions(taskId))
    const ctx = buildTranscriptContext(taskId, FIXTURE)
    try {
      const out = await llm.run(prompt, ctx)
      const problems = (RUBRICS[taskId] || (() => []))(out).filter(Boolean)
      if (problems.length === 0) {
        pass++
        console.log(`[PASS] ${name}/${taskId}`)
      } else {
        fail++
        console.log(`[FAIL] ${name}/${taskId}: ${problems.join('; ')}\n  out: ${out.slice(0, 160).replace(/\n/g, ' ')}…`)
      }
    } catch (e: any) {
      fail++
      console.log(`[FAIL] ${name}/${taskId}: threw ${e.message}`)
    }
  }
  return { pass, fail }
}

const adapters = (process.env.EVAL_ADAPTERS || process.env.LLM_ADAPTER || 'claude-local')
  .split(',').map(s => s.trim()).filter(Boolean)

let anyFail = false
for (const a of adapters) {
  console.log(`\n═══ Evaluating adapter: ${a} ═══`)
  const { pass, fail } = await evalAdapter(a)
  console.log(`${a}: ${pass} pass / ${fail} fail (threshold: 0 failures to be default-eligible)`)
  if (fail > 0) anyFail = true
}
console.log(anyFail ? '\nEVAL FAIL' : '\nEVAL PASS')
process.exit(anyFail ? 1 : 0)
