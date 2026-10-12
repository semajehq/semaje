// insert — puts text at the caret of the focused editable element.
// Classic content script (no import/export): content scripts are not modules.
// Exposes window.__semajeInsert. Handles <input>, <textarea>, contenteditable,
// and framework-controlled fields (React/Vue) via the native value setter.
(() => {
  if (window.__semajeInsert) return

  const TEXT_INPUTS = ['text', 'search', 'url', 'tel', 'email', '']

  function isEditable(el) {
    if (!el) return false
    const tag = (el.tagName || '').toLowerCase()
    if (tag === 'textarea') return !el.disabled && !el.readOnly
    if (tag === 'input') return TEXT_INPUTS.includes((el.type || '').toLowerCase()) && !el.disabled && !el.readOnly
    return el.isContentEditable === true || el.closest?.('[contenteditable="true"],[contenteditable=""]') != null
  }

  function editableRoot(el) {
    if (!el) return null
    const tag = (el.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea') return el
    return el.closest?.('[contenteditable="true"],[contenteditable=""]') || (el.isContentEditable ? el : null)
  }

  /** Deepest focused element, piercing open shadow roots and same-origin iframes. */
  function activeEditable(doc = document) {
    let el = doc.activeElement
    while (el) {
      if (el.shadowRoot?.activeElement) { el = el.shadowRoot.activeElement; continue }
      if (el.tagName === 'IFRAME') {
        try { el = el.contentDocument.activeElement; continue } catch { break }
      }
      break
    }
    return isEditable(el) ? editableRoot(el) : null
  }

  function insertAtCursor(target, text) {
    const el = editableRoot(target)
    if (!isEditable(el) || !text) return false
    const tag = (el.tagName || '').toLowerCase()
    const win = el.ownerDocument?.defaultView || window
    const emitInput = () => el.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))

    if (tag === 'input' || tag === 'textarea') {
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const before = el.value.slice(0, start)
      // Keep words apart when dictating into the middle of existing text.
      const glue = before && !/\s$/.test(before) && !/^[\s.,!?;:]/.test(text) ? ' ' : ''
      const next = before + glue + text + el.value.slice(end)
      const proto = tag === 'textarea' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(el, next)
      else el.value = next
      const pos = start + glue.length + text.length
      el.selectionStart = el.selectionEnd = pos
      emitInput()
      return true
    }

    const doc = el.ownerDocument
    const sel = doc.defaultView.getSelection()
    // Rich editors (Google Docs-style, ProseMirror, Lexical) listen for beforeinput/execCommand.
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      if (typeof doc.execCommand === 'function' && doc.queryCommandSupported?.('insertText')) {
        if (doc.execCommand('insertText', false, text)) return true
      }
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const node = doc.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      el.appendChild(doc.createTextNode(text))
    }
    emitInput()
    return true
  }

  window.__semajeInsert = { insertAtCursor, isEditable, activeEditable }
})()
