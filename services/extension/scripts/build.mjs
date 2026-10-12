#!/usr/bin/env node
// Build the semaje extension for every browser:
//   node services/extension/scripts/build.mjs [--target chrome,firefox] [--server https://semaje.corp]
// Output: services/extension/dist/<target>/ (load unpacked) + dist/semaje-<target>-<version>.zip (store upload).
// No dependencies: icons are rasterized and zips are written with node:zlib. Builds are
// byte-reproducible (fixed timestamps, sorted entries) so a zip hash identifies a release.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildManifest, TARGETS } from '../manifest/build-manifest.mjs'
import { renderIcon } from './icons.mjs'
import { zipFiles } from './zip.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(ROOT, '../..')

export function lintPackage(dir, manifest) {
  const problems = []
  const must = path => { if (!existsSync(join(dir, path))) problems.push(`manifest references missing file: ${path}`) }
  const m = manifest
  Object.values(m.icons || {}).forEach(must)
  if (m.action?.default_popup) must(m.action.default_popup)
  if (m.options_ui?.page) must(m.options_ui.page)
  if (m.background?.service_worker) must(m.background.service_worker)
  for (const s of m.background?.scripts || []) must(s)
  if (m.side_panel?.default_path) must(m.side_panel.default_path)
  if (m.sidebar_action?.default_panel) must(m.sidebar_action.default_panel)
  if (m.storage?.managed_schema) must(m.storage.managed_schema)

  // Every relative import / script / stylesheet must resolve inside the package.
  for (const file of walk(dir)) {
    const text = file.endsWith('.js') || file.endsWith('.html') ? readFileSync(file, 'utf8') : ''
    const refs = [
      ...text.matchAll(/\bimport\s+(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g),
      ...text.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
      ...text.matchAll(/<(?:script|link)[^>]+(?:src|href)="(?!https?:|data:)([^"]+)"/g),
    ].map(match => match[1])
    for (const ref of refs) {
      const target = resolve(dirname(file), ref.split('?')[0])
      if (!target.startsWith(dir)) problems.push(`${relative(dir, file)} escapes the package: ${ref}`)
      else if (!existsSync(target)) problems.push(`${relative(dir, file)} imports missing ${ref}`)
    }
    // Content scripts are classic scripts: module syntax would throw on injection.
    if (file.includes(`${join('src', 'content')}`) && /^\s*(import|export)\s/m.test(text)) {
      problems.push(`${relative(dir, file)} uses import/export but content scripts are not modules`)
    }
  }
  return problems
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

export function build({ targets = TARGETS, serverOrigins = [], outDir = join(ROOT, 'dist') } = {}) {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  mkdirSync(outDir, { recursive: true })
  const results = []
  for (const target of targets) {
    const dir = join(outDir, target)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, 'icons'), { recursive: true })
    cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true })
    for (const size of [16, 32, 48, 128]) writeFileSync(join(dir, 'icons', `icon-${size}.png`), renderIcon(size))
    const manifest = buildManifest(target, { version, serverOrigins })
    if (manifest.storage?.managed_schema) cpSync(join(ROOT, 'managed_schema.json'), join(dir, 'managed_schema.json'))
    if (existsSync(join(REPO, 'LICENSE'))) cpSync(join(REPO, 'LICENSE'), join(dir, 'LICENSE'))
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    const problems = lintPackage(dir, manifest)
    if (problems.length) throw new Error(`${target} package is broken:\n  ${problems.join('\n  ')}`)

    const files = walk(dir).map(full => ({ name: relative(dir, full).split('\\').join('/'), data: readFileSync(full) }))
    const zipPath = join(outDir, `semaje-${target}-${version}.zip`)
    writeFileSync(zipPath, zipFiles(files))
    results.push({ target, dir, zip: zipPath, files: files.length, bytes: statSync(zipPath).size })
  }
  return results
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => {
    const i = process.argv.indexOf(`--${name}`)
    return i > -1 ? process.argv[i + 1] : process.env[`SEMAJE_EXT_${name.toUpperCase()}`]
  }
  const targets = (arg('target') || TARGETS.join(',')).split(',').map(s => s.trim()).filter(Boolean)
  const serverOrigins = (arg('server') || '').split(',').map(s => s.trim()).filter(Boolean)
  for (const r of build({ targets, serverOrigins })) {
    console.log(`${r.target.padEnd(8)} ${r.files} files  ${(r.bytes / 1024).toFixed(1)} KB  → ${relative(process.cwd(), r.zip)}`)
  }
}
