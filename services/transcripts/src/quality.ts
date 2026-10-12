import type { SttResult, SttSegment } from '@semaje/schemas'

export interface GlossaryTerm { term: string; replacement: string }

function replaceTerm(text: string, term: GlossaryTerm): { text: string; matches: number } {
  const escaped = term.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\b${escaped}\\b`, 'gi')
  let matches = 0
  return {
    text: text.replace(pattern, () => { matches += 1; return term.replacement }),
    matches,
  }
}

export function applyGlossary(result: SttResult, terms: GlossaryTerm[]) {
  let matches = 0
  let text = result.text
  let segments = result.segments.map(segment => ({ ...segment }))
  for (const term of terms) {
    const whole = replaceTerm(text, term)
    text = whole.text
    matches += whole.matches
    segments = segments.map(segment => ({ ...segment, text: replaceTerm(segment.text, term).text }))
  }
  return { ...result, text, segments, glossaryMatches: matches }
}

export function cleanupPunctuation(result: SttResult): SttResult {
  const segments = result.segments.map(segment => {
    const raw = segment.text.trim()
    const capitalized = raw ? raw[0].toLocaleUpperCase() + raw.slice(1) : raw
    const text = capitalized && !/[.!?]$/.test(capitalized) ? `${capitalized}.` : capitalized
    return { ...segment, text }
  })
  return { ...result, segments, text: segments.map(segment => segment.text).join(' ').trim() }
}

export function summarizeQuality(result: SttResult, glossaryMatches = 0) {
  const confidenceValues = result.segments
    .map(segment => segment.confidence)
    .filter((value): value is number => typeof value === 'number')
  const speakerSegments = result.segments.filter(segment => segment.speaker).length
  const averageConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : null
  return {
    averageConfidence: averageConfidence == null ? null : Number(averageConfidence.toFixed(3)),
    lowConfidenceSegments: confidenceValues.filter(value => value < 0.65).length,
    timedSegments: result.segments.length,
    diarizationCoverage: result.segments.length
      ? Number((speakerSegments / result.segments.length).toFixed(3))
      : 0,
    glossaryMatches,
  }
}

export function speakerLabels(segments: SttSegment[]) {
  return Object.fromEntries(
    [...new Set(segments.map(segment => segment.speaker).filter(Boolean) as string[])]
      .map(speaker => [speaker, speaker.replace(/^SPEAKER_0*/, 'Speaker ')]),
  )
}

export function renameSpeakerInSegments(
  segments: SttSegment[], speaker: string, name: string,
): SttSegment[] {
  return segments.map(segment => segment.speaker === speaker ? { ...segment, speaker: name } : segment)
}
