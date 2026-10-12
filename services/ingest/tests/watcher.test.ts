import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  archiveName, buildFolderIngestKey, hashBuffer, isSupportedMedia, mediaMimeType,
} from '../src/watcher-core.ts'

test('folder watcher accepts practical media formats only', () => {
  assert.equal(isSupportedMedia('/watch/call.MP3'), true)
  assert.equal(isSupportedMedia('/watch/meeting.mp4'), true)
  assert.equal(isSupportedMedia('/watch/notes.txt'), false)
  assert.equal(mediaMimeType('voice.m4a'), 'audio/mp4')
})

test('content-derived ingest keys deduplicate renamed recordings', () => {
  const checksum = hashBuffer(Buffer.from('same recording'))
  assert.equal(buildFolderIngestKey(checksum), `folder:${checksum}`)
  assert.equal(buildFolderIngestKey(checksum).length, 71)
})

test('archive names preserve useful file context without unsafe characters', () => {
  assert.equal(archiveName('/watch/Team sync (final).wav', '12345678-abcd'), '12345678--Team_sync_final_.wav')
})
