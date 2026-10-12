import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureCommand, captureInputArgs, deviceListCommand } from '../src/capture-core.ts'

test('desktop capture selects native ffmpeg input adapters', () => {
  assert.deepEqual(captureInputArgs('darwin', '2:0'), ['-f', 'avfoundation', '-i', '2:0'])
  assert.deepEqual(captureInputArgs('linux'), ['-f', 'pulse', '-i', 'default'])
  assert.deepEqual(captureInputArgs('win32', 'audio=Mic'), ['-f', 'dshow', '-i', 'audio=Mic'])
})

test('desktop capture emits mono 16 kHz wav for local STT', () => {
  const command = captureCommand('linux', '/tmp/capture.wav', { durationSec: 30 })
  assert.ok(command.includes('30'))
  assert.deepEqual(command.slice(-7), ['-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '/tmp/capture.wav'])
})

test('device listing uses a platform-specific ffmpeg probe', () => {
  assert.ok(deviceListCommand('darwin').includes('-list_devices'))
  assert.ok(deviceListCommand('linux').includes('-sources'))
})
