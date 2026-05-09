import { useCallback, useState } from "react";
import {
  FORTYTWO_MCP_HTTP_ENDPOINT,
  FORTYTWO_MCP_PROTOCOL_VERSION,
} from "../lib/fortytwo";

/**
 * Dev-only MCP connectivity checks for `/test` (LegacyApp).
 * Uses the same endpoint and protocol version as Prime (`/api/mcp` proxy by default).
 */
export function FortytwoMcpProbe() {
  const [busy, setBusy] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);

  const append = useCallback((line: string) => {
    setLines((prev) => [
      ...prev,
      `[${new Date().toISOString()}] ${line}`,
    ]);
  }, []);

  const runInitialize = useCallback(async () => {
    setBusy("initialize");
    try {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "initialize",
        params: {
          protocolVersion: FORTYTWO_MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "fortytwo-prime-test", version: "0.1.0" },
        },
      });
      const res = await fetch(FORTYTWO_MCP_HTTP_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
      const upstream = res.headers.get("x-upstream-status");
      const text = await res.text();
      const snip =
        text.length > 400 ? `${text.slice(0, 400)}…` : text;
      append(
        `initialize → HTTP ${res.status} · x-upstream-status: ${upstream ?? "—"} · ${snip.replace(/\s+/g, " ")}`
      );
    } catch (e) {
      append(`initialize → fetch error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [append]);

  const runToolsCallNoPay = useCallback(async () => {
    setBusy("tools/call");
    try {
      const idem = crypto.randomUUID();
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: {
          name: "ask_fortytwo_prime",
          arguments: { query: "MCP probe ping (no payment expected)" },
        },
      });
      const res = await fetch(FORTYTWO_MCP_HTTP_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-idempotency-key": idem,
        },
        body,
      });
      const upstream = res.headers.get("x-upstream-status");
      const pay = res.headers.get("payment-required");
      const text = await res.text();
      const snip =
        text.length > 300 ? `${text.slice(0, 300)}…` : text;
      append(
        `tools/call → HTTP ${res.status} · x-upstream-status: ${upstream ?? "—"} · payment-required: ${pay ? `${pay.slice(0, 48)}… (${pay.length} chars)` : "—"} · body: ${snip.replace(/\s+/g, " ")}`
      );
    } catch (e) {
      append(`tools/call → fetch error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [append]);

  const clear = useCallback(() => setLines([]), []);

  return (
    <section className="legacy-mcp-probe" aria-label="Fortytwo MCP probe">
      <div className="legacy-mcp-probe-head">
        <h2 className="legacy-mcp-probe-title">Fortytwo MCP probe</h2>
        <p className="legacy-mcp-probe-meta">
          Endpoint: <code>{FORTYTWO_MCP_HTTP_ENDPOINT}</code> · protocol:{" "}
          <code>{FORTYTWO_MCP_PROTOCOL_VERSION}</code>
        </p>
        <div className="legacy-mcp-probe-actions">
          <button
            type="button"
            className="error-action-btn error-action-btn-primary"
            disabled={!!busy}
            onClick={() => void runInitialize()}
          >
            {busy === "initialize" ? "Running…" : "Run initialize"}
          </button>
          <button
            type="button"
            className="error-action-btn error-action-btn-primary"
            disabled={!!busy}
            onClick={() => void runToolsCallNoPay()}
          >
            {busy === "tools/call" ? "Running…" : "Run tools/call (expect 402)"}
          </button>
          <button type="button" className="error-action-btn" onClick={clear}>
            Clear log
          </button>
        </div>
      </div>
      {lines.length > 0 && (
        <pre className="legacy-mcp-probe-log">{lines.join("\n")}</pre>
      )}
    </section>
  );
}
