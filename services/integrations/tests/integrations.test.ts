import { test } from 'node:test'
import assert from 'node:assert/strict'
import { integrationStatus } from '../src/index.ts'

test('integrations are default-off and expose no credential values', () => {
  const previous = { ...process.env }
  delete process.env.INTEGRATION_FILE_SYNC_DIR
  delete process.env.NEXTCLOUD_WEBDAV_URL
  delete process.env.SLACK_WEBHOOK_URL
  delete process.env.TEAMS_WEBHOOK_URL
  delete process.env.SMTP_URL
  try {
    const status = integrationStatus()
    assert.deepEqual(status.adapters, {
      local: false, nextcloud: false, slack: false, teams: false, email: false,
    })
    assert.equal(JSON.stringify(status).includes('password'), false)
  } finally {
    Object.assign(process.env, previous)
  }
})

test('sharing can be disabled globally or constrained to local clients', () => {
  const enabled = process.env.SHARING_ENABLED
  const local = process.env.SHARE_LOCAL_ONLY
  process.env.SHARING_ENABLED = 'false'
  process.env.SHARE_LOCAL_ONLY = 'true'
  try {
    assert.deepEqual(integrationStatus().sharing, { enabled: false, localOnly: true })
  } finally {
    if (enabled == null) delete process.env.SHARING_ENABLED; else process.env.SHARING_ENABLED = enabled
    if (local == null) delete process.env.SHARE_LOCAL_ONLY; else process.env.SHARE_LOCAL_ONLY = local
  }
})

test('strict local mode suppresses every network integration but keeps local delivery', () => {
  const keys = [
    'STRICT_LOCAL_MODE', 'INTEGRATION_FILE_SYNC_DIR', 'NEXTCLOUD_WEBDAV_URL',
    'NEXTCLOUD_USERNAME', 'NEXTCLOUD_PASSWORD', 'SLACK_WEBHOOK_URL',
    'TEAMS_WEBHOOK_URL', 'SMTP_URL', 'WEBHOOK_SECRET',
  ] as const
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  Object.assign(process.env, {
    STRICT_LOCAL_MODE: 'true',
    INTEGRATION_FILE_SYNC_DIR: '/tmp/semaje-local-delivery',
    NEXTCLOUD_WEBDAV_URL: 'https://cloud.example.test/dav',
    NEXTCLOUD_USERNAME: 'team', NEXTCLOUD_PASSWORD: 'secret',
    SLACK_WEBHOOK_URL: 'https://hooks.slack.test/one',
    TEAMS_WEBHOOK_URL: 'https://teams.example.test/one',
    SMTP_URL: 'smtp://mail.example.test', WEBHOOK_SECRET: 'secret',
  })
  try {
    const status = integrationStatus()
    assert.equal(status.strictLocal, true)
    assert.deepEqual(status.sharing, { enabled: false, localOnly: false })
    assert.deepEqual(status.adapters, {
      local: true, nextcloud: false, slack: false, teams: false, email: false,
    })
    assert.equal(status.webhookSigning, false)
  } finally {
    for (const key of keys) {
      if (before[key] == null) delete process.env[key]
      else process.env[key] = before[key]
    }
  }
})
