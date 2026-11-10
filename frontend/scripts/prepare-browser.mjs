import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const frontend = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../', import.meta.url))
const output = join(frontend, 'public/browser')
const runtime = join(output, 'runtime')
mkdirSync(runtime, { recursive: true })
for (const name of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'pyodide-lock.json', 'python_stdlib.zip']) {
  copyFileSync(join(frontend, 'node_modules/pyodide', name), join(runtime, name))
}
copyFileSync(join(repo, 'notices/Pyodide-LICENSE.txt'), join(runtime, 'LICENSE.txt'))
const files = Object.fromEntries(['archive', 'bytecode', 'inspect_jar', 'translate', 'horizon', 'browser'].map((name) =>
  [`${name}.py`, readFileSync(join(repo, 'engine/horizonrelay', `${name}.py`), 'utf8')]))
writeFileSync(join(output, 'engine.json'), JSON.stringify(files))
copyFileSync(join(repo, 'catalog/nightlies.json'), join(output, 'nightlies.json'))
const examples = join(output, 'examples')
mkdirSync(examples, { recursive: true })
const fixtures = mkdtempSync(join(tmpdir(), 'horizonrelay-fixtures-'))
try {
  execFileSync(process.env.HB_PYTHON || 'python', [join(repo, 'tests/make_fixtures.py'), fixtures], { stdio: 'inherit' })
  for (const name of ['logic.jar', 'startup.jar', 'asset.jar']) copyFileSync(join(fixtures, name), join(examples, name))
} finally {
  rmSync(fixtures, { recursive: true, force: true })
}
