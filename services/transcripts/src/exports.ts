// Pure transcript exporters — SRT / VTT / TXT / MD from Whisper segments.
import type { SttSegment } from '@semaje/schemas'

function pad(n: number, w = 2): string { return String(n).padStart(w, '0') }

function ts(seconds: number, sep: ',' | '.'): string {
  const s = Math.max(0, seconds)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ms, 3)}`
}

export function toSRT(segments: SttSegment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${ts(s.start, ',')} --> ${ts(s.end, ',')}\n${s.speaker ? `${s.speaker}: ` : ''}${s.text}`)
    .join('\n\n') + (segments.length ? '\n' : '')
}

export function toVTT(segments: SttSegment[]): string {
  const body = segments
    .map(s => `${ts(s.start, '.')} --> ${ts(s.end, '.')}\n${s.speaker ? `<v ${s.speaker}>` : ''}${s.text}`)
    .join('\n\n')
  return `WEBVTT\n\n${body}${segments.length ? '\n' : ''}`
}

export function toTXT(text: string): string { return text }

export interface ExportableTranscript {
  id?: string
  title: string
  text: string
  segments: SttSegment[] | null
  source?: string
  task?: string
  language?: string | null
  durationSec?: number | null
  createdAt?: string | Date
  result?: unknown
  speakerLabels?: Record<string, string>
  tags?: string[]
}

export interface NormalizedAction {
  task: string
  owner: string
  dueDate: string
  status: string
}

export function normalizeIntelligence(result: unknown) {
  const value = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown> : {}
  const strings = (input: unknown) => Array.isArray(input)
    ? input.map(item => typeof item === 'string' ? item : JSON.stringify(item)) : []
  const rawActions = Array.isArray(value.actionItems)
    ? value.actionItems : Array.isArray(value.actions) ? value.actions : []
  const actionItems: NormalizedAction[] = rawActions.map(item => {
    if (typeof item === 'string') return { task: item, owner: '', dueDate: '', status: 'open' }
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      task: String(row.task || row.title || row.description || ''),
      owner: String(row.owner || row.assignee || ''),
      dueDate: String(row.dueDate || row.due || ''),
      status: String(row.status || 'open'),
    }
  }).filter(item => item.task)
  return {
    summary: typeof value.summary === 'string' ? value.summary : '',
    decisions: strings(value.decisions),
    actionItems,
    risks: strings(value.risks),
    followUps: strings(value.followUps),
  }
}

function metadataLines(t: ExportableTranscript): string[] {
  return [
    t.source && `- Source: ${t.source}`,
    t.task && `- Task: ${t.task}`,
    t.language && `- Language: ${t.language}`,
    t.durationSec != null && `- Duration: ${Number(t.durationSec).toFixed(1)} seconds`,
    t.createdAt && `- Created: ${new Date(t.createdAt).toISOString()}`,
    t.tags?.length && `- Tags: ${t.tags.join(', ')}`,
  ].filter(Boolean) as string[]
}

export function toMD(
  title: string, text: string, segments: SttSegment[] | null,
  metadata: Omit<ExportableTranscript, 'title' | 'text' | 'segments'> = {},
): string {
  const lines = [`# ${title}`, '']
  const transcript: ExportableTranscript = { title, text, segments, ...metadata }
  const meta = metadataLines(transcript)
  if (meta.length) lines.push('## Metadata', '', ...meta, '')
  const intelligence = normalizeIntelligence(transcript.result)
  if (intelligence.summary) lines.push('## Summary', '', intelligence.summary, '')
  if (intelligence.decisions.length) lines.push('## Decisions', '', ...intelligence.decisions.map(item => `- ${item}`), '')
  if (intelligence.actionItems.length) {
    lines.push('## Action items', '')
    for (const item of intelligence.actionItems) {
      lines.push(`- [${item.status === 'done' ? 'x' : ' '}] ${item.task}${item.owner ? ` (Owner: ${item.owner})` : ''}${item.dueDate ? ` (Due: ${item.dueDate})` : ''}`)
    }
    lines.push('')
  }
  if (intelligence.risks.length) lines.push('## Risks', '', ...intelligence.risks.map(item => `- ${item}`), '')
  lines.push('## Transcript', '')
  if (segments?.length) {
    for (const s of segments) {
      const mm = Math.floor(s.start / 60)
      const ss = Math.floor(s.start % 60)
      lines.push(`**[${pad(mm)}:${pad(ss)}]** ${s.speaker ? `**${s.speaker}:** ` : ''}${s.text}`, '')
    }
  } else {
    lines.push(text, '')
  }
  return lines.join('\n')
}

export function toJSON(t: ExportableTranscript): string {
  return JSON.stringify({
    schema: 'semaje.transcript.v1',
    metadata: {
      id: t.id || null, title: t.title, source: t.source || null, task: t.task || null,
      language: t.language || null, durationSec: t.durationSec ?? null,
      createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : null,
      speakers: t.speakerLabels || {}, tags: t.tags || [],
    },
    intelligence: normalizeIntelligence(t.result),
    transcript: { text: t.text, segments: t.segments || [] },
  }, null, 2)
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`

export function toActionsCSV(t: ExportableTranscript): string {
  const rows = normalizeIntelligence(t.result).actionItems
  return [
    ['task', 'owner', 'due_date', 'status', 'transcript_id', 'transcript_title'].map(csvCell).join(','),
    ...rows.map(item => [item.task, item.owner, item.dueDate, item.status, t.id || '', t.title].map(csvCell).join(',')),
  ].join('\n') + '\n'
}

export const EXPORT_FORMATS = ['srt', 'vtt', 'txt', 'md', 'json', 'actions.csv'] as const
export type ExportFormat = typeof EXPORT_FORMATS[number]

export function exportTranscript(
  format: ExportFormat,
  t: ExportableTranscript,
): { body: string; mimeType: string; extension: string } {
  switch (format) {
    case 'srt': return { body: toSRT(t.segments || []), mimeType: 'application/x-subrip', extension: 'srt' }
    case 'vtt': return { body: toVTT(t.segments || []), mimeType: 'text/vtt', extension: 'vtt' }
    case 'txt': return { body: toTXT(t.text), mimeType: 'text/plain', extension: 'txt' }
    case 'md': return {
      body: toMD(t.title, t.text, t.segments, t), mimeType: 'text/markdown', extension: 'md',
    }
    case 'json': return { body: toJSON(t), mimeType: 'application/json', extension: 'json' }
    case 'actions.csv': return { body: toActionsCSV(t), mimeType: 'text/csv', extension: 'actions.csv' }
  }
}
