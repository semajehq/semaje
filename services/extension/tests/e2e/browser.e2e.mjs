#!/usr/bin/env node
// End-to-end: load the BUILT extension into a real browser and drive it
// against a mock semaje server (HTTP + realtime WebSocket). The browser's fake
// microphone stands in for a person speaking.
//
//   npm run test:extension:e2e                       # chrome + firefox (whichever are installed)
//   node .../browser.e2e.mjs --browser firefox       # one browser
//   CHROME_PATH=... FIREFOX_PATH=...                 # override binaries
//
// Verifies: service worker boots; options + popup connect and list languages;
// dictation streams mic audio through the offscreen host to /ws and inserts
// the server's final text into a page's textarea; read-aloud calls /api/tts;
// no extension context logs an error.
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { WebSocketServer } from 'ws'
import puppeteer from 'puppeteer-core'
import { build } from '../../scripts/build.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BROWSER = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : 'chrome'
const BINARIES = {
  chrome: [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'],
  firefox: [process.env.FIREFOX_PATH, '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox'],
}
const EXECUTABLE = (BINARIES[BROWSER] || []).find(p => p && existsSync(p))
if (!EXECUTABLE) { console.log(`SKIP: ${BROWSER} not found`); process.exit(0) }
const FIREFOX_UUID = '7c1d3f52-0e9b-4c6e-9a51-5e3a1b2c4d6f'

// ── mock semaje server ────────────────────────────────────────
const seen = { tts: [], wsStart: null, wsBytes: 0, wsStop: false }
const LANGS = {
  total: 3, withTts: 1, available: ['whisper', 'omnilingual'],
  languages: [
    { code: 'eng_Latn', name: 'English', iso1: 'en', whisper: 'en', aliases: [], engines: ['whisper', 'omnilingual'], whisperStrong: true, tts: { voices: 1, engines: ['piper'] } },
    { code: 'swh_Latn', name: 'Swahili', iso1: 'sw', whisper: 'sw', aliases: ['Kiswahili'], engines: ['whisper', 'omnilingual'], whisperStrong: false, tts: { voices: 1, engines: ['piper'] } },
    { code: 'kik_Latn', name: 'Kikuyu', iso1: 'ki', whisper: null, aliases: [], engines: ['omnilingual'], whisperStrong: false, tts: { voices: 0, engines: [] } },
  ],
}
function wav(seconds = 0.3) {
  const n = Math.floor(16000 * seconds), b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  return b
}
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const json = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (url.pathname === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>t</title><textarea id="ta" style="width:400px;height:100px"></textarea>') }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
  if (url.pathname === '/api/me') return json({ principal: { via: 'single-user' } })
  if (url.pathname === '/api/languages') return json(LANGS)
  if (url.pathname === '/api/tts/voices') return json({ voices: [{ id: 'sw_CD-lanfrica-medium', engine: 'piper', language: 'swh_Latn' }] })
  if (url.pathname === '/api/transcripts') return json({ transcripts: [] })
  if (url.pathname === '/api/tts' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { seen.tts.push(JSON.parse(body)); res.writeHead(200, { 'content-type': 'audio/wav', 'x-semaje-voice': 'sw_CD-lanfrica-medium' }); res.end(wav()) })
    return
  }
  json({ error: 'not found' }, 404)
})
const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', ws => {
  let sentFinal = false
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'start') { seen.wsStart = msg; ws.send(JSON.stringify({ type: 'ready' })) }
      if (msg.type === 'stop') { seen.wsStop = true; ws.send(JSON.stringify({ type: 'end', transcriptId: 'tx-e2e' })); ws.close() }
      return
    }
    seen.wsBytes += data.length
    if (!sentFinal && seen.wsBytes > 2000) {  // real audio is flowing from the fake mic
      sentFinal = true
      ws.send(JSON.stringify({ type: 'final', text: 'habari yako', tStart: 0, tEnd: 2 }))
    }
  })
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

