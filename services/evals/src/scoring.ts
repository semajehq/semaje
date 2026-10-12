export function normalizeWords(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
}

export function normalizeCharacters(value: string) {
  return value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').split('')
}

export function editDistance<T>(reference: T[], hypothesis: T[]) {
  const row = Array.from({ length: hypothesis.length + 1 }, (_, index) => index)
  for (let i = 1; i <= reference.length; i += 1) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const current = row[j]
      row[j] = reference[i - 1] === hypothesis[j - 1]
        ? previous : 1 + Math.min(previous, row[j], row[j - 1])
      previous = current
    }
  }
  return row[hypothesis.length]
}

export function wordErrorRate(reference: string, hypothesis: string) {
  const words = normalizeWords(reference)
  return editDistance(words, normalizeWords(hypothesis)) / Math.max(1, words.length)
}

export function characterErrorRate(reference: string, hypothesis: string) {
  const characters = normalizeCharacters(reference)
  return editDistance(characters, normalizeCharacters(hypothesis)) / Math.max(1, characters.length)
}

interface SttFixture { id: string; reference: string }
interface SttRun { backend: string; model: string; runtimeMs: number; hypotheses: Record<string, string> }

export function scoreSttRun(fixtures: SttFixture[], run: SttRun) {
  const hypotheses = run?.hypotheses || {}
  const samples = fixtures.map(fixture => ({
    id: fixture.id,
    wer: wordErrorRate(fixture.reference, hypotheses[fixture.id] || ''),
    cer: characterErrorRate(fixture.reference, hypotheses[fixture.id] || ''),
  }))
  return {
    backend: run?.backend || 'unknown', model: run?.model || 'unknown', runtimeMs: Number(run?.runtimeMs || 0), samples,
    averageWer: samples.reduce((sum, sample) => sum + sample.wer, 0) / Math.max(1, samples.length),
    averageCer: samples.reduce((sum, sample) => sum + sample.cer, 0) / Math.max(1, samples.length),
  }
}

export function compareSttRuns(baseline: ReturnType<typeof scoreSttRun>, candidate: ReturnType<typeof scoreSttRun>) {
  return {
    werDelta: candidate.averageWer - baseline.averageWer,
    cerDelta: candidate.averageCer - baseline.averageCer,
    runtimeDeltaMs: candidate.runtimeMs - baseline.runtimeMs,
    runtimeRatio: baseline.runtimeMs > 0 ? candidate.runtimeMs / baseline.runtimeMs : 0,
  }
}

export function matches(value: string, pattern: string) {
  return new RegExp(pattern, 'i').test(value)
}
