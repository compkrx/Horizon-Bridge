import { useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Box,
  Braces, Check, ChevronRight, CircleHelp, CloudUpload, Command, FileArchive,
  FlaskConical, Layers3, LoaderCircle, LockKeyhole, ScanLine, Settings2, ShieldCheck, SquareTerminal, X,
} from 'lucide-react'
import { ApiError, api, loadCredentials, saveCredentials, uploadJar, type Config, type Credentials, type Job } from './api'
import { bytes, displayError, displayTime, stageLabel } from './format'
import { previewJar, type Preview } from './preflight'
import { MetadataTable, Results, TargetDetails } from './Results'

const pages = [
  {path: '/', label: 'Convert', Icon: Command},
  {path: '/workspace', label: 'Workspace', Icon: SquareTerminal},
  {path: '/compatibility', label: 'Compatibility', Icon: BookOpen},
  {path: '/settings', label: 'Settings', Icon: Settings2},
  {path: '/help', label: 'Help', Icon: CircleHelp},
]

function currentPath() { return window.location.pathname.replace(/\/$/, '') || '/' }

function Shell({path, config, configError, children}: {path: string; config: Config | null; configError: string; children: React.ReactNode}) {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar">
      <div className="site-width nav-wrap">
        <a href="/" className="brand" aria-label="HorizonBridge home"><img src="/bridge.svg" alt="" width="33" height="33" />Horizon<span>Bridge</span></a>
        <nav aria-label="Main navigation" className="nav-links">
          {pages.map(({path: href, label, Icon}) => <a key={href} href={href} aria-current={href === path ? 'page' : undefined}>
            <Icon size={15} aria-hidden="true" /><span>{label}</span>
          </a>)}
        </nav>
        <span className={`service-pill ${configError ? 'service-off' : ''}`}><span className={config ? 'service-dot online' : 'service-dot'} />{config ? 'API online' : configError ? 'API unavailable' : 'Connecting'}</span>
      </div>
    </header>
    <main className="site-width" id="main" tabIndex={-1}>{children}</main>
    <footer className="site-width footer">
      <div className="flex items-center gap-2"><img src="/bridge.svg" alt="" width="24" height="24" /><strong>HorizonBridge</strong><span className="footer-separator">/</span><span>Java to Horizon</span></div>
      <div className="flex flex-wrap gap-5"><a href="/compatibility">Compatibility</a><a href="/help">Help & privacy</a><a href="https://playhorizon.dev/docs/mods" target="_blank" rel="noreferrer">Horizon docs <ArrowUpRight size={13} /></a></div>
    </footer>
  </>
}

function Voxel({x, y, bright = false}: {x: number; y: number; bright?: boolean}) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M0 18 34 0 68 18 34 36Z" fill={bright ? '#23734b' : '#15241c'} stroke={bright ? '#9ffbc1' : '#4b6657'} />
    <path d="M0 18 34 36V75L0 57Z" fill={bright ? '#153d2b' : '#101b16'} stroke={bright ? '#69d797' : '#4b6657'} />
    <path d="M34 36 68 18V57L34 75Z" fill={bright ? '#1c5838' : '#18291f'} stroke={bright ? '#83f0b0' : '#4b6657'} />
    <path d="M17 9 51 27M17 27 51 9M17 27V66M51 27V66M0 38l34 18 34-18" fill="none" opacity=".34" stroke={bright ? '#affccd' : '#5e816d'} />
  </g>
}

