// captions — live caption overlay while a tab is being transcribed.
(() => {
  if (window.__semajeCaptions) return
  const api = globalThis.browser ?? globalThis.chrome
  const MAX_LINES = 3

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:48px;transform:translateX(-50%);display:none;max-width:min(860px,92vw);'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      .box { padding:10px 14px 12px; border-radius:12px; background:rgba(8,12,12,.86); color:#fff;
        font:500 18px/1.45 system-ui,-apple-system,"Noto Sans",sans-serif; box-shadow:0 10px 30px rgba(0,0,0,.35); }
      .head { display:flex; justify-content:space-between; gap:12px; font:600 11px/1 system-ui,sans-serif;
        letter-spacing:.04em; text-transform:uppercase; color:#8fd8cd; margin-bottom:6px; }
      button { all:unset; cursor:pointer; color:#cfd8d4; }
      .line { margin:0; } .line:not(:last-child) { opacity:.7; }
    </style>
    <div class="box" role="region" aria-label="Live captions" aria-live="polite">
      <div class="head"><span class="status">semaje · live captions</span><button class="close" title="Stop">Stop ✕</button></div>
      <div class="lines"></div>
    </div>`
  const lines = shadow.querySelector('.lines')
  const status = shadow.querySelector('.status')
  document.documentElement.appendChild(host)
  shadow.querySelector('.close').addEventListener('click', () => {
    api.runtime.sendMessage({ kind: 'ui:action', action: 'stop' })
  })

  function addLine(text) {
    const p = document.createElement('p')
    p.className = 'line'
    p.textContent = text
    lines.appendChild(p)
    while (lines.children.length > MAX_LINES) lines.firstChild.remove()
  }

  api.runtime.onMessage.addListener(msg => {
    if (msg?.session !== 'tab' && msg?.session !== 'media') return
    if (msg.kind === 'semaje:text') {
      host.style.display = 'block'
      addLine(msg.text)
    } else if (msg.kind === 'semaje:state') {
      host.style.display = msg.state === 'idle' ? 'none' : 'block'
      status.textContent = {
        connecting: 'semaje · connecting…', listening: 'semaje · live captions', finishing: 'semaje · saving…',
        error: `semaje · ${msg.detail || 'error'}`,
      }[msg.state] || 'semaje'
      if (msg.state === 'idle') lines.textContent = ''
    }
  })
  window.__semajeCaptions = { addLine }
})()
