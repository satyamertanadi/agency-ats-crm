// Build-time constants injected by esbuild `define` (extension/build.mjs).
declare const __SUPABASE_URL__: string
declare const __SUPABASE_ANON_KEY__: string
declare const __APP_ORIGIN__: string

// Minimal ambient typings for the subset of the chrome.* extension APIs this extension uses, so the
// optional `tsc --noEmit` passes without pulling in @types/chrome as a dependency. esbuild does the
// actual bundling and ignores types entirely.
declare namespace chrome {
  namespace runtime {
    const lastError: { message?: string } | undefined
    function sendMessage<T = unknown>(message: unknown): Promise<T>
    const onMessage: {
      addListener(cb: (message: any, sender: { tab?: { id?: number; url?: string } }, sendResponse: (response?: unknown) => void) => boolean | void | Promise<unknown>): void
    }
  }
  namespace storage {
    interface Area { get(keys: string | string[] | null): Promise<Record<string, any>>; set(items: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> }
    const local: Area
  }
  namespace tabs {
    interface Tab { id?: number; url?: string }
    function create(props: { url: string; active?: boolean }): Promise<Tab>
    function remove(tabId: number): Promise<void>
    function query(info: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>
  }
}
