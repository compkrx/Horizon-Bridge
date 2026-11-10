import { useState } from 'react'
import { ArrowDownToLine, Search } from 'lucide-react'
import type { NightlyCatalog, NightlyTarget } from './types'

interface Props {
  catalog?: NightlyCatalog
  catalogError: string
  catalogUrl: string
  target?: NightlyTarget
  selectTarget: (id: string) => void
  busy: boolean
}

function matches(target: NightlyTarget, terms: string[]) {
  const minecraft = target.minecraft?.toLowerCase()
  const fields = [target.label, target.id, target.date, target.horizonRevision, target.mixinsRevision, `minecraft mc ${minecraft ?? 'unconfirmed'}`]
  return terms.every((term) => /^\d+(?:\.\d+)+$/.test(term)
    ? minecraft === term
    : fields.some((field) => field?.toLowerCase().includes(term)))
}

export function NightlyPicker({catalog, catalogError, catalogUrl, target, selectTarget, busy}: Props) {
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const cutoff = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const searching = terms.length > 0
  const targets = catalog?.targets ?? []
  const recent = targets.filter((item) => item.date >= cutoff)
  const archived = targets.filter((item) => item.date < cutoff)
  const showOld = searching || showArchived || Boolean(target && target.date < cutoff)
  const visibleRecent = searching ? recent.filter((item) => matches(item, terms)) : recent
  const visibleArchived = showOld ? archived.filter((item) => !searching || matches(item, terms)) : []
  const matchingCount = visibleRecent.length + visibleArchived.length
  const activeOutsideSearch = searching && target && !matches(target, terms)
  const option = (item: NightlyTarget) => <option key={item.id} value={item.id}>{item.label}{item.id === catalog?.current ? ' · Current' : ''}</option>

  return <section className="nightly-picker" id="versions" aria-label="Conversion target">
    <div className="nightly-heading">
      <label htmlFor="nightly-target">Horizon Nightly target</label>
      {catalog && <a className="btn outline compact nightly-download" href={catalogUrl} download="horizon-nightlies.json" aria-describedby="nightly-export-detail"><ArrowDownToLine size={15} /> Download full catalog (JSON)</a>}
    </div>
    {catalog && <>
      <p id="nightly-export-detail" className="nightly-info">Includes all {targets.length} catalog entries and their pinned revisions, even when the picker is filtered.</p>
      <div className="nightly-search-row">
        <label className="nightly-search" htmlFor="nightly-search">
          <Search size={16} /> <span className="sr-only">Search Nightlies</span>
          <input id="nightly-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Hash, YYYY-MM-DD, or Minecraft version" aria-describedby="nightly-search-summary" disabled={busy} />
        </label>
        <button className="btn plain compact" type="button" disabled={busy || !query} onClick={() => setQuery('')}>Clear search</button>
      </div>
      <p className="nightly-info" id="nightly-search-summary" role="status">{searching
        ? (matchingCount ? `${matchingCount} of ${targets.length} Nightlies match across recent and archived entries.` : 'No Nightlies match. The selected target is still active.')
        : 'Search covers recent and archived entries.'}</p>
    </>}
    <select id="nightly-target" value={target?.id ?? ''} onChange={(event) => selectTarget(event.target.value)} disabled={busy || !catalog}>
      {!catalog && <option value="">{catalogError ? 'Catalog unavailable' : 'Loading Nightlies…'}</option>}
      {activeOutsideSearch && <optgroup label="Selected target outside search">{option(target)}</optgroup>}
      {visibleRecent.length > 0 && <optgroup label="Last 30 days">{visibleRecent.map(option)}</optgroup>}
      {visibleArchived.length > 0 && <optgroup label="Archived Nightlies">{visibleArchived.map(option)}</optgroup>}
    </select>
    {catalogError && <p className="error" role="alert">{catalogError}</p>}
    {catalog && <div className="nightly-meta">
      <label className="permission"><input type="checkbox" checked={showOld} disabled={busy || searching || !archived.length || !recent.length} onChange={(event) => {
        setShowArchived(event.target.checked)
        if (!event.target.checked && target && target.date < cutoff) selectTarget(recent[0]?.id ?? catalog.current)
      }} /> Show archived Nightlies ({archived.length})</label>
      {target && <a href={`https://github.com/horizon-rust/horizon/tree/${target.horizonRevision}`} target="_blank" rel="noreferrer">Pinned source ↗</a>}
    </div>}
    {target && <p className="nightly-info">{target.minecraft ? `Minecraft ${target.minecraft}` : 'Minecraft version unconfirmed'} · {target.nativeStartup ? 'Startup source available' : 'Startup hook unconfirmed'} · {target.contentApi === '0.2' && target.minecraft === '26.3' ? 'Recipe export available' : 'Recipe export unconfirmed'}</p>}
  </section>
}
