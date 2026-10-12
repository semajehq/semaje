// Gate tests: classic content scripts run in jsdom the way browsers inject them.
/// <reference lib="dom" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { domWithScripts, fakeExtApi, runScript } from './helpers.ts'

test('insert.js loads as a classic script and is idempotent', () => {
  const dom = domWithScripts('<input id="a" />', ['content/insert.js', 'content/insert.js'])
  assert.equal(typeof dom.window.__semajeInsert.insertAtCursor, 'function')
})

test('isEditable: text inputs, textareas, contenteditable; not buttons/readonly/password', () => {
  const dom = domWithScripts(`
    <input id="t" type="text"><input id="e" type="email"><textarea id="ta"></textarea>
    <div id="ce" contenteditable="true"><span id="inner">x</span></div>
    <input id="ro" readonly><input id="pw" type="password"><button id="b">x</button>`, ['content/insert.js'])
  const { isEditable } = dom.window.__semajeInsert
  const $ = (id: string) => dom.window.document.getElementById(id)
  for (const id of ['t', 'e', 'ta', 'ce', 'inner']) assert.equal(isEditable($(id)), true, id)
  for (const id of ['ro', 'pw', 'b']) assert.equal(isEditable($(id)), false, id)
})

test('insertAtCursor replaces the selection and adds a separating space', () => {
  const dom = domWithScripts('<textarea id="ta"></textarea>', ['content/insert.js'])
  const ta = dom.window.document.getElementById('ta') as HTMLTextAreaElement
  ta.value = 'hello world'
  ta.selectionStart = ta.selectionEnd = 5
  let events = 0
  ta.addEventListener('input', () => events++)
  assert.equal(dom.window.__semajeInsert.insertAtCursor(ta, 'there'), true)
  assert.equal(ta.value, 'hello there world')
  assert.equal(ta.selectionStart, 11)
  assert.equal(events, 1)
})

test('insertAtCursor uses the native setter so React-controlled inputs see the change', () => {
  const dom = domWithScripts('<input id="i" />', ['content/insert.js'])
  const input = dom.window.document.getElementById('i') as HTMLInputElement
  let ownSetterCalls = 0
  Object.defineProperty(input, 'value', {   // React shadows `value` on the instance
    configurable: true,
    get() { return dom.window.HTMLInputElement.prototype.__lookupGetter__('value').call(this) },
    set(v) { ownSetterCalls++; dom.window.HTMLInputElement.prototype.__lookupSetter__('value').call(this, v) },
  })
  dom.window.__semajeInsert.insertAtCursor(input, 'habari')
  assert.equal(input.value, 'habari')
  assert.equal(ownSetterCalls, 0)  // went through the prototype setter, like a real keystroke
})

test('insertAtCursor in contenteditable inserts at the caret', () => {
  const dom = domWithScripts('<div id="ce" contenteditable="true">ab</div>', ['content/insert.js'])
  const doc = dom.window.document
  const ce = doc.getElementById('ce')!
  const range = doc.createRange()
  range.setStart(ce.firstChild!, 1)
  range.collapse(true)
  dom.window.getSelection()!.removeAllRanges()
  dom.window.getSelection()!.addRange(range)
  dom.window.__semajeInsert.insertAtCursor(ce, 'X')
  assert.equal(ce.textContent, 'aXb')
})

test('activeEditable pierces open shadow roots', () => {
  const dom = domWithScripts('<div id="host"></div>', ['content/insert.js'])
  const host = dom.window.document.getElementById('host')!
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = '<textarea id="deep"></textarea>'
  ;(root.getElementById('deep') as HTMLTextAreaElement).focus()
  assert.equal(dom.window.__semajeInsert.activeEditable().id, 'deep')
})

test('widget.js inserts final dictation text only for its own session', () => {
  const fake = fakeExtApi()
  const dom = domWithScripts('<textarea id="ta"></textarea>', ['content/insert.js'], { chrome: fake.api })
  ;(dom.window.document.getElementById('ta') as HTMLTextAreaElement).focus()
  runScript(dom, 'content/widget.js')
  fake.deliver({ kind: 'semaje:state', session: 'dictation', sessionId: 's1', state: 'listening' })
  fake.deliver({ kind: 'semaje:text', session: 'dictation', sessionId: 's1', text: 'habari yako' })
  fake.deliver({ kind: 'semaje:text', session: 'dictation', sessionId: 'other', text: 'IGNORED' })
  fake.deliver({ kind: 'semaje:text', session: 'tab', sessionId: 's1', text: 'IGNORED' })
  assert.equal((dom.window.document.getElementById('ta') as HTMLTextAreaElement).value, 'habari yako ')
})

test('captions.js keeps the last three lines and hides on idle', () => {
  const fake = fakeExtApi()
  const dom = domWithScripts('', [], { chrome: fake.api })
  runScript(dom, 'content/captions.js')
  for (const t of ['one', 'two', 'three', 'four']) fake.deliver({ kind: 'semaje:text', session: 'tab', text: t })
  assert.ok(dom.window.__semajeCaptions)
  fake.deliver({ kind: 'semaje:state', session: 'tab', state: 'idle' })
})

test('media-tap.js picks the largest playing media element', () => {
  const fake = fakeExtApi()
  const dom = domWithScripts('<video id="ad"></video><video id="main"></video><audio id="a"></audio>', [], { chrome: fake.api })
  runScript(dom, 'content/media-tap.js')
  const doc = dom.window.document
  const set = (id: string, w: number, h: number, playing: boolean) => {
    const el = doc.getElementById(id)!
    Object.defineProperties(el, {
      clientWidth: { value: w }, clientHeight: { value: h }, paused: { value: !playing }, ended: { value: false }, readyState: { value: 4 },
    })
  }
  set('ad', 300, 250, true); set('main', 1280, 720, true); set('a', 0, 0, false)
  assert.equal(dom.window.__semajeTap.pickMedia().id, 'main')
})

test('media-tap.js reports no-media when nothing can be captured', () => {
  const fake = fakeExtApi()
  const dom = domWithScripts('', [], { chrome: fake.api })
  runScript(dom, 'content/media-tap.js')
  fake.deliver({ kind: 'tap:start', sessionId: 'm1' })
  assert.deepEqual(JSON.parse(JSON.stringify(fake.sent.at(-1))), { kind: 'tap:state', sessionId: 'm1', state: 'no-media' })
})
