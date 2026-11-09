type Descriptor = 'fabric.mod.json' | 'quilt.mod.json' | 'META-INF/neoforge.mods.toml' | 'META-INF/mods.toml' | 'mcmod.info'

const descriptors: Descriptor[] = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml', 'mcmod.info']
const maxIndex = 512 * 1024
const maxCompressed = 16 * 1024
const maxText = 32 * 1024
const decoder = new TextDecoder('utf-8', {fatal: true})

type Member = {name: Descriptor; method: number; offset: number; size: number; compressed: number}
export type Preview = {loader: string; name?: string; id?: string; version?: string; minecraft?: string}

async function view(file: File, start: number, length: number) {
  return new DataView(await file.slice(start, start + length).arrayBuffer())
}

async function findDescriptor(file: File): Promise<Member | undefined> {
  // The ZIP end record is 22 bytes plus at most 65,535 bytes of ZIP comment.
  const tailStart = Math.max(0, file.size - 65557)
  const tail = await view(file, tailStart, file.size - tailStart)
  let end = tail.byteLength - 22
  while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50 || end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)) end--
  if (end < 0 || tail.getUint32(end + 4, true) !== 0) return
  const count = tail.getUint16(end + 10, true)
  const indexSize = tail.getUint32(end + 12, true)
  const indexStart = tail.getUint32(end + 16, true)
  if (count !== tail.getUint16(end + 8, true) || count > 5000 || indexSize > maxIndex || indexStart + indexSize > tailStart + end) return

  const index = await view(file, indexStart, indexSize)
  let position = 0
  let best: Member | undefined
  for (let i = 0; i < count; i++) {
    if (position + 46 > indexSize || index.getUint32(position, true) !== 0x02014b50) return
    const nameLength = index.getUint16(position + 28, true)
    const next = position + 46 + nameLength + index.getUint16(position + 30, true) + index.getUint16(position + 32, true)
    if (next > indexSize) return
    const flags = index.getUint16(position + 8, true)
    const method = index.getUint16(position + 10, true)
    const compressed = index.getUint32(position + 20, true)
    const size = index.getUint32(position + 24, true)
    const offset = index.getUint32(position + 42, true)
    if (!(flags & 1) && (method === 0 || method === 8) && compressed <= maxCompressed && size <= maxText && nameLength <= 40 && offset + 30 + compressed <= indexStart) {
      const rawName = new Uint8Array(index.buffer, position + 46, nameLength)
      const name = descriptors.find((candidate) => candidate.length === nameLength && rawName.every((value, char) => value === candidate.charCodeAt(char)))
      if (name && (!best || descriptors.indexOf(name) < descriptors.indexOf(best.name))) best = {name, method, compressed, size, offset}
    }
    position = next
  }
  return best
}

async function readDescriptor(file: File, member: Member) {
  const header = await view(file, member.offset, 30)
  if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(8, true) !== member.method || header.getUint16(6, true) & 1) return
  const nameLength = header.getUint16(26, true)
  if (nameLength !== member.name.length) return
  const actualName = decoder.decode(await file.slice(member.offset + 30, member.offset + 30 + nameLength).arrayBuffer())
  if (actualName !== member.name) return
  const start = member.offset + 30 + nameLength + header.getUint16(28, true)
  if (start + member.compressed > file.size) return
  const content = file.slice(start, start + member.compressed)
  if (member.method === 0) {
    if (content.size === member.size) return decoder.decode(await content.arrayBuffer())
    return
  }

  // Read one descriptor only, and stop even if the advertised expanded size was false.
  const reader = content.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const decoded = new Uint8Array(member.size)
  let offset = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (offset + next.value.length > decoded.length) return
      decoded.set(next.value, offset)
      offset += next.value.length
    }
    if (offset === member.size) return decoder.decode(decoded)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, 150) : undefined
}

function dependency(items: unknown, idKey: string, versionKey: string) {
  return Array.isArray(items) ? text(object(items.find((item: unknown) => object(item)[idKey] === 'minecraft'))[versionKey]) : undefined
}

export async function previewJar(file: File): Promise<Preview | undefined> {
  // Preview is opportunistic. Unsupported ZIP layouts and older browsers can still submit the JAR.
  try {
    const member = await findDescriptor(file)
    if (!member) return
    const raw = await readDescriptor(file, member)
    if (!raw) return
    if (member.name.endsWith('.toml')) {
      const {parse} = await import('smol-toml')
      const data = parse(raw, {unsafeKeyBehaviour: 'drop'})
      const mod = object(Array.isArray(data.mods) ? data.mods[0] : undefined)
      const id = text(mod.modId)
      return {
        loader: member.name === 'META-INF/neoforge.mods.toml' ? 'NeoForge' : 'Forge',
        name: text(mod.displayName), id, version: text(mod.version),
        minecraft: id ? dependency(object(data.dependencies)[id], 'modId', 'versionRange') : undefined,
      }
    }
    const data: unknown = JSON.parse(raw)
    if (member.name === 'quilt.mod.json') {
      const quilt = object(object(data).quilt_loader)
      return {loader: 'Quilt', name: text(object(quilt.metadata).name), id: text(quilt.id), version: text(quilt.version), minecraft: dependency(quilt.depends, 'id', 'versions')}
    }
    if (member.name === 'mcmod.info') {
      const mods = Array.isArray(data) ? data : object(data).modList
      const legacy = object(Array.isArray(mods) ? mods[0] : undefined)
      return {loader: 'Legacy', name: text(legacy.name), id: text(legacy.modid), version: text(legacy.version), minecraft: text(legacy.mcversion)}
    }
    const fabric = object(data)
    return {loader: 'Fabric', name: text(fabric.name), id: text(fabric.id), version: text(fabric.version), minecraft: text(object(fabric.depends).minecraft)}
  } catch {
    return undefined
  }
}
