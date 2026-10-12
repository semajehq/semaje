// ═══════════════════════════════════════════════════════════════
// @semaje/schemas — the single source of truth for every contract
// crossing a service boundary. zod schemas + inferred TS types.
// ═══════════════════════════════════════════════════════════════
import { z } from 'zod'

// ── Core enums ───────────────────────────────────────────────
export const TaskId = z.enum([
  'transcription', 'subtitles', 'captions', 'summary', 'sentiment',
  'chapters', 'translation', 'multilingual', 'diarization', 'interview',
  'meeting', 'medical', 'legal', 'lyrics', 'voicemail',
])
export type TaskId = z.infer<typeof TaskId>

export const TranscriptSource = z.enum([
  'upload', 'live', 'meeting', 'dictation', 'folder', 'api', 'desktop', 'extension',
])
export const JobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled'])
export type JobStatus = z.infer<typeof JobStatus>
export const Role = z.enum(['owner', 'admin', 'member', 'viewer'])
export type Role = z.infer<typeof Role>
export const SharePermission = z.enum(['view', 'comment'])

// ── STT result (mirrors semajehq/semaje-stt contract.md) ─────
export const SttSegment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  speaker: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  words: z.array(z.object({
    start: z.number(),
    end: z.number(),
    word: z.string(),
    probability: z.number().min(0).max(1).optional(),
  })).optional(),
})
export type SttSegment = z.infer<typeof SttSegment>

export const SttEngine = z.enum(['auto', 'whisper', 'omnilingual'])
export type SttEngine = z.infer<typeof SttEngine>

export const SttResult = z.object({
  text: z.string(),
  language: z.string(),
  duration: z.number(),
  segments: z.array(SttSegment),
  backend: z.string(),
  model: z.string(),
  // v2: multi-engine routing metadata (optional so v1 payloads still parse)
  engine: z.enum(['whisper', 'omnilingual']).optional(),
  engineLanguage: z.string().nullable().optional(),
  languageCode: z.string().nullable().optional(),
  languageName: z.string().nullable().optional(),
  routing: z.object({
    engine: z.string(), language: z.string().nullable(), canonical: z.string().nullable(), reason: z.string(),
  }).optional(),
  audio: z.object({
    container: z.string(), codec: z.string(), sampleRate: z.number(), channels: z.number(),
    duration: z.number(), bitRate: z.number().nullable(), hasVideo: z.boolean(), channelLayout: z.string().optional(),
  }).optional(),
  requestId: z.string().optional(),
})
export type SttResult = z.infer<typeof SttResult>

// ── Auth ─────────────────────────────────────────────────────
export const Principal = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  role: Role,
  scopes: z.array(z.string()).default([]),
  via: z.enum(['jwt', 'api-key', 'single-user']),
})
export type Principal = z.infer<typeof Principal>

export const RegisterRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120).optional(),
})
export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export const TokenResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  user: z.object({ id: z.string(), email: z.string(), displayName: z.string().nullable() }),
})

// ── Transcripts ──────────────────────────────────────────────
export const Transcript = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid().nullable(),
  ownerId: z.string().uuid(),
  title: z.string(),
  source: TranscriptSource,
  task: TaskId,
  language: z.string().nullable(),
  durationSec: z.number().nullable(),
  text: z.string(),
  segments: z.array(SttSegment).nullable(),
  result: z.unknown().nullable(),
  audioBlobId: z.string().uuid().nullable(),
  status: z.enum(['draft', 'complete']),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Transcript = z.infer<typeof Transcript>

export const CreateTranscriptRequest = z.object({
  title: z.string().min(1).max(300).optional(),
  source: TranscriptSource.default('upload'),
  task: TaskId.default('transcription'),
  language: z.string().max(32).optional(),
  durationSec: z.number().nonnegative().optional(),
  text: z.string(),
  segments: z.array(SttSegment).optional(),
  result: z.unknown().optional(),
  audioBlobId: z.string().uuid().optional(),
  speakerLabels: z.record(z.string()).optional(),
  qualityMeta: z.record(z.unknown()).optional(),
  processingMeta: z.record(z.unknown()).optional(),
})
export type CreateTranscriptRequest = z.infer<typeof CreateTranscriptRequest>

