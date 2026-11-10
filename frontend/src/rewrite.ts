export type RewriteChoice = {id: string; label: string; language: string}
export type RewriteSource = RewriteChoice & {text: string}
export type RustDraft = {rust: string; notes: string[]; model: string; source: string; filename: string; generatedAt?: string}
export type RewriteRun = (id: string, progress: (status: string) => void, signal: AbortSignal) => Promise<RustDraft>
