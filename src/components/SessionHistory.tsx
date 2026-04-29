/**
 * Modal listing past Fortytwo Prime billing sessions for the connected wallet.
 *
 * Each row shows: opened/closed timestamps, close reason, authorized vs.
 * spent USDC, message count, token totals, and explorer links to the
 * settle/refund transactions.
 */

import { useEffect, useMemo, useState } from "react";
import { UsdcMark } from "./Icons";
import {
  effectivePayTo,
  formatTokenAmount,
  type CloseReason,
  type PrimeSessionRecord,
} from "../lib/primeHistory";

interface Props {
  open: boolean;
  onClose: () => void;
  records: PrimeSessionRecord[];
  explorerHref: (txHash: string) => string;
  /** Optional block explorer URL builder for `0x` addresses (wallet, USDC, escrow). */
  addressHref?: (addr: string) => string;
  onClear?: () => void;
}

const REASON_LABEL: Record<CloseReason, string> = {
  idle: "idle 10min",
  "hard-cap": "60min cap",
  "402": "re-payment",
  "410": "session gone",
  manual: "ended manually",
  error: "error",
};

function shortHash(h?: string): string {
  if (!h) return "—";
  const clean = h.startsWith("0x") ? h : `0x${h}`;
  return `${clean.slice(0, 8)}…${clean.slice(-6)}`;
}

