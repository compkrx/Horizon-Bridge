import type { RewriteSource, RustDraft } from '../rewrite'

export function runDeviceRewrite(source: RewriteSource, target: string, progress: (status: string) => void, signal: AbortSignal) {
  return new Promise<RustDraft>((resolve, reject) => {
    signal.throwIfAborted()
    const worker = new Worker(new URL('./ai-rewrite.worker.ts', import.meta.url), {type: 'module'})
    function cleanup() {
      worker.terminate()
      signal.removeEventListener('abort', cancel)
      window.clearTimeout(timeout)
    }
    function cancel() { cleanup(); reject(new DOMException('Rewrite cancelled.', 'AbortError')) }
    const timeout = window.setTimeout(() => {cleanup(); reject(new Error('The model exceeded its ten-minute budget.'))}, 600_000)
    signal.addEventListener('abort', cancel, {once: true})
    worker.onmessage = ({data}: MessageEvent<{status?: string; error?: string; draft?: RustDraft}>) => {
      if (data.status) progress(data.status)
      else if (data.draft) { cleanup(); resolve(data.draft) }
      else { cleanup(); reject(new Error(data.error || 'No draft was returned.')) }
    }
    worker.onerror = () => {cleanup(); reject(new Error('The model worker stopped. Check the browser’s WebGPU support and available memory.'))}
    worker.postMessage({source, target})
  })
}
