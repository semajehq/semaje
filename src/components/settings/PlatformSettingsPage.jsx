import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, ArchiveRestore, Check, Clipboard, Clock3, Database, FileKey, Fingerprint,
  HardDrive, KeyRound, Plus, RefreshCcw, Route, ShieldCheck, Trash2, UserPlus, Users,
} from 'lucide-react'
import {
  createInvite, createWorkspace, getSecurityAdmin, runRetention, saveRetentionPolicy,
  updateMemberRole,
} from '../../utils/apiClient'

const TABS = [
  ['people', 'People', Users], ['retention', 'Retention', Trash2],
  ['audit', 'Audit', Fingerprint], ['recovery', 'Recovery', ArchiveRestore],
]

export default function PlatformSettingsPage() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('people')
  const [error, setError] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteToken, setInviteToken] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [retention, setRetention] = useState({ enabled: false, defaultDays: 365, sourceRules: {}, deleteAudio: true })
  const [retentionResult, setRetentionResult] = useState(null)

  const load = async () => {
    try {
      const next = await getSecurityAdmin()
      setData(next)
      setRetention({
        enabled: next.retention.enabled,
        defaultDays: next.retention.default_days,
        sourceRules: next.retention.source_rules || {},
        deleteAudio: next.retention.delete_audio,
      })
      setError('')
    } catch (nextError) { setError(nextError.message) }
  }
  useEffect(() => { load() }, [])

  const invite = async event => {
    event.preventDefault()
    if (!inviteEmail.trim()) return
    try {
      const created = await createInvite({ email: inviteEmail.trim(), role: inviteRole, expiresInDays: 7 })
      setInviteToken(`${window.location.origin}/join?token=${encodeURIComponent(created.token)}`); setInviteEmail(''); await load()
    } catch (nextError) { setError(nextError.message) }
  }

  const addWorkspace = async event => {
    event.preventDefault()
    if (!workspace.trim()) return
    try { await createWorkspace(workspace.trim()); setWorkspace(''); await load() }
    catch (nextError) { setError(nextError.message) }
  }

  const saveRetention = async () => {
    try { await saveRetentionPolicy(retention); await load() }
    catch (nextError) { setError(nextError.message) }
  }

  const executeRetention = async dryRun => {
    if (!dryRun && !window.confirm('Delete transcripts and unreferenced audio matching this policy?')) return
    try { setRetentionResult(await runRetention(dryRun)); await load() }
    catch (nextError) { setError(nextError.message) }
  }

  return (
    <main className="flex-1 admin-page">
      <header className="admin-mast">
        <div><p className="eyebrow">Self-host control plane</p><h1>Operations console</h1></div>
        <div className="posture-stamp" data-strict={data?.deployment?.strictLocal}><ShieldCheck size={16} /><span>{data?.deployment?.strictLocal ? 'Strict local' : 'Controlled egress'}</span><b>{data?.deployment?.authMode || 'loading'}</b></div>
      </header>

      <nav className="admin-route-strip">
        <Link to="/settings/api-keys"><KeyRound size={15} /><span>API keys</span></Link>
        <Link to="/settings/models"><HardDrive size={15} /><span>Speech models</span></Link>
        <Link to="/settings/intelligence"><Database size={15} /><span>Local AI</span></Link>
        <Link to="/settings/integrations"><Route size={15} /><span>Routing</span></Link>
        <Link to="/settings/observability"><Activity size={15} /><span>Telemetry</span></Link>
      </nav>

      <div className="admin-tabbar">
        {TABS.map(([key, label, Icon]) => <button key={key} data-active={tab === key} onClick={() => setTab(key)}><Icon size={14} /> {label}</button>)}
        <button className="admin-refresh" onClick={load} title="Refresh admin data"><RefreshCcw size={14} /></button>
      </div>
      {error && <div className="error-banner mt-3">{error}</div>}

      {tab === 'people' && <section className="admin-grid people-grid">
        <div className="member-ledger">
          <div className="admin-section-heading"><Users size={15} /><span>Members</span><strong>{data?.members?.length || 0}</strong></div>
          {(data?.members || []).map(member => <div className="member-row" key={member.id}>
            <span className="member-avatar">{(member.display_name || member.email).slice(0, 2).toUpperCase()}</span>
            <div><strong>{member.display_name || member.email.split('@')[0]}</strong><small>{member.email}</small></div>
            <select value={member.role} onChange={event => updateMemberRole(member.id, event.target.value).then(load).catch(nextError => setError(nextError.message))}>
              {['viewer', 'member', 'admin', 'owner'].map(role => <option key={role}>{role}</option>)}
            </select>
            <time>{member.last_login_at ? new Date(member.last_login_at).toLocaleDateString() : 'never'}</time>
          </div>)}
        </div>

        <aside className="admin-side-stack">
          <form className="invite-console" onSubmit={invite}>
            <div className="admin-section-heading"><UserPlus size={15} /><span>Invite member</span></div>
            <input type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="name@company.local" />
            <div><select value={inviteRole} onChange={event => setInviteRole(event.target.value)}><option>viewer</option><option>member</option><option>admin</option></select><button className="primary-button"><Plus size={14} /> Invite</button></div>
            {inviteToken && <button type="button" className="invite-token" onClick={() => navigator.clipboard.writeText(inviteToken)}><Clipboard size={13} /><span>{inviteToken}</span></button>}
          </form>

          <form className="workspace-console" onSubmit={addWorkspace}>
            <div className="admin-section-heading"><Database size={15} /><span>Workspaces</span></div>
            {(data?.workspaces || []).map(item => <div key={item.id}><span>{item.name}</span><small>{new Date(item.created_at).toLocaleDateString()}</small></div>)}
            <label><input value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder="Workspace name" /><button title="Create workspace"><Plus size={14} /></button></label>
          </form>
        </aside>
      </section>}

      {tab === 'retention' && <section className="retention-console">
        <div className="retention-header"><div><p className="eyebrow">Deletion policy</p><h2>Data lifecycle</h2></div><label className="toggle-row"><input type="checkbox" checked={retention.enabled} onChange={event => setRetention(current => ({ ...current, enabled: event.target.checked }))} /><span>Enabled</span></label></div>
        <div className="retention-matrix">
          <label><span>Default</span><input type="number" min="1" value={retention.defaultDays} onChange={event => setRetention(current => ({ ...current, defaultDays: Number(event.target.value) }))} /><small>days</small></label>
          {['upload', 'meeting', 'dictation', 'folder'].map(source => <label key={source}><span>{source}</span><input type="number" min="1" placeholder={retention.defaultDays} value={retention.sourceRules[source] || ''} onChange={event => setRetention(current => ({ ...current, sourceRules: { ...current.sourceRules, [source]: event.target.value ? Number(event.target.value) : undefined } }))} /><small>days</small></label>)}
        </div>
        <label className="toggle-row retention-audio"><input type="checkbox" checked={retention.deleteAudio} onChange={event => setRetention(current => ({ ...current, deleteAudio: event.target.checked }))} /><span>Delete unreferenced source audio</span></label>
        <div className="retention-actions"><button className="secondary-button" onClick={saveRetention}><Check size={14} /> Save policy</button><button className="secondary-button" onClick={() => executeRetention(true)}><Clock3 size={14} /> Preview</button><button className="danger-button" onClick={() => executeRetention(false)}><Trash2 size={14} /> Execute</button></div>
        {retentionResult && <div className="retention-result"><strong>{retentionResult.transcripts}</strong><span>transcripts</span><strong>{retentionResult.audioBlobs}</strong><span>audio blobs</span><b>{retentionResult.dryRun ? 'preview' : 'deleted'}</b></div>}
      </section>}

      {tab === 'audit' && <section className="audit-console">
        <div className="admin-section-heading"><Fingerprint size={15} /><span>Sensitive activity</span><strong>{data?.auditEvents?.length || 0}</strong></div>
        {(data?.auditEvents || []).map(item => <div className="audit-row" key={item.id}><time>{new Date(item.created_at).toLocaleString()}</time><strong>{item.action}</strong><span>{item.actor_email || 'system'}</span><small>{item.target_type || '-'} / {item.target_id || '-'}</small><code>{item.ip_address || 'local'}</code></div>)}
      </section>}

      {tab === 'recovery' && <section className="recovery-console">
        <div><ArchiveRestore size={22} /><h2>Backup and restore</h2><p>Checksummed Postgres, application data, model volumes, and reviewed configuration.</p><code>deploy/backup</code><code>deploy/restore backups/semaje-TIMESTAMP --yes</code></div>
        <div><FileKey size={22} /><h2>Encryption posture</h2><dl><div><dt>Host volume</dt><dd>Required</dd></div><div><dt>Application key</dt><dd>{data?.deployment?.encryptionKeyConfigured ? 'Loaded' : 'Not loaded'}</dd></div><div><dt>Restore guide</dt><dd>docs/backup-restore.md</dd></div></dl></div>
      </section>}
    </main>
  )
}
