// ═══════════════════════════════════════════════════════════════
// services/api — the HTTP gateway. Auth, validation, rate limits,
// uploads, jobs, transcripts, shares, API keys, legacy sync path.
// Exported as a factory so gate tests boot it with fakes.
// ═══════════════════════════════════════════════════════════════
import express, { type Express } from 'express'
import cors from 'cors'
import multer from 'multer'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { getPool } from '@semaje/db'
import {
  RegisterRequest, LoginRequest, CreateTranscriptRequest, ListTranscriptsQuery,
  CreateJobRequest, CreateApiKeyRequest, CreateShareRequest, CreateMeetingBotRunRequest,
  UpdateTranscriptRequest, RenameSpeakerRequest, GlossaryTermRequest,
  LlmSettingsRequest,
  KnowledgeSearchQuery, CollectionRequest, SavedSearchRequest, AskKnowledgeRequest,
  IngestRequest, WebhookRequest, DeliverTranscriptRequest, ActionItemRequest, type Principal,
  InviteRequest, AcceptInviteRequest, MemberRoleRequest, WorkspaceRequest, RetentionPolicyRequest,
} from '@semaje/schemas'
import {
  registerUser, loginUser, signAccessToken, signRefreshToken, verifyToken,
  generateApiKey, ensureSeed,
} from '../../auth/src/index.ts'
import { getStorage, audioKey } from '../../storage/src/index.ts'
import {
  createTranscript, listTranscripts, getTranscript, deleteTranscript,
  createShare, getByShareToken, exportTranscript, EXPORT_FORMATS, type ExportFormat,
  updateTranscript, renameTranscriptSpeaker, listTranscriptRevisions,
  listGlossary, upsertGlossaryTerm, deleteGlossaryTerm,
  applyGlossary, cleanupPunctuation, speakerLabels, summarizeQuality,
} from '../../transcripts/src/index.ts'
import { enqueueTranscribeJob, getJob, listJobs, retryJob } from '../../jobs/src/index.ts'
import { assertBotTransition, detectMeetingProvider } from '../../meeting-bot/src/index.ts'
import {
  sttHealth, sttTranscribe, sttModels, sttDownloadModel,
  sttActivateModel, sttDeleteModel, sttLanguages, SttError,
} from '../../speech/stt-client.ts'
import { ttsHealth, ttsSynthesize, ttsVoices, TtsError } from '../../speech/tts-client.ts'
import { needsLlm, renderPlainTranscript, buildTranscriptContext } from '../../pipeline/src/index.ts'
import { createLlm, runWithFallback } from '../../llm/src/index.ts'
// @ts-ignore — plain JS prompt library shared with the worker and evals
import { TASK_DEFINITIONS, CATEGORIES } from '../../llm/src/prompts.js'
import { runMeetingWithFallback } from '../../llm/src/structured.ts'
import {
  getWorkspaceLlmConfig, saveWorkspaceLlmConfig, isLocalEndpoint,
} from '../../llm/src/settings.ts'
import {
  keywordSearch, semanticSearch, indexTranscriptEmbedding, locateTimestamp,
} from '../../search/src/index.ts'
import {
  deliverTranscript, emitIntegrationEvent, integrationStatus,
} from '../../integrations/src/index.ts'
import {
  acceptWorkspaceInvite, auditEvent, createWorkspaceInvite, getRetentionPolicy,
  runRetention, saveRetentionPolicy,
} from '../../admin/src/index.ts'
import { getOperationsSnapshot, renderPrometheus } from '../../observability/src/index.ts'
import { requireAuth, requireScope, rateLimit, validate, errorHandler } from './middleware.ts'

function isLocalRequest(ip = '') {
  const value = ip.replace(/^::ffff:/, '')
  return value === '::1' || value === '127.0.0.1' || value.startsWith('10.')
    || value.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(value)
}

function isPrivateUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || host.startsWith('10.') || host.startsWith('192.168.')
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || !host.includes('.')
  } catch { return false }
}

function exportableTranscript(t: any) {
  return {
    id: t.id, title: t.title, text: t.text, segments: t.segments,
    source: t.source, task: t.task, language: t.language,
    durationSec: t.duration_sec, createdAt: t.created_at, result: t.result,
    speakerLabels: t.speaker_labels, tags: t.tags,
  }
}

function auditContext(req: express.Request) {
  return { ip: req.ip, userAgent: req.header('user-agent') || undefined }
}

function routeParam(req: express.Request, name: string) {
  const value = req.params[name]
  return Array.isArray(value) ? value[0] || '' : value
}

