import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, FileSearch, LoaderCircle, Package } from 'lucide-react'
import { bytes } from '../format'
import type { NativePackageReport, PackageInspectionMessage } from './package-inspection'
import type { NightlyTarget } from './types'

function saveReport(report: NativePackageReport) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], {type: 'application/json'}))
  const link = document.createElement('a')
  link.href = href
  link.download = `${report.id}-native-package-report.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 5000)
}

function targetSummary(report: NativePackageReport, selected?: NightlyTarget) {
  if (!selected) return 'Choose a target Nightly to compare against these declarations.'
  if (selected.minecraft && selected.minecraft !== report.game) return `This package declares Minecraft ${report.game}. The selected Nightly is Minecraft ${selected.minecraft}.`
  if (selected.horizonRevision === report.horizonRevision) {
    if (selected.mixinsRevision && selected.mixinsRevision !== report.mixinsRevision) return 'Horizon revision matches. The recorded Mixins revisions differ.'
    return selected.mixinsRevision ? 'The selected Nightly matches both recorded revisions.' : 'Horizon revision matches. This Nightly’s Mixins revision is unconfirmed.'
  }
  if (report.hookApi !== null && typeof selected.hookApi === 'number') {
    if (selected.hookApi < report.hookApi) return `The selected Nightly’s hook API ${selected.hookApi} is below the package’s declared minimum ${report.hookApi}.`
    return `The selected Nightly has hook API ${selected.hookApi}. The package declares ${report.hookApi}. Its tested Horizon revision differs.`
  }
  return 'The selected Nightly differs from the package’s recorded Horizon revision.'
}

export function NativePackageInspector({base, targets, selected, chooseTarget, busy}: {
  base: string; targets: NightlyTarget[]; selected?: NightlyTarget; chooseTarget: (target: NightlyTarget) => void; busy: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const active = useRef<(() => void) | null>(null)
  const [filename, setFilename] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState<NativePackageReport>()
  const [query, setQuery] = useState('')
  useEffect(() => () => active.current?.(), [])

  function inspect(file: File) {
    setReport(undefined)
    setQuery('')
    setError('')
    setFilename(file.name)
    if (!/\.hnmod$/i.test(file.name) || file.size < 4 || file.size > 32 * 1024 * 1024) {
      setError('Select a .hnmod archive between 4 bytes and 32 MiB.')
      return
    }
    let worker: Worker
    try { worker = new Worker(new URL('./native-package.worker.ts', import.meta.url), {type: 'module'}) }
    catch { setError('This browser could not start the package worker.'); return }
    function clean() {
      worker.terminate()
      window.clearTimeout(timer)
      active.current = null
    }
    function fail(message: string) {
      clean()
      setError(message)
      setStatus('')
    }
    const timer = window.setTimeout(() => fail('Package inspection exceeded its 90-second budget.'), 90_000)
    active.current = clean
    setStatus('Loading the package inspection engine…')
    worker.onmessage = ({data}: MessageEvent<PackageInspectionMessage>) => {
      if (active.current !== clean) return
      if ('status' in data) setStatus(data.status)
      else if ('error' in data) fail(data.error)
      else { clean(); setReport(data.result); setStatus('') }
    }
    worker.onerror = () => { if (active.current === clean) fail('The package worker stopped unexpectedly.') }
    worker.postMessage({base, file})
  }

  const match = report && targets.find((target) => target.horizonRevision === report.horizonRevision)
  const filtered = report?.paths.filter((path) => path.toLowerCase().includes(query.trim().toLowerCase())) ?? []
  return <section className="panel result-section browser-compat" id="native-package" aria-labelledby="native-package-title">
    <div className="panel-title"><Package size={21} /><h2 id="native-package-title">Native package inspector</h2><span className="pill ml-auto">Static analysis</span></div>
    <p className="text-muted">Open a .hnmod to see its pinned build, mixin declarations, and bundled notices. The file stays in this tab. Inspection does not build or run the mod.</p>
    <div className="browser-actions">
      <button className="btn accent" type="button" disabled={!!status} onClick={() => input.current?.click()}><FileSearch size={16} /> Inspect a .hnmod</button>
      <input ref={input} type="file" accept=".hnmod" aria-label="Native package file" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file && !active.current) inspect(file)
      }} />
      {status && <button className="btn outline" type="button" onClick={() => {active.current?.(); setStatus('')}}>Cancel inspection</button>}
      {report && <button className="btn outline" type="button" onClick={() => saveReport(report)}><ArrowDownToLine size={16} /> Download package report</button>}
      {!status && filename && <button className="btn plain" type="button" onClick={() => {setReport(undefined); setFilename(''); setQuery(''); setError('')}}>Clear package</button>}
      {filename && <span className="text-muted break-all">{filename}</span>}
    </div>
    {status && <p className="text-muted mt-3" role="status"><LoaderCircle size={16} className="spin inline" /> {status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {report && <div className="native-package-report mt-5">
      <h3>{report.id} · {report.version}</h3>
      <dl className="browser-metrics mt-3">
        <div><dt>Minecraft</dt><dd>{report.game}</dd></div>
        <div><dt>Rust files</dt><dd>{report.rustFiles}</dd></div>
        <div><dt>Declared modules</dt><dd>{report.modules}</dd></div>
        <div><dt>Declared injections</dt><dd>{report.injections}</dd></div>
        <div><dt>Expanded size</dt><dd>{bytes(report.expandedBytes)}</dd></div>
      </dl>
      <dl className="data-grid mt-4">
        <div><dt>Horizon revision</dt><dd className="mono break-all">{report.horizonRevision}</dd></div>
        <div><dt>Mixins revision</dt><dd className="mono break-all">{report.mixinsRevision}</dd></div>
        <div><dt>Declared hook API</dt><dd>{report.hookApi ?? 'Undeclared'}</dd></div>
        <div><dt>Package SHA-256</dt><dd className="mono break-all">{report.sha256}</dd></div>
      </dl>
      <p className="text-muted mt-3">{targetSummary(report, selected)} Confirm compatibility with Horizon’s official tools before installing.</p>
      {match && <button className="btn outline compact mt-3" type="button" disabled={busy} onClick={() => chooseTarget(match)}>Select {match.label}</button>}
      <div className="mt-4"><strong>Bundled notices</strong>{report.noticeFiles.length ? <ul className="inventory-list mono">{report.noticeFiles.map((path) => <li key={path}>{path}</li>)}</ul> : <p className="text-muted">No license or notice file was found in this archive.</p>}</div>
      {report.declaredInjections.length > 0 && <details className="browser-inventory"><summary>Declared injection targets ({report.injections})</summary>
        {report.declaredInjections.length < report.injections && <p className="text-muted text-sm">Showing the first {report.declaredInjections.length} declarations.</p>}
        <ul className="inventory-list mono">{report.declaredInjections.map(({id, kind, target, hook, hookVersion, cancellable}, index) => <li key={index}><span>{id || 'Unnamed'}</span><span>{kind} {hook ? `Hook ${hook}${hookVersion ? ` v${hookVersion}` : ''}` : target}{cancellable ? ' · Cancellable' : ''}</span></li>)}</ul>
      </details>}
      <details className="browser-inventory"><summary>Package files ({report.entries})</summary>
        <div className="inventory-controls"><label><FileSearch size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by path" aria-label="Filter native package files" /></label></div>
        <p className="text-muted text-sm">{filtered.length} matches in the first {report.paths.length} of {report.entries} paths.</p>
        <ul className="inventory-list mono">{filtered.map((path) => <li key={path}>{path}</li>)}</ul>
      </details>
    </div>}
  </section>
}
