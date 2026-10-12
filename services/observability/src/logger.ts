type Fields = Record<string, unknown>

function write(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, service: process.env.SEMAJE_SERVICE || 'semaje', event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logInfo = (event: string, fields?: Fields) => write('info', event, fields)
export const logWarn = (event: string, fields?: Fields) => write('warn', event, fields)
export const logError = (event: string, fields?: Fields) => write('error', event, fields)
