export async function loadBrowserEngine(base: string) {
  const indexURL = new URL('browser/runtime/', base).href
  const moduleUrl = new URL('pyodide.mjs', indexURL).href
  const [{ loadPyodide }, response] = await Promise.all([
    import(/* @vite-ignore */ moduleUrl) as Promise<typeof import('pyodide')>,
    fetch(new URL('browser/engine.json', base)),
  ])
  if (!response.ok) throw new Error('Could not load the browser engine.')
  const files = await response.json() as Record<string, string>
  const py = await loadPyodide({ indexURL })
  py.FS.mkdir('/home/pyodide/horizonrelay')
  for (const [name, content] of Object.entries(files)) py.FS.writeFile(`/home/pyodide/horizonrelay/${name}`, content)
  return py
}
