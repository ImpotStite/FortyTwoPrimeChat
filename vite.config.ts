import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
});
