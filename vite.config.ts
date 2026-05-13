import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

const DEFAULT_PRODUCTION_SITE = "https://forty-two-prime-chat.vercel.app";

/** Main Vite CSS links are render-blocking; defer paint until loaded (FOUC risk is minimal). */
function makeViteStylesheetsNonBlocking(html: string): string {
  return html.replace(
    /<link rel="stylesheet"([^>]+)>/gi,
    (full, attrs: string) => {
      const a = attrs;
      if (!a.includes('href="/assets/') || /\bmedia\s*=/.test(full)) {
        return full;
      }
      return `<link rel="stylesheet"${a} media="print" onload="this.media='all'">`;
    }
  );
}

/** Hoist bundled CSS + module script early in <head> so the network starts in parallel. */
function hoistViteHeadAssets(html: string): string {
  const linkRe =
    /<link rel="stylesheet"[^>]*href="\/assets\/[^"]+\.css"[^>]*>/i;
  const scriptRe =
    /<script type="module"[^>]*src="\/assets\/[^"]+\.js"[^>]*><\/script>/i;
  const linkMatch = html.match(linkRe);
  const scriptMatch = html.match(scriptRe);
  if (!linkMatch?.[0] || !scriptMatch?.[0]) {
    return html;
  }
  const linkTag = linkMatch[0];
  const scriptTag = scriptMatch[0];
  let out = html.replace(linkTag, "").replace(scriptTag, "");
  out = out.replace(
    /<meta charset="UTF-8" \/>/i,
    `<meta charset="UTF-8" />\n    ${linkTag}\n    ${scriptTag}`
  );
  return out;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const siteUrl = (
    env.VITE_SITE_URL?.trim() ||
    (mode === "production" ? DEFAULT_PRODUCTION_SITE : "http://localhost:5173")
  ).replace(/\/$/, "");

  let resolvedOutDir = "dist";

  return {
    plugins: [
      {
        name: "inject-site-url-html",
        transformIndexHtml(html) {
          let out = html.replaceAll("__SITE_URL__", siteUrl);
          if (mode === "production") {
            out = makeViteStylesheetsNonBlocking(out);
            out = hoistViteHeadAssets(out);
          }
          return out;
        },
      },
      react(),
      {
        name: "write-seo-files",
        configResolved(config) {
          resolvedOutDir = config.build.outDir;
        },
        writeBundle() {
          const outAbs = path.resolve(process.cwd(), resolvedOutDir);
          const robots = `User-agent: *
Allow: /

# Internal OpenRouter playground (also noindex when the app loads)
Disallow: /test

Sitemap: ${siteUrl}/sitemap.xml
`;
          const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
          fs.mkdirSync(outAbs, { recursive: true });
          fs.writeFileSync(path.join(outAbs, "robots.txt"), robots, "utf8");
          fs.writeFileSync(path.join(outAbs, "sitemap.xml"), sitemap, "utf8");
        },
      },
      {
        name: "openrouter-dev-proxy",
        configureServer(server) {
          server.middlewares.use(
            async (
              req: IncomingMessage,
              res: ServerResponse,
              next: () => void
            ) => {
              const url = req.url ?? "";
              if (!url.startsWith("/api/openrouter")) return next();

              const key = env.OPENROUTER_API_KEY;
              if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
                res.setHeader(
                  "Access-Control-Allow-Headers",
                  "Content-Type, Accept"
                );
                res.end();
                return;
              }
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              if (!key?.trim()) {
                res.statusCode = 503;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    error: {
                      message:
                        "Set OPENROUTER_API_KEY in .env.local for the /test OpenRouter route.",
                    },
                  })
                );
                return;
              }

              const port =
                typeof server.config.server?.port === "number"
                  ? server.config.server.port
                  : 5173;

              let body: Uint8Array;
              try {
                body = await readBody(req);
              } catch {
                res.statusCode = 400;
                res.end();
                return;
              }

              try {
                const upstream = await fetch(
                  "https://openrouter.ai/api/v1/chat/completions",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type":
                        (req.headers["content-type"] as string) ||
                        "application/json",
                      Authorization: `Bearer ${key}`,
                      "HTTP-Referer": `http://localhost:${port}`,
                      "X-Title": "Fortytwo Prime Chat",
                    },
                    body,
                  }
                );

                res.statusCode = upstream.status;
                upstream.headers.forEach((value: string, name: string) => {
                  const ln = name.toLowerCase();
                  if (ln === "content-encoding" || ln === "content-length") {
                    return;
                  }
                  res.setHeader(name, value);
                });

                if (!upstream.body) {
                  res.end();
                  return;
                }

                const reader = upstream.body.getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(value);
                }
                res.end();
              } catch (e) {
                res.statusCode = 502;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    error: { message: String((e as Error).message) },
                  })
                );
              }
            }
          );
        },
      },
    ],
    server: {
      port: 5173,
      open: true,
      /**
       * Dev-only proxy: in production the request hits the Vercel Function in
       * `api/mcp.ts`, but `vite dev` doesn't run Functions. Forward `/api/mcp`
       * straight to Fortytwo's MCP endpoint so signing flows can be tested
       * locally without `vercel dev`.
       */
      proxy: {
        "/api/mcp": {
          target: "https://mcp.fortytwo.network",
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/api\/mcp$/, "/mcp"),
        },
      },
    },
  };
});
