import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import { pageHref } from './pages'

const accents = {Violet: '#8267ff', Ember: '#ee875a', Ice: '#73c7fa'}
const key = 'horizonrelay-appearance'
type Settings = {accent: keyof typeof accents; glass: number; blur: number; backgroundBlur: number; motion: boolean}
const defaults: Settings = {accent: 'Violet', glass: 74, blur: 12, backgroundBlur: 2, motion: true}
const presets = [
  {name: 'Horizon', settings: defaults, description: 'Violet glass with a warm sunset.'},
  {name: 'Sunset', settings: {...defaults, accent: 'Ember' as const, glass: 80, blur: 16}, description: 'Amber highlights and softer glass.'},
  {name: 'Clear night', settings: {...defaults, accent: 'Ice' as const, glass: 93, blur: 4, backgroundBlur: 0}, description: 'Cool accents and more opaque panels.'},
]

function saved(): Settings {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings>
    return {
      accent: data.accent && Object.hasOwn(accents, data.accent) ? data.accent : defaults.accent,
      glass: typeof data.glass === 'number' && data.glass >= 60 && data.glass <= 95 ? data.glass : defaults.glass,
      blur: typeof data.blur === 'number' && data.blur >= 0 && data.blur <= 24 ? data.blur : defaults.blur,
      backgroundBlur: typeof data.backgroundBlur === 'number' && data.backgroundBlur >= 0 && data.backgroundBlur <= 12 ? data.backgroundBlur : defaults.backgroundBlur,
      motion: typeof data.motion === 'boolean' ? data.motion : defaults.motion,
    }
  } catch { return defaults }
}

export function Appearance() {
  const [settings, setSettings] = useState(saved)
  useEffect(() => {
    const style = document.documentElement.style
    style.setProperty('--relay-accent', accents[settings.accent])
    style.setProperty('--relay-glass', `${settings.glass}%`)
    style.setProperty('--relay-blur', `${settings.blur}px`)
    style.setProperty('--relay-background-blur', `${settings.backgroundBlur}px`)
    document.documentElement.dataset.motion = settings.motion ? 'on' : 'off'
    try { localStorage.setItem(key, JSON.stringify(settings)) } catch { /* Appearance is optional. */ }
  }, [settings])
  return <section className="panel result-section browser-compat appearance" id="appearance" aria-labelledby="appearance-heading">
    <div className="panel-title"><Palette size={21} /><h2 id="appearance-heading">Appearance</h2></div>
    <p className="text-muted">Pick a starting point, then adjust the workspace. Preferences are saved in this browser.</p>
    <div className="appearance-presets">{presets.map((preset) => <button className="preset-card" type="button" key={preset.name} onClick={() => setSettings({...preset.settings})} aria-pressed={Object.entries(preset.settings).every(([name, value]) => settings[name as keyof Settings] === value)}>
      <span className="preset-swatch" style={{background: accents[preset.settings.accent]}} /><strong>{preset.name}</strong><span>{preset.description}</span>
    </button>)}</div>
    <div className="appearance-controls">
      <div><h3>Accent</h3><div className="accent-options">{Object.entries(accents).map(([name, value]) =>
        <button type="button" key={name} style={{background: value}} aria-label={`${name} accent`} aria-pressed={settings.accent === name}
          onClick={() => setSettings({...settings, accent: name as Settings['accent']})} />)}</div></div>
      <label>Glass opacity <span>{settings.glass}%</span><input type="range" min={60} max={95} value={settings.glass} onChange={(event) => setSettings({...settings, glass: event.target.valueAsNumber})} /></label>
      <label>Frost blur <span>{settings.blur} px</span><input type="range" min={0} max={24} value={settings.blur} onChange={(event) => setSettings({...settings, blur: event.target.valueAsNumber})} /></label>
      <label>Background blur <span>{settings.backgroundBlur} px</span><input type="range" min={0} max={12} value={settings.backgroundBlur} onChange={(event) => setSettings({...settings, backgroundBlur: event.target.valueAsNumber})} /></label>
    </div>
    <label className="permission browser-permission"><input type="checkbox" checked={settings.motion} onChange={(event) => setSettings({...settings, motion: event.target.checked})} /> Cursor tilt and interface motion</label>
    <p className="nightly-info mt-2">Your system’s reduced-motion preference takes priority. Lower blur can reduce rendering work on slower devices.</p>
    <div className="appearance-preview"><span className="pill">Live preview</span><h3>Your HorizonRelay workspace</h3><p>Panels, borders, buttons, and navigation use these settings across all six pages.</p><a href={pageHref('studio')} className="btn accent">Return to Studio</a></div>
    <div className="browser-actions"><button className="btn outline" type="button" onClick={() => setSettings({...defaults})}>Reset appearance</button></div>
  </section>
}
