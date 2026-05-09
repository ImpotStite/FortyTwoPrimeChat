# Fortytwo Prime Chat

A **Claude / ChatGPT–style** chat built with **React + Vite + TypeScript**.

## Routes

| Path | What it is |
|------|------------|
| **`/`** | **Fortytwo Prime** — wallet login (Privy), x402 USDC on **Monad**, MCP tool `ask_fortytwo_prime` via a same-origin proxy (`/api/mcp` → `mcp.fortytwo.network`). Streaming replies, session + billing history, on-chain refund toasts. |
| **`/test`** | **Legacy OpenRouter** playground — free models, vision, model picker; API key on the **server** only (`OPENROUTER_API_KEY` via Vercel Node.js `api/openrouter.ts` or Vite dev middleware). |

## Features (/)

- **Privy** external wallets, **EIP-712 / EIP-3009** payment when the MCP returns HTTP 402
- **Streaming** (SSE) assistant output
- **USDC balance** + **session** popover; **past sessions** modal with explorer links
- **On-chain refund detection** (USDC `Transfer` from Fortytwo escrow to your wallet)
- Dark / light theme, sidebar, export-style chat storage (`localStorage`)
- **PWA**: service worker registers only in **production** builds
- Code blocks: syntax highlighting + copy

## Features (/test — OpenRouter)

- Model picker (including free models), vision when the model supports images
- Streaming with retries on transient errors
- Tokens & cost when OpenRouter returns `usage`
- Per-chat model, edit / regenerate, image attachments

## Setup

```bash
npm install
npm run dev
```

Opens [http://localhost:5173](http://localhost:5173). In dev, Vite proxies `/api/mcp` to Fortytwo and serves `/api/openrouter` with your local `OPENROUTER_API_KEY` (see `vite.config.ts`).

## Configuration

Create `.env.local` (see `.env.example`):

**Fortytwo Prime (`/`) — required for wallet app**

```env
VITE_PRIVY_APP_ID=...
VITE_MONAD_RPC_URL=https://rpc3.monad.xyz
# Optional MCP URL override (default: same-origin /api/mcp)
# VITE_FORTYTWO_MCP_ENDPOINT=
```

**OpenRouter (`/test`)**

```env
OPENROUTER_API_KEY=sk-or-v1-...
VITE_OPENROUTER_MODEL=google/gemma-4-31b-it:free
# Optional: VITE_OPENROUTER_FALLBACK_MODELS=...
```

On **Vercel**, add `OPENROUTER_API_KEY` under Project → Settings → Environment Variables (Production / Preview as needed). It is read only by `api/openrouter.ts`, not bundled into the client.

> **Security:** `OPENROUTER_API_KEY` must **not** use the `VITE_` prefix (that would embed it in the browser). The Privy app id remains a public client identifier.

## Production build

```bash
npm run build
npm run preview
```

### Deploy on Vercel

- **Static app:** Vite output in `dist/` (`vercel.json` sets `outputDirectory` + `buildCommand`).
- **API routes:** `api/mcp.ts` and `api/openrouter.ts` are **Vercel Node.js serverless functions** (Web `fetch` handler, `export default { fetch }`). They are **not** Edge: long MCP streams and x402 payment settlement need a higher invocation limit than Edge allows.
- **Duration:** Both functions set `export const maxDuration = 300` and `vercel.json` → `functions["api/mcp.ts"]` / `["api/openrouter.ts"]` with `maxDuration: 300` so SSE + payment replay are not cut off with HTTP 504.
- **Assets:** `public/` (e.g. `sw.js`, icons, PWA manifest). `npm run preview` serves static files only — use `vercel dev` or a deployed preview to exercise `/api/*` locally.

**Troubleshooting**

- **504** on `/api/mcp` after long waits: usually Vercel function timeout — confirm `maxDuration` and project plan limits ([Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)).
- **502** with upstream Fortytwo in logs (`mcp.fortytwo.network` → 502): the proxy is working; the failure is on Fortytwo’s side or the network path — retry or contact Fortytwo with timestamps / correlation ids.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/⌘ + B` | Toggle sidebar |
| `Ctrl/⌘ + Shift + O` | New chat |
| `Esc` | Stop generation |
| `Ctrl/⌘ + Enter` | Submit message edit |
| `Enter` / `Shift+Enter` | Send / newline in composer |

## Project layout

```
src/
  PrimeApp.tsx       # / Fortytwo Prime + Privy
  LegacyApp.tsx      # /test OpenRouter
  main.tsx           # Router: / vs /test
  components/        # Sidebar, Message, Composer, SessionHistory, …
  lib/
    fortytwo.ts      # MCP client, x402, askPrime
    primeHistory.ts  # Billing session history (localStorage)
    escrowEvents.ts # Refund log polling
    privy.ts         # Chain + shared Monad RPC transport
    usdc.ts          # Balance + escrow address
    openrouter.ts    # Legacy route only
api/
  mcp.ts             # Vercel Node.js proxy → Fortytwo MCP (CORS, SSE, x402 headers)
  openrouter.ts      # Vercel Node.js proxy → OpenRouter (server-only OPENROUTER_API_KEY)
public/
  manifest.webmanifest, sw.js, icons, brand assets
scripts/
  crop-brand-mark.py # Optional: tight crop for logo PNG (needs Python + Pillow + numpy)
```

## Notes / tooling

- Regenerating cropped logo assets: run `python scripts/crop-brand-mark.py <src.png> public/fortytwo-prime-mark.png` (requires Python with **Pillow** and **numpy**), then regenerate `favicon-32.png`, `apple-touch-icon.png`, and manifest icons as needed.

## Language

All user-visible UI strings and this README are **English**. See `.cursor/rules/english-language.mdc`.
