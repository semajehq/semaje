// Gate tests for the Whisper↔LLM routing. Pure, deterministic, free.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  needsLlm, formatTimestamp, renderPlainTranscript,
  buildTranscriptContext, TIMING_TASKS,
} from '../src/index.ts'

const stt = {
  text: 'hello world this is a test',
  language: 'en',
  segments: [
    { start: 0.0, end: 2.5, text: 'hello world' },
    { start: 2.5, end: 6.0, text: 'this is a test' },
  ],
}

test('plain transcription does NOT call the LLM', () => {
  assert.equal(needsLlm('transcription', {}), false)
  assert.equal(needsLlm('transcription', { timestamps: true }), false)
})

test('transcription with speaker labels or polish DOES call the LLM', () => {
  assert.equal(needsLlm('transcription', { speakerLabels: true }), true)
  assert.equal(needsLlm('transcription', { polish: true }), true)
})

test('every non-transcription task calls the LLM', () => {
  for (const t of ['summary', 'sentiment', 'chapters', 'translation', 'subtitles',
    'captions', 'diarization', 'meeting', 'medical', 'legal', 'lyrics', 'voicemail',
    'multilingual', 'interview']) {
    assert.equal(needsLlm(t, {}), true, `${t} should need the LLM`)
  }
})

test('formatTimestamp renders HH:MM:SS.mmm', () => {
  assert.equal(formatTimestamp(0), '00:00:00.000')
  assert.equal(formatTimestamp(2.5), '00:00:02.500')
  assert.equal(formatTimestamp(3661.234), '01:01:01.234')
  assert.equal(formatTimestamp(-5), '00:00:00.000')
})

test('renderPlainTranscript returns raw text without timestamps option', () => {
  assert.equal(renderPlainTranscript(stt, {}), 'hello world this is a test')
})

test('renderPlainTranscript injects [mm:ss] when timestamps enabled', () => {
  const out = renderPlainTranscript(stt, { timestamps: true })
  assert.equal(out, '[00:00] hello world\n[00:02] this is a test')
})

test('renderPlainTranscript handles no speech', () => {
  assert.equal(renderPlainTranscript({ text: '', segments: [] }, {}), '[No speech detected]')
})

test('buildTranscriptContext uses plain text for non-timing tasks', () => {
  const ctx = buildTranscriptContext('summary', stt)
  assert.match(ctx, /detected language: en/)
  assert.match(ctx, /TRANSCRIPT:\nhello world this is a test/)
  assert.doesNotMatch(ctx, /-->/)
})

test('buildTranscriptContext includes segment timestamps for timing tasks', () => {
  assert.ok(TIMING_TASKS.has('subtitles'))
  const ctx = buildTranscriptContext('subtitles', stt)
  assert.match(ctx, /\[00:00:00\.000 --> 00:00:02\.500\] hello world/)
  assert.match(ctx, /\[00:00:02\.500 --> 00:00:06\.000\] this is a test/)
})