function Hero({config}: {config: Config | null}) {
  const target = config?.targets[0]
  return <section className="hero" aria-labelledby="home-title">
    <div className="hero-copy">
      <div className="eyebrow hero-tag"><span /><span>JAVA EDITION</span><ChevronRight size={13} /> HORIZON NATIVE</div>
      <h1 id="home-title">Convert Java Mods <em>to Horizon</em></h1>
      <p>Upload your Minecraft Java mod and automatically port supported functionality to Horizon's native Rust mod system.</p>
      <div className="hero-actions"><a href="#converter" className="btn accent">Open converter <ArrowDown size={16} /></a><a href="/compatibility" className="btn plain">View compatibility <ArrowUpRight size={16} /></a></div>
    </div>
    <div className="hero-visual" aria-hidden="true">
      <div className="diagram-top"><span><span /> FORMAT BRIDGE</span><span>{target ? `MC ${target.minecraft}` : 'JAVA → RUST'}</span></div>
      <svg className="diagram" viewBox="0 0 394 182" fill="none">
        <defs>
          <pattern id="dots" x="0" y="0" width="17" height="17" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#365343" /></pattern>
          <radialGradient id="glow"><stop offset="0" stopColor="#4bf494" stopOpacity=".2" /><stop offset="1" stopColor="#4bf494" stopOpacity="0" /></radialGradient>
          <linearGradient id="route"><stop offset="0" stopColor="#385c47" /><stop offset="1" stopColor="#99f8be" /></linearGradient>
        </defs>
        <rect x="14" y="0" width="366" height="182" fill="url(#dots)" opacity=".74" />
        <ellipse cx="305" cy="77" rx="91" ry="78" fill="url(#glow)" />
        <path d="m54 115 39-21 39 21-39 22ZM265 115l39-21 39 21-39 22Z" fill="#8bf5b5" fillOpacity=".055" stroke="#6ca286" strokeOpacity=".37" />
        <path d="M127 72h44l13-13h31l13 13h38" stroke="url(#route)" strokeDasharray="4 5" />
        <path d="m254 66 8 6-8 6" stroke="#8ceeb5" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="199" cy="60" r="14" fill="#13291d" stroke="#315940" />
        <path d="m194 60 3 3 6-6" stroke="#9ff5c0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <Voxel x={59} y={37} />
        <Voxel x={270} y={32} bright />
        <text x="93" y="164" textAnchor="middle" fill="#a7bab0" className="diagram-label">.JAR</text>
        <text x="304" y="164" textAnchor="middle" fill="#a6fac6" className="diagram-label">.HNMOD</text>
      </svg>
      <div className="diagram-bottom"><span>01 / JAVA BYTECODE</span><span>02 / NATIVE RUST</span></div>
    </div>
  </section>
}

const workflow = [
  {title: 'Inspect', detail: 'Read metadata, resources, and bytecode.', Icon: ScanLine},
  {title: 'Translate', detail: 'Convert recognized logic and assets.', Icon: Braces},
  {title: 'Validate', detail: 'Check outputs and report coverage.', Icon: ShieldCheck},
]

function Sidebar({config, targetId}: {config: Config | null; targetId: string}) {
  const target = config?.targets.find((item) => item.id === targetId) ?? config?.targets[0]
  return <aside className="sidebar" aria-label="Conversion context">
    <section className="panel side-panel">
      <div className="side-title"><span className="small-icon"><Box size={18} /></span><h2>Target environment</h2></div>
      {target ? <><p className="target-name">{target.label}</p><TargetDetails target={target} /></> : <p className="text-sm text-muted">Target details load from the conversion service.</p>}
    </section>
    <section className="panel side-panel">
      <div className="side-title"><span className="small-icon"><Layers3 size={18} /></span><h2>Conversion pipeline</h2></div>
      <ol className="side-steps">{workflow.map(({title, detail, Icon}, index) => <li key={title}>
        <span className="step-icon"><Icon size={16} /></span><div><h3>{title}</h3><p>{detail}</p></div><span className="mono step-index">0{index + 1}</span>
      </li>)}</ol>
    </section>
    <div className="sidebar-note"><LockKeyhole size={17} /><p>{config ? `Uploads and artifacts expire after ${config.retentionHours} hours.` : 'Uploads and artifacts are temporary.'} Keep a local copy of any result you need.</p></div>
  </aside>
}

