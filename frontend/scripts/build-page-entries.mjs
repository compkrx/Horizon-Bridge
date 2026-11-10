import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const index = new URL('index.html', dist)
const html = readFileSync(index, 'utf8')
writeFileSync(index, html.replace('name="horizonrelay-base" content="/"', 'name="horizonrelay-base" content="./"'))

for (const page of ['studio', 'versions', 'packages', 'ai', 'guide', 'look']) {
  const directory = new URL(`${page}/`, dist)
  mkdirSync(directory, {recursive: true})
  const entry = html
    .replace('name="horizonrelay-base" content="/"', 'name="horizonrelay-base" content="../"')
    .replaceAll('"./assets/', '"../assets/')
    .replace('href="./bridge.svg"', 'href="../bridge.svg"')
    .replace('<title>HorizonRelay · Minecraft mod converter</title>', `<title>${page[0].toUpperCase() + page.slice(1)} · HorizonRelay</title>`)
  writeFileSync(new URL('index.html', directory), entry)
}
