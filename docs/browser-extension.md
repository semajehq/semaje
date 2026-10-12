# Browser extension: install, deploy, and use

The semaje extension brings open-source speech recognition and synthesis to any
web page, in 1,600+ languages, using **your own semaje server**. Audio never
goes to a third party.

| What | How |
|---|---|
| **Dictate** into any text field (Gmail, Docs, Slack, CRMs, forms) | `⌘/Ctrl ⇧ 1`, popup → *Dictate*, or right-click → *Dictate here* |
| **Live captions** for any tab (meetings, lectures, videos) | `⌘/Ctrl ⇧ 2`, popup → *Transcribe this tab live* |
| **Transcribe any audio/video** on a page or a link | right-click the media or link → *Transcribe with semaje* |
| **Transcribe a file** (MP3, M4A, WAV, Opus, AMR, MP4, MOV, MKV…) | popup → *Transcribe a file…* (drag & drop in the library panel) |
| **Read aloud** selected text | `⌘/Ctrl ⇧ 3`, or right-click → *Read aloud with semaje* |
| **Library** of every transcript, searchable | popup → *Open library* (side panel / sidebar) |

Supported browsers: **Chrome, Edge, Brave, Opera, Vivaldi, Arc** (Chromium 116+),
**Firefox** 128+, **Safari** 17+ (macOS).

---

## 1. Build the packages

From the repository root:

```bash
npm install
npm run ext:build
```

Output in `services/extension/dist/`:

| Folder (load unpacked) | Zip (store upload) | For |
|---|---|---|
| `chrome/` | `semaje-chrome-2.0.0.zip` | Chrome, Brave, Opera, Vivaldi, Arc |
| `edge/` | `semaje-edge-2.0.0.zip` | Microsoft Edge |
| `firefox/` | `semaje-firefox-2.0.0.zip` | Firefox |
| `safari/` | `semaje-safari-2.0.0.zip` | input to Apple's Safari converter |

Builds are byte-reproducible: the same source always produces the same zip
hash. Every build lints each package (manifest files exist, every import
resolves, content scripts are classic scripts) and fails loudly if not.

**Organization builds.** Bake your server into the package so users never type
a URL and the browser grants access up front:

```bash
node services/extension/scripts/build.mjs --server https://semaje.example.com
```

---

## 2. Install for yourself (developer / pilot)

### Chrome · Brave · Opera · Vivaldi · Arc

1. Open `chrome://extensions` (`brave://extensions`, `opera://extensions`, `vivaldi://extensions`).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select `services/extension/dist/chrome`.
4. Pin semaje from the puzzle-piece menu.

### Microsoft Edge

1. `edge://extensions` → enable **Developer mode** (left sidebar).
2. **Load unpacked** → `services/extension/dist/edge`.

### Firefox

Temporary (until restart), for testing:

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
2. Pick `services/extension/dist/firefox/manifest.json`.

Permanent install needs a Mozilla signature, even for private use. Sign it as
an unlisted add-on (free, automated, minutes):

```bash
npx web-ext sign --source-dir services/extension/dist/firefox \
  --channel unlisted --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

Get the API key at <https://addons.mozilla.org/developers/addon/api/key/>. The
signed `.xpi` installs by dragging it into Firefox.

### Safari (macOS)

Safari extensions ship inside a Mac app. You need Xcode.

```bash
xcodebuild -runFirstLaunch            # once per Xcode install
xcrun safari-web-extension-converter services/extension/dist/safari \
  --project-location build/safari --app-name semaje \
  --bundle-identifier app.semaje.extension --swift --no-open
open build/safari/semaje/semaje.xcodeproj
```

In Xcode choose the **semaje (macOS)** scheme → **Run**. Then in Safari:
**Settings → Advanced → Show features for web developers**, then
**Develop → Allow Unsigned Extensions**, and enable semaje under **Settings →
Extensions**. For distribution, archive and notarize the app with your Apple
Developer ID (or submit it to the Mac App Store).

Safari has no tab-capture API, so live tab captions use the page's
`<video>`/`<audio>` element directly; dictation, file transcription, and read
aloud work the same as everywhere else.

---

## 3. First run (every user)

1. **Settings opens automatically.** Enter your **Server URL** (for example
   `https://semaje.example.com`, or `http://localhost:3001` for a local server)
   and, on team servers, an **API key** (create one in the semaje web app under
   **Platform → API keys**). Click **Save & test connection**. The browser asks
   to allow access to that server: allow it. You should see *Connected · 1,693
   languages*.
2. Click **Allow microphone** and allow it. Browsers only let extensions use
   the mic after a one-time grant on the extension's own page.
3. Pick your **default spoken language**. Search by name, code, or local name:
   `Kiswahili`, `kik`, `Yoruba`, `amh`. Leave it on *Auto-detect* if you switch
   languages.

### Use it

- **Dictate:** click into any text field, press `⌘/Ctrl ⇧ 1`, and speak. A small
  pill shows *Listening*; text appears at your cursor about every five seconds.
  Press the shortcut again, or click the pill, to stop. Sessions are saved to
  your library unless you turn that off in settings.
- **Caption a tab:** on a meeting or video tab press `⌘/Ctrl ⇧ 2`. Captions
  overlay the page and the full transcript is saved when you stop.
