export interface NativePackageReport {
  schema: 1
  scope: 'static-inspection'
  id: string
  version: string
  game: string
  horizonRevision: string
  mixinsRevision: string
  hookApi: number | null
  sha256: string
  entries: number
  expandedBytes: number
  rustFiles: number
  modules: number
  injections: number
  declaredInjections: {id: string; kind: string; target: string; hook: string; hookVersion: number | null; cancellable: boolean}[]
  noticeFiles: string[]
  paths: string[]
}

export type PackageInspectionMessage = {status: string} | {result: NativePackageReport} | {error: string}
