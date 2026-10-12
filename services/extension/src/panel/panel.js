// Library panel: Chromium side panel, Firefox sidebar, or a tab elsewhere.
import { ext } from '../lib/ext.js'
import { MSG } from '../lib/protocol.js'
import { loadConfig } from '../lib/config.js'
import { createClient, friendlyError } from '../lib/api.js'

const $ = id => document.getElementById(id)
const { config } = await loadConfig()
const client = createClient({ apiBase: config.apiBase, apiKey: config.apiKey })

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children.filter(c => c != null))
  return node
}

function meta(t) {
  return `${t.source || t.task}${t.language ? ` · ${t.language}` : ''} · ${new Date(t.created_at).toLocaleString()}`
}

async function load(q = '') {
  $('status').textContent = 'Loading…'
  $('status').className = 'status'
  $('detail').textContent = ''
  $('back').hidden = true
  try {
    const { transcripts } = await client.transcripts(q)
    $('list').replaceChildren(...(transcripts.length ? transcripts.map(t => el('div', { className: 'item' },
      el('div', { className: 'title', textContent: t.title }),
      el('div', { className: 'meta', textContent: meta(t) }),
      el('div', { className: 'preview', textContent: t.preview || '' }),
      el('div', { className: 'row' },
        button('Open', () => open(t.id)),
        button('Copy', async b => { const { transcript } = await client.transcript(t.id); await navigator.clipboard.writeText(transcript.text); flash(b, 'Copied') }),
        button('Read aloud', async () => { const { transcript } = await client.transcript(t.id); speak(transcript.text, transcript.language) }),
      ),
    )) : [el('p', { className: 'muted', textContent: q ? 'No matches.' : 'No transcripts yet. Dictate, caption a tab, or drop a file above.' })]))
    $('status').textContent = ''
  } catch (err) {
    $('status').textContent = friendlyError(err)
    $('status').className = 'status error'
    $('list').textContent = ''
  }
}

function button(label, onClick) {
  const b = el('button', { type: 'button', textContent: label })
  b.addEventListener('click', () => Promise.resolve(onClick(b)).catch(err => { $('status').textContent = friendlyError(err); $('status').className = 'status error' }))
  return b
}

function flash(b, text) {
  const old = b.textContent
  b.textContent = text
  setTimeout(() => { b.textContent = old }, 1200)
}

function speak(text, language) {
  ext.runtime.sendMessage({ kind: MSG.UI_ACTION, action: 'speak', text: text.slice(0, 5000), language })
}

async function open(id) {
  const { transcript: t } = await client.transcript(id)
  $('list').textContent = ''
  $('back').hidden = false
  $('detail').replaceChildren(
    el('h1', { textContent: t.title }),
    el('div', { className: 'meta muted', textContent: meta(t) }),
    el('div', { className: 'row', style: 'margin:8px 0' },
      button('Copy', async b => { await navigator.clipboard.writeText(t.text); flash(b, 'Copied') }),
      button('Read aloud', () => speak(t.text, t.language)),
      button('Open in semaje', () => ext.tabs.create({ url: `${config.apiBase.replace(/:\d+$/, '')}/library/${t.id}` })),
    ),
    el('p', { textContent: t.result ? String(t.result) : t.text }),
  )
}

async function transcribe(file) {
  $('job').hidden = false
  $('job-name').textContent = file.name
  $('job-state').textContent = 'uploading'
  $('job-progress').value = 5
  try {
    const t = await client.transcribeFile(file, file.name, {
      language: config.language, engine: config.engine,
      onProgress: job => { $('job-state').textContent = job.status; $('job-progress').value = Math.max(10, job.progress || 0) },
    })
    $('job-state').textContent = 'done'
    $('job-progress').value = 100
    await open(t.id)
  } catch (err) {
    $('job-state').textContent = 'failed'
    $('status').textContent = friendlyError(err)
    $('status').className = 'status error'
  }
}

const drop = $('drop')
drop.addEventListener('click', () => $('file').click())
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('file').click() })
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) transcribe(e.dataTransfer.files[0]) })
$('file').addEventListener('change', e => { if (e.target.files[0]) transcribe(e.target.files[0]) })
$('back').addEventListener('click', () => load($('search').value))
$('settings').addEventListener('click', () => ext.runtime.openOptionsPage())
let debounce
$('search').addEventListener('input', e => { clearTimeout(debounce); debounce = setTimeout(() => load(e.target.value), 300) })

const { lastTranscriptId } = await ext.storage.local.get('lastTranscriptId')
if (lastTranscriptId) {
  await ext.storage.local.remove('lastTranscriptId')
  open(lastTranscriptId).catch(() => load())
} else {
  load()
}
