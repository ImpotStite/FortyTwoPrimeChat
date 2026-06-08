# Fortytwo Prime Chat

A **Claude / ChatGPT–style** chat built with **React + Vite + TypeScript**.

## Routes

| Path | What it is |
|------|------------|
| **`/`** | **Fortytwo Prime**, wallet login (Privy), x402 USDC on **Monad**, MCP tool `ask_fortytwo_prime` via a same-origin proxy (`/api/mcp` → `mcp.fortytwo.network`). Streaming replies, session + billing history, on-chain refund toasts. |
| **`/test`** | **Legacy OpenRouter** playground, free models, vision, model picker; API key on the **server** only (`OPENROUTER_API_KEY` via Edge `api/openrouter.ts` or Vite dev middleware). |

## Features (/)

- **Privy** external wallets, **EIP-712 / EIP-3009** payment when the MCP returns HTTP 402
- **Streaming** (SSE) assistant output
- **USDC balance** + **session** popover; **past sessions** modal with explorer links
- **On-chain refund detection** (USDC `Transfer` from Fortytwo escrow to your wallet)
- Dark / light theme, sidebar, export-style chat storage (`localStorage`)
- **PWA**: service worker registers only in **production** builds
- Code blocks: syntax highlighting + copy

## Features (/test, OpenRouter)

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

**Fortytwo Prime (`/`), required for wallet app**

```env
VITE_PRIVY_APP_ID=...
VITE_MONAD_RPC_URL=https://rpc3.monad.xyz
# Optional MCP URL override (default: same-origin /api/mcp)
# VITE_FORTYTWO_MCP_ENDPOINT=
```

**OpenRouter (`/test`)**

```env
OPENROUTER_API_KEY=sk-or-v1-...
VITE_OPENROUTER_MODEL=moonshotai/kimi-k2.6:free
# Optional: VITE_OPENROUTER_FALLBACK_MODELS=...
```

On **Vercel**, add `OPENROUTER_API_KEY` under Project → Settings → Environment Variables (Production / Preview as needed). It is read only by `api/openrouter.ts`, not bundled into the client.

> **Security:** `OPENROUTER_API_KEY` must **not** use the `VITE_` prefix (that would embed it in the browser). The Privy app id remains a public client identifier.

## Production build

```bash
npm run build
npm run preview
```

Deploy on **Vercel**: `api/mcp.ts` and `api/openrouter.ts` are Edge proxies (CORS + streaming). Static assets + `sw.js` live under `public/`. `npm run preview` serves static files only, use `vercel dev` or a deployed preview to exercise `/api/*` routes locally.

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
  mcp.ts             # Vercel Edge proxy to Fortytwo MCP
  openrouter.ts      # Vercel Edge proxy to OpenRouter (holds OPENROUTER_API_KEY)
public/
  manifest.webmanifest, sw.js, icons, brand assets (`/images/*` for loader sprites)
```

## Language

All user-visible UI strings and this README are **English**. See `.cursor/rules/english-language.mdc`.
