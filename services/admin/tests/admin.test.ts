import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceInvite, runRetention } from '../src/index.ts'

const principal = {
  userId: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  role: 'owner' as const, scopes: [], via: 'jwt' as const,
}

test('workspace invites are signed, hashed at rest, and return the token once', async () => {
  const queries: { text: string; values: unknown[] }[] = []
  const pool = {
    query: async (text: string, values: unknown[]) => {
      queries.push({ text, values })
      return { rows: [{ id: 'invite-1', email: values[1], role: values[2] }] }
    },
  }
  const created = await createWorkspaceInvite(principal, {
    email: 'Team@Example.com', role: 'member', expiresInDays: 7,
  }, pool as never)
  assert.ok(created.token.length > 40)
  assert.equal(queries[0].values[1], 'team@example.com')
  assert.notEqual(queries[0].values[3], created.token)
  assert.match(String(queries[0].values[3]), /^[a-f0-9]{64}$/)
})

test('retention preview applies source-specific cutoffs without deleting data', async () => {
  const queries: string[] = []
  const pool = {
    query: async (text: string) => {
      queries.push(text)
      if (text.includes('FROM retention_policies')) {
        return { rows: [{ enabled: true, default_days: 365, source_rules: { meeting: 30 }, delete_audio: true }] }
      }
      if (text.includes('FROM transcripts t')) {
        return { rows: [
          { id: 'transcript-1', audio_blob_id: 'blob-1', storage_key: 'one.wav' },
          { id: 'transcript-2', audio_blob_id: null, storage_key: null },
        ] }
      }
      return { rows: [] }
    },
  }
  const result = await runRetention(principal, true, pool as never)
  assert.deepEqual(result, { dryRun: true, transcripts: 2, audioBlobs: 1 })
  assert.equal(queries.some(query => query.startsWith('DELETE')), false)
  assert.equal(queries.some(query => query.includes('source_rules')), true)
})
