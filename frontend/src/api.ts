export interface Target {
  id: string
  label: string
  minecraft: string
  horizonRevision: string
  mixinsRevision: string
  hookApi: number | string
}

export interface Config {
  maxUploadBytes: number
  retentionHours: number
  aiAvailable: boolean
  reconstructionAvailable?: boolean
  nativeValidationAvailable?: boolean
  targets: Target[]
}

export interface Metadata {
  name?: string
  id?: string
  version?: string
  minecraft?: string
  loader?: string
  author?: string | string[]
  license?: string
  description?: string
  dependencies?: unknown
  entrypoints?: unknown
  [field: string]: unknown
}

export interface Report {
  classification: 'verified' | 'partial' | 'unsupported'
  metadata: Metadata
  target: Target
  features: {name: string; status: 'translated' | 'partial' | 'unsupported'; detail: string}[]
  validation: {name: string; status: 'passed' | 'failed' | 'skipped'; detail: string}[]
  diagnostics: string[]
  warnings: string[]
  missingDependencies: string[]
  inputBytes: number
}

export type Artifact = {name: string; kind: 'hnmod' | 'hmod' | 'source' | 'report'; size: number}
export type FileInfo = {path: string; size: number}
export type Credentials = {id: string; token: string}
export type JobState = 'awaiting_upload' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface Job {
  id: string
  filename: string
  size: number
  target: string
  state: JobState
  stage: string
  history: {stage: string; at: string}[]
  createdAt: string
  expiresAt: string
  attempt: number
  error?: string
  retryable?: boolean
  ai?: boolean
  metadata?: Metadata
  report?: Report
  artifacts: Artifact[]
  files: FileInfo[]
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function errorMessage(value: unknown, status: number) {
  if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') {
    return value.error
  }
  return `The conversion service returned HTTP ${status}.`
}

async function request(path: string, options: RequestInit = {}, token?: string) {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(path, {...options, headers, cache: 'no-store', redirect: 'error'})
  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, errorMessage(problem, response.status))
  }
  return response
}

const jobPath = (job: Credentials) => `/api/jobs/${encodeURIComponent(job.id)}`
const getJson = async <T,>(path: string, options?: RequestInit, token?: string): Promise<T> => {
  const response = await request(path, options, token)
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('The conversion API returned an unexpected response. Check that the API is connected.')
  }
  return response.json() as Promise<T>
}

export const api = {
  config: (signal?: AbortSignal) => getJson<Config>('/api/config', {signal}),
  create: (body: {filename: string; size: number; target: string; authorized: true; ai: boolean}) =>
    getJson<Credentials & {uploadUrl: string}>('/api/jobs', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
    }),
  get: (job: Credentials, signal?: AbortSignal) => getJson<Job>(jobPath(job), {signal}, job.token),
  change: (job: Credentials, action: 'cancel' | 'retry') =>
    getJson<Job>(`${jobPath(job)}/${action}`, {method: 'POST'}, job.token),
  advice: (job: Credentials) =>
    getJson<{advice: string}>(`${jobPath(job)}/advice`, {method: 'POST'}, job.token),
  async file(job: Credentials, path: string, signal: AbortSignal) {
    const response = await request(`${jobPath(job)}/files?${new URLSearchParams({path})}`, {signal}, job.token)
    return response.text()
  },
  async download(job: Credentials, artifact: Artifact) {
    const response = await request(`${jobPath(job)}/artifacts/${encodeURIComponent(artifact.name)}`, {}, job.token)
    const blobUrl = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = artifact.name
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000)
  },
}

export function uploadJar(url: string, job: Credentials, file: File, onProgress: (sent: number) => void, signal: AbortSignal) {
  return new Promise<Job>((resolve, reject) => {
    const endpoint = new URL(url, window.location.origin)
    if (endpoint.origin !== window.location.origin || !endpoint.pathname.startsWith(`${jobPath(job)}/`)) {
      reject(new Error('The service returned an invalid upload address.'))
      return
    }
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    if (signal.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'))
      return
    }
    xhr.open('PUT', endpoint.href)
    xhr.responseType = 'json'
    xhr.timeout = 10 * 60 * 1000
    xhr.setRequestHeader('Content-Type', 'application/java-archive')
    xhr.setRequestHeader('Authorization', `Bearer ${job.token}`)
    xhr.upload.onprogress = (event) => onProgress(event.loaded)
    xhr.onload = () => {
      if (xhr.status === 202 && xhr.response && typeof xhr.response.state === 'string') {
        resolve(xhr.response as Job)
        return
      }
      reject(new ApiError(xhr.status, errorMessage(xhr.response, xhr.status)))
    }
    xhr.onerror = () => reject(new Error('Upload connection failed. Check the connection and try again.'))
    xhr.ontimeout = () => reject(new Error('The upload timed out.'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'))
    xhr.onloadend = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, {once: true})
    xhr.send(file)
  })
}

const sessionKey = 'horizonbridge-current-job'

export function saveCredentials(credentials: Credentials | null) {
  try {
    if (credentials) sessionStorage.setItem(sessionKey, JSON.stringify(credentials))
    else sessionStorage.removeItem(sessionKey)
  } catch {
    // The active job remains usable in memory if browser storage is unavailable.
  }
}

export function loadCredentials(): Credentials | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null') as Credentials | null
    return typeof value?.id === 'string' && typeof value.token === 'string' ? value : null
  } catch {
    return null
  }
}
