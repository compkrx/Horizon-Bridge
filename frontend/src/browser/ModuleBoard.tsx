import { useState, type PointerEvent } from 'react'
import { Blocks, BrainCircuit, GitBranch } from 'lucide-react'
import { pageHref } from './pages'

const groups = [
  {label: 'Converter', Icon: Blocks, modules: [
    ['JAR inspector', 'Read loader metadata and bytecode without launching the mod.', pageHref('studio', 'studio')],
    ['Basic functions', 'Lower supported arithmetic and control flow to Rust.', pageHref('studio', 'conversion-mode')],
    ['Recipe exports', 'Package supported crafting recipes into a candidate Horizon bundle.', pageHref('studio', 'studio')],
    ['Source explorer', 'Read generated Rust and reports before downloading them.', pageHref('studio', 'browser-results')],
  ]},
  {label: 'Rewrite', Icon: BrainCircuit, modules: [
    ['Device model', 'Use this device’s GPU to draft a Rust function in a browser worker.', pageHref('ai')],
    ['Self-hosted AI', 'Connect Ollama or a compatible inference server to rewrite selected Java code.', pageHref('ai', 'self-hosted')],
    ['Review drafts', 'Compare AI-generated Rust with its source before compiling it.', pageHref('guide', 'guide-ai')],
  ]},
  {label: 'Horizon', Icon: GitBranch, modules: [
    ['Nightly targets', 'Choose the exact Horizon revision the conversion should target.', pageHref('versions')],
    ['Archive', 'Find older Nightly targets and their original source snapshots.', pageHref('versions')],
    ['Native packages', 'Inspect the source pins and mixins declared by an existing Horizon package.', pageHref('packages')],
  ]},
] as const

export function ModuleBoard({hasResults}: {hasResults: boolean}) {
  const [detail, setDetail] = useState('Point to a module or focus it to see what it does.')
  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const box = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--relay-rx', `${(0.5 - (event.clientY - box.top) / box.height) * 11}deg`)
    event.currentTarget.style.setProperty('--relay-ry', `${((event.clientX - box.left) / box.width - 0.5) * 14}deg`)
  }
  return <div className="module-board" onPointerMove={tilt} onPointerLeave={(event) => {
    event.currentTarget.style.removeProperty('--relay-rx')
    event.currentTarget.style.removeProperty('--relay-ry')
  }}>
    <div className="module-columns">{groups.map(({label, Icon, modules}) => <section key={label} className="module-group">
      <h2><Icon size={16} /> {label}</h2>
      <ul>{modules.map(([name, description, path]) => <li key={name}>
        <a href={path === pageHref('studio', 'browser-results') && !hasResults ? pageHref('studio', 'studio') : path}
          onPointerEnter={() => setDetail(description)} onFocus={() => setDetail(description)} aria-label={`${name} — ${description}`}>{name}</a>
      </li>)}</ul>
    </section>)}</div>
    <p className="module-detail" role="status">{detail}</p>
  </div>
}
