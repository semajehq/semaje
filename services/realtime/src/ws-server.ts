// WS endpoint /ws — attaches to the API's HTTP server. One RealtimeSession
// per connection. Auth: ?token=<jwt|api-key> or single-user mode (none).
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { Principal } from '@semaje/schemas'
import { authenticate } from '../../auth/src/index.ts'
import { sttTranscribe } from '../../speech/stt-client.ts'
import { createTranscript } from '../../transcripts/src/index.ts'
import { RealtimeSession, type Transcriber, type Persister } from './session.ts'

const realTranscriber: Transcriber = async (audio, mimeType, language) => {
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
  return sttTranscribe(audio, `live.${ext}`, mimeType, { language })
}

const realPersister: Persister = async (principal, data) => {
  const row = await createTranscript(principal, {
    title: data.title,
    source: data.source,
    task: 'transcription',
    language: data.language ?? undefined,
    durationSec: data.durationSec,
    text: data.text,
    segments: data.segments,
  })
  return { id: row.id }
}

export function attachRealtime(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname !== '/ws') { socket.destroy(); return }
    try {
      const token = url.searchParams.get('token')
      const principal = await authenticate(
        token ? { authorization: `Bearer ${token}` } : {},
      )
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req, principal)
      })
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
    }
  })

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, principal: Principal) => {
    const session = new RealtimeSession(
      principal,
      realTranscriber,
      realPersister,
      { send: msg => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)) } },
    )
    ws.on('message', (data, isBinary) => {
      if (isBinary) session.handleAudio(Buffer.from(data as Buffer))
      else session.handleMessage(data.toString()).catch(() => {})
    })
    ws.on('close', () => { session.stop().catch(() => {}) })
  })

  return wss
}
