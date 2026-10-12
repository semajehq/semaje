import { test } from 'node:test'
import assert from 'node:assert/strict'
import { characterErrorRate, compareSttRuns, scoreSttRun, wordErrorRate } from '../src/scoring.ts'

test('WER ignores case and punctuation but counts word substitutions', () => {
  assert.equal(wordErrorRate('Hello, World!', 'hello world'), 0)
  assert.equal(wordErrorRate('one two three four', 'one two five four'), 0.25)
})

test('CER handles Unicode text deterministically', () => {
  assert.equal(characterErrorRate('Cafe', 'cafe'), 0)
  assert.equal(characterErrorRate('abc', 'adc'), 1 / 3)
})

test('STT comparisons report quality and runtime deltas', () => {
  const fixtures = [{ id: 'one', reference: 'ship the release today' }]
  const baseline = scoreSttRun(fixtures, { backend: 'fixture', model: 'old', runtimeMs: 100, hypotheses: { one: 'ship release today' } })
  const candidate = scoreSttRun(fixtures, { backend: 'fixture', model: 'new', runtimeMs: 80, hypotheses: { one: 'ship the release today' } })
  assert.equal(compareSttRuns(baseline, candidate).werDelta, -0.25)
  assert.equal(compareSttRuns(baseline, candidate).runtimeRatio, 0.8)
})
