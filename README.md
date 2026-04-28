# FortyTwo Prime Chat

A modern **Claude / ChatGPT–style** chat app built with **React + Vite + TypeScript**, powered by **OpenRouter**.

## Features

- **Streaming** completions (SSE) with automatic retries on transient provider errors (`Provider returned error`, 5xx, timeouts)
- **Model picker**: all **free** models on OpenRouter, search, **vision-only** filter, context size badges
- **Per-chat model**: each conversation can override the default model
- **Edit & regenerate**: edit user messages (truncates history and resends), regenerate assistant replies, delete last message
- **Image attachments** (multimodal): upload, paste from clipboard, multiple images per message
- **Dark / light theme** with persistence
- **Sidebar**: full-text search, **pin**, **rename** (double-click or pencil), **date grouping**
- **Export / import**: Markdown or JSON per chat, full JSON backup, merge import by conversation id
- **Tokens & cost** under each assistant reply (OpenRouter `usage` with `stream_options.include_usage`)
- **Shortcuts**: `Ctrl+B` / `⌘B` (sidebar), `Ctrl+Shift+O` / `⌘⇧O` (new chat), `Esc` (stop generation)
- **Mobile**: slide-out sidebar with backdrop
- **PWA**: installable; offline shell for cached assets (service worker only in **production** build)
- **Code blocks**: syntax highlighting + **Copy** button
- **Thinking indicator** (three dots) before the first token

## Setup

```bash
npm install
npm run dev
```

Opens [http://localhost:5173](http://localhost:5173).

## Configuration

Create `.env.local`:

```env
VITE_OPENROUTER_API_KEY=sk-or-v1-...
VITE_OPENROUTER_MODEL=google/gemma-4-31b-it:free
# Optional: fallback model ids sent as OpenRouter `models` when the primary fails
# VITE_OPENROUTER_FALLBACK_MODELS=google/gemma-4-26b-a4b-it:free,google/gemma-3-27b-it:free
```

> **Security:** the API key is embedded in the client bundle. For a public deployment, proxy OpenRouter through a backend that holds the secret.

## Production build

```bash
npm run build
npm run preview
```

The service worker registers only in **production** (not during `npm run dev`).

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
  App.tsx
  components/       # Sidebar, Message, Composer, ModelPicker, …
  hooks/
  lib/              # openrouter, storage, export/import, formatting
  styles/
public/
  manifest.webmanifest
  sw.js
```

## Notes

- Free `:free` models can be overloaded; the app retries automatically (up to 2 attempts) on generic provider errors.
- Image upload requires a model that accepts **image** inputs; the paperclip is disabled when the current model does not support vision (based on OpenRouter model metadata).
- `usage.cost` is usually **$0** on free models; token counts still reflect usage.

## Language

All UI strings, docs, and default assistant prompts in this repository are **English**. See `.cursor/rules/english-language.mdc`.
