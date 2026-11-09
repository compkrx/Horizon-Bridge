export const stages: Record<string, string> = {
  awaiting_upload: 'Waiting for upload',
  uploading: 'Uploading',
  queued: 'Queued for processing',
  inspecting: 'Inspecting archive',
  permissions: 'Checking permissions',
  bytecode: 'Analyzing bytecode',
  reconstructing: 'Reconstructing Java',
  mapping: 'Mapping Horizon APIs',
  translating: 'Translating Rust',
  repairing: 'Repairing code',
  checking: 'Checking compilation',
  packaging: 'Validating package',
  ready: 'Ready for download',
  failed: 'Conversion failed',
  cancelled: 'Conversion cancelled',
}

export const stageLabel = (stage: string) => stages[stage] ?? stage.replaceAll('_', ' ')
export const displayError = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.'

export function bytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MiB`
  if (size >= 1024) return `${(size / 1024).toFixed(1).replace(/\.0$/, '')} KiB`
  return `${size} B`
}

export function displayTime(time: string) {
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? time : date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})
}

export function displayValue(value: unknown): string {
  if (value == null || value === '') return 'Unknown'
  if (Array.isArray(value)) return value.length ? value.map(displayValue).join(', ') : 'None detected'
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    return entries.length ? entries.map(([key, item]) => `${key} (${displayValue(item)})`).join(', ') : 'None detected'
  }
  return String(value)
}
