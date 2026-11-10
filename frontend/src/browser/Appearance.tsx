import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'

const accents = {Violet: '#8267ff', Ember: '#ee875a', Ice: '#73c7fa'}
const key = 'horizonrelay-appearance'
type Settings = {accent: keyof typeof accents; glass: number; blur: number}

function saved(): Settings {
  const defaults: Settings = {accent: 'Violet', glass: 74, blur: 12}
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings>
    return {
      accent: data.accent && Object.hasOwn(accents, data.accent) ? data.accent : defaults.accent,
      glass: typeof data.glass === 'number' && data.glass >= 60 && data.glass <= 95 ? data.glass : defaults.glass,
      blur: typeof data.blur === 'number' && data.blur >= 0 && data.blur <= 24 ? data.blur : defaults.blur,
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
    try { localStorage.setItem(key, JSON.stringify(settings)) } catch { /* Appearance is optional. */ }
  }, [settings])
  return <section className="panel result-section browser-compat appearance" id="appearance" aria-labelledby="appearance-heading">
    <div className="panel-title"><Palette size={21} /><h2 id="appearance-heading">Appearance</h2></div>
    <div className="appearance-controls">
      <div><h3>Accent</h3><div className="accent-options">{Object.entries(accents).map(([name, value]) =>
        <button type="button" key={name} style={{background: value}} aria-label={`${name} accent`} aria-pressed={settings.accent === name}
          onClick={() => setSettings({...settings, accent: name as Settings['accent']})} />)}</div></div>
      <label>Glass opacity <span>{settings.glass}%</span><input type="range" min={60} max={95} value={settings.glass} onChange={(event) => setSettings({...settings, glass: event.target.valueAsNumber})} /></label>
      <label>Frost blur <span>{settings.blur} px</span><input type="range" min={0} max={24} value={settings.blur} onChange={(event) => setSettings({...settings, blur: event.target.valueAsNumber})} /></label>
    </div>
  </section>
}
