import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArrowDownToLine, ArrowRight, BookOpen, BrainCircuit, Code2, GitBranch, GitFork, Layers3, LoaderCircle, LockKeyhole, Package, Palette, Plus, Search, UploadCloud, X } from 'lucide-react'
import type { Artifact, Job } from '../api'
import { bytes, displayError } from '../format'
import { Results, TargetDetails, type ArtifactAccess } from '../Results'
import type { BrowserResult, ConversionMode, NightlyCatalog, Stage, WorkerOutput } from './types'
import { RewritePanel } from '../RewritePanel'
import { runDeviceRewrite } from './run-device-rewrite'
import { ModuleBoard } from './ModuleBoard'
import { NightlyPicker } from './NightlyPicker'
import { NativePackageInspector } from './NativePackageInspector'
import { Appearance } from './Appearance'
import { appBase, navigate, pageHref, pages, usePage } from './pages'
import { Guide } from './Guide'
import { DeviceCheck } from './DeviceCheck'
import './studio.css'

const repo = 'https://github.com/horizonrelay/horizonrelay.github.io'
const base = appBase.href
const catalogUrl = new URL('browser/nightlies.json', base).href
const maxFiles = 12
const maxSize = 32 * 1024 * 1024
const labels = { loading: 'Loading engine', inspecting: 'Inspecting JAR', translating: 'Translating bytecode', packaging: 'Building downloads' }
const modeLabels = { all: 'All supported conversions', basic: 'Basic functions only', inspect: 'Inspect only' } satisfies Record<ConversionMode, string>
const examples = [{name: 'logic.jar', title: 'Java arithmetic'}, {name: 'asset.jar', title: 'Crafting recipe'}, {name: 'startup.jar', title: 'Fabric startup hook'}]
const pageIcons = {studio: Layers3, versions: GitBranch, packages: Package, ai: BrainCircuit, guide: BookOpen, look: Palette}

type Item = {id: string; file: File; authorized: boolean; stage: Stage | 'ready' | 'queued' | 'failed' | 'cancelled'; result?: BrowserResult; completedMode?: ConversionMode; error?: string}

