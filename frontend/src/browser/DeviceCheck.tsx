import { useState } from 'react'
import { Cpu } from 'lucide-react'

export function DeviceCheck() {
  const [status, setStatus] = useState('Check whether this browser can access a WebGPU adapter before downloading the model.')
  const [checking, setChecking] = useState(false)
  async function check() {
    setChecking(true)
    try {
      const gpu = navigator.gpu
      const adapter = await gpu?.requestAdapter()
      setStatus(adapter
        ? `WebGPU adapter available. The maximum storage buffer is ${Math.round(adapter.limits.maxStorageBufferBindingSize / 1024 / 1024)} MiB. Model loading also depends on available memory.`
        : 'A WebGPU adapter is unavailable. Check browser support and hardware acceleration, then try again.')
    } catch {
      setStatus('The browser could not access a WebGPU adapter. Check browser support and hardware acceleration.')
    } finally { setChecking(false) }
  }
  return <section className="panel result-section" aria-labelledby="device-title">
    <div className="panel-title"><Cpu size={21} /><h2 id="device-title">Can this device run it?</h2></div>
    <p className="text-muted" role="status">{status}</p>
    <dl className="browser-metrics mt-4"><div><dt>Model download</dt><dd>~300 MB</dd></div><div><dt>Compute</dt><dd>Your GPU</dd></div><div><dt>Model</dt><dd>Qwen 0.5B</dd></div></dl>
    <div className="browser-actions"><button className="btn outline" type="button" onClick={() => void check()} disabled={checking}>{checking ? 'Checking device…' : 'Check this device'}</button></div>
  </section>
}
