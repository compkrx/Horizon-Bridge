import type { Artifact, Report } from '../api'

export interface BrowserReport extends Report {
  inspection: {classCount: number; methodCount: number; javaVersion: number | null; resourceCount: number; expandedSize: number}
  resources: {count: number; entries: {path: string; exported: boolean}[]}
  runtime: 'browser'
}

export interface BrowserResult {
  report: BrowserReport
  artifacts: Artifact[]
  files: Record<string, string>
  downloads: Record<string, ArrayBuffer>
}

export type Stage = 'loading' | 'inspecting' | 'translating' | 'packaging'
export type WorkerInput = {file: File; base: string}
export type WorkerOutput = {stage: Stage} | {result: BrowserResult} | {error: string}
