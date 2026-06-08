/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Canonical origin for OG URLs, sitemap, and RouteSeo (no trailing slash). */
  readonly VITE_SITE_URL?: string;
  readonly VITE_OPENROUTER_MODEL?: string;
  /** Comma-separated fallback model ids (max 3), OpenRouter `models` field. */
  readonly VITE_OPENROUTER_FALLBACK_MODELS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
