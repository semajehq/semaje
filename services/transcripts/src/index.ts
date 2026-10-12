// ═══════════════════════════════════════════════════════════════
// services/transcripts — persistent library: CRUD, Postgres FTS,
// share links, exports. The sole tenancy-enforcement point for
// transcript data (every query is org-scoped by construction).
// ═══════════════════════════════════════════════════════════════
import { randomBytes } from 'node:crypto'
import type pg from 'pg'
import { getPool } from '@semaje/db'
import type { Principal, CreateTranscriptRequest } from '@semaje/schemas'
import { buildListQuery, buildGetQuery, buildDeleteQuery } from './queries.ts'

export { buildListQuery, buildGetQuery, buildDeleteQuery } from './queries.ts'
export * from './exports.ts'
export * from './quality.ts'

export async function createTranscript(
  principal: Principal, req: CreateTranscriptRequest, pool: pg.Pool = getPool(),
) {
  const title = req.title
    || (req.text || '').split(/\s+/).slice(0, 8).join(' ').slice(0, 120)
    || 'Untitled'
  const res = await pool.query(
    `INSERT INTO transcripts
       (org_id, owner_id, title, source, task, language, duration_sec, text, segments, result, audio_blob_id, speaker_labels, quality_meta, processing_meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      principal.orgId, principal.userId, title, req.source, req.task,
      req.language ?? null, req.durationSec ?? null, req.text,
      req.segments ? JSON.stringify(req.segments) : null,
      req.result != null ? JSON.stringify(req.result) : null,
      req.audioBlobId ?? null,
      JSON.stringify(req.speakerLabels || {}),
      JSON.stringify(req.qualityMeta || {}),
      JSON.stringify(req.processingMeta || {}),
    ],
  )
  return res.rows[0]
}

export async function updateTranscript(
  principal: Principal, id: string,
  patch: {
    title?: string; text?: string; segments?: unknown[]; reason?: string
    collectionId?: string | null; tags?: string[]
  },
  pool: pg.Pool = getPool(),
) {
  const current = await getTranscript(principal, id, pool)
  if (!current) return null
  if (patch.collectionId) {
    const collection = await pool.query(
      `SELECT id FROM collections WHERE id = $1 AND org_id = $2`,
      [patch.collectionId, principal.orgId],
    )
    if (!collection.rows[0]) {
      const error = new Error('Collection not found in this workspace')
      ;(error as Error & { status?: number }).status = 400
      throw error
    }
  }
  const nextText = patch.text ?? current.text
  const nextSegments = patch.segments ?? current.segments
  const contentChanged = patch.title !== undefined || patch.text !== undefined || patch.segments !== undefined
  if (!contentChanged) {
    const metadata = await pool.query(
      `UPDATE transcripts SET
         collection_id = CASE WHEN $3 THEN $4::uuid ELSE collection_id END,
         tags = COALESCE($5::text[], tags), updated_at = now()
       WHERE org_id = $1 AND id = $2 RETURNING *`,
      [
        principal.orgId, id, patch.collectionId !== undefined, patch.collectionId ?? null,
        patch.tags ?? null,
      ],
    )
    return metadata.rows[0] ?? null
  }
  const client = await pool.connect()
  await client.query('BEGIN')
  try {
    await client.query(
      `INSERT INTO transcript_revisions
         (transcript_id, actor_id, previous_text, next_text, previous_segments, next_segments, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id, principal.userId, current.text, nextText,
        current.segments ? JSON.stringify(current.segments) : null,
        nextSegments ? JSON.stringify(nextSegments) : null,
        patch.reason || 'manual correction',
      ],
    )
    const updated = await client.query(
      `UPDATE transcripts SET
         title = COALESCE($3, title), text = $4, segments = $5,
         collection_id = CASE WHEN $6 THEN $7::uuid ELSE collection_id END,
         tags = COALESCE($8::text[], tags),
         updated_at = now()
       WHERE org_id = $1 AND id = $2 RETURNING *`,
      [
        principal.orgId, id, patch.title ?? null, nextText,
        nextSegments ? JSON.stringify(nextSegments) : null,
        patch.collectionId !== undefined, patch.collectionId ?? null, patch.tags ?? null,
      ],
    )
    await client.query('COMMIT')
    return updated.rows[0] ?? null
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function renameTranscriptSpeaker(
  principal: Principal, id: string, speaker: string, name: string,
  pool: pg.Pool = getPool(),
) {
  const current = await getTranscript(principal, id, pool)
  if (!current) return null
  const segments = (current.segments || []).map((segment: any) => (
    segment.speaker === speaker ? { ...segment, speaker: name } : segment
  ))
  const text = segments.length
    ? segments.map((segment: any) => `${segment.speaker ? `${segment.speaker}: ` : ''}${segment.text}`).join('\n')
    : current.text
  const updated = await updateTranscript(principal, id, {
    text, segments, reason: `rename speaker ${speaker} to ${name}`,
  }, pool)
  if (updated) {
    const labels = { ...(current.speaker_labels || {}) }
    delete labels[speaker]
    labels[name] = name
    await pool.query(`UPDATE transcripts SET speaker_labels = $3 WHERE org_id = $1 AND id = $2`, [
      principal.orgId, id, JSON.stringify(labels),
    ])
    updated.speaker_labels = labels
  }
  return updated
}

export async function listTranscriptRevisions(
  principal: Principal, id: string, pool: pg.Pool = getPool(),
) {
  const transcript = await getTranscript(principal, id, pool)
  if (!transcript) return null
  return (await pool.query(
    `SELECT id, reason, created_at FROM transcript_revisions
     WHERE transcript_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [id],
  )).rows
}

export async function listGlossary(principal: Principal, pool: pg.Pool = getPool()) {
  return (await pool.query(
    `SELECT id, term, replacement, created_at FROM glossary_terms
     WHERE org_id = $1 ORDER BY lower(term)`, [principal.orgId],
  )).rows
}

export async function upsertGlossaryTerm(
  principal: Principal, term: string, replacement: string, pool: pg.Pool = getPool(),
) {
  return (await pool.query(
    `INSERT INTO glossary_terms (org_id, term, replacement) VALUES ($1,$2,$3)
     ON CONFLICT (org_id, term) DO UPDATE SET replacement = EXCLUDED.replacement
     RETURNING id, term, replacement, created_at`,
    [principal.orgId, term, replacement],
  )).rows[0]
}

export async function deleteGlossaryTerm(
  principal: Principal, id: string, pool: pg.Pool = getPool(),
) {
  return (await pool.query(
    `DELETE FROM glossary_terms WHERE org_id = $1 AND id = $2 RETURNING id`,
    [principal.orgId, id],
  )).rows[0] ?? null
}

export async function listTranscripts(
  principal: Principal, opts: { q?: string; limit: number; offset: number }, pool: pg.Pool = getPool(),
) {
  const { text, values } = buildListQuery(principal.orgId, opts)
  return (await pool.query(text, values)).rows
}

export async function getTranscript(principal: Principal, id: string, pool: pg.Pool = getPool()) {
  const { text, values } = buildGetQuery(principal.orgId, id)
  return (await pool.query(text, values)).rows[0] ?? null
}

export async function deleteTranscript(principal: Principal, id: string, pool: pg.Pool = getPool()) {
  const { text, values } = buildDeleteQuery(principal.orgId, id)
  return (await pool.query(text, values)).rows[0] ?? null
}

// ── Shares (Phase 1: public link shares) ─────────────────────
export function makeShareToken(): string {
  return randomBytes(20).toString('base64url')
}

export async function createShare(
  principal: Principal, transcriptId: string,
  opts: { permission?: string; expiresInDays?: number }, pool: pg.Pool = getPool(),
) {
  // Ownership check is org-scoped by construction.
  const t = await getTranscript(principal, transcriptId, pool)
  if (!t) return null
  const token = makeShareToken()
  const expires = opts.expiresInDays
    ? new Date(Date.now() + opts.expiresInDays * 86_400_000)
    : null
  const res = await pool.query(
    `INSERT INTO shares (transcript_id, kind, token, permission, expires_at)
     VALUES ($1, 'link', $2, $3, $4) RETURNING *`,
    [transcriptId, token, opts.permission || 'view', expires],
  )
  return res.rows[0]
}

/** Public share resolution — no principal; the token IS the credential. */
export async function getByShareToken(token: string, pool: pg.Pool = getPool()) {
  const res = await pool.query(
    `SELECT t.id, t.title, t.text, t.segments, t.task, t.language, t.duration_sec,
            t.created_at, s.permission, s.expires_at
     FROM shares s JOIN transcripts t ON t.id = s.transcript_id
     WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > now())`,
    [token],
  )
  return res.rows[0] ?? null
}
