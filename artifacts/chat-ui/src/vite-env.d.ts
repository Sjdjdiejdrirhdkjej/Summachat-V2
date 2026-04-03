/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when the UI is on a different host than the API (no trailing slash). */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
