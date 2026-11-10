import type { Artifact, Report, Target } from '../api'
import type { RewriteSource } from '../rewrite'

export type ConversionMode = 'all' | 'basic' | 'inspect'

export interface NightlyTarget extends Target {
  date: string
  evidence: string
  contentApi: string | null
  nativeStartup: boolean
}

export interface NightlyCatalog {
  schema: 1
  current: string
  targets: NightlyTarget[]
}

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
  rewriteSources: RewriteSource[]
}

export type Stage = 'loading' | 'inspecting' | 'translating' | 'packaging'
export type WorkerInput = {file: File; base: string; targetId: string; mode: ConversionMode}
export type WorkerOutput = {stage: Stage} | {result: BrowserResult} | {error: string}
