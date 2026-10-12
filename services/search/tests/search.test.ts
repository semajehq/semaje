import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchQuery, locateTimestamp } from '../src/index.ts'

test('knowledge search is org-scoped and parameterizes every filter', () => {
  const query = buildSearchQuery('org-1', {
    q: 'launch date', source: 'meeting', speaker: 'Amina', tags: ['customer'], limit: 12,
  })
  assert.match(query.text, /t\.org_id = \$1/)
  assert.match(query.text, /websearch_to_tsquery/)
  assert.match(query.text, /t\.segments::text ILIKE/)
  assert.match(query.text, /t\.tags &&/)
  assert.deepEqual(query.values, ['org-1', 'launch date', 'meeting', '%Amina%', ['customer'], 12])
})

test('search result location links to the matching segment timestamp', () => {
  const location = locateTimestamp([
    { start: 0, end: 2, text: 'Opening remarks' },
    { start: 9, end: 14, text: 'The launch date is March 10' },
  ], 'when is launch')
  assert.equal(location.startSec, 9)
  assert.match(location.excerpt, /launch date/)
})
