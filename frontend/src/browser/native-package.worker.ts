import { loadBrowserEngine } from './load-engine'
import type { PackageInspectionMessage } from './package-inspection'

const post = (message: PackageInspectionMessage) => self.postMessage(message)

self.onmessage = async ({data}: MessageEvent<{base: string; file: File}>) => {
  const path = '/tmp/horizonrelay-package.hnmod'
  try {
    const py = await loadBrowserEngine(data.base)
    post({status: 'Checking the archive and its manifests…'})
    py.FS.writeFile(path, new Uint8Array(await data.file.arrayBuffer()))
    const result = py.runPython(`
import json
from horizonrelay.native_package import inspect_native_package
try:
    package_response = {"result": inspect_native_package("${path}")}
except (ValueError, OSError) as exc:
    package_response = {"error": str(exc)[:500]}
json.dumps(package_response)
`) as string
    post(JSON.parse(result) as PackageInspectionMessage)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Package inspection failed.'
    post({error: message.includes('Traceback') ? 'The browser could not inspect this package.' : message.slice(0, 500)})
  }
}
