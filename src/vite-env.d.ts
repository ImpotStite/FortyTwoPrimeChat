/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_MODEL?: string;
  /** Comma-separated fallback model ids, e.g. `google/gemma-3-27b-it:free,...`, OpenRouter `models` field. */
  readonly VITE_OPENROUTER_FALLBACK_MODELS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