export const UpdateTranscriptRequest = z.object({
  title: z.string().min(1).max(300).optional(),
  text: z.string().optional(),
  segments: z.array(SttSegment).optional(),
  collectionId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(80)).max(30).optional(),
  reason: z.string().min(1).max(240).default('manual correction'),
}).refine(value => value.title !== undefined || value.text !== undefined || value.segments !== undefined || value.collectionId !== undefined || value.tags !== undefined, {
  message: 'At least one editable field is required',
})

export const RenameSpeakerRequest = z.object({
  name: z.string().min(1).max(120),
})

export const GlossaryTermRequest = z.object({
  term: z.string().min(1).max(120),
  replacement: z.string().min(1).max(120),
})

export const LlmSettingsRequest = z.object({
  adapter: z.enum(['ollama', 'llama-cpp', 'claude-local']),
  endpoint: z.string().url().optional(),
  model: z.string().min(1).max(160),
  preset: z.object({
    summary: z.boolean(),
    decisions: z.boolean(),
    actionItems: z.boolean(),
    risks: z.boolean(),
    followUps: z.boolean(),
    chapters: z.boolean(),
  }),
})

export const KnowledgeSearchQuery = z.object({
  q: z.string().max(500).default(''),
  mode: z.enum(['keyword', 'semantic']).default('keyword'),
  source: TranscriptSource.optional(),
  task: TaskId.optional(),
  speaker: z.string().max(120).optional(),
  collectionId: z.string().uuid().optional(),
  tags: z.string().max(500).optional().transform(value => value ? value.split(',').map(tag => tag.trim()).filter(Boolean) : []),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

export const CollectionRequest = z.object({
  name: z.string().min(1).max(120),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#0f8f83'),
})

export const SavedSearchRequest = z.object({
  name: z.string().min(1).max(120),
  query: z.record(z.unknown()),
})

export const AskKnowledgeRequest = z.object({
  question: z.string().min(2).max(1000),
  transcriptIds: z.array(z.string().uuid()).max(100).optional(),
  collectionId: z.string().uuid().optional(),
})

export const ListTranscriptsQuery = z.object({
  q: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

// ── Jobs ─────────────────────────────────────────────────────
export const JobInput = z.object({
  audioBlobId: z.string().uuid(),
  task: TaskId.default('transcription'),
  options: z.record(z.unknown()).default({}),
  language: z.string().max(32).optional(),
  title: z.string().max(300).optional(),
  source: TranscriptSource.default('upload'),
})
export type JobInput = z.infer<typeof JobInput>

export const Job = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  ownerId: z.string().uuid(),
  type: z.enum(['transcribe']),
  status: JobStatus,
  input: JobInput,
  transcriptId: z.string().uuid().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  progress: z.number().min(0).max(100),
  processingMeta: z.record(z.unknown()).default({}),
  webhookUrl: z.string().url().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
})
export type Job = z.infer<typeof Job>

export const CreateJobRequest = JobInput.extend({
  webhookUrl: z.string().url().optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
  captureMeta: z.record(z.unknown()).optional(),
})

export const IngestRequest = z.object({
  task: TaskId.default('transcription'),
  options: z.record(z.unknown()).default({}),
  language: z.string().max(32).optional(),
  title: z.string().max(300).optional(),
  source: TranscriptSource.default('api'),
  webhookUrl: z.string().url().optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
  captureMeta: z.record(z.unknown()).default({}),
})
export type IngestRequest = z.infer<typeof IngestRequest>

// ── API keys / shares ────────────────────────────────────────
export const ApiKeyScope = z.enum(['transcribe', 'read', 'write', 'export', 'share', 'admin'])
export const CreateApiKeyRequest = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(ApiKeyScope).min(1).default(['transcribe', 'read']),
})
export const CreateShareRequest = z.object({
  kind: z.enum(['link']).default('link'),
  permission: SharePermission.default('view'),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

export const IntegrationEvent = z.enum([
  'job.succeeded', 'job.failed', 'transcript.updated', 'action.created',
])
export type IntegrationEvent = z.infer<typeof IntegrationEvent>

export const WebhookRequest = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  events: z.array(IntegrationEvent).min(1).max(4),
})

