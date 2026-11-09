import { useMemo, useRef, useState } from 'react'
import { Archive, ArrowDownToLine, ArrowRight, BookOpen, Box, Code2, GitFork, Layers3, LoaderCircle, LockKeyhole, Plus, Search, UploadCloud, X } from 'lucide-react'
import type { Artifact, Job } from '../api'
import { bytes, displayError } from '../format'
import { Results, type ArtifactAccess } from '../Results'
import type { BrowserResult, Stage, WorkerOutput } from './types'
import './studio.css'

const repo = 'https://github.com/compkrx/Horizon-Bridge'
const base = new URL(import.meta.env.BASE_URL, window.location.href).href
const maxFiles = 12
const maxSize = 32 * 1024 * 1024
const labels = { loading: 'Loading engine', inspecting: 'Inspecting JAR', translating: 'Translating bytecode', packaging: 'Building downloads' }
const examples = [{name: 'logic.jar', title: 'Java arithmetic'}, {name: 'asset.jar', title: 'Crafting recipe'}, {name: 'startup.jar', title: 'Fabric startup hook'}]

type Item = {id: string; file: File; stage: Stage | 'ready' | 'queued' | 'failed' | 'cancelled'; result?: BrowserResult; error?: string}

function run(worker: Worker, file: File, progress: (stage: Stage) => void, signal: AbortSignal): Promise<BrowserResult> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate()
      fail(new Error('The converter exceeded its 90-second budget.'))
    }, 90_000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
    }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'))
    worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
      if ('stage' in event.data) progress(event.data.stage)
      else if ('error' in event.data) fail(new Error(event.data.error))
      else { cleanup(); resolve(event.data.result) }
    }
    worker.onerror = () => fail(new Error('The browser worker stopped unexpectedly.'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    worker.postMessage({ file, base })
  })
}

function download(buffer: ArrayBuffer, name: string) {
  const href = URL.createObjectURL(new Blob([buffer]))
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 5_000)
}

function WorkspaceResults({item, result}: {item: Item; result: BrowserResult}) {
  const [query, setQuery] = useState('')
  const [exportedOnly, setExportedOnly] = useState(false)
  const access = useMemo<ArtifactAccess>(() => ({
    async file(path) { return result.files[path] ?? '' },
    async download(artifact: Artifact) {
      const buffer = result.downloads[artifact.name]
      if (!buffer) throw new Error('The artifact is unavailable.')
      download(buffer, artifact.name)
    },
  }), [result])
  const {report} = result
  const job: Job = {
    id: item.id, filename: item.file.name, size: item.file.size, target: report.target.id, state: 'succeeded',
    stage: 'ready', history: [], createdAt: '', expiresAt: '', attempt: 1,
    report, artifacts: result.artifacts,
    files: Object.entries(result.files).map(([path, value]) => ({ path, size: new TextEncoder().encode(value).length })),
  }
  const match = report.resources.entries.filter((entry) => (!exportedOnly || entry.exported) && entry.path.toLowerCase().includes(query.toLowerCase()))
  return <div className="browser-results" id="browser-results">
    <section className="panel result-section" aria-label="Archive overview">
      <div className="panel-title"><Archive size={20} /><h2 className="break-all">{item.file.name}</h2><span className="pill ml-auto">In-browser</span></div>
      <dl className="browser-metrics">
        <div><dt>Java version</dt><dd>{report.inspection.javaVersion ?? '—'}</dd></div>
        <div><dt>Classes</dt><dd>{report.inspection.classCount}</dd></div>
        <div><dt>Methods</dt><dd>{report.inspection.methodCount}</dd></div>
        <div><dt>Resource entries</dt><dd>{report.resources.count}</dd></div>
      </dl>
      {report.resources.entries.length > 0 && <details className="browser-inventory">
        <summary>Search the resource inventory</summary>
        <div className="inventory-controls"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by path" aria-label="Filter resources by path" /></label>
          <label className="permission"><input type="checkbox" checked={exportedOnly} onChange={(event) => setExportedOnly(event.target.checked)} /> Exported only</label></div>
        <p className="text-sm text-muted">{match.length} matches in the first {report.resources.entries.length} of {report.resources.count} paths.</p>
        <ul className="inventory-list mono">{match.map((entry) => <li key={entry.path}><span>{entry.path}</span><span>{entry.exported ? 'Exported' : 'Review'}</span></li>)}</ul>
      </details>}
    </section>
    <Results job={job} config={null} access={access} />
  </div>
}