/** Truncate Fortytwo session id (UUID) for display; full id in `title`. */
function shortSessionId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(open: number, close?: number): string {
  if (!close) return "open";
  const ms = close - open;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function networkLine(r: PrimeSessionRecord): string {
  const fromNet = r.network
    ? /eip155:(\d+)/i.exec(r.network)?.[1]
    : undefined;
  const cid =
    r.chainId ?? (fromNet != null ? Number(fromNet) : undefined);
  if (r.network && cid != null) return `${r.network} · ${cid}`;
  if (r.network) return r.network;
  if (cid != null) return `Chain ${cid}`;
  return "—";
}

function SessionDetailRow({
  r,
  explorerHref,
  addressHref,
}: {
  r: PrimeSessionRecord;
  explorerHref: (txHash: string) => string;
  addressHref?: (addr: string) => string;
}) {
  const [idCopied, setIdCopied] = useState(false);
  const isOpen = !r.closedAt;
  const payTo = effectivePayTo(r);
  const tokIn = r.tokensIn ?? 0;
  const tokOut = r.tokensOut ?? 0;
  const tokTotal = tokIn + tokOut;
  const msgs = r.messageCount ?? 0;
  const avgTok =
    msgs > 1 && tokTotal > 0 ? Math.round(tokTotal / msgs) : null;

  const linkAddr = (addr: string, label: string) =>
    addressHref ? (
      <a
        href={addressHref(addr)}
        target="_blank"
        rel="noopener noreferrer"
        className="session-history-mono-link"
        title={addr}
      >
        {label}
      </a>
    ) : (
      <span className="session-history-mono" title={addr}>
        {label}
      </span>
    );

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(r.id);
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={`session-history-row ${isOpen ? "is-open" : ""}`}
    >
      <div className="session-history-row-head">
        <span className="session-history-when">{fmtTime(r.openedAt)}</span>
        <span className="session-history-duration">
          {fmtDuration(r.openedAt, r.closedAt)}
        </span>
        <span
          className={`session-history-reason${
            isOpen
              ? " is-active"
              : r.closeReason === "error"
                ? " is-error"
                : ""
          }`}
        >
          {isOpen ? "active" : REASON_LABEL[r.closeReason ?? "manual"]}
        </span>
      </div>

      <div className="session-history-row-body">
        <div className="session-history-detail-grid">
          <div className="session-history-detail-block">
            <span className="session-history-detail-label">Opened</span>
            <span className="session-history-detail-value">
              {fmtTime(r.openedAt)}
            </span>
          </div>
          <div className="session-history-detail-block">
            <span className="session-history-detail-label">Closed</span>
            <span className="session-history-detail-value">
              {r.closedAt ? fmtTime(r.closedAt) : "—"}
            </span>
          </div>
          <div className="session-history-detail-block">
            <span className="session-history-detail-label">Network</span>
            <span
              className="session-history-detail-value session-history-mono"
              title={networkLine(r)}
            >
              {networkLine(r)}
            </span>
          </div>
          <div className="session-history-detail-block">
            <span className="session-history-detail-label">Authorized</span>
            <span className="session-history-detail-value">
              <UsdcMark size={12} />{" "}
              {r.authorizedAmountDisplay ||
                `${formatTokenAmount(r.authorizedAmount, 6, 4)} USDC`}
            </span>
          </div>
        </div>

        {(tokIn > 0 || tokOut > 0 || msgs > 0) && (
          <div className="session-history-tokens">
            <div className="session-history-tokens-flow" title="Cumulative tokens from MCP usage metadata for this session">
              <span className="session-history-tokens-inout">
                ↑ {tokIn.toLocaleString("en-US")} in · ↓{" "}
                {tokOut.toLocaleString("en-US")} out
              </span>
              <span className="session-history-tokens-meta">
                <span className="session-history-tokens-total">
                  {tokTotal.toLocaleString("en-US")} tokens total
                </span>
                <span className="session-history-tokens-msgs">
                  {msgs} {msgs === 1 ? "message" : "messages"}
                </span>
                {avgTok != null && (
                  <span title="Average tokens per message (this session)">
                    ~{avgTok.toLocaleString("en-US")} avg / message
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        <div className="session-history-amounts">
          {r.apiReportedSpentBaseUnits &&
            BigInt(r.apiReportedSpentBaseUnits) > 0n && (
              <span title="If the MCP payload includes USDC fields in usage metadata">
                ≈ {formatTokenAmount(r.apiReportedSpentBaseUnits, 6, 4)} API est.
                spent
              </span>
            )}
          {r.spentAmount && BigInt(r.spentAmount) > 0n && (
            <span title="On-chain: authorized − refunded">
              ↦ {formatTokenAmount(r.spentAmount, 6, 4)} spent
            </span>
          )}
          {r.refundedAmount && BigInt(r.refundedAmount) > 0n && (
            <span title="Refunded" className="session-history-pos">
              + {formatTokenAmount(r.refundedAmount, 6, 4)} refunded
            </span>
          )}
          {r.closedAt &&
            !r.refundTxHash &&
            r.settleTxHash &&
            !(r.spentAmount && BigInt(r.spentAmount) > 0n) && (
              <span className="session-history-pending">
                On-chain release pending…
              </span>
            )}
        </div>

        <div className="session-history-chain-row">
          <div className="session-history-chain-item">
            <span className="session-history-detail-label">Wallet</span>
            {linkAddr(r.walletAddress, shortHash(r.walletAddress))}
          </div>
          <div className="session-history-chain-item">
            <span className="session-history-detail-label">USDC</span>
            {r.asset ? (
              linkAddr(r.asset, shortHash(r.asset))
            ) : (
              <span className="session-history-mono">—</span>
            )}
          </div>
          <div className="session-history-chain-item">
            <span className="session-history-detail-label">Escrow</span>
            {payTo ? (
              linkAddr(payTo, shortHash(payTo))
            ) : (
              <span className="session-history-mono">—</span>
            )}
          </div>
        </div>

        <div className="session-history-txs">
          {r.settleTxHash && (
            <a
              href={explorerHref(r.settleTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              title={r.settleTxHash}
            >
              Settle {shortHash(r.settleTxHash)}
            </a>
          )}
          {r.refundTxHash && (
            <a
              href={explorerHref(r.refundTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              title={r.refundTxHash}
            >
              Refund {shortHash(r.refundTxHash)}
            </a>
          )}
        </div>

        <div className="session-history-session-id">
          <code className="session-history-id-code" title={r.id}>
            {shortSessionId(r.id)}
          </code>
          <button
            type="button"
            className="session-history-copy-id"
            onClick={() => void copySessionId()}
          >
            {idCopied ? "Copied" : "Copy session ID"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionHistory({
  open,
  onClose,
  records,
  explorerHref,
  addressHref,
  onClear,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const totals = useMemo(() => {
    let auth = 0n;
    let refunded = 0n;
    let spent = 0n;
    let apiSpent = 0n;
    let messages = 0;
    let tokens = 0;
    let awaitingRefundCount = 0;
    try {
      for (const r of records) {
        if (r.authorizedAmount) auth += BigInt(r.authorizedAmount);
        if (r.refundedAmount) refunded += BigInt(r.refundedAmount);
        if (r.spentAmount) spent += BigInt(r.spentAmount);
        if (r.apiReportedSpentBaseUnits)
          apiSpent += BigInt(r.apiReportedSpentBaseUnits);
        messages += r.messageCount ?? 0;
        tokens += (r.tokensIn ?? 0) + (r.tokensOut ?? 0);
        if (r.closedAt && !r.refundTxHash && r.settleTxHash) awaitingRefundCount += 1;
      }
    } catch {
      /* ignore malformed amounts */
    }
    return {
      auth,
      refunded,
      spent,
      apiSpent,
      messages,
      tokens,
      awaitingRefundCount,
      remainder: auth - spent - refunded,
    };
  }, [records]);

  const absRemainder =
    totals.remainder < 0n ? -totals.remainder : totals.remainder;

  const spentOnChainLabel =
    totals.spent > 0n
      ? formatTokenAmount(totals.spent.toString(), 6, 4)
      : totals.awaitingRefundCount > 0
        ? "Pending"
        : "—";

  const refundedLabel =
    totals.refunded > 0n
      ? formatTokenAmount(totals.refunded.toString(), 6, 4)
      : totals.awaitingRefundCount > 0
        ? "Pending"
        : "—";

  const apiSpentLabel =
    totals.apiSpent > 0n
      ? formatTokenAmount(totals.apiSpent.toString(), 6, 4)
      : null;

  if (!open) return null;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal session-history"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Past sessions"
      >
        <div className="session-history-header">
          <h2 className="modal-title">Past sessions</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {records.length === 0 ? (
          <p className="modal-text session-history-empty">
            No past sessions yet — they'll appear here after your first paid
            message.
          </p>
        ) : (
          <>
            <div className="session-history-totals">
              <div className="session-history-total">
                <span
                  className="session-history-total-label"
                  title="Sum of USDC authorized across listed sessions."
                >
                  Total authorized
                </span>
                <span className="session-history-total-value">
                  <UsdcMark size={12} />{" "}
                  {formatTokenAmount(totals.auth.toString(), 6, 4)}
                </span>
              </div>
              <div className="session-history-total">
                <span
                  className="session-history-total-label"
                  title="USDC kept by the network after escrow release (authorized − refunded on-chain)."
                >
                  Spent
                </span>
                <span
                  className={`session-history-total-value${
                    spentOnChainLabel === "Pending" ? " is-pending" : ""
                  }`}
                >
                  <UsdcMark size={12} /> {spentOnChainLabel}
                </span>
              </div>
              {apiSpentLabel && (
                <div className="session-history-total">
                  <span
                    className="session-history-total-label"
                    title="Sum of per-call charges if the MCP response includes USDC fields in _meta.usage."
                  >
                    Spent (est.)
                  </span>
                  <span className="session-history-total-value">
                    <UsdcMark size={12} /> {apiSpentLabel}
                  </span>
                </div>
              )}
              <div className="session-history-total">
                <span
                  className="session-history-total-label"
                  title="USDC returned to your wallet after the session closed."
                >
                  Refunded
                </span>
                <span
                  className={`session-history-total-value${
                    refundedLabel === "Pending" ? " is-pending" : ""
                  }`}
                >
                  <UsdcMark size={12} /> {refundedLabel}
                </span>
              </div>
              <div className="session-history-total">
                <span className="session-history-total-label">Messages</span>
                <span className="session-history-total-value">
                  {totals.messages.toLocaleString("en-US")}
                </span>
              </div>
              {totals.tokens > 0 && (
                <div className="session-history-total">
                  <span className="session-history-total-label">Tokens</span>
                  <span className="session-history-total-value">
                    {totals.tokens.toLocaleString("en-US")}
                  </span>
                </div>
              )}
            </div>
            {totals.auth > 0n &&
              totals.remainder !== 0n &&
              absRemainder <= 50_000n && (
                <p
                  className="session-history-totals-note"
                  title={`Exact remainder: ${formatTokenAmount(
                    absRemainder.toString(),
                    6,
                    6
                  )} USDC (base units).`}
                >
                  Authorized versus spent + refunded can differ by a fraction of a
                  USDC due to rounding in the UI or minimal on-chain dust.
                </p>
              )}

            <div className="session-history-list">
              {records.map((r) => (
                <SessionDetailRow
                  key={r.id}
                  r={r}
                  explorerHref={explorerHref}
                  addressHref={addressHref}
                />
              ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          {onClear && records.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                if (confirm("Delete the local session history?")) onClear();
              }}
            >
              Clear history
            </button>
          )}
          <button
            type="button"
            className="primary-btn session-history-close-btn"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
