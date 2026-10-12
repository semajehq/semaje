export type DesktopPlatform = 'darwin' | 'linux' | 'win32'

export function captureInputArgs(platform: DesktopPlatform, input?: string): string[] {
  if (platform === 'darwin') return ['-f', 'avfoundation', '-i', input || ':0']
  if (platform === 'win32') return ['-f', 'dshow', '-i', input || 'audio=default']
  return ['-f', 'pulse', '-i', input || 'default']
}

export function captureCommand(
  platform: DesktopPlatform, output: string,
  options: { input?: string; durationSec?: number } = {},
): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning', '-y',
    ...captureInputArgs(platform, options.input),
    ...(options.durationSec ? ['-t', String(options.durationSec)] : []),
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output,
  ]
}

export function deviceListCommand(platform: DesktopPlatform): string[] {
  if (platform === 'darwin') return ['-f', 'avfoundation', '-list_devices', 'true', '-i', '']
  if (platform === 'win32') return ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']
  return ['-f', 'pulse', '-sources', 'true', '-i', 'dummy']
}
