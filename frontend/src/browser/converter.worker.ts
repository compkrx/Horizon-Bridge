import type { PyodideInterface } from 'pyodide'
import type { BrowserResult, NightlyCatalog, Stage, WorkerInput, WorkerOutput } from './types'

let runtime: Promise<{py: PyodideInterface; catalog: NightlyCatalog}> | undefined
const post = (message: WorkerOutput, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

async function prepare(base: string) {
  const indexURL = new URL('browser/runtime/', base).href
  const moduleUrl = new URL('pyodide.mjs', indexURL).href
  const [{ loadPyodide }, response, nightlies] = await Promise.all([
    import(/* @vite-ignore */ moduleUrl) as Promise<typeof import('pyodide')>,
    fetch(new URL('browser/engine.json', base)),
    fetch(new URL('browser/nightlies.json', base)),
  ])
  if (!response.ok || !nightlies.ok) throw new Error('Could not load the converter or Nightly catalog.')
  const files = await response.json() as Record<string, string>
  const py = await loadPyodide({ indexURL })
  py.FS.mkdir('/home/pyodide/horizonrelay')
  for (const [name, content] of Object.entries(files)) py.FS.writeFile(`/home/pyodide/horizonrelay/${name}`, content)
  py.runPython('import json, shutil\nfrom horizonrelay.browser import convert_browser')
  return {py, catalog: await nightlies.json() as NightlyCatalog}
}

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const { file, base, targetId } = event.data
  const input = '/tmp/horizonrelay-input.jar'
  const output = '/tmp/horizonrelay-output'
  let py: PyodideInterface | undefined
  try {
    post({ stage: 'loading' })
    const loaded = await (runtime ??= prepare(base))
    py = loaded.py
    const target = loaded.catalog.targets.find((item) => item.id === targetId)
    if (!target) throw new Error('This target is unavailable. Reload the Nightly catalog and try again.')
    py.FS.writeFile(input, new Uint8Array(await file.arrayBuffer()))
    py.globals.set('hb_progress', (stage: Stage) => post({ stage }))
    py.globals.set('hb_target', JSON.stringify(target))
    const value = py.runPython(`
try:
    hb_response = {"result": convert_browser("${input}", "${output}", hb_progress, target_info=json.loads(hb_target))}
except (ValueError, OSError) as exc:
    hb_response = {"error": str(exc)[:500]}
json.dumps(hb_response)
`) as string
    const response = JSON.parse(value) as {result?: Omit<BrowserResult, 'downloads'>; error?: string}
    if (!response.result) throw new Error(response.error || 'The converter did not produce a result.')
    const downloads: Record<string, ArrayBuffer> = {}
    for (const artifact of response.result.artifacts) {
      const data = py.FS.readFile(`${output}/${artifact.name}`)
      downloads[artifact.name] = new Uint8Array(data).buffer
    }
    post({ result: { ...response.result, downloads } }, Object.values(downloads))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not process this JAR.'
    post({ error: message.includes('Traceback') ? 'The converter could not process this JAR.' : message.slice(0, 500) })
  } finally {
    if (py) {
      try { py.FS.unlink(input) } catch { /* Input may never have reached the virtual filesystem. */ }
      py.runPython(`shutil.rmtree("${output}", ignore_errors=True)\nglobals().pop("hb_response", None)`)
      py.globals.delete('hb_progress')
      py.globals.delete('hb_target')
    }
  }
}
