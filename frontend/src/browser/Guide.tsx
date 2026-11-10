import { useState } from 'react'
import { ArrowRight, BookOpen, Search } from 'lucide-react'
import { pageHref } from './pages'

const topics = [
  {id: 'start', title: 'Your first conversion', summary: 'From a Java JAR to a reviewable source project.', steps: [
    'Open Studio and choose a JAR, or try one of the three original example mods. A batch holds up to 12 files, each up to 32 MiB.',
    'Open Versions and choose the Horizon Nightly you use. Return to Studio and pick All supported conversions, Basic functions only, or Inspect only.',
    'Confirm that you have permission to convert the files, then start the batch. You can visit other pages while it processes.',
    'Open each result. Read the coverage, missing dependencies, warnings, and validation checks. Use the source explorer to inspect the generated code.',
    'Download the source project and report. Open Packages for the downloads produced during this session, or AI to draft a selected method.',
  ], note: 'Switching pages keeps the current session. Reloading or closing the tab clears the JARs and generated results.', action: 'Open Studio', page: 'studio' as const},
  {id: 'guide-packages', title: 'Packages and installation', summary: 'Understand source projects, recipe bundles, and native mods.', steps: [
    'A source ZIP contains generated Rust, the bytecode representation, PORTING.md, and reports. Build and review it with the pinned Horizon toolchain.',
    'A browser .hmod is a candidate recipe bundle. Its report explains which recipes were exported and which resources were skipped.',
    'A .hnmod contains native Rust source that Horizon compiles into the client. Open an existing package in Packages to read its Horizon and Mixins pins, declared injections, and SHA-256 fingerprint.',
    'Use cargo horizon-mod check with the matching official tools. Read the package’s notices and test it in a disposable instance before using a world you care about.',
  ], note: 'Matching revision pins identifies the intended target. Compilation and in-game behavior need their own checks.', action: 'Open Packages', page: 'packages' as const},
  {id: 'guide-ai', title: 'AI on your PC or phone', summary: 'Use a WebGPU model to draft small Rust functions.', steps: [
    'Convert a JAR in Studio, open AI, and choose a completed result. The source menu lists the decoded JVM methods available to the model.',
    'Use Check this device to test whether this browser can obtain a WebGPU adapter. Available memory and the size of the selected method also affect success.',
    'Inspect the selected input, then generate a draft. The initial run downloads roughly 300 MB of model files and uses your device’s GPU and memory.',
    'Leave the tab open. Where supported, enable Keep the screen awake. Browsers can suspend background tabs, and phones may stop processing when the screen locks.',
    'Read the generated Rust alongside the input. Download the draft, adapt the Horizon bindings, and compile and test it with the matching target.',
  ], note: 'The browser model drafts one eligible method at a time. Complex rendering, networking, Java libraries, and Mixins still require integration work.', action: 'Open AI', page: 'ai' as const},
  {id: 'guide-local', title: 'Self-hosted AI and native builds', summary: 'Use your own inference server and the full toolchain.', steps: [
    'Clone the repository. Install the Python requirements and frontend dependencies, then run python scripts/dev.py from the repository root.',
    'Configure Ollama or a compatible inference server using docs/AI.md. The host stores its model credentials and sends the selected source to that configured server.',
    'Enable AI for a conversion job in the local edition. After conversion, choose a reconstructed Java file or decoded JVM method for the draft.',
    'Configure Vineflower to reconstruct eligible Java source. Use the pinned isolated processor profile for official mixin, Cargo, and native package checks.',
    'Read docs/HORIZON.md and docs/DEPLOYMENT.md for the required revisions, tool commands, and runtime settings.',
  ], note: 'The browser edition works on a static website. The local edition supplies the host tools and inference-server connection.', action: 'Read AI setup', href: 'https://github.com/horizonrelay/horizonrelay.github.io/blob/main/docs/AI.md'},
  {id: 'compatibility', title: 'What can be converted?', summary: 'Match the conversion mode and output to your source.', steps: [
    'Inspection reads Fabric, Forge, NeoForge, Quilt, and recognized legacy metadata, together with bounded archive and bytecode information.',
    'Basic functions translates the supported static integer and boolean bytecode subset. The report names the methods and instructions it could handle.',
    'All supported conversions adds recognized startup bindings and eligible shaped or shapeless vanilla-item recipes on confirmed Minecraft 26.3 targets.',
    'General Java Mixins, callbacks, custom commands, HUD code, configuration, rendering, and networking need API-specific Rust implementations. Use the detected features and diagnostics as a porting checklist.',
    'Verified, Partial, and Unsupported describe the checks and coverage in the report. Read each validation entry to see which checks passed, failed, or were skipped.',
  ], note: 'Choose the exact Nightly used by your Horizon instance. Older source revisions remain searchable in the archive.', action: 'Choose a version', page: 'versions' as const},
  {id: 'troubleshooting', title: 'Fix a failed conversion', summary: 'Recover a batch, missing download, or model failure.', steps: [
    'If loading the engine fails, check the connection and requeue the JAR. The first conversion downloads the WebAssembly runtime.',
    'If an archive is rejected, check its extension, size, and ZIP structure. Encrypted files, excessive expansion, or malformed entries can exceed inspection limits.',
    'If a method is unsupported, read its diagnostics and try a Rust draft from AI. Keep the source and its matching target revision when making a manual port.',
    'If WebGPU is unavailable, check the browser’s GPU support and hardware acceleration. A WebGPU adapter alone does not guarantee enough memory for the model.',
    'If you changed the target or conversion mode, requeue the completed JAR in Studio. Existing results retain the settings used to produce them.',
  ], note: 'Download reports and source files before reloading the tab. They make a bug report easier to reproduce.', action: 'Report an issue', href: 'https://github.com/compkrx/Horizon-Bridge/issues'},
  {id: 'privacy', title: 'Files, permissions, and privacy', summary: 'Where your files go and what the browser retains.', steps: [
    'The public browser studio reads JARs and packages in workers on your device. It downloads its runtime and optional model from the network.',
    'Input files and generated results remain in the current tab’s memory. Download anything you need to keep before closing or reloading.',
    'Appearance preferences are saved in this browser’s local storage. Reset them from Look.',
    'The self-hosted edition uploads JARs to your configured conversion host. Its retention settings and inference-server destination appear in that edition’s configuration.',
    'Convert code you own or have permission to port. Preserve source licenses and third-party notices in anything you distribute.',
  ], note: 'An archive inspection reads declarations and file contents. Review source and the relevant validation results before installing generated code.', action: 'Change appearance', page: 'look' as const},
] as const