// ── browser ───────────────────────────────────────────────────
const [{ dir }] = build({ targets: [BROWSER], outDir: resolve(HERE, '../../dist') })
const browser = await puppeteer.launch(BROWSER === 'firefox' ? {
  browser: 'firefox',
  executablePath: EXECUTABLE,
  args: ['-wait-for-browser'],  // macOS Firefox re-execs itself on a fresh profile
  headless: process.env.HEADFUL ? false : true,
  enableExtensions: true,
  extraPrefsFirefox: {
    'media.navigator.streams.fake': true,            // fake microphone
    'media.navigator.permission.disabled': true,     // no permission doorhanger
    'media.autoplay.default': 0,
    'extensions.originControls.grantByDefault': true, // MV3 host permissions granted at install
    'extensions.webextensions.uuids': JSON.stringify({ 'semaje@semaje.app': FIREFOX_UUID }),
  },
} : {
  executablePath: EXECUTABLE,
  headless: process.env.HEADFUL ? false : true,
  pipe: true,
  enableExtensions: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
})
const errors = []
let failed = false
try {
  const extId = await browser.installExtension(dir)
  const EXT = BROWSER === 'firefox' ? `moz-extension://${FIREFOX_UUID}` : `chrome-extension://${extId}`
  const swTarget = BROWSER === 'firefox' ? null
    : await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith(`${EXT}/`), { timeout: 15000 })
  const watch = page => {
    page.on('console', m => { if (m.type() === 'error') errors.push(`${page.url()}: ${m.text()}`) })
    page.on('pageerror', e => errors.push(`${page.url()}: ${e.message}`))
    page.on('response', r => { if (r.status() >= 400) errors.push(`${page.url()}: HTTP ${r.status()} ${r.url()}`) })
    return page
  }

  // Extension pages are opened the way the extension itself opens them. Firefox's
  // WebDriver BiDi refuses direct navigation to moz-extension:// URLs, so there we
  // start from the welcome page the extension opens on install.
  let control
  const openExtPage = async path => {
    if (BROWSER !== 'firefox') {
      const p = watch(await browser.newPage())
      await p.goto(`${EXT}/${path}`)
      return p
    }
    // Tabs the extension opens later never reach Firefox's page list, so reuse
    // the control tab: an in-page navigation, as a link click would do.
    await control.evaluate(url => { location.href = url }, `${EXT}/${path}`).catch(() => {})
    control = watch(await findPage(`${EXT}/${path}`))
    return control
  }
  // Firefox's remote agent reports moz-extension tabs as about:blank (its
  // NavigationManager loses them), so match on each page's real location.
  async function findPage(prefix, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      for (const p of await browser.pages()) {
        const href = await p.evaluate(() => location.href).catch(() => '')
        if (href.startsWith(prefix)) return p
      }
      await new Promise(r => setTimeout(r, 250))
    }
    throw new Error(`no page at ${prefix}`)
  }
  if (BROWSER === 'firefox') {
    control = watch(await findPage(`${EXT}/src/options/options.html`))
    console.log('✓ welcome page opened on install')
  } else {
    control = await openExtPage('src/popup/popup.html')
  }
  const act = (action, extra = {}) => control.evaluate((a, e) => chrome.runtime.sendMessage({ kind: 'ui:action', action: a, ...e }), action, extra)
  await control.evaluate(base => chrome.storage.local.set({ apiBase: base, apiKey: '' }), BASE)
  await new Promise(r => setTimeout(r, 300))
  errors.length = 0  // the control page's first load used the default server URL, before we configured it
  const status = await act('status')
  assert.equal(status.ok, true, JSON.stringify(status))
  const expected = BROWSER === 'firefox' ? ['background', 'media-tap'] : ['offscreen', 'tab-capture']
  assert.deepEqual([status.hostMode, status.tabStrategy], expected)
  console.log(`✓ ${BROWSER} background booted (host: ${status.hostMode}, tab audio: ${status.tabStrategy})`)

  const options = await openExtPage('src/options/options.html?e2e=1')
  await options.waitForFunction(() => document.getElementById('server-status').textContent.startsWith('Connected'), { timeout: 10000 })
  console.log('✓ options:', await options.$eval('#server-status', e => e.textContent))

  const popup = await openExtPage('src/popup/popup.html')
  await popup.waitForFunction(() => document.getElementById('server-badge').textContent === 'connected', { timeout: 10000 })
  await popup.focus('#lang')
  await popup.type('#lang', 'kiswa')
  const hit = await popup.$eval('#lang-results button[role="option"] span', e => e.textContent)
  assert.equal(hit, 'Swahili')
  console.log('✓ popup connected; language search "kiswa" → Swahili')

  const page = watch(await browser.newPage())
  await page.goto(`${BASE}/page.html`)
  await page.bringToFront()
  await page.focus('#ta')
  // Filter in JS: Firefox match patterns cannot contain a port.
  const tabId = await control.evaluate(async url => (await chrome.tabs.query({})).find(t => (t.url || '').startsWith(url))?.id, BASE)
  assert.ok(tabId != null, 'test page tab not visible to the extension')
  const started = await act('dictate', { tabId })
  assert.ok(!started.error, started.error)
  await page.waitForFunction(() => document.getElementById('ta').value.includes('habari yako'), { timeout: 20000 })
  await new Promise(r => setTimeout(r, 1500))  // any duplicate delivery would land by now
  assert.equal(await page.$eval('#ta', e => e.value), 'habari yako ', 'final text inserted exactly once')
  assert.equal(wss.clients.size, 1, 'exactly one realtime socket (one capture host)')
  assert.equal(seen.wsStart.source, 'extension')
  assert.equal(seen.wsStart.mode, 'dictation')
  console.log(`✓ dictation: ${seen.wsBytes} bytes of mic audio streamed; textarea = ${JSON.stringify(await page.$eval('#ta', e => e.value))}`)

  await act('stop')
  for (let i = 0; i < 30 && !seen.wsStop; i++) await new Promise(r => setTimeout(r, 100))
  await new Promise(r => setTimeout(r, 500))
  assert.equal(seen.wsStop, true)
  assert.deepEqual((await act('status')).sessions, [])
  console.log('✓ dictation stopped cleanly (stop frame sent, session released)')

  await act('speak', { text: 'Habari ya asubuhi', language: 'sw' })
  for (let i = 0; i < 50 && !seen.tts.length; i++) await new Promise(r => setTimeout(r, 100))
  assert.deepEqual({ text: seen.tts[0].text, language: seen.tts[0].language }, { text: 'Habari ya asubuhi', language: 'sw' })
  console.log(`✓ read aloud: /api/tts called and audio played by the ${status.hostMode} host`)

  const benign = e => /favicon|ERR_FILE_NOT_FOUND/.test(e)
  const real = errors.filter(e => !benign(e))
  assert.deepEqual(real, [], `extension logged errors:\n${real.join('\n')}`)
  console.log('✓ no errors in any extension context')
  console.log(`\nE2E PASS (${BROWSER} ${await browser.version()})`)
} catch (err) {
  failed = true
  console.error('\nE2E FAIL:', err.message)
  if (errors.length) console.error('captured errors:\n' + errors.join('\n'))
} finally {
  await browser.close()
  server.close()
}
process.exit(failed ? 1 : 0)
