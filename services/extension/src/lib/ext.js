// One handle for the WebExtension API across browsers. Firefox and Safari expose
// promise-based `browser`; Chromium exposes `chrome` (promise-based in MV3).
export const ext = globalThis.browser ?? globalThis.chrome
