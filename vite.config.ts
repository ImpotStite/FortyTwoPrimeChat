import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      {
        name: "openrouter-dev-proxy",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
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

            const chunks: Buffer[] = [];
            try {
              for await (const chunk of req) {
                chunks.push(chunk as Buffer);
              }
            } catch {
              res.statusCode = 400;
              res.end();
              return;
            }
            const body = Buffer.concat(chunks);

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
                    "X-Title": "FortyTwo Prime Chat",
                  },
                  body,
                }
              );

              res.statusCode = upstream.status;
              upstream.headers.forEach((value, name) => {
                const ln = name.toLowerCase();
                if (ln === "content-encoding" || ln === "content-length") return;
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
                res.write(Buffer.from(value));
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
          });
        },
      },
    ],
    server: {
      port: 5173,
      open: true,
      /**
       * Dev-only proxy: in production the request hits the Vercel Function in
       * `api/mcp.ts`, but `vite dev` doesn't run Functions. Forward `/api/mcp`
       * straight to FortyTwo's MCP endpoint so signing flows can be tested
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