function run(worker: Worker, file: File, targetId: string, mode: ConversionMode, progress: (stage: Stage) => void, signal: AbortSignal): Promise<BrowserResult> {
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
    worker.postMessage({ file, base, targetId, mode })
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

function PageIntro({title, description}: {title: string; description: string}) {
  return <header className="browser-page-intro"><h1>{title}</h1><p>{description}</p></header>
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
    {result.rewriteSources.length > 0 && <div className="browser-actions"><a className="btn outline" href={pageHref('ai')}>Open result in AI <ArrowRight size={16} /></a></div>}
  </div>
}

export default function Studio() {
  const {page, section} = usePage()
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [sample, setSample] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [catalog, setCatalog] = useState<NightlyCatalog>()
  const [catalogError, setCatalogError] = useState('')
  const [targetId, setTargetId] = useState('')
  const [mode, setMode] = useState<ConversionMode>('all')
  const main = useRef<HTMLElement>(null)
  const previousPage = useRef(page)
  const fileInput = useRef<HTMLInputElement>(null)
  const active = useRef<{ controller: AbortController; worker: Worker } | null>(null)
  const current = items.find((item) => item.id === selected)
  const targets = catalog?.targets ?? []
  const target = targets.find((item) => item.id === targetId)
  const authorized = items.length > 0 && items.every((item) => item.authorized)

  useEffect(() => {
    const label = pages.find((entry) => entry.id === page)?.label
    document.title = page === 'studio' ? 'HorizonRelay · Minecraft mod converter' : `${label} · HorizonRelay`
    if (previousPage.current !== page) main.current?.focus({preventScroll: true})
    previousPage.current = page
    const destination = section && document.getElementById(section)
    if (destination instanceof HTMLDetailsElement) destination.open = true
    if (destination) destination.scrollIntoView({block: 'start', behavior: 'instant'})
    else window.scrollTo({top: 0, behavior: 'instant'})
  }, [page, section])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(catalogUrl, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load the Nightly catalog. Reload the page to retry.')
      const data = await response.json() as NightlyCatalog
      if (data.schema !== 1 || !data.targets.some((item) => item.id === data.current)) throw new Error('The Nightly catalog is incomplete.')
      setCatalog(data)
      setTargetId(data.current)
    }).catch((error) => {
      if (!controller.signal.aborted) setCatalogError(displayError(error))
    })
    return () => controller.abort()
  }, [])

  function add(files: File[]) {
    if (busy) return
    const valid = files.filter((file) => /\.jar$/i.test(file.name) && file.size >= 4 && file.size <= maxSize)
    const added = valid.slice(0, maxFiles - items.length).map((file) => ({id: crypto.randomUUID(), file, authorized: false, stage: 'queued' as const}))
    setError(valid.length !== files.length ? 'Select JAR files between 4 bytes and 32 MiB.' : added.length !== valid.length ? 'A session holds up to 12 JARs. Clear results or remove a JAR to add more.' : '')
    setItems((previous) => [...previous, ...added.slice(0, maxFiles - previous.length)])
  }

  function requeue(id: string) {
    if (active.current) return
    setItems((list) => list.map((item) => item.id === id
      ? {id: item.id, file: item.file, authorized: item.authorized, stage: 'queued'}
      : item))
    if (selected === id) setSelected(items.find((item) => item.id !== id && item.result)?.id ?? '')
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
    if (active.current || !authorized || !target) return
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
          const result = await run(worker, item.file, target.id, mode, (stage) => update(item.id, {stage}), controller.signal)
          update(item.id, {stage: 'ready', result, completedMode: mode})
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
  const completed = items.filter((item) => item.result)
  const ready = completed.length
  const activePage = pages.find((entry) => entry.id === page)!
  const generated = completed.flatMap((item) => item.result!.artifacts
    .filter((artifact) => artifact.kind !== 'report')
    .map((artifact) => ({item, artifact, buffer: item.result!.downloads[artifact.name]})))
  return <>
    <a href="#page-content" className="skip-link" onClick={(event) => {
      event.preventDefault()
      main.current?.focus()
      main.current?.scrollIntoView({block: 'start'})
    }}>Skip to content</a>
    <header className="topbar browser-header"><div className="site-width topbar-inner">
      <a href={pageHref('studio')} className="brand"><img src={new URL('bridge.svg', base).href} width="32" height="32" alt="" /><strong>Horizon<span>Relay</span></strong></a>
      <span className="workspace-edition">Java → Horizon <span className="pill">Browser studio</span></span>
      <a className="service-pill" href={repo}><GitFork size={14} /> GitHub</a>
    </div></header>
    <div className="relay-workspace">
      <aside className="workspace-rail">
        <p className="eyebrow rail-label">WORKSPACE</p>
        <nav className="browser-nav" aria-label="Primary">{pages.map(({id, label, description}) => {
          const Icon = pageIcons[id]
          return <a key={id} href={pageHref(id)} aria-label={label} aria-current={page === id ? 'page' : undefined}><Icon size={19} /><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={14} className="rail-arrow" /></a>
        })}</nav>
        <div className="rail-session"><span className="eyebrow">THIS SESSION</span><dl><div><dt>Queued</dt><dd>{count}</dd></div><div><dt>Results</dt><dd>{ready}</dd></div></dl><p>{busy ? 'Conversion is running. You can browse the other pages.' : 'Files stay in this tab. Download your results before reloading.'}</p></div>
        <a className="rail-help" href={pageHref('guide', 'start')}><BookOpen size={16} /> New here? Start the guide</a>
      </aside>
    <main className="browser-main" id="page-content" ref={main} tabIndex={-1}>
      <nav className="workspace-breadcrumb" aria-label="Breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><span aria-current="page">{activePage.label}</span></nav>
      <div className="browser-screen" hidden={page !== 'studio'}>
        <PageIntro title="Studio" description="Add Java mods, choose a conversion mode, and review the generated code. Start with an example to try the workflow." />
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
            {items.length > 0 && <ul className="batch-list" aria-label="Conversion queue">{items.map((item) => {
              const previousTarget = item.result?.report.target
              const settingsChanged = previousTarget && (previousTarget.id !== targetId || item.completedMode !== mode)
              const canRequeue = item.stage === 'ready' || item.stage === 'failed' || item.stage === 'cancelled'
              return <li key={item.id}>
                <Archive size={17} /><div><strong>{item.file.name}</strong><p>{bytes(item.file.size)} · {item.stage in labels ? labels[item.stage as Stage] : item.stage}</p>
                  {previousTarget && item.completedMode && <p>Result · {previousTarget.label} · {modeLabels[item.completedMode]}</p>}
                  {settingsChanged && <p>Requeue to apply the selected settings.</p>}
                  {item.error && <p className="error" role="alert">{item.error}</p>}
                </div>
                <div className="flex max-w-40 flex-wrap justify-end gap-1">
                  {item.result && <button className="btn outline compact" type="button" aria-pressed={selected === item.id} onClick={() => {
                    setSelected(item.id)
                    requestAnimationFrame(() => document.getElementById('browser-results')?.scrollIntoView({block: 'start'}))
                  }}>View result</button>}
                  {canRequeue && <button className="btn plain compact" type="button" aria-label={`Requeue ${item.file.name}`} disabled={busy} onClick={() => requeue(item.id)}>Requeue</button>}
                  {!item.result && <button className="btn plain compact" type="button" aria-label={`Remove ${item.file.name}`} disabled={busy} onClick={() => setItems((list) => list.filter((entry) => entry.id !== item.id))}><X size={17} /></button>}
                </div>
              </li>
            })}</ul>}
            <p className="sr-only" role="status">{ready > 0 ? `${ready} of ${items.length} results ready.` : ''}</p>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="studio-target">
              <div><strong>Horizon Nightly target</strong><p className="nightly-info">{target?.label ?? (catalogError ? 'Catalog unavailable' : 'Loading Nightlies…')}</p></div>
              <a className="btn outline compact" href={pageHref('versions')}>Choose version <ArrowRight size={15} /></a>
            </div>
            {catalogError && <p className="error" role="alert">{catalogError}</p>}
            <div className="nightly-picker">
              <label htmlFor="conversion-mode">Conversion mode</label>
              <select id="conversion-mode" value={mode} disabled={busy} onChange={(event) => setMode(event.target.value as ConversionMode)}>
                <option value="all">{modeLabels.all}</option><option value="basic">{modeLabels.basic}</option><option value="inspect">{modeLabels.inspect}</option>
              </select>
              <p className="nightly-info">{mode === 'basic' ? 'Generate standalone Rust for supported integer and boolean methods.' : mode === 'inspect' ? 'Report metadata and bytecode without generating a port.' : 'Generate supported methods, recipe bundles, and known Horizon startup bindings.'}</p>
            </div>
            <label className="permission browser-permission"><input type="checkbox" checked={authorized} disabled={busy || !items.length} onChange={(event) => {
              const checked = event.target.checked
              setItems((list) => list.map((item) => ({...item, authorized: checked})))
            }} /> I own these mods or have permission to convert them.</label>
            <div className="browser-actions">
              <button className="btn accent" type="button" disabled={!count || !authorized || busy || !!sample || !target} onClick={() => void convert()}>{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />} {busy ? 'Processing batch' : `Convert ${count || ''} ${count === 1 ? 'JAR' : 'JARs'}`}</button>
              {busy ? <button className="btn outline" type="button" onClick={() => {active.current?.controller.abort(); active.current?.worker.terminate()}}>Cancel batch</button>
                : items.length > 0 && <button className="btn plain" type="button" onClick={() => {setItems([]); setSelected(''); setError('')}}>Clear session</button>}
            </div>
          </section>
          <aside className="sidebar"><section className="panel side-panel"><div className="side-title"><LockKeyhole size={19} /><h2>Private by design</h2></div><p>Analysis runs in a WebAssembly worker. Reports and downloads stay in memory until you clear or close the tab.</p></section>
            <section className="panel side-panel"><div className="side-title"><ArrowDownToLine size={19} /><h2>What you get</h2></div><ul className="browser-output-list"><li>Source project and bytecode IR</li><li>Validation and dependency report</li><li>Recipe bundles where supported</li><li>Rust source for recognized methods</li></ul></section>
            <section className="panel side-panel"><div className="side-title"><Code2 size={19} /><h2>Need native validation?</h2></div><p>The self-hosted edition runs the pinned Horizon build and can emit verified native bundles.</p><a href={`${repo}/blob/main/docs/HORIZON.md`}>Toolchain instructions <ArrowRight size={15} /></a></section></aside>
        </div>
        {current?.result && <WorkspaceResults key={current.id} item={current} result={current.result} />}
        <section className="panel result-section explore-tools"><div><h2>Explore the tools</h2><p className="text-muted">Point to a module for a short description, then open its page.</p></div><ModuleBoard hasResults={!!current?.result} /></section>
      </div>

      <div className="browser-screen" hidden={page !== 'versions'}>
        <PageIntro title="Horizon versions" description="Choose the Nightly for your next conversion. Search recent builds and archived source revisions." />
        <div className="page-columns versions-layout"><div className="panel result-section">
          <NightlyPicker catalog={catalog} catalogError={catalogError} catalogUrl={catalogUrl} target={target} selectTarget={setTargetId} busy={busy} />
          <div className="browser-actions"><a className="btn accent" href={pageHref('studio', 'studio')}>Back to Studio <ArrowRight size={16} /></a></div>
        </div><aside className="page-stack">
          <section className="panel result-section">
            <div className="panel-title"><GitBranch size={21} /><h2>Selected build</h2></div>
            {target ? <>
              <h3>{target.label}</h3>
              <TargetDetails target={target} />
              <p className="nightly-info mt-3">This target applies to the next conversion. Completed results keep the revision they used.</p>
              <div className="browser-actions">
                <a className="btn outline compact" href={target.evidence} target="_blank" rel="noreferrer">Release evidence ↗</a>
                <button className="btn plain compact" disabled={busy || !catalog || target.id === catalog.current} onClick={() => catalog && setTargetId(catalog.current)}>Use current Nightly</button>
              </div>
            </> : <p className="text-muted">Choose a build after the catalog loads.</p>}
          </section>
          <section className="panel result-section">
            <h2>Recent and archived</h2>
            <p className="text-muted mt-2">Recent builds cover the last 30 UTC calendar days. As new builds arrive, older records move into the searchable archive. Source revision records are retained.</p>
            <a className="text-link" href={pageHref('guide', 'compatibility')}>Understand compatibility <ArrowRight size={15} /></a>
          </section>
        </aside></div>
      </div>

      <div className="browser-screen" hidden={page !== 'packages'}>
        <PageIntro title="Packages" description="Inspect an existing Horizon package and compare its recorded revisions with your conversion target." />
        <section className="panel result-section" aria-labelledby="session-downloads">
          <div className="panel-title"><ArrowDownToLine size={21} /><h2 id="session-downloads">Downloads from this session</h2><span className="pill ml-auto">{generated.length}</span></div>
          {generated.length ? <ul className="session-downloads">{generated.map(({item, artifact, buffer}) => <li key={`${item.id}-${artifact.name}`}>
            <Package size={20} />
            <div>
              <strong>{artifact.name}</strong>
              <p>{item.file.name} · {bytes(artifact.size)} · {item.result!.report.target.label}</p>
              <span className="pill">{artifact.kind === 'source' ? 'Source project' : artifact.kind === 'hmod' ? 'Recipe candidate' : 'Native package'}</span>
            </div>
            <button className="btn outline compact" aria-label={`Save ${artifact.name}`} disabled={!buffer} onClick={() => {
              if (buffer) download(buffer, artifact.name)
            }}><ArrowDownToLine size={15} /> Download</button>
          </li>)}</ul> : <div className="page-empty">
            <Package size={28} />
            <h3>Your converted files will appear here</h3>
            <p>Start a conversion in Studio, then return to download its generated source projects and supported bundles.</p>
            <a className="btn outline" href={pageHref('studio')}>Go to Studio <ArrowRight size={16} /></a>
          </div>}
        </section>
        <NativePackageInspector base={base} targets={targets} selected={target} busy={busy} chooseTarget={(item) => {
          setTargetId(item.id)
          navigate('versions')
        }} />
        <section className="panel result-section">
          <h2>Which file do I need?</h2>
          <dl className="format-reference">
            <div><dt>Source ZIP</dt><dd>Generated Rust and porting notes to review, build, and extend.</dd></div>
            <div><dt>.hmod</dt><dd>Candidate content or recipe bundle. Run the official package checker before testing.</dd></div>
            <div><dt>.hnmod</dt><dd>Native Rust source package compiled by Horizon. Check its pins and review the code.</dd></div>
          </dl>
          <a className="text-link" href={pageHref('guide', 'guide-packages')}>Read the package guide <ArrowRight size={15} /></a>
        </section>
      </div>

      <div className="browser-screen" hidden={page !== 'ai'}>
        <PageIntro title="AI rewrite" description="Review the JVM instructions for a converted JAR and generate a Rust draft on this device." />
        <DeviceCheck />
        <section className="panel result-section" aria-labelledby="ai-source-title">
          <div className="panel-title"><Code2 size={21} /><h2 id="ai-source-title">Conversion result</h2></div>
          {ready ? <>
            <label className="rewrite-picker" htmlFor="ai-result">JAR to use for the draft</label>
            <select id="ai-result" className="relay-select" value={selected} onChange={(event) => setSelected(event.target.value)}>
              {completed.map((item) => <option key={item.id} value={item.id}>{item.file.name} · {item.result?.report.target.label}</option>)}
            </select>
          </> : <>
            <p className="text-muted">Convert a JAR in Studio first. Completed results will appear here.</p>
            <div className="browser-actions"><a className="btn accent" href={pageHref('studio', 'studio')}>Open Studio <ArrowRight size={16} /></a></div>
          </>}
        </section>
        {completed.map((item) => <div hidden={item.id !== selected} key={item.id}><DeviceRewrite result={item.result!} /></div>)}
        <section className="panel result-section browser-compat" id="self-hosted" aria-labelledby="self-hosted-title">
          <div className="panel-title"><BookOpen size={21} /><h2 id="self-hosted-title">Self-hosted AI</h2></div>
          <p className="text-muted">Run the local edition with Ollama or another compatible inference server. It can draft Rust from reconstructed Java as well as JVM methods.</p>
          <div className="browser-actions"><a className="btn outline" href={`${repo}/blob/main/docs/AI.md`}>Self-hosted setup guide <ArrowRight size={16} /></a></div>
          <a className="text-link" href={pageHref('guide', 'guide-ai')}>Device requirements and walkthrough <ArrowRight size={15} /></a>
        </section>
      </div>

      <div className="browser-screen" hidden={page !== 'guide'}>
        <PageIntro title="Guide" description="Get started with a conversion and learn what to check before installing a package or building a Rust draft." />
        <Guide section={page === 'guide' ? section : undefined} />
      </div>

      <div className="browser-screen" hidden={page !== 'look'}>
        <PageIntro title="Look" description="Adjust the accent color and frosted glass across all HorizonRelay pages." />
        <Appearance />
      </div>
    </main></div>
    <footer className="site-width footer"><strong>HorizonRelay · MIT</strong><a href={repo}>GitHub repository <GitFork size={15} /></a></footer>
  </>
}

function DeviceRewrite({result}: {result: BrowserResult}) {
  return <RewritePanel choices={result.rewriteSources} model="Qwen2.5-Coder 0.5B" device
    unavailable={'gpu' in navigator ? undefined : 'WebGPU is unavailable in this browser. Basic conversion still works.'}
    preview={(id) => result.rewriteSources.find((source) => source.id === id)?.text}
    run={(id, progress, signal) => {
      const source = result.rewriteSources.find((entry) => entry.id === id)
      if (!source) return Promise.reject(new Error('The selected method is unavailable.'))
      return runDeviceRewrite(source, result.report.target.horizonRevision, progress, signal)
    }} />
}

