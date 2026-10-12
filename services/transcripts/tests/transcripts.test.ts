// Gate tests: query builders (org-scoping structural), exports, share tokens.
// No live Postgres.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildListQuery, buildGetQuery, buildDeleteQuery } from '../src/queries.ts'
import { toSRT, toVTT, toMD, toJSON, toActionsCSV, exportTranscript } from '../src/exports.ts'
import { makeShareToken } from '../src/index.ts'
import { applyGlossary, cleanupPunctuation, renameSpeakerInSegments, summarizeQuality } from '../src/quality.ts'

const ORG = 'org-1'
const SEGS = [
  { start: 0, end: 2.5, text: 'hello world' },
  { start: 2.5, end: 6.041, text: 'this is a test' },
]

test('list query without q is org-scoped and ordered by recency', () => {
  const { text, values } = buildListQuery(ORG, { limit: 20, offset: 0 })
  assert.match(text, /WHERE org_id = \$1/)
  assert.match(text, /ORDER BY created_at DESC/)
  assert.deepEqual(values, [ORG, 20, 0])
})

test('list query with q uses websearch FTS and rank ordering', () => {
  const { text, values } = buildListQuery(ORG, { q: 'launch date', limit: 10, offset: 5 })
  assert.match(text, /search_tsv @@ websearch_to_tsquery\('simple', \$2\)/)
  assert.match(text, /ORDER BY rank DESC/)
  assert.deepEqual(values, [ORG, 'launch date', 10, 5])
})

test('get/delete queries always require org_id — tenancy is structural', () => {
  assert.match(buildGetQuery(ORG, 't-1').text, /org_id = \$1 AND id = \$2/)
  assert.match(buildDeleteQuery(ORG, 't-1').text, /org_id = \$1 AND id = \$2/)
  assert.throws(() => buildListQuery('', { limit: 1, offset: 0 }), /orgId is required/)
  assert.throws(() => buildGetQuery('', 'x'), /orgId is required/)
  assert.throws(() => buildDeleteQuery('', 'x'), /orgId is required/)
})

test('SRT export: indexes, comma timecodes, blank-line separation', () => {
  const srt = toSRT(SEGS)
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:02,500\nhello world\n\n2\n00:00:02,500 --> 00:00:06,041\nthis is a test\n')
})

test('VTT export: header + dot timecodes', () => {
  const vtt = toVTT(SEGS)
  assert.match(vtt, /^WEBVTT\n\n/)
  assert.match(vtt, /00:00:00\.000 --> 00:00:02\.500\nhello world/)
})

test('MD export includes title and [mm:ss] stamps', () => {
  const md = toMD('My call', 'fallback', SEGS)
  assert.match(md, /^# My call/)
  assert.match(md, /\*\*\[00:00\]\*\* hello world/)
  assert.match(md, /\*\*\[00:02\]\*\* this is a test/)
})

test('exportTranscript maps formats to mime types', () => {
  const t = { title: 'x', text: 'plain', segments: SEGS }
  assert.equal(exportTranscript('srt', t).mimeType, 'application/x-subrip')
  assert.equal(exportTranscript('vtt', t).mimeType, 'text/vtt')
  assert.equal(exportTranscript('txt', t).body, 'plain')
  assert.equal(exportTranscript('md', t).mimeType, 'text/markdown')
  assert.equal(exportTranscript('json', t).mimeType, 'application/json')
  assert.equal(exportTranscript('actions.csv', t).extension, 'actions.csv')
})

test('workflow exports preserve metadata and structured meeting intelligence', () => {
  const transcript = {
    id: 't-1', title: 'Planning', text: 'We agreed to ship.', segments: SEGS,
    source: 'meeting', task: 'meeting', language: 'en', durationSec: 6,
    createdAt: '2026-07-10T00:00:00.000Z', speakerLabels: { SPEAKER_00: 'Amina' },
    tags: ['launch'],
    result: {
      summary: 'Launch planning.', decisions: ['Ship Friday'], risks: ['Capacity'],
      actionItems: [{ task: 'Publish notes', owner: 'Amina', dueDate: '2026-07-11' }],
    },
  }
  const json = JSON.parse(toJSON(transcript))
  assert.equal(json.metadata.source, 'meeting')
  assert.equal(json.intelligence.decisions[0], 'Ship Friday')
  assert.equal(json.intelligence.actionItems[0].owner, 'Amina')
  const md = exportTranscript('md', transcript).body
  assert.match(md, /## Summary[\s\S]*Launch planning/)
  assert.match(md, /## Decisions[\s\S]*Ship Friday/)
  assert.match(md, /## Action items[\s\S]*Publish notes/)
  const csv = toActionsCSV(transcript)
  assert.match(csv, /"Publish notes","Amina","2026-07-11","open"/)
})

test('timed exports preserve speaker labels', () => {
  const segments = [{ start: 0, end: 1, text: 'hello', speaker: 'Amina' }]
  assert.match(toSRT(segments), /Amina: hello/)
  assert.match(toVTT(segments), /<v Amina>hello/)
  assert.match(toMD('Call', 'hello', segments), /\*\*Amina:\*\*/)
})

test('share tokens are long, URL-safe, and unique', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const tok = makeShareToken()
    assert.match(tok, /^[A-Za-z0-9_-]{20,}$/)
    assert.ok(!seen.has(tok))
    seen.add(tok)
  }
})

test('quality helpers apply glossary, cleanup, confidence, and speaker rename', () => {
  const source = {
    text: 'sema jay shipped', language: 'en', duration: 2,
    backend: 'fake', model: 'tiny',
    segments: [{ start: 0, end: 2, text: 'sema jay shipped', confidence: 0.5, speaker: 'SPEAKER_00' }],
  }
  const glossary = applyGlossary(source, [{ term: 'sema jay', replacement: 'semaje' }])
  assert.equal(glossary.text, 'semaje shipped')
  assert.equal(glossary.glossaryMatches, 1)
  const clean = cleanupPunctuation(glossary)
  assert.equal(clean.text, 'Semaje shipped.')
  assert.deepEqual(summarizeQuality(clean, 1), {
    averageConfidence: 0.5, lowConfidenceSegments: 1, timedSegments: 1,
    diarizationCoverage: 1, glossaryMatches: 1,
  })
  assert.equal(renameSpeakerInSegments(clean.segments, 'SPEAKER_00', 'Amina')[0].speaker, 'Amina')
})
