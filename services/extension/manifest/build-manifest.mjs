// Pure manifest generation for every supported browser. Gate-tested.
export const TARGETS = ['chrome', 'edge', 'firefox', 'safari']

const ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' }
const DEV_HOSTS = ['http://localhost/*', 'http://127.0.0.1/*']

function commands() {
  return {
    'toggle-dictation': { suggested_key: { default: 'Ctrl+Shift+1', mac: 'Command+Shift+1' }, description: 'Start/stop dictation into the focused text field' },
    'transcribe-tab': { suggested_key: { default: 'Ctrl+Shift+2', mac: 'Command+Shift+2' }, description: 'Start/stop live transcription of this tab' },
    'read-selection': { suggested_key: { default: 'Ctrl+Shift+3', mac: 'Command+Shift+3' }, description: 'Read the selected text aloud' },
  }
}

/**
 * @param {string} target  chrome | edge | firefox | safari
 * @param {{version: string, serverOrigins?: string[], geckoId?: string}} opts
 *   serverOrigins: org servers baked in as granted host permissions (enterprise builds)
 */
export function buildManifest(target, { version, serverOrigins = [], geckoId = 'semaje@semaje.app' }) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown target ${target}; use ${TARGETS.join(', ')}`)
  if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error(`Invalid extension version ${version}`)
  const hosts = [...new Set([...DEV_HOSTS, ...serverOrigins.map(o => `${new URL(o).origin}/*`)])]

  const base = {
    manifest_version: 3,
    name: 'semaje — dictate, caption & read aloud',
    short_name: 'semaje',
    version,
    description: 'Open-source speech-to-text and text-to-speech in 1,600+ languages, on your own server. Dictate anywhere, caption any tab, transcribe any audio.',
    icons: ICONS,
    action: { default_title: 'semaje', default_popup: 'src/popup/popup.html', default_icon: ICONS },
    options_ui: { page: 'src/options/options.html', open_in_tab: true },
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'notifications'],
    host_permissions: hosts,
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    commands: commands(),
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  }

  if (target === 'chrome' || target === 'edge') {
    return {
      ...base,
      minimum_chrome_version: '116',
      background: { service_worker: 'src/background/service-worker.js', type: 'module' },
      permissions: [...base.permissions, 'offscreen', 'tabCapture', 'sidePanel'],
      side_panel: { default_path: 'src/panel/panel.html' },
      storage: { managed_schema: 'managed_schema.json' },
    }
  }

  if (target === 'firefox') {
    return {
      ...base,
      background: { scripts: ['src/background/service-worker.js'], type: 'module' },
      sidebar_action: { default_title: 'semaje', default_panel: 'src/panel/panel.html', default_icon: ICONS, open_at_install: false },
      browser_specific_settings: {
        gecko: {
          id: geckoId,
          strict_min_version: '128.0',
          // Audio and text go only to the server the user (or their admin) configures.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }
  }

  // safari — converted with `xcrun safari-web-extension-converter`
  return {
    ...base,
    background: { service_worker: 'src/background/service-worker.js', type: 'module' },
    browser_specific_settings: { safari: { strict_min_version: '17.0' } },
  }
}
