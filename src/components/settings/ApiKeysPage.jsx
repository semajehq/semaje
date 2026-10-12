import { useState, useEffect } from 'react'
import { KeyRound, Trash2 } from 'lucide-react'
import { listApiKeys, createApiKey, revokeApiKey } from '../../utils/apiClient'

const SCOPES = ['transcribe', 'read', 'write', 'export', 'share', 'admin']

export default function ApiKeysPage() {
  const [keys, setKeys] = useState([])
  const [name, setName] = useState('')
  const [newToken, setNewToken] = useState('')
  const [error, setError] = useState('')
  const [scopes, setScopes] = useState(['transcribe', 'read'])

  const refresh = () => listApiKeys().then(setKeys).catch(e => setError(e.message))
  useEffect(() => { refresh() }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      const { token } = await createApiKey(name.trim(), scopes)
      setNewToken(token)
      setName('')
      refresh()
    } catch (err) { setError(err.message) }
  }

  const revoke = async (id) => {
    await revokeApiKey(id)
    refresh()
  }

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 lg:py-8 flex flex-col gap-5">
      <section className="app-panel p-5 sm:p-6">
        <p className="eyebrow">Developer access</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
          API keys
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          Use API keys for scripts, extension clients, or native helpers:
          <code className="mx-1 px-1 rounded" style={{ background: 'var(--card)' }}>Authorization: Bearer smj_...</code>
        </p>
      </section>

      <form onSubmit={create} className="app-panel p-4 grid gap-3">
        <div className="flex gap-2">
          <input className="field-input px-3 flex-1" style={{ background: 'transparent', color: 'var(--text)' }} placeholder="Key name" value={name} onChange={e => setName(e.target.value)} />
          <button className="primary-button" disabled={!scopes.length}>Create</button>
        </div>
        <fieldset className="scope-picker">
          <legend>Scopes</legend>
          {SCOPES.map(scope => <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={() => setScopes(current => current.includes(scope) ? current.filter(item => item !== scope) : [...current, scope])} /><span>{scope}</span></label>)}
        </fieldset>
      </form>

      {newToken && (
        <div className="p-3 rounded-lg text-xs break-all"
             style={{ background: 'var(--card)', border: '1px solid var(--accent)', color: 'var(--text)' }}>
          Copy your key now. It is shown only once:<br /><b>{newToken}</b>
        </div>
      )}
      {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

      <div className="flex flex-col gap-2">
        {keys.map(k => (
          <div key={k.id} className="flex items-center gap-3 p-3 rounded-lg"
               style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <KeyRound size={16} style={{ color: 'var(--muted)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{k.name}</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                smj_{k.key_prefix}_... · created {new Date(k.created_at).toLocaleDateString()}
                {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ''}
              </div>
              <div className="key-scopes">{k.scopes.map(scope => <span key={scope}>{scope}</span>)}</div>
            </div>
            <button onClick={() => revoke(k.id)} title="Revoke"><Trash2 size={15} style={{ color: '#f87171' }} /></button>
          </div>
        ))}
      </div>
    </main>
  )
}
