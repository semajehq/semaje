import type pg from 'pg'
import { getPool } from '@semaje/db'
import type { Principal, SttSegment } from '@semaje/schemas'
import { embedText, type EmbeddingConfig } from './embeddings.ts'

export interface SearchFilters {
  q?: string; source?: string; task?: string; speaker?: string
  collectionId?: string; tags?: string[]; dateFrom?: string; dateTo?: string; limit?: number
}

export function buildSearchQuery(orgId: string, filters: SearchFilters) {
  if (!orgId) throw new Error('orgId is required')
  const values: unknown[] = [orgId]
  const where = ['t.org_id = $1']
  const add = (value: unknown) => { values.push(value); return `$${values.length}` }
  if (filters.q?.trim()) {
    const p = add(filters.q.trim())
    where.push(`(t.search_tsv || coalesce(t.search_meta_tsv, ''::tsvector)) @@ websearch_to_tsquery('simple', ${p})`)
  }
  if (filters.source) where.push(`t.source = ${add(filters.source)}`)
  if (filters.task) where.push(`t.task = ${add(filters.task)}`)
  if (filters.speaker) where.push(`t.segments::text ILIKE ${add(`%${filters.speaker}%`)}`)
  if (filters.collectionId) where.push(`t.collection_id = ${add(filters.collectionId)}`)
  if (filters.tags?.length) where.push(`t.tags && ${add(filters.tags)}::text[]`)
  if (filters.dateFrom) where.push(`t.created_at >= ${add(filters.dateFrom)}::date`)
  if (filters.dateTo) where.push(`t.created_at < (${add(filters.dateTo)}::date + interval '1 day')`)
  const rank = filters.q?.trim()
    ? `ts_rank(t.search_tsv || coalesce(t.search_meta_tsv, ''::tsvector), websearch_to_tsquery('simple', $2))`
    : '0'
  const limit = add(filters.limit || 30)
  return {
    text: `SELECT t.id, t.title, t.source, t.task, t.language, t.duration_sec,
                  t.text, t.segments, t.tags, t.collection_id, t.created_at,
                  c.name AS collection_name, ${rank} AS rank
           FROM transcripts t LEFT JOIN collections c ON c.id = t.collection_id
           WHERE ${where.join(' AND ')}
           ORDER BY rank DESC, t.created_at DESC LIMIT ${limit}`,
    values,
  }
}

export function locateTimestamp(segments: SttSegment[] | null, query: string) {
  if (!segments?.length) return { startSec: null, excerpt: '' }
  const words = query.toLowerCase().split(/\W+/).filter(word => word.length > 2)
  const match = segments.find(segment => words.some(word => segment.text.toLowerCase().includes(word))) || segments[0]
  return { startSec: match.start, excerpt: match.text }
}

export async function keywordSearch(
  principal: Principal, filters: SearchFilters, pool: pg.Pool = getPool(),
) {
  const query = buildSearchQuery(principal.orgId, filters)
  const rows = (await pool.query(query.text, query.values)).rows
  return rows.map(row => ({ ...row, location: locateTimestamp(row.segments, filters.q || '') }))
}

export async function semanticSearch(
  principal: Principal, queryText: string, filters: SearchFilters,
  config: EmbeddingConfig = {}, pool: pg.Pool = getPool(),
) {
  const queryVector = await embedText(queryText, config)
  const values: unknown[] = [principal.orgId, queryVector.embedding]
  let collectionClause = ''
  if (filters.collectionId) { values.push(filters.collectionId); collectionClause = `AND t.collection_id = $${values.length}` }
  values.push(filters.limit || 30)
  const rows = (await pool.query(
    `SELECT t.id, t.title, t.source, t.task, t.language, t.duration_sec, t.text,
            t.segments, t.tags, t.collection_id, t.created_at, c.name AS collection_name,
            (SELECT coalesce(sum(a.value * b.value), 0) /
              nullif(sqrt(sum(a.value * a.value)) * sqrt(sum(b.value * b.value)), 0)
             FROM unnest(e.embedding) WITH ORDINALITY a(value, idx)
             JOIN unnest($2::double precision[]) WITH ORDINALITY b(value, idx) USING (idx)) AS rank
     FROM transcript_embeddings e
     JOIN transcripts t ON t.id = e.transcript_id
     LEFT JOIN collections c ON c.id = t.collection_id
     WHERE e.org_id = $1 ${collectionClause}
     ORDER BY rank DESC NULLS LAST LIMIT $${values.length}`,
    values,
  )).rows
  return rows.map(row => ({ ...row, location: locateTimestamp(row.segments, queryText) }))
}

export async function indexTranscriptEmbedding(
  principal: Principal, transcript: { id: string; title: string; text: string },
  config: EmbeddingConfig = {}, pool: pg.Pool = getPool(),
) {
  const vector = await embedText(`${transcript.title}\n\n${transcript.text}`, config)
  await pool.query(
    `INSERT INTO transcript_embeddings (transcript_id, org_id, model, embedding, content_hash)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (transcript_id) DO UPDATE SET model = EXCLUDED.model,
       embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, updated_at = now()`,
    [transcript.id, principal.orgId, vector.model, vector.embedding, vector.contentHash],
  )
  return { model: vector.model, dimensions: vector.embedding.length }
}
