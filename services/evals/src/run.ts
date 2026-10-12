import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
// @ts-ignore - the frontend prompt library remains the single JavaScript source of task prompts.
import { buildPrompt, getDefaultOptions } from '../../../src/utils/promptBuilder.js'
import { compareSttRuns, matches, scoreSttRun } from './scoring.ts'

const root = resolve(import.meta.dirname, '../../..')
const readJson = async (path: string) => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const profile = argument('--profile') || process.env.EVAL_PROFILE || 'smoke'
const sttFixture = await readJson(`services/evals/fixtures/stt-${profile}.json`)
const taskFixture = await readJson('services/evals/fixtures/task-smoke.json')
const baselinePath = argument('--baseline') || process.env.EVAL_BASELINE_FILE
const baselineInput = baselinePath ? await readJson(baselinePath) : await readJson(`services/evals/baselines/${profile}.json`)
const candidatePath = argument('--candidate') || process.env.EVAL_CANDIDATE_FILE
const candidate = candidatePath ? await readJson(candidatePath) : sttFixture.candidate
const baseline = scoreSttRun(sttFixture.fixtures, baselineInput)
const scored = scoreSttRun(sttFixture.fixtures, candidate)
const delta = compareSttRuns(baseline, scored)
const runtimeComparable = baseline.backend !== 'fixture' || scored.backend === 'fixture'
const qualityDeltaComparable = baseline.backend !== 'fixture' || scored.backend === 'fixture'
const thresholds = sttFixture.thresholds

const sttFailures = [
  scored.averageWer > thresholds.maxWer && `WER ${scored.averageWer.toFixed(3)} > ${thresholds.maxWer}`,
  scored.averageCer > thresholds.maxCer && `CER ${scored.averageCer.toFixed(3)} > ${thresholds.maxCer}`,
  qualityDeltaComparable && delta.werDelta > thresholds.maxWerRegression && `WER regression ${delta.werDelta.toFixed(3)} > ${thresholds.maxWerRegression}`,
  runtimeComparable && delta.runtimeRatio > thresholds.maxRuntimeRatio && `runtime ratio ${delta.runtimeRatio.toFixed(2)} > ${thresholds.maxRuntimeRatio}`,
].filter(Boolean) as string[]

const taskResults = taskFixture.fixtures.map((fixture: any) => {
  const prompt = buildPrompt(fixture.task, getDefaultOptions(fixture.task))
  const promptMisses = fixture.promptMustMatch.filter((pattern: string) => !matches(prompt, pattern))
  const outputMisses = fixture.expectedOutput.filter((pattern: string) => !matches(fixture.candidate, pattern))
  return { task: fixture.task, passed: !promptMisses.length && !outputMisses.length, promptMisses, outputMisses }
})
const taskFailures = taskResults.filter((result: any) => !result.passed)

const report = {
  schemaVersion: 1, profile, generatedAt: new Date().toISOString(),
  fixtureLicense: sttFixture.license,
  stt: { baseline, candidate: scored, delta: { ...delta, runtimeComparable, qualityDeltaComparable }, thresholds, failures: sttFailures },
  tasks: { passed: taskResults.length - taskFailures.length, failed: taskFailures.length, results: taskResults },
  passed: sttFailures.length === 0 && taskFailures.length === 0,
}
const output = resolve(root, argument('--output') || process.env.EVAL_REPORT_PATH || `.eval-results/${profile}-latest.json`)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`eval profile: ${profile}`)
console.log(`STT ${baseline.backend}/${baseline.model} -> ${scored.backend}/${scored.model}`)
console.log(`WER ${baseline.averageWer.toFixed(3)} -> ${scored.averageWer.toFixed(3)} (${delta.werDelta >= 0 ? '+' : ''}${delta.werDelta.toFixed(3)})`)
console.log(`CER ${baseline.averageCer.toFixed(3)} -> ${scored.averageCer.toFixed(3)} (${delta.cerDelta >= 0 ? '+' : ''}${delta.cerDelta.toFixed(3)})`)
console.log(`runtime ${baseline.runtimeMs}ms -> ${scored.runtimeMs}ms (${runtimeComparable ? `${delta.runtimeRatio.toFixed(2)}x` : 'cross-mode; capture a real baseline'})`)
console.log(`tasks ${report.tasks.passed} pass / ${report.tasks.failed} fail`)
for (const failure of sttFailures) console.log(`FAIL stt: ${failure}`)
for (const failure of taskFailures) console.log(`FAIL ${failure.task}: prompt=${failure.promptMisses.join(',') || '-'} output=${failure.outputMisses.join(',') || '-'}`)
console.log(`report: ${output}`)
console.log(report.passed ? 'EVAL PASS' : 'EVAL FAIL')
process.exit(report.passed ? 0 : 1)
