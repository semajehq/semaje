import 'dotenv/config'
import { getPool } from '@semaje/db'
import { runRetention } from './index.ts'
import { logError, logInfo } from '../../observability/src/logger.ts'

async function sweep() {
  const pool = getPool()
  const policies = (await pool.query(
    `SELECT p.org_id, COALESCE(p.updated_by, owner.user_id) AS user_id
     FROM retention_policies p
     LEFT JOIN LATERAL (
       SELECT user_id FROM memberships WHERE org_id = p.org_id AND role = 'owner' LIMIT 1
     ) owner ON true
     WHERE p.enabled = true`,
  )).rows
  for (const policy of policies) {
    if (!policy.user_id) continue
    try {
      const result = await runRetention({
        userId: policy.user_id, orgId: policy.org_id, role: 'owner', scopes: [], via: 'jwt',
      })
      logInfo('retention.succeeded', { orgId: policy.org_id, transcripts: result.transcripts, audioBlobs: result.audioBlobs })
    } catch (error: any) {
      logError('retention.failed', { orgId: policy.org_id, error: error.message })
    }
  }
}

await sweep()
if (process.env.RETENTION_DAEMON === 'true') {
  const intervalMs = Math.max(1, Number(process.env.RETENTION_INTERVAL_HOURS || 24)) * 3_600_000
  setInterval(sweep, intervalMs)
} else {
  await getPool().end()
}
