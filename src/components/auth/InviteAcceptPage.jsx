import { useContext, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound, UserPlus } from 'lucide-react'
import { AppContext } from '../../context/AppContext'
import { acceptInvite } from '../../utils/apiClient'

export default function InviteAcceptPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { setUser } = useContext(AppContext)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async event => {
    event.preventDefault(); setError('')
    try {
      const result = await acceptInvite(params.get('token') || '', password, name || undefined)
      setUser({
        id: result.principal.userId, orgId: result.principal.orgId, role: result.principal.role,
      })
      navigate('/onboarding', { replace: true })
    } catch (nextError) { setError(nextError.message) }
  }

  return (
    <main className="flex-1 invite-accept-page">
      <form onSubmit={submit}>
        <div className="invite-emblem"><UserPlus size={20} /></div>
        <p className="eyebrow">Workspace invitation</p>
        <h1>Join semaje</h1>
        <label><span>Display name</span><input value={name} onChange={event => setName(event.target.value)} /></label>
        <label><span>Password</span><input type="password" minLength="8" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <div className="error-banner">{error}</div>}
        <button className="primary-button"><KeyRound size={15} /> Accept invitation</button>
      </form>
    </main>
  )
}
