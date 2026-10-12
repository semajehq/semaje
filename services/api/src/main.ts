// semaje API entrypoint — HTTP + WS + (optionally) static frontend.
import 'dotenv/config'
import { createServer } from 'node:http'
import express from 'express'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { attachRealtime } from '../../realtime/src/ws-server.ts'
import { sttHealth } from '../../stt/client/index.ts'
import { ensureSeed } from '../../auth/src/index.ts'
import { logInfo, logWarn } from '../../observability/src/logger.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)

const app = createApp()

// Serve the built frontend when co-hosted (compose uses nginx instead).
if (process.env.SERVE_FRONTEND !== 'false') {
  const dist = join(__dirname, '../../../dist')
  app.use(express.static(dist))
  app.get('{*splat}', (_req, res) => { res.sendFile(join(dist, 'index.html')) })
}

const server = createServer(app)
attachRealtime(server)

server.listen(PORT, async () => {
  logInfo('api.ready', { port: PORT, websocketPath: '/ws' })
  if ((process.env.AUTH_ADAPTER || 'single-user') === 'single-user') {
    try { await ensureSeed(); logInfo('auth.ready', { adapter: 'single-user', seeded: true }) }
    catch (e: any) { logWarn('auth.seed_pending', { adapter: 'single-user', error: e.message }) }
  } else {
    logInfo('auth.ready', { adapter: process.env.AUTH_ADAPTER })
  }
  const w = await sttHealth()
  logInfo('dependencies.ready', {
    stt: (w as { backend?: string }).backend || null,
    llm: process.env.LLM_ADAPTER || 'claude-local', storage: process.env.STORAGE_ADAPTER || 'fs',
  })
})
