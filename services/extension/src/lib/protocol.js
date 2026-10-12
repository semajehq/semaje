// Message kinds exchanged between the extension's contexts. One place so a
// typo is a missing import, not a silently dropped message.
export const MSG = Object.freeze({
  // content → background
  DICTATION_TOGGLE: 'dictation:toggle',
  TAP_CHUNK: 'tap:chunk',          // Firefox/Safari tab-media fallback: base64 audio chunk
  TAP_STATE: 'tap:state',
  // background → host (offscreen document, background page, or host window)
  HOST_START: 'host:start',
  HOST_STOP: 'host:stop',
  HOST_PUSH: 'host:push',
  HOST_SPEAK: 'host:speak',
  HOST_SPEAK_STOP: 'host:speak-stop',
  HOST_PING: 'host:ping',
  // host → background
  HOST_STATE: 'host:state',
  HOST_TEXT: 'host:text',
  HOST_END: 'host:end',
  // background → content
  CS_TEXT: 'semaje:text',
  CS_STATE: 'semaje:state',
  // popup/options/panel → background
  UI_ACTION: 'ui:action',
  UI_STATUS: 'ui:status',
})

export const SESSION_KINDS = Object.freeze(['dictation', 'tab', 'media'])