- **Transcribe page media:** right-click a video, an audio player, or a link
  to a media file → *Transcribe with semaje*. The first time on a site, semaje
  asks permission to download from it.
- **Read aloud:** select text → `⌘/Ctrl ⇧ 3`.
- **Change shortcuts:** `chrome://extensions/shortcuts`, `edge://extensions/shortcuts`,
  or Firefox `about:addons` → ⚙ → *Manage Extension Shortcuts*.

---

## 4. Publish to the stores

| Store | Upload | Notes |
|---|---|---|
| Chrome Web Store | `semaje-chrome-*.zip` at <https://chrome.google.com/webstore/devconsole> | one-time $5 developer fee; also serves Brave, Opera, Vivaldi, Arc |
| Microsoft Edge Add-ons | `semaje-edge-*.zip` at <https://partner.microsoft.com/dashboard/microsoftedge> | free |
| Firefox Add-ons (AMO) | `semaje-firefox-*.zip` at <https://addons.mozilla.org/developers/> | listed or unlisted; source must pass `web-ext lint` (it does) |
| Opera Add-ons | `semaje-chrome-*.zip` at <https://addons.opera.com/developer/> | optional; Opera installs from the Chrome Web Store too |
| Mac App Store | Xcode archive of the converted Safari app | requires Apple Developer Program |

**Permission justifications for store review** (copy into the listing):

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Insert dictated text into the field the user is typing in, show captions, only on the tab where the user invoked semaje. No content script runs on pages otherwise. |
| `offscreen` (Chromium) | Service workers cannot use the microphone or play audio; an offscreen document does. |
| `tabCapture` (Chromium) | Live captions of the tab the user chose, on explicit user action. |
| `storage` | Server URL, API key, language, preferences. |
| `contextMenus`, `notifications` | Right-click actions and completion notices. |
| `sidePanel` / sidebar | Transcript library. |
| host permissions | Only the user's own semaje server (requested at runtime), plus a site's media when the user asks to transcribe it. |

Data disclosure: audio and text go only to the semaje server the user or their
administrator configures. The extension collects nothing for its publisher.

---

## 5. Enterprise rollout

Force-install the extension and pre-configure it centrally, so users get a
working semaje with no setup.

### Chrome / Edge (Google Admin, Intune, GPO, or plist)

1. **Force install.** Chrome: `ExtensionInstallForcelist` =
   `<extension-id>;https://clients2.google.com/service/update2/crx` (Web Store),
   or your own update URL for self-hosted CRX. Edge: the same policy name with
   the Edge Add-ons update URL
   `https://edge.microsoft.com/extensionwebstorebase/v1/crx`.
2. **Pre-configure** through managed storage. Policy path
   `3rdparty → extensions → <extension-id>`:

```json
{
  "apiBase": "https://semaje.example.com",
  "apiKey": "smj_org_issued_key",
  "language": "sw",
  "engine": "auto",
  "saveDictation": true,
  "captions": true,
  "allowTts": true,
  "lockSettings": true
}
```

Schema: `services/extension/managed_schema.json`. With `lockSettings: true`,
users see *managed by your organization* and cannot change those fields.

macOS (Jamf/MDM) plist domain `com.google.Chrome.extensions.<extension-id>`,
Windows registry
`HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\<extension-id>\policy`
(Edge: `...\Microsoft\Edge\3rdparty\...`).

3. **Host access.** Use an organization build (`--server`) so your server
   origin is a granted host permission. Optional permissions cannot be
   pre-granted by policy.

### Firefox (policies.json or GPO)

```json
{
  "policies": {
    "ExtensionSettings": {
      "semaje@semaje.app": {
        "installation_mode": "force_installed",
        "install_url": "https://intranet.example.com/semaje-firefox-2.0.0.xpi"
      }
    },
    "3rdparty": {
      "Extensions": {
        "semaje@semaje.app": { "apiBase": "https://semaje.example.com", "language": "sw", "lockSettings": true }
      }
    }
  }
}
```

Place it at `distribution/policies.json` in the Firefox install directory, or
deploy it with the Firefox ADMX templates. The `.xpi` must be signed (unlisted
signing, above).

### Safari

Distribute the notarized app with your MDM. Pre-configuration via managed
storage is not available in Safari; users enter the server URL once.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Popup badge says **offline** | Settings → *Save & test*. Check the server is up (`/api/health`) and the URL is reachable from this machine. |
| "server rejected the API key" | Create a key in the web app → Platform → API keys; paste it in Settings. |
| Dictation pill shows *Microphone access is needed* | Settings → *Allow microphone*. If blocked, reset the mic permission for the extension in the browser's site settings. |
| Nothing is inserted on a page | Some pages cannot be scripted (`chrome://`, the Web Store, built-in PDF viewer). Use another field or page. |
| Tab captions silent on Firefox/Safari | Press play first: those browsers capture the page's media element, and DRM-protected streams cannot be captured. |
| *No commercially licensed voice exists for …* | Ask your administrator: MMS-TTS covers it under a non-commercial license (`TTS_ALLOW_NONCOMMERCIAL=true`), or a custom voice can be added. |
| Language shows *Not available on this server* | The server's Omnilingual engine is not installed; see the server setup guide. |

Developers: the background logs `[semaje] background ready · host=… · tab-audio=…`
at startup (inspect the service worker / background page), and
`npm run test:extension:e2e` runs the full extension in real Chrome and Firefox.