export default function Studio() {
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sample, setSample] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const active = useRef<{ controller: AbortController; worker: Worker } | null>(null)
  const current = items.find((item) => item.id === selected)

  function add(files: File[]) {
    if (busy) return
    const valid = files.filter((file) => /\.jar$/i.test(file.name) && file.size >= 4 && file.size <= maxSize)
    const added = valid.slice(0, maxFiles - items.length).map((file) => ({id: crypto.randomUUID(), file, stage: 'queued' as const}))
    setError(valid.length !== files.length ? 'Select JAR files between 4 bytes and 32 MiB.' : added.length !== valid.length ? 'A session holds up to 12 JARs. Clear results or remove a JAR to add more.' : '')
    setItems((previous) => [...previous, ...added.slice(0, maxFiles - previous.length)])
    if (added.length) setAuthorized(false)
  }

  async function addSample(name: string) {
    setSample(name)
    setError('')
    try {
      const response = await fetch(new URL(`browser/examples/${name}`, base))
      if (!response.ok) throw new Error('Could not load the example JAR.')
      add([new File([await response.blob()], name, {type: 'application/java-archive'})])
    } catch (error) { setError(displayError(error)) }
    finally { setSample('') }
  }

  async function convert() {
    if (active.current || !authorized) return
    setError('')
    const queue = items.filter((item) => item.stage === 'queued')
    if (!queue.length) return
    let worker: Worker
    try { worker = new Worker(new URL('./converter.worker.ts', import.meta.url), { type: 'module' }) }
    catch { setError('This browser could not start the conversion worker.'); return }
    const controller = new AbortController()
    active.current = { controller, worker }
    setBusy(true)
    const update = (id: string, values: Partial<Item>) => setItems((list) => list.map((item) => item.id === id ? {...item, ...values} : item))
    try {
      for (const item of queue) {
        if (controller.signal.aborted) break
        try {
          const result = await run(worker, item.file, (stage) => update(item.id, {stage}), controller.signal)
          update(item.id, {stage: 'ready', result})
          setSelected((value) => value || item.id)
        } catch (error) {
          update(item.id, controller.signal.aborted ? {stage: 'cancelled'} : {stage: 'failed', error: displayError(error)})
          if (error instanceof Error && (error.message.includes('budget') || error.message.includes('stopped unexpectedly'))) break
        }
      }
    } finally {
      worker.terminate()
      active.current = null
      setBusy(false)
    }
  }

  const count = items.filter((item) => item.stage === 'queued').length
  const ready = items.filter((item) => item.result).length
  return <>
    <a href="#studio" className="skip-link">Skip to converter</a>
    <header className="topbar browser-header"><div className="site-width topbar-inner">
      <a href="#" className="brand"><img src={new URL('bridge.svg', base).href} width="32" height="32" alt="" /><strong>Horizon<span>Bridge</span></strong></a>
      <nav className="browser-nav" aria-label="Primary"><a href="#studio">Studio</a><a href="#compatibility">Compatibility</a><a href={repo}><GitFork size={16} /> GitHub</a></nav>
      <span className="service-pill"><span className="service-dot online" /> Local mode</span>
    </div></header>
    <main className="site-width browser-main">
      <section className="browser-hero"><div>
        <p className="eyebrow hero-tag"><span /> OPEN SOURCE <span className="hero-slash">/</span> HORIZON 26.3</p>
        <h1>Bring Java mods<br /> <em>to Horizon.</em></h1>
        <p>Inspect a batch of Minecraft JARs, convert supported logic, and export Rust source or recipe bundles. Your files stay in this browser tab.</p>
        <div className="hero-actions"><a className="btn accent" href="#studio">Open studio <ArrowRight size={16} /></a><a className="btn plain" href={repo}><GitFork size={16} /> View source</a></div>
      </div><div className="panel browser-hero-card">
        <span className="pill mono">LOCAL ENGINE / READY</span>
        <div className="hero-engine"><Archive size={36} /><span /><Box size={46} /></div>
        <div className="diagram-bottom"><span>01 / JAVA BYTECODE</span><span>02 / HORIZON ARTIFACTS</span></div>
      </div></section>
      <div className="browser-layout" id="studio">
        <section className="panel result-section" aria-labelledby="studio-title">
          <div className="panel-title"><Layers3 size={22} /><h2 id="studio-title">Batch conversion studio</h2><span className="pill ml-auto">{items.length}/{maxFiles} JARs</span></div>
          <div className={`dropzone browser-drop${dragging ? ' dragging' : ''}`} onDragOver={(event) => {event.preventDefault(); setDragging(true)}}
            onDragLeave={() => setDragging(false)} onDrop={(event) => {event.preventDefault(); setDragging(false); add(Array.from(event.dataTransfer.files))}}>
            <UploadCloud size={28} /><strong>Drop Minecraft mod JARs here</strong><p className="text-muted">Up to 32 MiB per file</p>
            <button className="btn outline compact" type="button" onClick={() => fileInput.current?.click()} disabled={busy || !!sample || items.length >= maxFiles}><Plus size={16} /> Choose JARs</button>
            <input ref={fileInput} type="file" accept=".jar" multiple hidden onChange={(event) => {add(Array.from(event.target.files ?? [])); event.target.value = ''}} />
          </div>
          <div className="browser-examples" aria-label="Example JARs"><span className="eyebrow">Try an example</span>{examples.map(({name,title}) =>
            <button className="btn outline compact" type="button" key={name} onClick={() => void addSample(name)} disabled={busy || !!sample || items.length >= maxFiles}>{title}</button>)}</div>
          {items.length > 0 && <ul className="batch-list" aria-label="Conversion queue">{items.map((item) => <li key={item.id}>
            <Archive size={17} /><div><strong>{item.file.name}</strong><p>{bytes(item.file.size)} · {item.stage in labels ? labels[item.stage as Stage] : item.stage}</p>{item.error && <p className="error" role="alert">{item.error}</p>}</div>
            {item.result ? <button className="btn outline compact" type="button" aria-pressed={selected === item.id} onClick={() => {
              setSelected(item.id)
              requestAnimationFrame(() => document.getElementById('browser-results')?.scrollIntoView({block: 'start'}))
            }}>View result</button>
              : <button className="btn plain compact" type="button" aria-label={`Remove ${item.file.name}`} disabled={busy} onClick={() => setItems((list) => list.filter((entry) => entry.id !== item.id))}><X size={17} /></button>}
          </li>)}</ul>}
          <p className="sr-only" role="status">{ready > 0 ? `${ready} of ${items.length} results ready.` : ''}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <label className="permission browser-permission"><input type="checkbox" checked={authorized} disabled={busy} onChange={(event) => setAuthorized(event.target.checked)} /> I own these mods or have permission to convert them.</label>
          <div className="browser-actions">
            <button className="btn accent" type="button" disabled={!count || !authorized || busy || !!sample} onClick={() => void convert()}>{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />} {busy ? 'Processing batch' : `Convert ${count || ''} ${count === 1 ? 'JAR' : 'JARs'}`}</button>
            {busy ? <button className="btn outline" type="button" onClick={() => {active.current?.controller.abort(); active.current?.worker.terminate()}}>Cancel batch</button>
              : items.length > 0 && <button className="btn plain" type="button" onClick={() => {setItems([]); setSelected(''); setError(''); setAuthorized(false)}}>Clear session</button>}
          </div>
        </section>
        <aside className="sidebar"><section className="panel side-panel"><div className="side-title"><LockKeyhole size={19} /><h2>Private by design</h2></div><p>Analysis runs in a WebAssembly worker. Reports and downloads stay in memory until you clear or close the tab.</p></section>
          <section className="panel side-panel"><div className="side-title"><ArrowDownToLine size={19} /><h2>What you get</h2></div><ul className="browser-output-list"><li>Source project and bytecode IR</li><li>Validation and dependency report</li><li>Recipe bundles where supported</li><li>Rust source for recognized methods</li></ul></section>
          <section className="panel side-panel"><div className="side-title"><Code2 size={19} /><h2>Need native validation?</h2></div><p>The self-hosted edition runs the pinned Horizon build and can emit verified native bundles.</p><a href={`${repo}/blob/main/docs/HORIZON.md`}>Toolchain instructions <ArrowRight size={15} /></a></section></aside>
      </div>
      {current?.result && <WorkspaceResults key={current.id} item={current} result={current.result} />}
      <section className="panel result-section browser-compat" id="compatibility" aria-labelledby="compat-title"><div className="panel-title"><BookOpen size={21} /><h2 id="compat-title">Compatibility</h2></div>
        <dl className="data-grid"><div><dt>Loaders inspected</dt><dd>Fabric, Forge, NeoForge, Quilt, legacy Java metadata</dd></div><div><dt>Rust generation</dt><dd>Recognized static bytecode and the supported Fabric startup pattern</dd></div><div><dt>Content export</dt><dd>Vanilla-item shaped and shapeless recipes in the mod’s namespace</dd></div><div><dt>Horizon target</dt><dd>Minecraft 26.3 · fdc87ae · hook API 411</dd></div></dl>
      </section>
    </main>
    <footer className="site-width footer"><strong>HorizonBridge · MIT</strong><a href={repo}>GitHub repository <GitFork size={15} /></a></footer>
  </>
}