type UploadProps = {
  config: Config | null
  configError: string
  targetId: string
  setTargetId: (id: string) => void
  submit: (file: File, ai: boolean) => Promise<void>
  sent: number | null
  busy: boolean
  stop: () => void
  error: string
  resume: Job | null
}

function Upload({config, configError, targetId, setTargetId, submit, sent, busy, stop, error, resume}: UploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview>()
  const [fileError, setFileError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [checking, setChecking] = useState(false)
  const [permission, setPermission] = useState(false)
  const [ai, setAi] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const checkEpoch = useRef(0)

  async function pick(fileToCheck: File | undefined, count = 1) {
    const epoch = ++checkEpoch.current
    setFile(null)
    setPreview(undefined)
    setFileError('')
    setChecking(false)
    if (!fileToCheck) return
    if (count !== 1 || !/\.jar$/i.test(fileToCheck.name)) { setFileError('Choose one file with the .jar extension.'); return }
    if (fileToCheck.size < 4) { setFileError('The JAR is empty or truncated.'); return }
    if (config && fileToCheck.size > config.maxUploadBytes) { setFileError(`The upload limit is ${bytes(config.maxUploadBytes)}.`); return }
    if (resume && (fileToCheck.name !== resume.filename || fileToCheck.size !== resume.size)) { setFileError('Choose the original JAR to resume this upload.'); return }
    setChecking(true)
    try {
      const header = new DataView(await fileToCheck.slice(0, 4).arrayBuffer()).getUint32(0, true)
      if (epoch !== checkEpoch.current) return
      if (header !== 0x04034b50) {
        setFileError('This file lacks a JAR/ZIP archive signature.')
        return
      }
      const metadata = await previewJar(fileToCheck)
      if (epoch === checkEpoch.current) {
        setPreview(metadata)
        setFile(fileToCheck)
      }
    } catch {
      if (epoch === checkEpoch.current) setFileError('The selected file could not be read.')
    } finally {
      if (epoch === checkEpoch.current) setChecking(false)
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (!busy) void pick(event.dataTransfer.files[0], event.dataTransfer.files.length)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (file && permission && config && (targetId || resume) && !busy && file.size <= config.maxUploadBytes) {
      void submit(file, ai && config.aiAvailable)
    }
  }

  return <section className="panel upload-panel" id="converter" aria-labelledby="upload-heading">
    <div className="upload-heading">
      <span className="small-icon"><CloudUpload size={22} /></span>
      <div><h2 id="upload-heading">{resume ? 'Resume upload' : 'Upload a Java mod'}</h2><p>{resume ? 'Select the original file to continue this job.' : 'Select a Minecraft mod archive to get started.'}</p></div>
      <span className="pill mono ml-auto">.JAR</span>
    </div>
    <form onSubmit={onSubmit} className="upload-form">
      <input ref={input} id="jar-file" data-testid="jar-input" type="file" accept=".jar,application/java-archive" className="sr-only" tabIndex={-1} aria-label="Choose a Minecraft Java mod JAR" disabled={busy}
        onChange={(event) => { void pick(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      <div className={`drop-zone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`} onDrop={drop}
        onDragOver={(event) => {event.preventDefault(); if (!busy) setDragging(true)}} onDragLeave={() => setDragging(false)}>
        {file ? <>
          <span className="drop-icon"><FileArchive size={28} /></span>
          <p className="drop-title break-all">{file.name}</p>
          <p className="text-sm text-muted">{bytes(file.size)} · Archive signature detected</p>
          <button type="button" className="btn outline compact" disabled={busy} onClick={() => void pick(undefined)}><X size={14} /> Remove file</button>
        </> : <>
          <span className="drop-icon">{checking ? <LoaderCircle className="spin" size={28} /> : <CloudUpload size={28} />}</span>
          <p className="drop-title">{checking ? 'Reading file…' : 'Drag and drop your .jar here'}</p>
          <p className="text-sm text-muted">{config ? `Single JAR file up to ${bytes(config.maxUploadBytes)}` : 'One Minecraft Java mod archive'}</p>
          <button type="button" className="btn outline compact" disabled={busy} onClick={() => input.current?.click()}>Browse files</button>
        </>}
      </div>
      {preview && <div className="preflight" aria-label="Local metadata preview">
        <div><strong>{preview.name || preview.id || 'Mod metadata'}</strong><p>Local metadata preview</p></div>
        <div className="preflight-tags"><span className="pill">{preview.loader}</span>{preview.version && <span className="pill">{preview.version}</span>}{preview.minecraft && <span className="pill">MC {preview.minecraft}</span>}</div>
      </div>}
      {fileError && <p className="error" role="alert">{fileError}</p>}
      <div className="form-field"><label htmlFor="target">Target Horizon version</label>
        <select id="target" value={resume?.target ?? targetId} onChange={(event) => setTargetId(event.target.value)} disabled={!config || busy || !!resume}>
          {!config?.targets.length && <option value="">{configError ? 'Conversion service unavailable' : 'Loading targets…'}</option>}
          {config?.targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
        </select>
      </div>
      <label className="checkbox-line"><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} disabled={busy} />
        <span>I own this mod or have permission under its licence to translate it.</span></label>
      {config?.aiAvailable && !resume && <label className="checkbox-line"><input type="checkbox" checked={ai} onChange={(event) => setAi(event.target.checked)} disabled={busy} />
        <span>Enable optional AI porting advice for this job. The configured provider receives a bounded report summary when advice is requested.</span></label>}
      {sent !== null && file && <div className="upload-meter"><label htmlFor="upload-meter">Uploading {bytes(sent)} of {bytes(file.size)}</label><progress id="upload-meter" value={sent} max={file.size} /></div>}
      {configError && <p className="error" role="alert">{configError}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="upload-actions">
        <button type="submit" className="btn accent" disabled={!file || !permission || busy || !config?.targets.length || file.size > config.maxUploadBytes}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <Activity size={17} />} {busy ? (sent === null ? 'Preparing upload…' : 'Uploading…') : resume ? 'Continue upload' : 'Start conversion'} {!busy && <ArrowRight size={17} className="ml-auto" />}
        </button>
        {busy && <button type="button" className="btn outline" onClick={stop}>Cancel upload</button>}
        <span className="upload-security"><ShieldCheck size={15} /> Static inspection</span>
      </div>
    </form>
  </section>
}

const terminal = (job: Job | null) => job && ['succeeded', 'failed', 'cancelled'].includes(job.state)

function JobStatus({job, change, busy}: {job: Job; change: (action: 'cancel' | 'retry') => void; busy: boolean}) {
  const processing = job.state === 'queued' || job.state === 'running'
  return <section className="panel status-panel" aria-labelledby="job-heading">
    <div className="panel-title"><SquareTerminal size={23} /><h2 id="job-heading" className="break-all">{job.filename}</h2><span className="pill mono ml-auto">Attempt {job.attempt}</span></div>
    <div className="job-meta"><span>{bytes(job.size)}</span><span>Expires {displayTime(job.expiresAt)}</span></div>
    <div className="current-stage" role="status" aria-live="polite">
      {processing ? <LoaderCircle className="spin" size={19} /> : job.state === 'succeeded' ? <Check size={19} /> : <Activity size={19} />}
      <strong>{stageLabel(job.stage)}</strong>
    </div>
    {job.error && <p className="error" role="alert">{job.error}</p>}
    {job.history.length > 0 && <details className="stage-history" open={processing ? true : undefined}>
      <summary>Processor timeline</summary>
      <ol aria-label="Reported stages">{job.history.map(({stage, at}, index) => <li key={`${stage}-${index}`}><span className="timeline-dot" />{stageLabel(stage)}<time dateTime={at}>{displayTime(at)}</time></li>)}</ol>
    </details>}
    {!terminal(job) && <button type="button" className="btn outline compact mt-4" disabled={busy} onClick={() => change('cancel')}><X size={15} /> Cancel job</button>}
    {job.state === 'failed' && job.retryable && <button type="button" className="btn outline compact mt-4" disabled={busy} onClick={() => change('retry')}>Retry conversion <ArrowRight size={15} /></button>}
  </section>
}

function PageHeading({eyebrow, title, children}: {eyebrow: string; title: string; children: React.ReactNode}) {
  return <div className="page-heading"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{children}</p></div>
}

function Compatibility({config}: {config: Config | null}) {
  return <>
    <PageHeading eyebrow="Reference / 01" title="Compatibility">Inspect source formats, target revisions, and the scope of automatic conversion.</PageHeading>
    <div className="docs-grid">
      <section className="panel result-section"><div className="panel-title"><Box size={21} /><h2>Target versions</h2></div>
        {config?.targets.length ? config.targets.map((target) => <div key={target.id} className="mt-4"><h3>{target.label}</h3><TargetDetails target={target} /></div>) : <p className="text-muted">Target details load from the conversion API.</p>}
      </section>
      <section className="panel result-section"><div className="panel-title"><FileArchive size={21} /><h2>Source loaders</h2></div>
        <p className="text-muted">HorizonBridge reads Fabric, Forge, NeoForge, Quilt, and recognized legacy metadata. Loader detection identifies the source. The results report tracks conversion coverage separately.</p>
        <div className="format-list">{['Fabric', 'Forge', 'NeoForge', 'Quilt', 'Legacy'].map((loader) => <span className="pill" key={loader}>{loader}</span>)}</div>
      </section>
      <section className="panel result-section"><div className="panel-title"><Braces size={21} /><h2>Rust and assets</h2></div>
        <p className="text-muted">Deterministic rules translate supported bytecode constructs. Asset conversion follows the available Horizon resource rules. Mixins, networking, rendering, and game interactions may need a manual implementation.</p>
      </section>
      <section className="panel result-section"><div className="panel-title"><FlaskConical size={21} /><h2>Validation levels</h2></div>
        <p className="text-muted">The report records structure, compilation, packaging, and behavioral checks separately. Review skipped checks and diagnostics before installation.</p>
      </section>
    </div>
    <p className="source-link"><a href="https://playhorizon.dev/docs/make-a-mod" target="_blank" rel="noreferrer">Horizon mod development documentation <ArrowUpRight size={15} /></a></p>
  </>
}

function Settings({config, error, reload}: {config: Config | null; error: string; reload: () => void}) {
  return <>
    <PageHeading eyebrow="Service / 02" title="Settings">View the capabilities configured by the operator of this HorizonBridge instance.</PageHeading>
    <section className="panel result-section settings-panel">
      <div className="panel-title"><Settings2 size={21} /><h2>Processor configuration</h2></div>
      {error && <p className="error" role="alert">{error}</p>}
      {config ? <dl className="target-spec">
        <div><dt>Maximum upload</dt><dd>{bytes(config.maxUploadBytes)}</dd></div>
        <div><dt>Temporary retention</dt><dd>{config.retentionHours} hours</dd></div>
        <div><dt>AI porting advice</dt><dd>{config.aiAvailable ? 'Available per job' : 'Disabled by operator'}</dd></div>
        {config.reconstructionAvailable !== undefined && <div><dt>Java reconstruction</dt><dd>{config.reconstructionAvailable ? 'Available' : 'Unavailable'}</dd></div>}
        {config.nativeValidationAvailable !== undefined && <div><dt>Native validation</dt><dd>{config.nativeValidationAvailable ? 'Available' : 'Unavailable'}</dd></div>}
      </dl> : !error && <p className="text-muted" role="status">Loading service settings…</p>}
      <button className="btn outline compact mt-5" type="button" onClick={reload}>Refresh service settings</button>
    </section>
  </>
}

const questions = [
  ['What can I upload?', 'Choose a Minecraft Java Edition .jar from a mod you own or have permission to translate. Keep the original JAR and any applicable licence notices.'],
  ['What is in each download?', 'A .hnmod contains Rust source that Horizon’s launcher compiles. A .hmod contains supported assets or data. The source archive contains the porting notes and build instructions. The JSON report lists feature coverage and validation.'],
  ['What does Partial port mean?', 'Some features were converted. Review PORTING.md and the report for missing dependencies, untranslated features, and checks to run before installing.'],
  ['Why did a job fail?', 'Open the workspace for the processor message. A failed job can be retried while its source is available if the service displays Retry conversion. For rejected archives, verify the file and submit a fresh copy.'],
  ['How are uploads handled?', 'The service inspects uploaded JARs without executing the mod. A temporary job token in this browser tab grants access to the job. Download any results you need before they expire.'],
  ['Can I trust a native mod immediately?', 'Native mods can execute with your permissions. Inspect the generated Rust, dependencies, and diagnostics before loading a package. Test it against the pinned target in a disposable game profile.'],
]

function Help() {
  return <>
    <PageHeading eyebrow="Support / 03" title="Help and privacy">Understand results, diagnose failed jobs, and handle generated native code.</PageHeading>
    <section className="panel result-section help-panel" aria-label="Frequently asked questions">
      {questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}
    </section>
    <p className="source-link"><a href="https://playhorizon.dev/docs/mods" target="_blank" rel="noreferrer">Official Horizon mod guide <ArrowUpRight size={15} /></a></p>
  </>
}

export function App() {
  const [path, setPath] = useState(currentPath)
  const [config, setConfig] = useState<Config | null>(null)
  const [configError, setConfigError] = useState('')
  const [configReload, setConfigReload] = useState(0)
  const [targetId, setTargetId] = useState('')
  const [credentials, setCredentials] = useState(loadCredentials)
  const [job, setJob] = useState<Job | null>(null)
  const [jobError, setJobError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<number | null>(null)
  const activeUpload = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.config(controller.signal).then((value) => {
      setConfig(value)
      setTargetId((existing) => value.targets.some((target) => target.id === existing) ? existing : (value.targets[0]?.id ?? ''))
      setConfigError('')
    }).catch((error: unknown) => { if (!controller.signal.aborted) setConfigError(displayError(error)) })
    return () => controller.abort()
  }, [configReload])

  useEffect(() => {
    const syncPath = () => setPath(currentPath())
    window.addEventListener('popstate', syncPath)
    return () => window.removeEventListener('popstate', syncPath)
  }, [])

  useEffect(() => {
    if (!credentials || busy || terminal(job)) return
    const controller = new AbortController()
    let timer: number | undefined
    async function poll(current: Credentials) {
      try {
        const snapshot = await api.get(current, controller.signal)
        if (controller.signal.aborted) return
        setJob(snapshot)
        if (!terminal(snapshot)) timer = window.setTimeout(() => void poll(current), 1500)
      } catch (error) {
        if (controller.signal.aborted) return
        setJobError(displayError(error))
        if (error instanceof ApiError && [401, 403, 404, 410].includes(error.status)) {
          saveCredentials(null)
          setCredentials(null)
          setJob(null)
          return
        }
        timer = window.setTimeout(() => void poll(current), 4500)
      }
    }
    void poll(credentials)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [credentials, busy, job?.state])

  function openWorkspace() {
    if (currentPath() !== '/workspace') {
      window.history.pushState({}, '', '/workspace')
      setPath('/workspace')
      window.scrollTo(0, 0)
      requestAnimationFrame(() => document.getElementById('main')?.focus())
    }
  }

  async function submit(file: File, ai: boolean) {
    if (busy) return
    const controller = new AbortController()
    activeUpload.current = controller
    setBusy(true)
    setJobError('')
    let handle: Credentials | null = null
    try {
      let uploadUrl: string
      if (credentials && job?.state === 'awaiting_upload') {
        handle = credentials
        uploadUrl = `/api/jobs/${encodeURIComponent(handle.id)}/upload`
      } else {
        const created = await api.create({filename: file.name, size: file.size, target: targetId, authorized: true, ai})
        handle = {id: created.id, token: created.token}
        uploadUrl = created.uploadUrl
        saveCredentials(handle)
        setCredentials(handle)
        setJob(null)
      }
      setSent(0)
      setJob(await uploadJar(uploadUrl, handle, file, setSent, controller.signal))
      openWorkspace()
    } catch (error) {
      if (controller.signal.aborted) {
        if (handle) {
          try { setJob(await api.change(handle, 'cancel')) }
          catch (problem) { setJobError(displayError(problem)) }
          openWorkspace()
        }
      } else {
        setJobError(displayError(error))
        if (handle) openWorkspace()
      }
    } finally {
      setBusy(false)
      setSent(null)
      activeUpload.current = null
    }
  }

  async function change(action: 'cancel' | 'retry') {
    if (!credentials || busy) return
    setBusy(true)
    setJobError('')
    try { setJob(await api.change(credentials, action)) }
    catch (error) { setJobError(displayError(error)) }
    finally { setBusy(false) }
  }

  function clearJob() {
    saveCredentials(null)
    setCredentials(null)
    setJob(null)
    setJobError('')
  }

  const form = (resume: Job | null) => <Upload key={resume?.id ?? 'new'} config={config} configError={configError} targetId={targetId} setTargetId={setTargetId}
    submit={submit} sent={sent} busy={busy} stop={() => activeUpload.current?.abort()} error={jobError} resume={resume} />
  let content: React.ReactNode
  if (path === '/') content = <><Hero config={config} /><div className="layout">
    {credentials && !activeUpload.current ? <section className="panel status-panel" id="converter"><div className="panel-title"><SquareTerminal size={23} /><h2>Conversion workspace</h2></div>
      <p className="text-muted mb-5">A conversion job is open in this tab. Open the workspace to see its status and available actions.</p>
      <a href="/workspace" className="btn accent">Open workspace <ArrowRight size={16} /></a></section> : form(null)}
    <Sidebar config={config} targetId={targetId} />
  </div></>
  else if (path === '/workspace') content = <>
    <PageHeading eyebrow="Converter / workspace" title="Conversion workspace">Follow reported processor stages, inspect the output, and download your files.</PageHeading>
    <div className="layout workspace-layout">
      <div className="workspace-main">
        {credentials && !job && !activeUpload.current && <div className="panel status-panel" role="status">Loading conversion job…</div>}
        {job && <JobStatus job={job} change={(action) => void change(action)} busy={busy} />}
        {jobError && credentials && job?.state !== 'awaiting_upload' && <p className="error" role="alert">{jobError}</p>}
        {(!credentials || (activeUpload.current && !job)) && form(null)}
        {job?.state === 'awaiting_upload' && form(job)}
        {job && !job.report && job.metadata && <section className="panel result-section"><div className="panel-title"><FileArchive size={21} /><h2>Inspected metadata</h2></div><MetadataTable metadata={job.metadata} /></section>}
        {job && credentials && <Results job={job} credentials={credentials} config={config} />}
        {terminal(job) && <button type="button" className="btn outline" onClick={clearJob}><ArrowLeft size={16} /> New conversion</button>}
      </div>
      <Sidebar config={config} targetId={job?.target ?? targetId} />
    </div>
  </>
  else if (path === '/compatibility') content = <Compatibility config={config} />
  else if (path === '/settings') content = <Settings config={config} error={configError} reload={() => setConfigReload((value) => value + 1)} />
  else if (path === '/help') content = <Help />
  else content = <><PageHeading eyebrow="404" title="Page unavailable">This route does not exist.</PageHeading><a href="/" className="btn accent">Open converter <ArrowRight size={17} /></a></>

  return <Shell path={path} config={config} configError={configError}>{content}</Shell>
}