export const DeliverTranscriptRequest = z.object({
  adapter: z.enum(['local', 'nextcloud', 'slack', 'teams', 'email']),
  format: z.enum(['md', 'json', 'actions.csv']).default('md'),
  recipient: z.string().email().optional(),
})

export const ActionItemRequest = z.object({
  task: z.string().min(1).max(500),
  owner: z.string().max(200).optional(),
  dueDate: z.string().max(40).optional(),
  status: z.enum(['open', 'done']).default('open'),
})

export const InviteRequest = z.object({
  email: z.string().email(),
  role: Role.exclude(['owner']).default('member'),
  expiresInDays: z.number().int().min(1).max(30).default(7),
})

export const AcceptInviteRequest = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(120).optional(),
})

export const MemberRoleRequest = z.object({ role: Role })
export const WorkspaceRequest = z.object({ name: z.string().min(1).max(120) })

export const RetentionPolicyRequest = z.object({
  enabled: z.boolean(),
  defaultDays: z.number().int().min(1).max(36500),
  sourceRules: z.record(TranscriptSource, z.number().int().min(1).max(36500)).default({}),
  deleteAudio: z.boolean().default(true),
})

export const MeetingProvider = z.enum(['zoom', 'meet', 'teams'])
export const CreateMeetingBotRunRequest = z.object({
  joinUrl: z.string().url(),
  title: z.string().min(1).max(300).optional(),
  startsAt: z.string().datetime().optional(),
  provider: MeetingProvider.optional(),
})
export type CreateMeetingBotRunRequest = z.infer<typeof CreateMeetingBotRunRequest>

// ── Realtime WS protocol (services/realtime/contract.md) ─────
export const RTClientStart = z.object({
  type: z.literal('start'),
  mode: z.enum(['dictation', 'meeting']).default('dictation'),
  source: z.enum(['dictation', 'meeting', 'extension', 'desktop']).optional(),
  language: z.string().max(32).optional(),
  mimeType: z.string().max(100).optional(),
  title: z.string().max(300).optional(),
})
export const RTClientStop = z.object({ type: z.literal('stop') })
export const RTClientMessage = z.discriminatedUnion('type', [RTClientStart, RTClientStop])
export type RTClientMessage = z.infer<typeof RTClientMessage>

export const RTServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('partial'), text: z.string(), tStart: z.number() }),
  z.object({
    type: z.literal('final'),
    text: z.string(),
    tStart: z.number(),
    tEnd: z.number(),
    language: z.string().optional(),
  }),
  z.object({ type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('end'), transcriptId: z.string().uuid().optional() }),
])
export type RTServerMessage = z.infer<typeof RTServerMessage>

// ── Extension ↔ platform messaging ───────────────────────────
export const ExtMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dictation:start') }),
  z.object({ kind: z.literal('dictation:stop') }),
  z.object({ kind: z.literal('dictation:text'), text: z.string(), final: z.boolean() }),
  z.object({ kind: z.literal('dictation:state'), state: z.enum(['idle', 'listening', 'error']), error: z.string().optional() }),
  z.object({ kind: z.literal('auth:status') }),
  z.object({ kind: z.literal('auth:result'), authed: z.boolean(), email: z.string().optional() }),
])
export type ExtMessage = z.infer<typeof ExtMessage>