function tokensMatch(supplied: string, expected: string) {
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createApp(opts: { enableJobs?: boolean } = {}): Express {
  const app = express()
  const enableJobs = opts.enableJobs !== false
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0)
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops)

  app.use(cors({
    origin: (process.env.CORS_ORIGINS
      || 'http://localhost:5173,http://localhost:4173').split(','),
    credentials: true,
  }))
  app.use(express.json({ limit: '2mb' }))
  // One id per request, echoed back and forwarded to STT/TTS so a single id
  // traces a request across every service's logs.
  app.use((req, res, next) => {
    const incoming = req.header('x-request-id')
    req.requestId = incoming && /^[\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID()
    res.setHeader('x-request-id', req.requestId)
    next()
  })

  const upload = multer({
    dest: process.env.UPLOAD_TMP_DIR || 'uploads/',
    limits: { fileSize: Number(process.env.UPLOAD_MAX_MB || 500) * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const extension = file.originalname.split('.').pop()?.toLowerCase()
      const supported = new Set(['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'aac', 'webm', 'mp4', 'mov', 'mkv'])
      if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/') || supported.has(extension || '')) cb(null, true)
      else cb(new Error('Only audio and video files are supported.'))
    },
  })

  const persistUpload = async (file: Express.Multer.File, principal: Principal) => {
    const blobId = randomUUID()
    const ext = file.originalname.split('.').pop() || 'bin'
    const key = audioKey(principal.orgId, blobId, ext)
    const storage = await getStorage()
    await storage.put(key, await readFile(file.path), file.mimetype)
    const row = await getPool().query(
      `INSERT INTO audio_blobs (id, org_id, owner_id, storage_key, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, storage_key, mime_type, size_bytes`,
      [blobId, principal.orgId, principal.userId, key, file.mimetype, file.size],
    )
    return row.rows[0]
  }

  const parseJsonField = (value: unknown, fallback: unknown) => {
    if (value == null || value === '') return fallback
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) }
    catch {
      const error = new Error('Multipart options and captureMeta fields must contain valid JSON.') as Error & { status?: number }
      error.status = 400
      throw error
    }
  }

  // ── Health ─────────────────────────────────────────────────
  app.get('/api/health', async (_req, res) => {
    const [w, t] = await Promise.all([sttHealth(), ttsHealth()])
    res.json({
      ok: true,
      name: 'semaje',
      mode: process.env.AUTH_ADAPTER || 'single-user',
      stt: { reachable: w.ok === true, backend: w.backend ?? null, engines: w.engines ?? null },
      tts: { reachable: t.ok === true, allowNoncommercial: t.allowNoncommercial ?? null },
      llmAdapter: process.env.LLM_ADAPTER || 'ollama',
    })
  })

  // ── Task catalog (labels/options for clients; prompts stay server-side) ──
  app.get('/api/tasks', requireAuth(), rateLimit(), (_req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.json({ tasks: TASK_DEFINITIONS, categories: CATEGORIES })
  })

  // ── Languages + speech synthesis ───────────────────────────
  // STT languages enriched with TTS voice coverage. Cached: both lists only
  // change when an operator installs models.
  let languagesCache: { at: number; body: unknown } | null = null
  app.get('/api/languages', requireAuth(), rateLimit(), async (_req, res, next) => {
    try {
      if (!languagesCache || Date.now() - languagesCache.at > 5 * 60 * 1000) {
        const [stt, tts] = await Promise.all([
          sttLanguages(),
          ttsVoices().catch(() => ({ voices: [] as Array<Record<string, any>>, allowNoncommercial: false })),
        ])
        const voicesByLanguage = new Map<string, Array<Record<string, any>>>()
        for (const voice of tts.voices) {
          const list = voicesByLanguage.get(voice.language) || []
          list.push(voice)
          voicesByLanguage.set(voice.language, list)
        }
        const languages = stt.languages.map((lang: Record<string, any>) => {
          const voices = voicesByLanguage.get(lang.code) || []
          return {
            code: lang.code, name: lang.name, iso1: lang.iso1, whisper: lang.whisper, aliases: lang.aliases,
            engines: lang.engines, whisperStrong: lang.whisperStrong, translate: lang.translate,
            tts: { voices: voices.length, engines: [...new Set(voices.map(v => v.engine))] },
          }
        })
        languagesCache = {
          at: Date.now(),
          body: {
            total: stt.total, available: stt.available, ttsNoncommercial: tts.allowNoncommercial,
            withTts: languages.filter((l: any) => l.tts.voices > 0).length, languages,
          },
        }
      }
      res.setHeader('Cache-Control', 'private, max-age=300')
      res.json(languagesCache.body)
    } catch (e) { next(e) }
  })

  app.get('/api/tts/voices', requireAuth(), rateLimit(), async (req, res, next) => {
    try { res.json(await ttsVoices(typeof req.query.language === 'string' ? req.query.language : undefined)) }
    catch (e) {
      if (e instanceof TtsError) return res.status(e.status).json({ error: e.message, code: e.code })
      next(e)
    }
  })

  app.post('/api/tts', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const body = req.body || {}
      if (typeof body.text !== 'string' || !body.text.trim()) {
        return res.status(400).json({ error: 'text is required', code: 'invalid_text' })
      }
      const out = await ttsSynthesize({
        text: body.text, language: body.language, voice: body.voice,
        format: body.format, speed: body.speed, requestId: req.requestId,
      })
      for (const [key, value] of Object.entries(out.headers)) res.setHeader(key, value)
      res.setHeader('Content-Type', out.contentType)
      res.setHeader('Access-Control-Expose-Headers', 'x-semaje-voice, x-semaje-engine, x-semaje-language, x-semaje-license, x-request-id')
      res.send(out.audio)
    } catch (e) {
      if (e instanceof TtsError) return res.status(e.status).json({ error: e.message, code: e.code })
      next(e)
    }
  })

  app.get('/metrics', async (req, res, next) => {
    try {
      const expected = process.env.METRICS_TOKEN || ''
      const supplied = String(req.header('authorization') || '').replace(/^Bearer\s+/i, '')
      if (expected ? !tokensMatch(supplied, expected) : !isLocalRequest(req.ip)) {
        return res.status(403).type('text/plain').send('metrics access denied\n')
      }
      const orgId = process.env.METRICS_ORG_ID || (await getPool().query(
        `SELECT id FROM orgs ORDER BY created_at LIMIT 1`,
      )).rows[0]?.id
      if (!orgId) return res.type('text/plain; version=0.0.4').send('# semaje has no organizations yet\n')
      const snapshot = await getOperationsSnapshot({
        orgId, userId: '00000000-0000-0000-0000-000000000000', role: 'owner', scopes: [], via: 'single-user',
      })
      res.type('text/plain; version=0.0.4').send(renderPrometheus(snapshot))
    } catch (error) { next(error) }
  })

  // ── Auth ───────────────────────────────────────────────────
  app.post('/api/auth/register', validate(RegisterRequest), async (req, res, next) => {
    try {
      const p = await registerUser(req.body.email, req.body.password, req.body.displayName)
      res.status(201).json({
        accessToken: signAccessToken(p),
        refreshToken: signRefreshToken(p),
        user: { id: p.userId, email: req.body.email, displayName: req.body.displayName ?? null },
      })
    } catch (e: any) {
      if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' })
      next(e)
    }
  })

  app.post('/api/auth/token', validate(LoginRequest), async (req, res, next) => {
    try {
      const p = await loginUser(req.body.email, req.body.password)
      res.json({
        accessToken: signAccessToken(p),
        refreshToken: signRefreshToken(p),
        user: { id: p.userId, email: req.body.email, displayName: null },
      })
    } catch (e) { next(e) }
  })

  app.post('/api/auth/refresh', async (req, res, next) => {
    try {
      const p = verifyToken(String(req.body?.refreshToken || ''), 'refresh')
      res.json({ accessToken: signAccessToken(p) })
    } catch (e) { next(e) }
  })

  app.post('/api/auth/invites/accept', rateLimit(), validate(AcceptInviteRequest), async (req, res, next) => {
    try {
      const principal = await acceptWorkspaceInvite(req.body.token, req.body.password, req.body.displayName)
      await auditEvent(principal, 'invite.accepted', { type: 'user', id: principal.userId }, auditContext(req))
      res.status(201).json({
        accessToken: signAccessToken(principal), refreshToken: signRefreshToken(principal),
        principal,
      })
    } catch (e: any) {
      e.status = 400
      next(e)
    }
  })

  app.get('/api/me', requireAuth(), rateLimit(), async (req, res) => {
    res.json({ principal: req.principal })
  })

  // ── Team administration, audit, and retention ─────────────
  app.get('/api/admin/security', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const p = req.principal!
      const [members, invites, workspaces, audits, retention] = await Promise.all([
        getPool().query(
          `SELECT u.id, u.email, u.display_name, m.role, m.created_at, u.last_login_at
           FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = $1 ORDER BY lower(u.email)`, [p.orgId],
        ),
        getPool().query(
          `SELECT id, email, role, expires_at, accepted_at, created_at FROM invites
           WHERE org_id = $1 ORDER BY created_at DESC LIMIT 30`, [p.orgId],
        ),
        getPool().query(
          `SELECT id, name, created_at FROM workspaces WHERE org_id = $1 ORDER BY created_at`, [p.orgId],
        ),
        getPool().query(
          `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.ip_address,
                  a.created_at, u.email AS actor_email
           FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
           WHERE a.org_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [p.orgId],
        ),
        getRetentionPolicy(p.orgId),
      ])
      res.json({
        members: members.rows, invites: invites.rows, workspaces: workspaces.rows,
        auditEvents: audits.rows, retention,
        deployment: {
          authMode: process.env.AUTH_ADAPTER || 'single-user',
          strictLocal: process.env.STRICT_LOCAL_MODE === 'true',
          sharingEnabled: process.env.STRICT_LOCAL_MODE !== 'true' && process.env.SHARING_ENABLED !== 'false',
          encryptionKeyConfigured: Boolean(process.env.DATA_ENCRYPTION_KEY),
        },
      })
    } catch (e) { next(e) }
  })

  app.get('/api/admin/observability', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const [snapshot, runtime] = await Promise.all([
        getOperationsSnapshot(req.principal!),
        sttModels().catch(() => ({ models: [], active: null, hardware: null })),
      ])
      res.json({ ...snapshot, modelCache: runtime })
    } catch (error) { next(error) }
  })

  app.post('/api/admin/invites', requireAuth(), requireScope('admin'), rateLimit(), validate(InviteRequest), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const created = await createWorkspaceInvite(req.principal!, req.body)
      await auditEvent(req.principal!, 'invite.created', {
        type: 'invite', id: created.invite.id, metadata: { email: created.invite.email, role: created.invite.role },
      }, auditContext(req))
      res.status(201).json(created)
    } catch (e) { next(e) }
  })

  app.patch('/api/admin/members/:userId', requireAuth(), requireScope('admin'), rateLimit(), validate(MemberRoleRequest), async (req, res, next) => {
    try {
      if (req.principal!.role !== 'owner') return res.status(403).json({ error: 'Owner access required' })
      const current = (await getPool().query(
        `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [req.principal!.orgId, routeParam(req, 'userId')],
      )).rows[0]
      if (!current) return res.status(404).json({ error: 'Member not found' })
      if (current.role === 'owner' && req.body.role !== 'owner') {
        const owners = Number((await getPool().query(
          `SELECT count(*)::int AS count FROM memberships WHERE org_id = $1 AND role = 'owner'`,
          [req.principal!.orgId],
        )).rows[0]?.count || 0)
        if (owners <= 1) return res.status(409).json({ error: 'The last owner cannot be demoted.' })
      }
      const member = (await getPool().query(
        `UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2 RETURNING *`,
        [req.principal!.orgId, routeParam(req, 'userId'), req.body.role],
      )).rows[0]
      await auditEvent(req.principal!, 'member.role_changed', {
        type: 'user', id: routeParam(req, 'userId'), metadata: { from: current.role, to: req.body.role },
      }, auditContext(req))
      res.json({ member })
    } catch (e) { next(e) }
  })

  app.post('/api/admin/workspaces', requireAuth(), requireScope('admin'), rateLimit(), validate(WorkspaceRequest), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const workspace = (await getPool().query(
        `INSERT INTO workspaces (org_id, name) VALUES ($1,$2) RETURNING *`,
        [req.principal!.orgId, req.body.name],
      )).rows[0]
      await auditEvent(req.principal!, 'workspace.created', { type: 'workspace', id: workspace.id }, auditContext(req))
      res.status(201).json({ workspace })
    } catch (e) { next(e) }
  })

  app.put('/api/admin/retention', requireAuth(), requireScope('admin'), rateLimit(), validate(RetentionPolicyRequest), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const retention = await saveRetentionPolicy(req.principal!, req.body)
      await auditEvent(req.principal!, 'retention.updated', {
        type: 'retention', metadata: { enabled: req.body.enabled, defaultDays: req.body.defaultDays },
      }, auditContext(req))
      res.json({ retention })
    } catch (e) { next(e) }
  })

  app.post('/api/admin/retention/run', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const dryRun = req.body?.dryRun !== false
      const run = await runRetention(req.principal!, dryRun)
      await auditEvent(req.principal!, dryRun ? 'retention.previewed' : 'retention.executed', {
        type: 'retention', metadata: run,
      }, auditContext(req))
      res.json({ run })
    } catch (e) { next(e) }
  })

  // ── Local STT model control plane ──────────────────────────
  app.get('/api/admin/stt', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const runtime = await sttModels()
      res.json({
        ...runtime,
        queue: {
          workerSlots: Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1)),
          maxQueuedJobs: Math.max(1, Number(process.env.MAX_QUEUED_JOBS || 100)),
        },
      })
    } catch (e) { next(e) }
  })

  app.post('/api/admin/stt/models/download', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      res.json(await sttDownloadModel(String(req.body?.backend || ''), String(req.body?.model || '')))
    } catch (e) { next(e) }
  })

  app.post('/api/admin/stt/models/activate', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      res.json(await sttActivateModel(String(req.body?.backend || ''), String(req.body?.model || '')))
    } catch (e) { next(e) }
  })

  app.delete('/api/admin/stt/models/:backend/:model', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      res.json(await sttDeleteModel(routeParam(req, 'backend'), routeParam(req, 'model')))
    } catch (e) { next(e) }
  })

  // ── Local meeting-intelligence runtime ─────────────────────
  app.get('/api/admin/llm', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      res.json({ config: await getWorkspaceLlmConfig(req.principal!.orgId) })
    } catch (e) { next(e) }
  })

  app.put('/api/admin/llm', requireAuth(), requireScope('admin'), rateLimit(), validate(LlmSettingsRequest), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      if (req.body.endpoint && !isLocalEndpoint(req.body.endpoint)) {
        return res.status(400).json({ error: 'Local AI endpoints must resolve to localhost, a private network, or a compose service.' })
      }
      const saved = await saveWorkspaceLlmConfig(req.principal!.orgId, req.body)
      res.json({ config: saved.llm_config, updatedAt: saved.updated_at })
    } catch (e) { next(e) }
  })

  app.post('/api/admin/llm/test', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const parsed = LlmSettingsRequest.safeParse(req.body?.config || await getWorkspaceLlmConfig(req.principal!.orgId))
      if (!parsed.success) return res.status(400).json({ error: 'Invalid local AI configuration' })
      if (parsed.data.endpoint && !isLocalEndpoint(parsed.data.endpoint)) {
        return res.status(400).json({ error: 'Endpoint is not local or private.' })
      }
      const adapter = createLlm(parsed.data.adapter, parsed.data)
      const output = await adapter.run('Reply with exactly: local intelligence ready', 'SYSTEM CHECK')
      res.json({ ok: true, output, runtime: adapter.lastRun })
    } catch (e) { next(e) }
  })

  // ── Uploads → audio_blobs ──────────────────────────────────
  app.post('/api/uploads', requireAuth(), requireScope('transcribe'), rateLimit(), upload.single('audio'), async (req, res, next) => {
    const tmpPath = req.file?.path
    try {
      if (!req.file) return res.status(400).json({ error: 'No audio file provided.' })
      res.status(201).json({ audioBlob: await persistUpload(req.file, req.principal!) })
    } catch (e) { next(e) }
    finally { if (tmpPath) unlink(tmpPath).catch(() => {}) }
  })

  app.post('/api/uploads/presign', requireAuth(), requireScope('transcribe'), rateLimit(), async (req, res, next) => {
    try {
      const p = req.principal!
      const mimeType = String(req.body?.mimeType || 'audio/mpeg')
      const ext = String(req.body?.filename || 'audio.bin').split('.').pop() || 'bin'
      const blobId = randomUUID()
      const key = audioKey(p.orgId, blobId, ext)
      const storage = await getStorage()
      const presigned = await storage.presignUpload(key, mimeType)
      if (!presigned) return res.json({ presigned: null, fallback: '/api/uploads' })
      await getPool().query(
        `INSERT INTO audio_blobs (id, org_id, owner_id, storage_key, mime_type)
         VALUES ($1,$2,$3,$4,$5)`,
        [blobId, p.orgId, p.userId, key, mimeType],
      )
      res.json({ presigned, audioBlobId: blobId })
    } catch (e) { next(e) }
  })

  // ── Async jobs ─────────────────────────────────────────────
  app.post('/api/ingest', requireAuth(), requireScope('transcribe'), rateLimit(), upload.single('audio'), async (req, res, next) => {
    const tmpPath = req.file?.path
    try {
      if (!req.file) return res.status(400).json({ error: 'No audio file provided.' })
      const idempotencyKey = String(req.body?.idempotencyKey || req.header('Idempotency-Key') || '') || undefined
      if (idempotencyKey) {
        const existing = await getPool().query(
          `SELECT * FROM jobs WHERE org_id = $1 AND ingest_key = $2`,
          [req.principal!.orgId, idempotencyKey],
        )
        if (existing.rows[0]) return res.status(200).json({ job: existing.rows[0], duplicate: true })
      }
      const parsed = IngestRequest.safeParse({
        task: req.body?.task || undefined,
        options: parseJsonField(req.body?.options, {}),
        language: req.body?.language || undefined,
        title: req.body?.title || req.file.originalname.replace(/\.[^.]+$/, ''),
        source: req.body?.source || undefined,
        webhookUrl: req.body?.webhookUrl || undefined,
        idempotencyKey,
        captureMeta: parseJsonField(req.body?.captureMeta, {}),
      })
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid ingest request',
          details: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
        })
      }
      if (process.env.STRICT_LOCAL_MODE === 'true' && parsed.data.webhookUrl && !isPrivateUrl(parsed.data.webhookUrl)) {
        return res.status(403).json({ error: 'External completion webhooks are disabled in strict local mode.' })
      }
      const blob = await persistUpload(req.file, req.principal!)
      const { webhookUrl, idempotencyKey: key, captureMeta, ...input } = parsed.data
      const job = await enqueueTranscribeJob(
        req.principal!, { ...input, audioBlobId: blob.id }, webhookUrl ?? null,
        {
          idempotencyKey: key,
          captureMeta: {
            filename: req.file.originalname,
            mimeType: req.file.mimetype,
            sizeBytes: req.file.size,
            ...captureMeta,
          },
        },
      )
      res.status(202).json({ job, audioBlob: blob, duplicate: false })
    } catch (e) { next(e) }
    finally { if (tmpPath) unlink(tmpPath).catch(() => {}) }
  })

  if (enableJobs) {
    app.post('/api/jobs', requireAuth(), requireScope('transcribe'), rateLimit(), validate(CreateJobRequest), async (req, res, next) => {
      try {
        const { webhookUrl, idempotencyKey, captureMeta, ...input } = req.body
        if (process.env.STRICT_LOCAL_MODE === 'true' && webhookUrl && !isPrivateUrl(webhookUrl)) {
          return res.status(403).json({ error: 'External completion webhooks are disabled in strict local mode.' })
        }
        const job = await enqueueTranscribeJob(req.principal!, input, webhookUrl ?? null, { idempotencyKey, captureMeta })
        res.status(202).json({ job })
      } catch (e) { next(e) }
    })
  }
  app.get('/api/jobs', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try { res.json({ jobs: await listJobs(req.principal!, Number(req.query.limit || 30)) }) }
    catch (e) { next(e) }
  })
  app.get('/api/jobs/:id', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const job = await getJob(req.principal!, routeParam(req, 'id'))
      if (!job) return res.status(404).json({ error: 'Job not found' })
      res.json({ job })
    } catch (e) { next(e) }
  })

  app.post('/api/jobs/:id/retry', requireAuth(), requireScope('transcribe'), rateLimit(), async (req, res, next) => {
    try {
      const job = await retryJob(req.principal!, routeParam(req, 'id'))
      if (!job) return res.status(404).json({ error: 'Failed job not found' })
      res.status(202).json({ job })
    } catch (e) { next(e) }
  })

  // ── Transcripts library ────────────────────────────────────
  app.post('/api/transcripts', requireAuth(), requireScope('write'), rateLimit(), validate(CreateTranscriptRequest), async (req, res, next) => {
    try { res.status(201).json({ transcript: await createTranscript(req.principal!, req.body) }) }
    catch (e) { next(e) }
  })

  app.get('/api/transcripts', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const q = ListTranscriptsQuery.safeParse(req.query)
      if (!q.success) return res.status(400).json({ error: 'Invalid query' })
      res.json({ transcripts: await listTranscripts(req.principal!, q.data) })
    } catch (e) { next(e) }
  })

  app.get('/api/transcripts/:id', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const t = await getTranscript(req.principal!, routeParam(req, 'id'))
      if (!t) return res.status(404).json({ error: 'Transcript not found' })
      await auditEvent(req.principal!, 'transcript.read', { type: 'transcript', id: t.id }, auditContext(req))
      res.json({ transcript: t })
    } catch (e) { next(e) }
  })

  app.patch('/api/transcripts/:id', requireAuth(), requireScope('write'), rateLimit(), validate(UpdateTranscriptRequest), async (req, res, next) => {
    try {
      const transcript = await updateTranscript(req.principal!, routeParam(req, 'id'), req.body)
      if (!transcript) return res.status(404).json({ error: 'Transcript not found' })
      await emitIntegrationEvent(req.principal!, 'transcript.updated', {
        transcriptId: transcript.id, title: transcript.title, fields: Object.keys(req.body),
      })
      res.json({ transcript })
    } catch (e) { next(e) }
  })

  app.post('/api/transcripts/:id/speakers/:speaker', requireAuth(), requireScope('write'), rateLimit(), validate(RenameSpeakerRequest), async (req, res, next) => {
    try {
      const transcript = await renameTranscriptSpeaker(
        req.principal!, routeParam(req, 'id'), routeParam(req, 'speaker'), req.body.name,
      )
      if (!transcript) return res.status(404).json({ error: 'Transcript not found' })
      res.json({ transcript })
    } catch (e) { next(e) }
  })

  app.get('/api/transcripts/:id/revisions', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const revisions = await listTranscriptRevisions(req.principal!, routeParam(req, 'id'))
      if (!revisions) return res.status(404).json({ error: 'Transcript not found' })
      res.json({ revisions })
    } catch (e) { next(e) }
  })

  app.get('/api/transcripts/:id/audio', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const transcript = await getTranscript(req.principal!, routeParam(req, 'id'))
      if (!transcript) return res.status(404).json({ error: 'Transcript not found' })
      if (!transcript.audio_blob_id) return res.status(404).json({ error: 'Source audio is unavailable' })
      const blob = (await getPool().query(
        `SELECT storage_key, mime_type, size_bytes FROM audio_blobs WHERE id = $1 AND org_id = $2`,
        [transcript.audio_blob_id, req.principal!.orgId],
      )).rows[0]
      if (!blob) return res.status(404).json({ error: 'Source audio is unavailable' })
      const audio = await (await getStorage()).get(blob.storage_key)
      res.setHeader('Content-Type', blob.mime_type)
      res.setHeader('Content-Length', audio.byteLength)
      res.send(audio)
    } catch (e) { next(e) }
  })

  app.delete('/api/transcripts/:id', requireAuth(), requireScope('write'), rateLimit(), async (req, res, next) => {
    try {
      const gone = await deleteTranscript(req.principal!, routeParam(req, 'id'))
      if (!gone) return res.status(404).json({ error: 'Transcript not found' })
      await auditEvent(req.principal!, 'transcript.deleted', { type: 'transcript', id: gone.id }, auditContext(req))
      res.json({ deleted: gone.id })
    } catch (e) { next(e) }
  })

  app.post('/api/transcripts/:id/actions', requireAuth(), requireScope('write'), rateLimit(), validate(ActionItemRequest), async (req, res, next) => {
    try {
      const t = await getTranscript(req.principal!, routeParam(req, 'id'))
      if (!t) return res.status(404).json({ error: 'Transcript not found' })
      const result = t.result && typeof t.result === 'object' && !Array.isArray(t.result) ? t.result : {}
      const actionItems = Array.isArray(result.actionItems) ? result.actionItems : []
      const action = { ...req.body, id: randomUUID(), createdAt: new Date().toISOString() }
      const updated = (await getPool().query(
        `UPDATE transcripts SET result = $3::jsonb, updated_at = now()
         WHERE org_id = $1 AND id = $2 RETURNING *`,
        [req.principal!.orgId, routeParam(req, 'id'), JSON.stringify({ ...result, actionItems: [...actionItems, action] })],
      )).rows[0]
      await emitIntegrationEvent(req.principal!, 'action.created', {
        transcriptId: updated.id, title: updated.title, action,
      })
      res.status(201).json({ action, transcript: updated })
    } catch (e) { next(e) }
  })

  app.get('/api/glossary', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try { res.json({ terms: await listGlossary(req.principal!) }) }
    catch (e) { next(e) }
  })

  app.post('/api/glossary', requireAuth(), requireScope('write'), rateLimit(), validate(GlossaryTermRequest), async (req, res, next) => {
    try {
      res.status(201).json({ term: await upsertGlossaryTerm(req.principal!, req.body.term, req.body.replacement) })
    } catch (e) { next(e) }
  })

  app.delete('/api/glossary/:id', requireAuth(), requireScope('write'), rateLimit(), async (req, res, next) => {
    try {
      const deleted = await deleteGlossaryTerm(req.principal!, routeParam(req, 'id'))
      if (!deleted) return res.status(404).json({ error: 'Glossary term not found' })
      res.json({ deleted: deleted.id })
    } catch (e) { next(e) }
  })

  // ── Local knowledge search ─────────────────────────────────
  app.get('/api/search', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const parsed = KnowledgeSearchQuery.safeParse(req.query)
      if (!parsed.success) return res.status(400).json({ error: 'Invalid search filters' })
      const { mode, ...filters } = parsed.data
      if (mode === 'semantic' && !filters.q.trim()) return res.status(400).json({ error: 'Semantic search requires a query' })
      const config = await getWorkspaceLlmConfig(req.principal!.orgId)
      const results = mode === 'semantic'
        ? await semanticSearch(req.principal!, filters.q, filters, {
            endpoint: config.endpoint, model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
          })
        : await keywordSearch(req.principal!, filters)
      res.json({ results, mode })
    } catch (e) { next(e) }
  })

  app.get('/api/collections', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const rows = await getPool().query(
        `SELECT c.id, c.name, c.color, c.created_at, count(t.id)::int AS transcript_count
         FROM collections c LEFT JOIN transcripts t ON t.collection_id = c.id
         WHERE c.org_id = $1 GROUP BY c.id ORDER BY lower(c.name)`,
        [req.principal!.orgId],
      )
      res.json({ collections: rows.rows })
    } catch (e) { next(e) }
  })

  app.post('/api/collections', requireAuth(), requireScope('write'), rateLimit(), validate(CollectionRequest), async (req, res, next) => {
    try {
      const row = await getPool().query(
        `INSERT INTO collections (org_id, name, color) VALUES ($1,$2,$3)
         ON CONFLICT (org_id, name) DO UPDATE SET color = EXCLUDED.color RETURNING *`,
        [req.principal!.orgId, req.body.name, req.body.color],
      )
      res.status(201).json({ collection: row.rows[0] })
    } catch (e) { next(e) }
  })

  app.delete('/api/collections/:id', requireAuth(), requireScope('write'), rateLimit(), async (req, res, next) => {
    try {
      const row = await getPool().query(
        `DELETE FROM collections WHERE org_id = $1 AND id = $2 RETURNING id`,
        [req.principal!.orgId, routeParam(req, 'id')],
      )
      if (!row.rows[0]) return res.status(404).json({ error: 'Collection not found' })
      res.json({ deleted: row.rows[0].id })
    } catch (e) { next(e) }
  })

  app.get('/api/saved-searches', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const rows = await getPool().query(
        `SELECT id, name, query, created_at FROM saved_searches
         WHERE org_id = $1 AND owner_id = $2 ORDER BY created_at DESC`,
        [req.principal!.orgId, req.principal!.userId],
      )
      res.json({ savedSearches: rows.rows })
    } catch (e) { next(e) }
  })

  app.post('/api/saved-searches', requireAuth(), requireScope('write'), rateLimit(), validate(SavedSearchRequest), async (req, res, next) => {
    try {
      const row = await getPool().query(
        `INSERT INTO saved_searches (org_id, owner_id, name, query) VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.principal!.orgId, req.principal!.userId, req.body.name, JSON.stringify(req.body.query)],
      )
      res.status(201).json({ savedSearch: row.rows[0] })
    } catch (e) { next(e) }
  })

  app.delete('/api/saved-searches/:id', requireAuth(), requireScope('write'), rateLimit(), async (req, res, next) => {
    try {
      const row = await getPool().query(
        `DELETE FROM saved_searches WHERE org_id = $1 AND owner_id = $2 AND id = $3 RETURNING id`,
        [req.principal!.orgId, req.principal!.userId, routeParam(req, 'id')],
      )
      if (!row.rows[0]) return res.status(404).json({ error: 'Saved search not found' })
      res.json({ deleted: row.rows[0].id })
    } catch (e) { next(e) }
  })

  app.post('/api/search/index/:id', requireAuth(), requireScope('write'), rateLimit(), async (req, res, next) => {
    try {
      const transcript = await getTranscript(req.principal!, routeParam(req, 'id'))
      if (!transcript) return res.status(404).json({ error: 'Transcript not found' })
      const config = await getWorkspaceLlmConfig(req.principal!.orgId)
      const indexed = await indexTranscriptEmbedding(req.principal!, transcript, {
        endpoint: config.endpoint, model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
      })
      res.json({ indexed })
    } catch (e) { next(e) }
  })

  app.post('/api/knowledge/ask', requireAuth(), requireScope('read'), rateLimit(), validate(AskKnowledgeRequest), async (req, res, next) => {
    try {
      const p = req.principal!
      let rows: any[]
      if (req.body.transcriptIds?.length) {
        rows = (await getPool().query(
          `SELECT id, title, text, segments FROM transcripts WHERE org_id = $1 AND id = ANY($2::uuid[]) LIMIT 30`,
          [p.orgId, req.body.transcriptIds],
        )).rows
      } else if (req.body.collectionId) {
        rows = (await getPool().query(
          `SELECT id, title, text, segments FROM transcripts
           WHERE org_id = $1 AND collection_id = $2 ORDER BY created_at DESC LIMIT 30`,
          [p.orgId, req.body.collectionId],
        )).rows
      } else {
        rows = await keywordSearch(p, { q: req.body.question, limit: 8 })
        if (!rows.length) rows = (await getPool().query(
          `SELECT id, title, text, segments FROM transcripts WHERE org_id = $1 ORDER BY created_at DESC LIMIT 8`,
          [p.orgId],
        )).rows
      }
      if (!rows.length) return res.status(404).json({ error: 'No transcripts are available for this question.' })
      const citations = rows.slice(0, 12).map(row => ({
        transcriptId: row.id, title: row.title,
        ...locateTimestamp(row.segments, req.body.question),
      }))
      const context = rows.slice(0, 12).map((row, index) => {
        const segments = (row.segments || []).slice(0, 120)
        const body = segments.length
          ? segments.map((segment: any) => `[${Math.floor(segment.start / 60)}:${String(Math.floor(segment.start % 60)).padStart(2, '0')}] ${segment.text}`).join('\n')
          : String(row.text).slice(0, 30_000)
        return `SOURCE ${index + 1} — ${row.title} (${row.id})\n${body}`
      }).join('\n\n')
      const config = await getWorkspaceLlmConfig(p.orgId)
      const generated = await runWithFallback(
        config,
        `Answer the question using only the supplied transcript sources. Cite sources inline as [1], [2], etc. Say when the evidence is insufficient. QUESTION: ${req.body.question}`,
        context,
      )
      res.json({ answer: generated.text, citations, runtime: generated.meta })
    } catch (e) { next(e) }
  })

  app.get('/api/transcripts/:id/export/:format', requireAuth(), requireScope('export'), rateLimit(), async (req, res, next) => {
    try {
      const format = routeParam(req, 'format') as ExportFormat
      if (!EXPORT_FORMATS.includes(format)) return res.status(400).json({ error: `format must be one of ${EXPORT_FORMATS.join(', ')}` })
      const t = await getTranscript(req.principal!, routeParam(req, 'id'))
      if (!t) return res.status(404).json({ error: 'Transcript not found' })
      const { body, mimeType, extension } = exportTranscript(format, exportableTranscript(t))
      await auditEvent(req.principal!, 'transcript.exported', {
        type: 'transcript', id: t.id, metadata: { format },
      }, auditContext(req))
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Content-Disposition', `attachment; filename="${t.title.replace(/[^\w.-]+/g, '_').slice(0, 60)}.${extension}"`)
      res.send(body)
    } catch (e) { next(e) }
  })

  // ── Integration routing ───────────────────────────────────
  app.get('/api/integrations', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      const [webhooks, deliveries] = await Promise.all([
        getPool().query(
          `SELECT id, name, url, events, disabled_at, created_at FROM webhooks
           WHERE org_id = $1 ORDER BY created_at DESC`, [req.principal!.orgId],
        ),
        getPool().query(
          `SELECT id, transcript_id, event, adapter, destination, status, error, created_at
           FROM integration_deliveries WHERE org_id = $1 ORDER BY created_at DESC LIMIT 30`,
          [req.principal!.orgId],
        ),
      ])
      res.json({ ...integrationStatus(), webhooks: webhooks.rows, deliveries: deliveries.rows })
    } catch (e) { next(e) }
  })

  app.post('/api/integrations/webhooks', requireAuth(), requireScope('admin'), rateLimit(), validate(WebhookRequest), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      if (process.env.STRICT_LOCAL_MODE === 'true') return res.status(403).json({ error: 'External webhooks are disabled in strict local mode.' })
      const hash = createHash('sha256').update(process.env.WEBHOOK_SECRET || 'change-me-webhooks').digest('hex')
      const row = await getPool().query(
        `INSERT INTO webhooks (org_id, name, url, secret_hash, events)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, name, url, events, created_at`,
        [req.principal!.orgId, req.body.name, req.body.url, hash, req.body.events],
      )
      await auditEvent(req.principal!, 'webhook.created', {
        type: 'webhook', id: row.rows[0].id,
        metadata: { name: req.body.name, destination: new URL(req.body.url).host, events: req.body.events },
      }, auditContext(req))
      res.status(201).json({ webhook: row.rows[0] })
    } catch (e) { next(e) }
  })

  app.delete('/api/integrations/webhooks/:id', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const row = await getPool().query(
        `DELETE FROM webhooks WHERE org_id = $1 AND id = $2 RETURNING id`,
        [req.principal!.orgId, routeParam(req, 'id')],
      )
      if (!row.rows[0]) return res.status(404).json({ error: 'Webhook not found' })
      await auditEvent(req.principal!, 'webhook.deleted', {
        type: 'webhook', id: row.rows[0].id,
      }, auditContext(req))
      res.json({ deleted: row.rows[0].id })
    } catch (e) { next(e) }
  })

  app.post('/api/transcripts/:id/deliver', requireAuth(), requireScope('export'), rateLimit(), validate(DeliverTranscriptRequest), async (req, res, next) => {
    try {
      const transcript = await getTranscript(req.principal!, routeParam(req, 'id'))
      if (!transcript) return res.status(404).json({ error: 'Transcript not found' })
      const delivery = await deliverTranscript(
        req.principal!, exportableTranscript(transcript), req.body.adapter,
        req.body.format, req.body.recipient,
      )
      await auditEvent(req.principal!, 'transcript.delivered', {
        type: 'transcript', id: routeParam(req, 'id'),
        metadata: { adapter: req.body.adapter, destination: delivery.destination, format: req.body.format },
      }, auditContext(req))
      res.status(202).json({ delivery })
    } catch (e) { next(e) }
  })

  // ── Shares ─────────────────────────────────────────────────
  app.post('/api/transcripts/:id/shares', requireAuth(), requireScope('share'), rateLimit(), validate(CreateShareRequest), async (req, res, next) => {
    try {
      if (process.env.STRICT_LOCAL_MODE === 'true' || process.env.SHARING_ENABLED === 'false') return res.status(403).json({ error: 'Share links are disabled for this deployment.' })
      const share = await createShare(req.principal!, routeParam(req, 'id'), req.body)
      if (!share) return res.status(404).json({ error: 'Transcript not found' })
      await auditEvent(req.principal!, 'share.created', {
        type: 'transcript', id: routeParam(req, 'id'), metadata: { expiresAt: share.expires_at || null },
      }, auditContext(req))
      res.status(201).json({ share })
    } catch (e) { next(e) }
  })

  app.get('/api/share/:token', async (req, res, next) => {
    try {
      if (process.env.STRICT_LOCAL_MODE === 'true' || process.env.SHARING_ENABLED === 'false') return res.status(404).json({ error: 'Share links are disabled.' })
      if (process.env.SHARE_LOCAL_ONLY === 'true' && !isLocalRequest(req.ip)) {
        return res.status(403).json({ error: 'This share is only available on the local network.' })
      }
      const t = await getByShareToken(routeParam(req, 'token'))
      if (!t) return res.status(404).json({ error: 'Share not found or expired' })
      res.json({ transcript: t })
    } catch (e) { next(e) }
  })

  // ── API keys ───────────────────────────────────────────────
  app.post('/api/api-keys', requireAuth(), requireScope('admin'), rateLimit(), validate(CreateApiKeyRequest), async (req, res, next) => {
    try {
      const p = req.principal!
      if (!['owner', 'admin'].includes(p.role)) return res.status(403).json({ error: 'Admin access required' })
      const k = generateApiKey()
      const row = await getPool().query(
        `INSERT INTO api_keys (org_id, owner_id, name, key_prefix, key_hash, scopes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, key_prefix, scopes, created_at`,
        [p.orgId, p.userId, req.body.name, k.prefix, k.hash, req.body.scopes],
      )
      await auditEvent(p, 'api_key.created', {
        type: 'api_key', id: row.rows[0].id, metadata: { name: req.body.name, scopes: req.body.scopes },
      }, auditContext(req))
      res.status(201).json({ apiKey: row.rows[0], token: k.token }) // token shown once
    } catch (e) { next(e) }
  })

  app.get('/api/api-keys', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const rows = await getPool().query(
        `SELECT id, name, key_prefix, scopes, last_used_at, created_at
         FROM api_keys WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
        [req.principal!.orgId],
      )
      res.json({ apiKeys: rows.rows })
    } catch (e) { next(e) }
  })

  app.delete('/api/api-keys/:id', requireAuth(), requireScope('admin'), rateLimit(), async (req, res, next) => {
    try {
      if (!['owner', 'admin'].includes(req.principal!.role)) return res.status(403).json({ error: 'Admin access required' })
      const revoked = (await getPool().query(
        `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL RETURNING id`,
        [routeParam(req, 'id'), req.principal!.orgId],
      )).rows[0]
      if (!revoked) return res.status(404).json({ error: 'API key not found' })
      await auditEvent(req.principal!, 'api_key.revoked', { type: 'api_key', id: routeParam(req, 'id') }, auditContext(req))
      res.json({ revoked: routeParam(req, 'id') })
    } catch (e) { next(e) }
  })

  // ── Meeting bot runs ──────────────────────────────────────
  app.post('/api/meeting-bot/runs', requireAuth(), requireScope('transcribe'), rateLimit(), validate(CreateMeetingBotRunRequest), async (req, res, next) => {
    try {
      const p = req.principal!
      let provider: 'zoom' | 'meet' | 'teams'
      try {
        provider = req.body.provider || detectMeetingProvider(req.body.joinUrl)
      } catch {
        return res.status(400).json({ error: 'Unsupported meeting provider. Use a Zoom, Google Meet, or Microsoft Teams URL.' })
      }
      const row = await getPool().query(
        `INSERT INTO meeting_bot_runs (org_id, calendar_event_id, provider, join_url, state)
         VALUES ($1, $2, $3, $4, 'invited')
         RETURNING id, org_id, calendar_event_id, provider, join_url, state, job_id, transcript_id, error, created_at, updated_at, started_at, finished_at`,
        [p.orgId, req.body.startsAt || '', provider, req.body.joinUrl],
      )
      res.status(201).json({ run: row.rows[0] })
    } catch (e) { next(e) }
  })

  app.get('/api/meeting-bot/runs', requireAuth(), requireScope('read'), rateLimit(), async (req, res, next) => {
    try {
      const rows = await getPool().query(
        `SELECT id, org_id, calendar_event_id, provider, join_url, state, job_id, transcript_id, error, created_at, updated_at, started_at, finished_at
         FROM meeting_bot_runs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.principal!.orgId],
      )
      res.json({ runs: rows.rows })
    } catch (e) { next(e) }
  })

  app.post('/api/meeting-bot/runs/:id/start', requireAuth(), requireScope('transcribe'), rateLimit(), async (req, res, next) => {
    try {
      const p = req.principal!
      const found = await getPool().query(
        `SELECT id, org_id, calendar_event_id, provider, join_url, state, job_id, transcript_id, error, created_at, updated_at, started_at, finished_at
         FROM meeting_bot_runs WHERE org_id = $1 AND id = $2`,
        [p.orgId, routeParam(req, 'id')],
      )
      const run = found.rows[0]
      if (!run) return res.status(404).json({ error: 'Bot run not found' })
      if (run.state !== 'invited') return res.status(409).json({ error: `Bot run is already ${run.state}.` })

      assertBotTransition('invited', 'joined')
      assertBotTransition('joined', 'recording')
      assertBotTransition('recording', 'left')

      const transcript = await createTranscript(p, {
        title: `${String(run.provider).toUpperCase()} meeting bot notes`,
        source: 'meeting',
        task: 'meeting',
        text: [
          `Meeting bot joined ${run.join_url}.`,
          '',
          `Provider: ${run.provider}`,
          'Status: local self-host run completed.',
          '',
          'Live media capture is ready to be attached once calendar and meeting-provider credentials are configured.',
        ].join('\n'),
        result: {
          summary: 'The meeting bot lifecycle completed in local self-host mode.',
          actionItems: [
            'Connect Google, Zoom, or Microsoft credentials for live meeting media capture.',
            'Route completed meeting notes from the Meetings notebook.',
          ],
        },
      })

      const updated = await getPool().query(
        `UPDATE meeting_bot_runs
         SET state = 'left', transcript_id = $3, started_at = COALESCE(started_at, now()), finished_at = now(), updated_at = now()
         WHERE org_id = $1 AND id = $2
         RETURNING id, org_id, calendar_event_id, provider, join_url, state, job_id, transcript_id, error, created_at, updated_at, started_at, finished_at`,
        [p.orgId, routeParam(req, 'id'), transcript.id],
      )
      res.json({ run: updated.rows[0], transcript, mode: 'simulated' })
    } catch (e) { next(e) }
  })

  // ── Legacy sync transcribe (small files, no persistence) ───
  // Kept for the existing web UI + BYO-key mode. Auth applies in
  // local-db mode; single-user mode works credential-free as before.
  const syncTranscribe = async (req: express.Request, res: express.Response) => {
    const filePath = req.file?.path
    try {
      if (!req.file) return res.status(400).json({ error: 'No audio file provided.' })
      const task = String(req.body.task || 'transcription')
      let options: Record<string, unknown> = {}
      try { options = JSON.parse(req.body.options || '{}') } catch { /* default */ }

      const engine = String(req.body.engine || options.engine || 'auto')
      let stt = await sttTranscribe(
        await readFile(filePath!), req.file.originalname || 'audio.bin',
        req.file.mimetype, {
          language: req.body.language || undefined,
          diarize: task === 'diarization' || options.speakerLabels === true,
          engine: engine === 'whisper' || engine === 'omnilingual' ? engine : 'auto',
          channel: req.body.channel || undefined,
          enhance: req.body.enhance === 'true' || options.enhance === true,
          requestId: req.requestId,
        },
      )
      const glossaryTerms = (await getPool().query(
        `SELECT term, replacement FROM glossary_terms WHERE org_id = $1 ORDER BY length(term) DESC`,
        [req.principal!.orgId],
      )).rows
      const glossaryResult = applyGlossary(stt, glossaryTerms)
      stt = options.polish ? cleanupPunctuation(glossaryResult) : glossaryResult
      const qualityMeta = summarizeQuality(stt, glossaryResult.glossaryMatches)

      let transcript: string
      let enrichedResult: unknown = null
      let llmMeta: unknown = null
      if (!needsLlm(task, options)) {
        transcript = renderPlainTranscript(stt, options)
      } else {
        const ctx = buildTranscriptContext(task, stt)
        const config = await getWorkspaceLlmConfig(req.principal!.orgId)
        if (task === 'meeting') {
          const enriched = await runMeetingWithFallback(config, ctx, config.preset)
          transcript = stt.text
          enrichedResult = enriched.result
          llmMeta = { ...enriched.meta, fallbackUsed: enriched.fallbackUsed }
        } else {
          const prompt = String(req.body.prompt || '')
          if (!prompt) return res.status(400).json({ error: 'No task prompt provided.' })
          const generated = await runWithFallback(config, prompt, ctx)
          transcript = generated.text
          enrichedResult = task === 'transcription' ? null : generated.text
          llmMeta = { ...generated.meta, fallbackUsed: generated.fallbackUsed }
        }
      }
      res.json({
        transcript,
        stt: {
          language: stt.language, languageCode: stt.languageCode ?? null, languageName: stt.languageName ?? null,
          duration: stt.duration, segments: stt.segments, engine: stt.engine ?? null, model: stt.model,
          routing: stt.routing ?? null, audio: stt.audio ?? null,
        },
        qualityMeta,
        speakerLabels: speakerLabels(stt.segments),
        result: enrichedResult,
        processingMeta: llmMeta ? { llm: llmMeta } : {},
      })
    } catch (e: any) {
      // STT 4xx (bad audio, unknown language, too long) are the caller's to fix.
      const status = e instanceof SttError ? (e.status < 500 || e.status === 503 ? e.status : 502) : 500
      res.status(status).json({ error: e.message || 'Transcription failed.', code: e.code, requestId: req.requestId })
    } finally {
      if (filePath) unlink(filePath).catch(() => {})
    }
  }

  app.post('/api/transcribe', requireAuth(), requireScope('transcribe'), rateLimit(), upload.single('audio'),
    (req, res) => syncTranscribe(req, res))

  app.use(errorHandler())
  return app
}

export { ensureSeed }