export function Guide({section}: {section?: string}) {
  const [query, setQuery] = useState('')
  const topic = topics.find((item) => item.id === section) ?? topics[0]
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = topics.filter((item) => terms.every((term) => [item.title, item.summary, ...item.steps, item.note].join(' ').toLowerCase().includes(term)))
  return <div className="page-columns guide-layout">
    <aside className="panel result-section guide-topics">
      <h2>Find a guide</h2>
      <label className="nightly-search mt-3"><Search size={16} /><input type="search" aria-label="Search guides" placeholder="Search setup, AI, packages…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <p className="text-muted text-sm mt-2" role="status">{matches.length} guides found</p>
      <nav aria-label="Guide topics">{matches.map((item) => <a key={item.id} href={pageHref('guide', item.id)} aria-current={topic.id === item.id ? 'page' : undefined}><strong>{item.title}</strong><span>{item.summary}</span></a>)}</nav>
      {!matches.length && <button className="btn outline compact mt-3" onClick={() => setQuery('')}>Clear guide search</button>}
    </aside>
    <article className="panel result-section guide-article" id={topic.id}>
      <div className="panel-title"><BookOpen size={21} /><h2>{topic.title}</h2></div>
      <p className="text-muted">{topic.summary}</p>
      <ol className="guide-steps">{topic.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <p className="page-notice">{topic.note}</p>
      <div className="browser-actions"><a className="btn accent" href={'href' in topic ? topic.href : pageHref(topic.page)}>{topic.action}<ArrowRight size={16} /></a></div>
    </article>
  </div>
}
