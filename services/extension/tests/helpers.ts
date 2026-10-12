// Shared test helpers: run classic content scripts exactly as a browser would.
// @ts-ignore — jsdom ships without bundled types
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

export function domWithScripts(html: string, scripts: string[], extra: Record<string, unknown> = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true })
  Object.assign(dom.window, extra)
  for (const rel of scripts) dom.window.eval(readFileSync(join(SRC, rel), 'utf8'))
  return dom
}

export function fakeExtApi() {
  const listeners: Array<(msg: any) => void> = []
  const sent: any[] = []
  return {
    sent,
    deliver(msg: any) { for (const l of listeners) l(msg) },
    api: { runtime: { sendMessage: (m: any) => { sent.push(m); return Promise.resolve() }, onMessage: { addListener: (l: any) => listeners.push(l) } } },
  }
}

export function runScript(dom: any, rel: string) {
  dom.window.eval(readFileSync(join(SRC, rel), 'utf8'))
}
