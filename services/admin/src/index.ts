import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type pg from 'pg'
import { getPool } from '@semaje/db'
import type { Principal, Role } from '@semaje/schemas'
import { getStorage } from '../../storage/src/index.ts'
import { inviteToken, verifyInviteToken } from '../../auth/src/oidc.ts'

export interface AuditContext {
  ip?: string
  userAgent?: string
}

export async function auditEvent(
  principal: Principal, action: string,
  target: { type?: string; id?: string; metadata?: Record<string, unknown> } = {},
  context: AuditContext = {}, pool: pg.Pool = getPool(),
) {
  await pool.query(
    `INSERT INTO audit_events
       (org_id, actor_id, action, target_type, target_id, metadata, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      principal.orgId, principal.userId, action, target.type || null, target.id || null,
      JSON.stringify(target.metadata || {}), context.ip || null, context.userAgent || null,
    ],
  )
}

export async function createWorkspaceInvite(
  principal: Principal, input: { email: string; role: Exclude<Role, 'owner'>; expiresInDays: number },
  pool: pg.Pool = getPool(),
) {
  const expiresAt = Date.now() + input.expiresInDays * 86_400_000
  const secret = process.env.INVITE_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me'
  const token = inviteToken({
    email: input.email.toLowerCase(), orgId: principal.orgId, role: input.role, expiresAt,
  }, secret)
  const hash = createHash('sha256').update(token).digest('hex')
  const row = await pool.query(
    `INSERT INTO invites (org_id, email, role, token_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, email, role, expires_at, created_at`,
    [principal.orgId, input.email.toLowerCase(), input.role, hash, new Date(expiresAt)],
  )
  return { invite: row.rows[0], token }
}

export async function acceptWorkspaceInvite(
  token: string, password: string, displayName?: string, pool: pg.Pool = getPool(),
): Promise<Principal> {
  const secret = process.env.INVITE_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me'
  const decoded = verifyInviteToken(token, secret)
  if (!decoded) throw new Error('Invite is invalid or expired')
  const hash = createHash('sha256').update(token).digest('hex')
  const invite = (await pool.query(
    `SELECT id, org_id, email, role FROM invites
     WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`, [hash],
  )).rows[0]
  if (!invite || invite.org_id !== decoded.orgId || invite.email !== decoded.email) {
    throw new Error('Invite is invalid or already used')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const user = (await client.query(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name)
       RETURNING id`,
      [decoded.email, bcrypt.hashSync(password, 10), displayName || decoded.email.split('@')[0]],
    )).rows[0]
    await client.query(
      `INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role`,
      [user.id, decoded.orgId, decoded.role],
    )
    await client.query(`UPDATE invites SET accepted_at = now() WHERE id = $1`, [invite.id])
    await client.query('COMMIT')
    return {
      userId: user.id, orgId: decoded.orgId, role: decoded.role, scopes: [], via: 'jwt',
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function getRetentionPolicy(orgId: string, pool: pg.Pool = getPool()) {
  return (await pool.query(
    `SELECT enabled, default_days, source_rules, delete_audio, updated_at
     FROM retention_policies WHERE org_id = $1`, [orgId],
  )).rows[0] || {
    enabled: false, default_days: 365, source_rules: {}, delete_audio: true, updated_at: null,
  }
}

export async function saveRetentionPolicy(
  principal: Principal,
  policy: { enabled: boolean; defaultDays: number; sourceRules: Record<string, number>; deleteAudio: boolean },
  pool: pg.Pool = getPool(),
) {
  return (await pool.query(
    `INSERT INTO retention_policies
       (org_id, enabled, default_days, source_rules, delete_audio, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id) DO UPDATE SET
       enabled = EXCLUDED.enabled, default_days = EXCLUDED.default_days,
       source_rules = EXCLUDED.source_rules, delete_audio = EXCLUDED.delete_audio,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [
      principal.orgId, policy.enabled, policy.defaultDays,
      JSON.stringify(policy.sourceRules), policy.deleteAudio, principal.userId,
    ],
  )).rows[0]
}

export async function runRetention(
  principal: Principal, dryRun = true, pool: pg.Pool = getPool(),
) {
  const policy = await getRetentionPolicy(principal.orgId, pool)
  if (!policy.enabled) return { dryRun, transcripts: 0, audioBlobs: 0, disabled: true }
  const expired = (await pool.query(
    `SELECT t.id, t.audio_blob_id, b.storage_key
     FROM transcripts t LEFT JOIN audio_blobs b ON b.id = t.audio_blob_id
     WHERE t.org_id = $1
       AND COALESCE((($2::jsonb ->> t.source)::int), $3::int) > 0
       AND t.created_at < now() - make_interval(days => COALESCE((($2::jsonb ->> t.source)::int), $3::int))
     ORDER BY t.created_at LIMIT 1000`,
    [principal.orgId, JSON.stringify(policy.source_rules || {}), policy.default_days],
  )).rows
  if (dryRun) return { dryRun: true, transcripts: expired.length, audioBlobs: expired.filter(row => row.audio_blob_id).length }

  const storage = await getStorage()
  let audioBlobs = 0
  for (const row of expired) {
    await pool.query(`DELETE FROM transcripts WHERE org_id = $1 AND id = $2`, [principal.orgId, row.id])
    if (policy.delete_audio && row.audio_blob_id) {
      const stillUsed = Number((await pool.query(
        `SELECT count(*)::int AS count FROM transcripts WHERE audio_blob_id = $1`, [row.audio_blob_id],
      )).rows[0]?.count || 0)
      if (!stillUsed) {
        if (row.storage_key) await storage.delete(row.storage_key).catch(() => {})
        await pool.query(`DELETE FROM audio_blobs WHERE org_id = $1 AND id = $2`, [principal.orgId, row.audio_blob_id])
        audioBlobs += 1
      }
    }
  }
  await pool.query(
    `INSERT INTO retention_runs (org_id, dry_run, transcripts, audio_blobs, status)
     VALUES ($1,false,$2,$3,'succeeded')`, [principal.orgId, expired.length, audioBlobs],
  )
  return { dryRun: false, transcripts: expired.length, audioBlobs }
}
