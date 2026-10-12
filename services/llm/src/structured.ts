import { z } from 'zod'
import { createLlm, type LlmAdapter, type LlmRunMeta } from './index.ts'

export const MeetingIntelligence = z.object({
  summary: z.string(),
  decisions: z.array(z.string()).default([]),
  actionItems: z.array(z.object({
    task: z.string(),
    owner: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
  })).default([]),
  risks: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([]),
  chapters: z.array(z.object({
    title: z.string(),
    startSec: z.number().nonnegative().nullable().optional(),
  })).default([]),
})
export type MeetingIntelligence = z.infer<typeof MeetingIntelligence>

export const DEFAULT_ENRICHMENT_PRESET = {
  summary: true, decisions: true, actionItems: true,
  risks: true, followUps: true, chapters: true,
}

export function meetingJsonPrompt(preset: Record<string, boolean> = DEFAULT_ENRICHMENT_PRESET) {
  const requested = Object.entries(preset).filter(([, enabled]) => enabled).map(([name]) => name).join(', ')
  return `Create grounded meeting intelligence for: ${requested}. Return JSON only with this exact shape: {"summary":"string","decisions":["string"],"actionItems":[{"task":"string","owner":"string or null","dueDate":"string or null"}],"risks":["string"],"followUps":["string"],"chapters":[{"title":"string","startSec":0}]}. Use empty arrays when evidence is absent. Never invent owners, dates, decisions, or risks.`
}

function extractJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = (fenced || value).trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('model output did not contain a JSON object')
  return source.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')
}

export function parseMeetingIntelligence(value: string): MeetingIntelligence {
  return MeetingIntelligence.parse(JSON.parse(extractJson(value)))
}

export async function runMeetingIntelligence(
  adapter: LlmAdapter, transcriptContext: string,
  preset: Record<string, boolean> = DEFAULT_ENRICHMENT_PRESET,
) {
  const prompt = meetingJsonPrompt(preset)
  const first = await adapter.run(prompt, transcriptContext)
  try {
    return parseMeetingIntelligence(first)
  } catch (firstError: any) {
    const repaired = await adapter.run(
      `${prompt}\nThe previous response failed validation: ${firstError.message}. Repair it and return only valid JSON.\nPREVIOUS RESPONSE:\n${first}`,
      transcriptContext,
    )
    return parseMeetingIntelligence(repaired)
  }
}

export async function runMeetingWithFallback(
  primary: { adapter: string; endpoint?: string; model?: string },
  transcriptContext: string,
  preset: Record<string, boolean> = DEFAULT_ENRICHMENT_PRESET,
  fallbackNames = (process.env.LLM_FALLBACKS || 'llama-cpp,claude-local').split(',').map(value => value.trim()).filter(Boolean),
): Promise<{ result: MeetingIntelligence; meta?: LlmRunMeta; fallbackUsed: boolean }> {
  const names = [primary.adapter, ...fallbackNames.filter(name => name !== primary.adapter)]
  const errors: string[] = []
  for (const name of names) {
    const adapter = createLlm(name, name === primary.adapter ? primary : {})
    try {
      const result = await runMeetingIntelligence(adapter, transcriptContext, preset)
      return { result, meta: adapter.lastRun, fallbackUsed: name !== primary.adapter }
    } catch (error: any) { errors.push(`${name}: ${error.message}`) }
  }
  throw new Error(`All local meeting-intelligence adapters failed. ${errors.join(' | ')}`)
}
