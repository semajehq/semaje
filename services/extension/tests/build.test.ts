// Gate tests: per-browser manifests, package lint, reproducible zips.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
// @ts-ignore — plain JS modules
import { buildManifest, TARGETS } from '../manifest/build-manifest.mjs'
// @ts-ignore
import { build, lintPackage } from '../scripts/build.mjs'
// @ts-ignore
import { zipFiles } from '../scripts/zip.mjs'
// @ts-ignore
import { renderIcon } from '../scripts/icons.mjs'

test('chromium targets get offscreen, tabCapture, side panel, and managed storage', () => {
  for (const target of ['chrome', 'edge']) {
    const m = buildManifest(target, { version: '2.0.0' })
    assert.equal(m.manifest_version, 3)
    assert.equal(m.background.service_worker, 'src/background/service-worker.js')
    for (const p of ['offscreen', 'tabCapture', 'sidePanel', 'scripting', 'activeTab', 'storage']) assert.ok(m.permissions.includes(p), p)
    assert.equal(m.storage.managed_schema, 'managed_schema.json')
    assert.ok(!('content_scripts' in m), 'no always-on content scripts: inject on demand')
  }
})

test('firefox target uses an event page, sidebar, and gecko settings; no chromium-only APIs', () => {
  const m = buildManifest('firefox', { version: '2.0.0' })
  assert.deepEqual(m.background, { scripts: ['src/background/service-worker.js'], type: 'module' })
  assert.equal(m.sidebar_action.default_panel, 'src/panel/panel.html')
  assert.equal(m.browser_specific_settings.gecko.id, 'semaje@semaje.app')
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] })
  for (const p of ['offscreen', 'tabCapture', 'sidePanel']) assert.ok(!m.permissions.includes(p), p)
  assert.ok(!('side_panel' in m) && !('storage' in m))
})

test('safari target drops chromium-only APIs and pins a minimum version', () => {
  const m = buildManifest('safari', { version: '2.0.0' })
  assert.ok(!m.permissions.includes('offscreen'))
  assert.equal(m.browser_specific_settings.safari.strict_min_version, '17.0')
})

test('enterprise builds bake the org server into host permissions', () => {
  const m = buildManifest('chrome', { version: '2.0.0', serverOrigins: ['https://semaje.corp.example:8443/app'] })
  assert.ok(m.host_permissions.includes('https://semaje.corp.example:8443/*'))
  assert.ok(m.host_permissions.includes('http://localhost/*'))
})

test('manifest rejects unknown targets and bad versions; commands fit browser limits', () => {
  assert.throws(() => buildManifest('ie11', { version: '1.0' }), /Unknown target/)
  assert.throws(() => buildManifest('chrome', { version: 'v2-beta' }), /Invalid/)
  for (const t of TARGETS) assert.ok(Object.keys(buildManifest(t, { version: '1.0' }).commands).length <= 4)  // Chrome max suggested keys
})

test('full build: every target packages, lints clean, and zips reproducibly', () => {
  const out = mkdtempSync(join(tmpdir(), 'semaje-ext-'))
  const first = build({ outDir: out })
  assert.deepEqual(first.map((r: any) => r.target), TARGETS)
  const hashes = first.map((r: any) => readFileSync(r.zip).toString('base64'))
  const second = build({ outDir: out })
  assert.deepEqual(second.map((r: any) => readFileSync(r.zip).toString('base64')), hashes)
  for (const r of first) {
    const manifest = JSON.parse(readFileSync(join(r.dir, 'manifest.json'), 'utf8'))
    assert.deepEqual(lintPackage(r.dir, manifest), [])
  }
})

test('lint catches broken imports, missing manifest files, and module syntax in content scripts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'semaje-lint-'))
  mkdirSync(join(dir, 'src', 'content'), { recursive: true })
  writeFileSync(join(dir, 'src', 'a.js'), "import { x } from './missing.js'\n")
  writeFileSync(join(dir, 'src', 'content', 'bad.js'), 'export const y = 1\n')
  const problems = lintPackage(dir, { icons: { 16: 'icons/none.png' }, background: { service_worker: 'src/sw.js' } })
  assert.ok(problems.some((p: string) => p.includes('missing.js')))
  assert.ok(problems.some((p: string) => p.includes('icons/none.png')))
  assert.ok(problems.some((p: string) => p.includes('src/sw.js')))
  assert.ok(problems.some((p: string) => p.includes('not modules')))
})

test('zip writer produces a valid archive (entries inflate back to the input)', () => {
  const zip = zipFiles([{ name: 'b.txt', data: Buffer.from('hello hello hello hello') }, { name: 'a.txt', data: Buffer.from('x') }])
  assert.equal(zip.readUInt32LE(0), 0x04034b50)
  const nameLen = zip.readUInt16LE(26)
  assert.equal(zip.subarray(30, 30 + nameLen).toString(), 'a.txt')  // sorted
  const eocd = zip.subarray(zip.length - 22)
  assert.equal(eocd.readUInt32LE(0), 0x06054b50)
  assert.equal(eocd.readUInt16LE(10), 2)
  // second entry is deflated text
  const off = 30 + nameLen + zip.readUInt32LE(18)
  const size = zip.readUInt32LE(off + 18)
  const n2 = zip.readUInt16LE(off + 26)
  assert.equal(inflateRawSync(zip.subarray(off + 30 + n2, off + 30 + n2 + size)).toString(), 'hello hello hello hello')
})

test('icons are valid PNGs at each size', () => {
  for (const size of [16, 48, 128]) {
    const png = renderIcon(size)
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.equal(png.readUInt32BE(16), size)
  }
})
