/**
 * Modal listing past Fortytwo Prime billing sessions for the connected wallet.
 *
 * Each row shows: opened/closed timestamps, close reason, in/out token
 * tallies, message count, spent/refunded USDC, addresses/TX links, session id.
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
  if (!h) return "–";
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
  const msgs = r.messageCount ?? 0;

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
        <div className="session-history-detail-grid session-history-detail-grid--pair">
          <div className="session-history-detail-block">
            <span className="session-history-detail-label">Opened</span>
            <span className="session-history-detail-value">
              {fmtTime(r.openedAt)}
            </span>
          </div>
          <div className="session-history-detail-block">
            <span className="session-history-detail-label">Closed</span>
            <span className="session-history-detail-value">
              {r.closedAt ? fmtTime(r.closedAt) : "–"}
            </span>
          </div>
        </div>

        {(tokIn > 0 || tokOut > 0 || msgs > 0) && (
          <div
            className="session-history-tokens"
            title="Token counts from MCP usage for this session."
          >
            <div className="session-history-tokens-row">
              {(tokIn > 0 || tokOut > 0) && (
                <span className="session-history-tokens-inout">
                  ↑ {tokIn.toLocaleString("en-US")} in · ↓{" "}
                  {tokOut.toLocaleString("en-US")} out
                </span>
              )}
              {msgs > 0 && (
                <span className="session-history-tokens-msgs">
                  {msgs} {msgs === 1 ? "message" : "messages"}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="session-history-amounts">
          {r.apiReportedSpentBaseUnits &&
            BigInt(r.apiReportedSpentBaseUnits) > 0n && (
              <span
                className="session-history-spent"
                title="If the MCP payload includes USDC fields in usage metadata"
              >
                ≈ <UsdcMark size={12} />{" "}
                {formatTokenAmount(r.apiReportedSpentBaseUnits, 6, 4)} API est.
                spent
              </span>
            )}
          {r.spentAmount && BigInt(r.spentAmount) > 0n && (
            <span className="session-history-spent" title="On-chain: authorized − refunded">
              ↦ <UsdcMark size={12} /> {formatTokenAmount(r.spentAmount, 6, 4)}{" "}
              spent
            </span>
          )}
          {r.refundedAmount && BigInt(r.refundedAmount) > 0n && (
            <span title="Refunded" className="session-history-pos">
              + <UsdcMark size={12} />{" "}
              {formatTokenAmount(r.refundedAmount, 6, 4)} refunded
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

        <div className="session-history-chain-grid">
          <div className="session-history-chain-item">
            <span className="session-history-detail-label">Wallet</span>
            {linkAddr(r.walletAddress, shortHash(r.walletAddress))}
          </div>
          <div className="session-history-chain-item">
            <span className="session-history-detail-label">USDC</span>
            <span className="session-history-chain-value">
              {r.asset ? (
                <>
                  <UsdcMark size={12} aria-hidden />
                  {linkAddr(r.asset, shortHash(r.asset))}
                </>
              ) : (
                <span className="session-history-mono">–</span>
              )}
            </span>
          </div>
          <div className="session-history-chain-item">
            <span className="session-history-detail-label">Escrow</span>
            {payTo ? (
              linkAddr(payTo, shortHash(payTo))
            ) : (
              <span className="session-history-mono">–</span>
            )}
          </div>

          <div className="session-history-chain-item">
            <span className="session-history-detail-label">Settle TX</span>
            {r.settleTxHash ? (
              <a
                href={explorerHref(r.settleTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="session-history-mono-link session-history-tx-link"
                title={r.settleTxHash}
              >
                {shortHash(r.settleTxHash)}
              </a>
            ) : (
              <span className="session-history-mono">–</span>
            )}
          </div>
          <div
            className="session-history-chain-item session-history-chain-item--spacer"
            aria-hidden
          />
          <div className="session-history-chain-item">
            <span className="session-history-detail-label">Refund TX</span>
            {r.refundTxHash ? (
              <a
                href={explorerHref(r.refundTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="session-history-mono-link session-history-tx-link"
                title={r.refundTxHash}
              >
                {shortHash(r.refundTxHash)}
              </a>
            ) : (
              <span className="session-history-mono">–</span>
            )}
          </div>
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
    let awaitingRefundCount = 0;
    try {
      for (const r of records) {
        if (r.authorizedAmount) auth += BigInt(r.authorizedAmount);
        if (r.refundedAmount) refunded += BigInt(r.refundedAmount);
        if (r.spentAmount) spent += BigInt(r.spentAmount);
        if (r.apiReportedSpentBaseUnits)
          apiSpent += BigInt(r.apiReportedSpentBaseUnits);
        messages += r.messageCount ?? 0;
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
        : "–";

  const refundedLabel =
    totals.refunded > 0n
      ? formatTokenAmount(totals.refunded.toString(), 6, 4)
      : totals.awaitingRefundCount > 0
        ? "Pending"
        : "–";

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
            No past sessions yet, they'll appear here after your first paid
            message.
          </p>
        ) : (
          <>
            <div className="session-history-totals">
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
                  Session totals may differ from on-chain figures by a fraction of
                  a USDC due to rounding or minimal dust.
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
