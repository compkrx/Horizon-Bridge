import type { PyodideInterface } from 'pyodide'
import type { BrowserResult, NightlyCatalog, Stage, WorkerInput, WorkerOutput } from './types'
import { loadBrowserEngine } from './load-engine'

let runtime: Promise<{py: PyodideInterface; catalog: NightlyCatalog}> | undefined
const post = (message: WorkerOutput, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

async function prepare(base: string) {
  const [py, nightlies] = await Promise.all([
    loadBrowserEngine(base),
    fetch(new URL('browser/nightlies.json', base)),
  ])
  if (!nightlies.ok) throw new Error('Could not load the Nightly catalog.')
  py.runPython('import json, shutil\nfrom horizonrelay.browser import convert_browser')
  return {py, catalog: await nightlies.json() as NightlyCatalog}
}

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const { file, base, targetId, mode } = event.data
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
    py.globals.set('hb_mode', mode)
    const value = py.runPython(`
try:
    hb_response = {"result": convert_browser("${input}", "${output}", hb_progress, target_info=json.loads(hb_target), mode=hb_mode)}
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
      py.globals.delete('hb_mode')
    }
  }
}
