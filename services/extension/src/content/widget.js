// widget — dictation indicator pinned near the focused field. Injected on
// demand (no <all_urls> content script). Inserts final text at the caret.
(() => {
  if (window.__semajeWidget) return
  const api = globalThis.browser ?? globalThis.chrome
  const { insertAtCursor, activeEditable } = window.__semajeInsert || {}
  if (!insertAtCursor) return

  let target = activeEditable()
  let sessionId = null

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;display:none;'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      .pill { display:flex; align-items:center; gap:8px; padding:7px 11px 7px 9px; border-radius:999px;
        font:600 12px/1.2 system-ui,-apple-system,sans-serif; color:#fff; background:#101817;
        border:1px solid rgba(255,255,255,.16); box-shadow:0 8px 24px rgba(0,0,0,.3); cursor:pointer; }
      .dot { width:9px; height:9px; border-radius:50%; background:#52c7b8; }
      .listening .dot { background:#e5623f; animation:pulse 1.1s infinite; }
      .error { background:#7d2420; }
      @keyframes pulse { 50% { box-shadow:0 0 0 6px rgba(229,98,63,.25); } }
      @media (prefers-reduced-motion: reduce) { .listening .dot { animation:none; } }
    </style>
    <div class="pill" role="status" aria-live="polite" tabindex="0" title="Click to stop dictation">
      <span class="dot"></span><span class="label">semaje</span>
    </div>`
  const pill = shadow.querySelector('.pill')
  const label = shadow.querySelector('.label')
  document.documentElement.appendChild(host)

  function place() {
    if (!target?.getBoundingClientRect) return
    const r = target.getBoundingClientRect()
    host.style.top = `${Math.max(8, Math.min(window.innerHeight - 44, r.top - 40))}px`
    host.style.left = `${Math.max(8, Math.min(window.innerWidth - 180, r.left))}px`
    host.style.right = 'auto'
  }

  function show(state, detail) {
    host.style.display = state === 'idle' ? 'none' : 'block'
    pill.classList.toggle('listening', state === 'listening')
    pill.classList.toggle('error', state === 'error')
    label.textContent = {
      connecting: 'Connecting…', listening: 'Listening — click to stop', finishing: 'Finishing…',
      error: detail || 'Dictation failed',
    }[state] || 'semaje'
    if (state === 'error') setTimeout(() => { host.style.display = 'none' }, 4000)
    place()
  }

  document.addEventListener('focusin', () => { const el = activeEditable(); if (el) target = el }, true)
  pill.addEventListener('mousedown', e => {
    e.preventDefault()  // keep focus in the field
    api.runtime.sendMessage({ kind: 'dictation:toggle' })
  })

  api.runtime.onMessage.addListener(msg => {
    if (msg?.session !== 'dictation') return
    if (msg.kind === 'semaje:state') {
      sessionId = msg.sessionId
      show(msg.state, msg.detail)
    } else if (msg.kind === 'semaje:text' && msg.sessionId === sessionId) {
      const el = activeEditable() || target
      if (el) insertAtCursor(el, msg.text.endsWith(' ') ? msg.text : `${msg.text} `)
    }
  })

  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  window.__semajeWidget = { show }
})()
