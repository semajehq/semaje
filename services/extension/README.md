# services/extension — semaje browser extension

Dictation into any field, live tab captions, transcription of any page media or
file, and read-aloud, in 1,600+ languages, against your own semaje server.
One source tree builds for Chrome, Edge, Brave, Opera, Vivaldi, Arc, Firefox,
and Safari. Vanilla JS, no bundler, no runtime dependencies.

**Install, publish, and enterprise rollout:** [docs/browser-extension.md](../../docs/browser-extension.md).

```bash
npm run ext:build                 # dist/<browser>/ + reproducible zips (lints every package)
npm test                          # gate tests incl. content scripts in jsdom, host lifecycle, manifests
npm run test:extension:e2e        # the built extension in real Chrome + Firefox (fake mic, mock server)
```

## Architecture

```
src/background/service-worker.js  orchestrator: sessions, commands, context menus, permissions
src/lib/host-core.js              audio capture + realtime socket + TTS playback (one implementation)
src/host/host.html                hosts host-core: Chromium offscreen doc · Safari fallback window
                                  (Firefox runs host-core inside its background page)
src/lib/{api,realtime,config,languages,capture-host,protocol}.js   pure, unit-tested
src/content/insert.js             caret insertion (inputs, textareas, contenteditable, shadow DOM, React)
src/content/widget.js             dictation status pill; inserts final text
src/content/captions.js           live caption overlay
src/content/media-tap.js          Firefox/Safari tab audio: records the page's <video>/<audio>
src/{popup,options,panel,permissions}/   UI
manifest/build-manifest.mjs       per-browser manifest (pure, tested)
scripts/{build,zip,icons}.mjs     packaging (no dependencies)
managed_schema.json               enterprise policy schema
```

Capture host per browser: **offscreen** (Chromium) · **background page**
(Firefox) · **window** (Safari). Tab audio: **tabCapture** (Chromium) ·
**media element tap** (Firefox/Safari). Content scripts are injected on demand
(`activeTab` + `scripting`); nothing runs on pages the user hasn't invoked
semaje on.
