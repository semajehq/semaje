// ═══════════════════════════════════════════════════════════════
// services/auth — pluggable identity. Adapters:
//   single-user (default self-host): no login, one seeded principal
//   local-db: email+password against Postgres (small team)
//   oidc: Phase 3 (cloud SSO) — seam reserved
// ═══════════════════════════════════════════════════════════════
import bcrypt from 'bcryptjs'
import type pg from 'pg'
import { getPool } from '@semaje/db'
import type { Principal } from '@semaje/schemas'
import { verifyToken, signAccessToken, signRefreshToken } from './tokens.ts'
import { parseApiKey, verifyApiKeySecret } from './apikeys.ts'

export { signAccessToken, signRefreshToken, verifyToken } from './tokens.ts'
export { generateApiKey, parseApiKey, verifyApiKeySecret } from './apikeys.ts'
export { assertSameOrg, assertRoleAtLeast, ForbiddenError } from './tenancy.ts'

export class AuthError extends Error {
  status = 401
  constructor(msg = 'Unauthorized') { super(msg) }
}

const ADAPTER = () => process.env.AUTH_ADAPTER || 'single-user'

// ── Seeding (idempotent) ─────────────────────────────────────
// Single-user mode needs exactly one org + user to exist.
let seeded: { userId: string; orgId: string } | null = null

export async function ensureSeed(pool: pg.Pool = getPool()): Promise<{ userId: string; orgId: string }> {
  if (seeded) return seeded
  const email = process.env.SINGLE_USER_EMAIL || 'owner@semaje.local'
  const org = await pool.query(
    `INSERT INTO orgs (name) SELECT 'Default'
     WHERE NOT EXISTS (SELECT 1 FROM orgs) RETURNING id`,
  )
  const orgId: string = org.rows[0]?.id
    ?? (await pool.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0].id
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ($1, 'Owner')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [email],
  )
  const userId: string = user.rows[0].id
  await pool.query(
    `INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')
     ON CONFLICT (user_id, org_id) DO NOTHING`,
    [userId, orgId],
  )
  seeded = { userId, orgId }
  return seeded
}

/** Test seam. */
export function _resetSeed(): void { seeded = null }

// ── Register / login (local-db adapter) ──────────────────────
export async function registerUser(
  email: string, password: string, displayName?: string, pool: pg.Pool = getPool(),
): Promise<Principal> {
  if (ADAPTER() === 'single-user') throw new AuthError('Registration disabled in single-user mode')
  const hash = bcrypt.hashSync(password, 10)
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
    [email.toLowerCase(), hash, displayName || email.split('@')[0]],
  )
  const userId = user.rows[0].id
  // Each new registration gets its own org (owner). Invites come in Phase 3.
  const org = await pool.query(`INSERT INTO orgs (name) VALUES ($1) RETURNING id`,
    [`${displayName || email.split('@')[0]}'s workspace`])
  const orgId = org.rows[0].id
  await pool.query(`INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')`,
    [userId, orgId])
  return { userId, orgId, role: 'owner', scopes: [], via: 'jwt' }
}

export async function loginUser(
  email: string, password: string, pool: pg.Pool = getPool(),
): Promise<Principal> {
  const res = await pool.query(
    `SELECT u.id, u.password_hash, m.org_id, m.role
     FROM users u JOIN memberships m ON m.user_id = u.id
     WHERE u.email = $1 ORDER BY m.created_at LIMIT 1`,
    [email.toLowerCase()],
  )
  const row = res.rows[0]
  if (!row?.password_hash || !bcrypt.compareSync(password, row.password_hash)) {
    throw new AuthError('Invalid email or password')
  }
  await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [row.id])
  return { userId: row.id, orgId: row.org_id, role: row.role, scopes: [], via: 'jwt' }
}

// ── The one authenticate() every request goes through ────────
export async function authenticate(
  headers: Record<string, string | string[] | undefined>,
  pool: pg.Pool = getPool(),
): Promise<Principal> {
  const raw = headers['authorization']
  const header = Array.isArray(raw) ? raw[0] : raw

  // 1. API key (works in every adapter mode)
  if (header?.startsWith('Bearer smj_')) {
    const parsed = parseApiKey(header.slice(7))
    if (!parsed) throw new AuthError('Malformed API key')
    const res = await pool.query(
      `SELECT k.key_hash, k.org_id, k.owner_id, k.scopes, m.role
       FROM api_keys k JOIN memberships m ON m.user_id = k.owner_id AND m.org_id = k.org_id
       WHERE k.key_prefix = $1 AND k.revoked_at IS NULL`,
      [parsed.prefix],
    )
    const row = res.rows[0]
    if (!row || !verifyApiKeySecret(parsed.secret, row.key_hash)) throw new AuthError('Invalid API key')
    pool.query(`UPDATE api_keys SET last_used_at = now() WHERE key_prefix = $1`, [parsed.prefix])
      .catch(() => {})
    pool.query(
      `INSERT INTO audit_events (org_id, actor_id, action, target_type, target_id, metadata)
       VALUES ($1,$2,'api_key.used','api_key',$3,$4)`,
      [row.org_id, row.owner_id, parsed.prefix, JSON.stringify({ scopes: row.scopes })],
    ).catch(() => {})
    return { userId: row.owner_id, orgId: row.org_id, role: row.role, scopes: row.scopes, via: 'api-key' }
  }

  // 2. JWT
  if (header?.startsWith('Bearer ')) {
    try { return verifyToken(header.slice(7), 'access') }
    catch { throw new AuthError('Invalid or expired token') }
  }

  // 3. single-user mode: no credentials required
  if (ADAPTER() === 'single-user') {
    const seed = await ensureSeed(pool)
    return { userId: seed.userId, orgId: seed.orgId, role: 'owner', scopes: [], via: 'single-user' }
  }

  throw new AuthError('Authentication required')
}
