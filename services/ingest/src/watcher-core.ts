import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'

export const MEDIA_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.ogg', '.oga', '.flac', '.aac', '.webm', '.mp4', '.mov', '.mkv',
])

export function isSupportedMedia(path: string): boolean {
  return MEDIA_EXTENSIONS.has(extname(path).toLowerCase())
}

export function mediaMimeType(path: string): string {
  const extension = extname(path).toLowerCase()
  const types: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac', '.webm': 'audio/webm',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  }
  return types[extension] || 'application/octet-stream'
}

export function buildFolderIngestKey(checksum: string): string {
  return `folder:${checksum.toLowerCase()}`
}

export function archiveName(path: string, jobId: string): string {
  const safeName = basename(path).replace(/[^a-zA-Z0-9._-]+/g, '_')
  return `${jobId.slice(0, 8)}--${safeName}`
}

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
