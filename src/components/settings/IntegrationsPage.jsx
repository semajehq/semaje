import { useEffect, useState } from 'react'
import {
  Activity, Check, Cloud, FolderSync, Mail, MessageSquare, Plus, RefreshCcw,
  ShieldCheck, Trash2, Webhook, X,
} from 'lucide-react'
import { createWebhook, deleteWebhook, getIntegrations } from '../../utils/apiClient'

const CONNECTORS = [
  ['local', 'Local sync', 'INTEGRATION_FILE_SYNC_DIR', FolderSync],
  ['nextcloud', 'Nextcloud', 'NEXTCLOUD_WEBDAV_URL', Cloud],
  ['slack', 'Slack', 'SLACK_WEBHOOK_URL', MessageSquare],
  ['teams', 'Teams', 'TEAMS_WEBHOOK_URL', MessageSquare],
  ['email', 'SMTP email', 'SMTP_URL', Mail],
]

const EVENTS = ['job.succeeded', 'job.failed', 'transcript.updated', 'action.created']

export default function IntegrationsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState(['job.succeeded'])
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try { setData(await getIntegrations()); setError('') }
    catch (nextError) { setError(nextError.message) }
  }

  useEffect(() => { load() }, [])

  const toggleEvent = event => setEvents(current => current.includes(event)
    ? current.filter(item => item !== event) : [...current, event])

  const addWebhook = async event => {
    event.preventDefault()
    if (!name.trim() || !url.trim() || !events.length) return
    setSaving(true); setError('')
    try {
      await createWebhook({ name: name.trim(), url: url.trim(), events })
      setName(''); setUrl(''); setEvents(['job.succeeded']); await load()
    } catch (nextError) { setError(nextError.message) }
    finally { setSaving(false) }
  }

  const removeWebhook = async id => {
    try { await deleteWebhook(id); await load() }
    catch (nextError) { setError(nextError.message) }
  }

  return (
    <main className="flex-1 integration-page">
      <header className="integration-mast">
        <div>
          <p className="eyebrow">Outbound control</p>
          <h1>Routing board</h1>
        </div>
        <div className="integration-privacy"><ShieldCheck size={15} /><span>Default off</span><b>No implicit egress</b></div>
      </header>

      {error && <div className="error-banner integration-error">{error}</div>}

      <section className="integration-shell">
        <div className="connector-bay">
          <div className="bay-heading"><span>Destination</span><span>Configuration</span><span>State</span></div>
          {CONNECTORS.map(([key, label, env, Icon], index) => {
            const active = Boolean(data?.adapters?.[key])
            return (
              <div className="connector-row" key={key} data-active={active}>
                <span className="connector-index">0{index + 1}</span>
                <Icon size={18} />
                <div><strong>{label}</strong><small>{env}</small></div>
                <i aria-hidden="true" />
                <span className="connector-state">{active ? <Check size={13} /> : <X size={13} />}{active ? 'ready' : 'off'}</span>
              </div>
            )
          })}

          <div className="share-policy">
            <div><span>Share links</span><strong>{data?.sharing?.enabled ? 'Enabled' : 'Disabled'}</strong></div>
            <div><span>Network boundary</span><strong>{data?.sharing?.localOnly ? 'Local only' : 'Configured host'}</strong></div>
            <div><span>Webhook signatures</span><strong>{data?.webhookSigning ? 'Key loaded' : 'Default key'}</strong></div>
          </div>
        </div>

        <div className="webhook-bay">
          <div className="webhook-heading">
            <div><p className="eyebrow">Event subscriptions</p><h2>Custom webhooks</h2></div>
            <button className="icon-button h-9 w-9 rounded-lg" onClick={load} title="Refresh routes"><RefreshCcw size={14} /></button>
          </div>

          <form className="webhook-form" onSubmit={addWebhook}>
            <label><span>Name</span><input type="text" value={name} onChange={event => setName(event.target.value)} placeholder="Automation route" /></label>
            <label><span>Endpoint</span><input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://automation.local/hooks/semaje" /></label>
            <fieldset>
              <legend>Events</legend>
              {EVENTS.map(item => (
                <label key={item}><input type="checkbox" checked={events.includes(item)} onChange={() => toggleEvent(item)} /><span>{item}</span></label>
              ))}
            </fieldset>
            <button className="primary-button" disabled={saving || !events.length}><Plus size={15} /> Add route</button>
          </form>

          <div className="webhook-list">
            {(data?.webhooks || []).map(item => (
              <div key={item.id}>
                <Webhook size={15} />
                <div><strong>{item.name}</strong><small>{new URL(item.url).host}</small><p>{item.events.join(' / ')}</p></div>
                <button onClick={() => removeWebhook(item.id)} title="Remove webhook"><Trash2 size={14} /></button>
              </div>
            ))}
            {data && !data.webhooks.length && <p className="bay-empty">No event routes configured</p>}
          </div>
        </div>

        <aside className="delivery-rail">
          <div className="rail-heading"><Activity size={15} /><span>Delivery log</span></div>
          {(data?.deliveries || []).map(item => (
            <div className="delivery-row" key={item.id} data-status={item.status}>
              <span>{item.status === 'succeeded' ? <Check size={12} /> : <X size={12} />}</span>
              <div><strong>{item.adapter}</strong><small>{item.event}</small><p>{item.destination || 'local'}</p></div>
              <time>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          ))}
          {data && !data.deliveries.length && <p className="bay-empty">No deliveries yet</p>}
        </aside>
      </section>
    </main>
  )
}
