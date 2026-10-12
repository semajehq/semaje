// Where audio capture/playback runs. Pure decision so it is testable.
//   offscreen  — Chromium MV3: an offscreen document (service workers have no DOM)
//   background — Firefox: the background page has a DOM and can capture directly
//   window     — Safari / anything else: a small extension window
export function chooseCaptureHost({ hasOffscreen, backgroundHasDom }) {
  if (hasOffscreen) return 'offscreen'
  if (backgroundHasDom) return 'background'
  return 'window'
}

// Tab audio: Chromium can capture a tab's mixed output; elsewhere we tap the
// page's <video>/<audio> element directly.
export function chooseTabStrategy({ hasTabCapture }) {
  return hasTabCapture ? 'tab-capture' : 'media-tap'
}

export function preferredMimeType(isTypeSupported) {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return types.find(t => { try { return isTypeSupported(t) } catch { return false } }) || ''
}
