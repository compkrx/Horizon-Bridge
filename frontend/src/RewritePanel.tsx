import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDownToLine, Cpu, LoaderCircle, Sparkles } from 'lucide-react'
import { displayError } from './format'
import type { RewriteChoice, RewriteRun, RustDraft } from './rewrite'

export function RewritePanel({choices, model, run, device, unavailable}: {
  choices: RewriteChoice[]; model: string; run: RewriteRun; device?: boolean; unavailable?: string
}) {
  const selectId = useId()
  const [choiceId, setChoiceId] = useState('')
  const [draft, setDraft] = useState<RustDraft>()
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [keepAwake, setKeepAwake] = useState(false)
  const active = useRef<AbortController | null>(null)
  const current = choices.find((entry) => entry.id === choiceId) ?? choices[0]
  useEffect(() => () => active.current?.abort(), [])

  async function rewrite() {
    if (!current || active.current) return
    const controller = new AbortController()
    active.current = controller
    setDraft(undefined)
    setError('')
    setStatus(device ? 'Starting the on-device worker…' : 'Waiting for the self-hosted model…')
    let wake: WakeLockSentinel | undefined
    try {
      if (device && keepAwake && navigator.wakeLock) wake = await navigator.wakeLock.request('screen').catch(() => undefined)
      setDraft(await run(current.id, setStatus, controller.signal))
    }
    catch (error) { if (!controller.signal.aborted) setError(displayError(error)) }
    finally { void wake?.release().catch(() => undefined); active.current = null; setStatus('') }
  }

  function download() {
    if (!draft) return
    const href = URL.createObjectURL(new Blob([draft.rust], {type: 'text/plain;charset=utf-8'}))
    const link = document.createElement('a')
    link.href = href
    link.download = draft.filename
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  return <section className="panel result-section rewrite-panel" id={device ? 'on-device-ai' : 'local-ai'}>
    <div className="panel-title"><Cpu size={21} /><h3>{device ? 'On-device AI rewrite' : 'Self-hosted AI rewrite'}</h3><span className="pill ml-auto">Rust draft</span></div>
    <p className="text-muted text-sm mb-4">{device
      ? 'This runs in a WebGPU worker. The first run downloads roughly 300 MB of model files. Your code stays on this device. Keep the tab open while it works.'
      : `The chosen source is sent to your configured ${model || 'self-hosted'} inference server. Model credentials stay on the host.`}</p>
    {unavailable ? <p className="text-muted text-sm">{unavailable}</p> : current ? <>
      <label className="rewrite-picker" htmlFor={selectId}>Source to rewrite</label>
      <select id={selectId} className="relay-select" value={current.id} disabled={!!status} onChange={(event) => {setChoiceId(event.target.value); setDraft(undefined); setError('')}}>
        {choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {entry.language}</option>)}
      </select>
      {device && 'wakeLock' in navigator && <label className="permission mt-3"><input type="checkbox" checked={keepAwake} disabled={!!status} onChange={(event) => setKeepAwake(event.target.checked)} /> Keep the screen awake during this draft</label>}
      <div className="browser-actions">
        <button className="btn accent" type="button" disabled={!!status} onClick={() => void rewrite()}>{status ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />} Generate Rust draft</button>
        {device && status && <button className="btn outline" type="button" onClick={() => active.current?.abort()}>Cancel rewrite</button>}
      </div>
    </> : <p className="text-muted text-sm">This archive has no small decoded methods or eligible reconstructed Java files to send to the model.</p>}
    {status && <p role="status" className="text-muted mt-3">{status}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {draft && <div className="rewrite-result">
      <div className="note warning"><p>AI-generated source requires review and validation. It stays separate from installable packages.</p></div>
      <p className="text-muted text-sm break-all">{draft.source} · {draft.model}</p>
      <pre aria-label="AI-generated Rust draft" tabIndex={0}><code>{draft.rust}</code></pre>
      {draft.notes.length > 0 && <ul className="rewrite-notes">{draft.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      <button className="btn outline" type="button" onClick={download}><ArrowDownToLine size={17} /> Download Rust draft</button>
    </div>}
  </section>
}
