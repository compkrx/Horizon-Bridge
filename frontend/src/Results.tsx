import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Archive, ArrowDownToLine, Braces, Check, FileCode2, FileText, Folder, LoaderCircle, Shield, Sparkles } from 'lucide-react'
import { api, type Artifact, type Config, type Credentials, type FileInfo, type Job, type Metadata, type Target } from './api'
import { bytes, displayError, displayValue } from './format'
import { RewritePanel } from './RewritePanel'
import type { RewriteChoice } from './rewrite'

const artifactDetails = {
  hnmod: {title: 'Horizon native mod', description: 'Rust source the Horizon launcher compiles on your system.', Icon: Braces},
  hmod: {title: 'Horizon asset mod', description: 'Converted resources for Horizon’s asset mod system.', Icon: Archive},
  source: {title: 'Source project', description: 'Generated source, PORTING.md, and reproducible build instructions.', Icon: Folder},
  report: {title: 'Conversion report', description: 'Machine-readable metadata, coverage, and validation results.', Icon: FileText},
}

export function MetadataTable({metadata}: {metadata: Metadata}) {
  const fields: [string, unknown][] = [
    ['Name', metadata.name], ['Mod ID', metadata.id], ['Mod version', metadata.version],
    ['Minecraft', metadata.minecraft], ['Source loader', metadata.loader], ['Author', metadata.author],
    ['Licence', metadata.license], ['Dependencies', metadata.dependencies], ['Java entry points', metadata.entrypoints],
  ]
  return <>
    {metadata.description && <p className="break-words text-muted mb-4">{metadata.description}</p>}
    <dl className="data-grid">
      {fields.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{displayValue(value)}</dd></div>)}
    </dl>
  </>
}

export function TargetDetails({target}: {target: Target}) {
  return <dl className="target-spec">
    <div><dt>Minecraft</dt><dd>{target.minecraft ?? 'Unknown'}</dd></div>
    <div><dt>Horizon</dt><dd title={target.horizonRevision}>{target.horizonRevision?.slice(0, 12) || 'Unknown'}</dd></div>
    <div><dt>Mixins</dt><dd title={target.mixinsRevision ?? undefined}>{target.mixinsRevision?.slice(0, 12) || 'Unknown'}</dd></div>
    <div><dt>Hook API</dt><dd>{target.hookApi ?? 'Unknown'}</dd></div>
  </dl>
}

export interface ArtifactAccess {
  file(path: string, signal: AbortSignal): Promise<string>
  download(artifact: Artifact): Promise<void>
}

function DownloadButton({artifact, access}: {artifact: Artifact; access: ArtifactAccess}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const {title, description, Icon} = artifactDetails[artifact.kind]
  async function download() {
    setError('')
    setBusy(true)
    try { await access.download(artifact) }
    catch (problem) { setError(displayError(problem)) }
    finally { setBusy(false) }
  }
  return <div className="artifact">
    <div className="artifact-row">
      <span className="small-icon"><Icon size={18} /></span>
      <div className="min-w-0 grow">
        <h4>{title} <span className="mono size-label">{bytes(artifact.size)}</span></h4>
        <p className="mono break-all text-xs text-soft">{artifact.name}</p>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <button type="button" className="btn outline compact" onClick={() => void download()} disabled={busy} aria-label={`Download ${title}`}>
        {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}
        <span className="hidden sm:inline">Download</span>
      </button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}

const codeTokens = /(\/\*[^]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:use|pub|fn|mod|let|mut|struct|enum|impl|trait|where|if|else|match|loop|for|while|in|return|break|continue|const|unsafe|extern|as|move|type|self|Self|true|false|null)\b|\b\d[\d_.]*\b)/g

function HighlightedCode({value, path}: {value: string; path: string}) {
  if (!/\.(?:rs|java|toml|json)$/i.test(path)) return <code>{value}</code>
  return <code>{value.split(codeTokens).map((token, index) => {
    if (index % 2 === 0) return token
    let kind = 'keyword'
    if (/^(?:\/[/\*]|#)/.test(token)) kind = 'comment'
    else if (/^["']/.test(token)) kind = 'literal'
    else if (/^\d/.test(token)) kind = 'number'
    return <span key={index} className={`code-${kind}`}>{token}</span>
  })}</code>
}

function SourceExplorer({access, files}: {access: ArtifactAccess; files: FileInfo[]}) {
  const [path, setPath] = useState(files.find((file) => file.path.endsWith('lib.rs'))?.path ?? files.find((file) => file.path.endsWith('.rs'))?.path ?? files[0]?.path ?? '')
  const [source, setSource] = useState<{path: string; value?: string; error?: string} | null>(null)
  const current = source?.path === path ? source : null
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    access.file(path, controller.signal)
      .then((value) => setSource({path, value}))
      .catch((error: unknown) => { if (!controller.signal.aborted) setSource({path, error: displayError(error)}) })
    return () => controller.abort()
  }, [access, path])
  return <section className="panel result-section" aria-labelledby="source-heading">
    <div className="panel-title"><FileCode2 size={21} /><h3 id="source-heading">Source explorer</h3><span className="pill ml-auto">Read only</span></div>
    <div className="explorer">
      <ul aria-label="Generated files" className="explorer-files">
        {files.map((file) => <li key={file.path}><button type="button" aria-pressed={file.path === path} onClick={() => setPath(file.path)}>
          <FileText size={14} aria-hidden="true" /><span>{file.path}</span>
        </button></li>)}
      </ul>
      <div className="explorer-preview">
        <div className="explorer-path mono">{path}</div>
        {current?.error ? <p className="error" role="alert">{current.error}</p> : current?.value !== undefined
          ? <pre tabIndex={0} aria-label={`Source of ${path}`}><HighlightedCode value={current.value} path={path} /></pre>
          : <p className="explorer-loading" role="status">Loading file…</p>}
      </div>
    </div>
  </section>
}

function Advice({credentials}: {credentials: Credentials}) {
  const [pending, setPending] = useState(false)
  const [advice, setAdvice] = useState('')
  const [error, setError] = useState('')
  async function fetchAdvice() {
    setPending(true)
    setError('')
    try { setAdvice((await api.advice(credentials)).advice) }
    catch (problem) { setError(displayError(problem)) }
    finally { setPending(false) }
  }
  return <section className="panel result-section" aria-labelledby="advice-heading">
    <div className="panel-title"><Sparkles size={21} /><h3 id="advice-heading">AI porting advice</h3></div>
    <p className="text-sm text-muted mb-4">Request suggestions based on this job’s report. Review any proposed changes before applying them.</p>
    <button className="btn outline" type="button" disabled={pending} onClick={() => void fetchAdvice()}>
      {pending ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} {pending ? 'Requesting advice…' : 'Get porting advice'}
    </button>
    {error && <p className="error" role="alert">{error}</p>}
    {advice && <pre className="advice" tabIndex={0}>{advice}</pre>}
  </section>
}

function ServerRewrite({credentials}: {credentials: Credentials}) {
  const [sources, setSources] = useState<RewriteChoice[]>([])
  const [model, setModel] = useState('')
  const [notice, setNotice] = useState('Loading rewrite sources…')
  useEffect(() => {
    const controller = new AbortController()
    api.rewriteSources(credentials, controller.signal).then((value) => {
      setSources(value.sources)
      setModel(value.model)
      setNotice('')
    }).catch((error: unknown) => {if (!controller.signal.aborted) setNotice(displayError(error))})
    return () => controller.abort()
  }, [credentials])
  return <RewritePanel choices={sources} model={model} unavailable={notice} run={(id, _, signal) => api.rewrite(credentials, id, signal)} />
}

const resultLabels = {verified: 'Verified package', partial: 'Partial port', unsupported: 'Unsupported'}
const resultDescriptions = {
  verified: 'The generated package passed its applicable technical checks. Review the behavioral validation before use.',
  partial: 'Some functionality was translated. Use the report to see what still requires development or testing.',
  unsupported: 'HorizonRelay could not produce a meaningful port with the current conversion rules. The report identifies the blockers.',
}

export function Results({job, credentials, config, access: localAccess}: {job: Job; credentials?: Credentials; config: Config | null; access?: ArtifactAccess}) {
  const access = useMemo(() => localAccess ?? {
    file: (path: string, signal: AbortSignal) => credentials ? api.file(credentials, path, signal) : Promise.reject(new Error('Source is unavailable.')),
    download: (artifact: Artifact) => credentials ? api.download(credentials, artifact) : Promise.reject(new Error('Download is unavailable.')),
  }, [credentials, localAccess])
  const report = job.report
  if (!report) return null
  const format = job.artifacts.filter((item) => item.kind === 'hmod' || item.kind === 'hnmod').map((item) => `.${item.kind}`).join(' + ')
  const verified = report.classification === 'verified'
  const ResultIcon = verified ? Check : AlertTriangle
  return <div className="results" aria-labelledby="results-heading">
    <div className={`panel result-banner ${report.classification}`}>
      <span className="small-icon"><ResultIcon size={23} /></span>
      <div className="min-w-0"><p className="eyebrow">Conversion results</p><h2 id="results-heading">{report.mode === 'inspect' ? 'Inspection complete' : resultLabels[report.classification]}</h2><p>{report.mode === 'inspect' ? 'The report describes the JAR without generating conversion code or content bundles.' : resultDescriptions[report.classification]}</p></div>
    </div>
    <section className="panel result-section" aria-labelledby="artifacts-heading">
      <div className="panel-title"><ArrowDownToLine size={21} /><h3 id="artifacts-heading">Downloads</h3></div>
      {job.artifacts.some((artifact) => artifact.kind === 'hnmod') && <div className="note warning"><Shield size={20} /><p>Native mods can run with your permissions. Review the generated Rust source and its dependencies before installing.</p></div>}
      {localAccess && job.artifacts.some((artifact) => artifact.kind === 'hmod') && <div className="note warning"><Shield size={20} /><p>The browser recipe bundle is a candidate. Check it with Horizon’s tools before installing.</p></div>}
      {job.artifacts.length ? job.artifacts.map((artifact) => <DownloadButton key={artifact.name} artifact={artifact} access={access} />)
        : <p className="text-muted">This job has no downloadable artifacts.</p>}
    </section>
    <div className="results-grid">
      <section className="panel result-section" aria-labelledby="metadata-heading">
        <div className="panel-title"><FileText size={21} /><h3 id="metadata-heading">Source metadata</h3></div>
        <MetadataTable metadata={report.metadata} />
      </section>
      <section className="panel result-section" aria-labelledby="destination-heading">
        <div className="panel-title"><Archive size={21} /><h3 id="destination-heading">Formats and target</h3></div>
        <dl className="target-spec">
          <div><dt>Source archive</dt><dd>.jar · {bytes(report.inputBytes ?? job.size)}</dd></div>
          <div><dt>Target artifacts</dt><dd>{format || 'Report / source only'}</dd></div>
        </dl>
        <TargetDetails target={report.target} />
      </section>
    </div>
    <section className="panel result-section" aria-labelledby="coverage-heading">
      <div className="panel-title"><Braces size={21} /><h3 id="coverage-heading">Feature coverage</h3></div>
      {report.features.length ? <ul className="outcomes">{report.features.map((feature, index) => <li key={`${feature.name}-${index}`}>
        <span className={`status-chip ${feature.status}`}>{feature.status}</span>
        <div><strong>{feature.name}</strong><p>{feature.detail}</p></div>
      </li>)}</ul> : <p className="text-muted">No convertible features were reported.</p>}
      {report.missingDependencies.length > 0 && <div className="subsection"><h4>Missing dependencies</h4><ul>{report.missingDependencies.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    </section>
    <section className="panel result-section" aria-labelledby="validation-heading">
      <div className="panel-title"><Shield size={21} /><h3 id="validation-heading">Validation and diagnostics</h3></div>
      {report.validation.length ? <ul className="outcomes">{report.validation.map((check, index) => <li key={`${check.name}-${index}`}>
        <span className={`status-chip ${check.status}`}>{check.status}</span>
        <div><strong>{check.name}</strong><p>{check.detail}</p></div>
      </li>)}</ul> : <p className="text-muted">No validation checks were reported.</p>}
      {report.diagnostics.length > 0 && <div className="subsection"><h4>Compiler diagnostics</h4><pre tabIndex={0}>{report.diagnostics.join('\n\n')}</pre></div>}
      {report.warnings.length > 0 && <div className="subsection"><h4>Warnings</h4><ul>{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    </section>
    {job.files.length > 0 && <SourceExplorer key={job.id} files={job.files} access={access} />}
    {job.ai && config?.aiAvailable && credentials && <><ServerRewrite key={job.id} credentials={credentials} /><Advice credentials={credentials} /></>}
  </div>
}
