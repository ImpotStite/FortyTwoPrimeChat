/**
 * Click-to-expand popover for the current Fortytwo Prime session.
 *
 * Surfaces the data already captured elsewhere: session id, opened/expires,
 * authorized/spent USDC, settle TX, refund TX (when known), and a running
 * tally of messages + tokens.
 */

import { useEffect, useRef } from "react";
import { UsdcMark } from "./Icons";
import {
  formatTokenAmount,
  type PrimeSessionRecord,
} from "../lib/primeHistory";
import type { PrimeSession } from "../lib/fortytwo";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The live session held in PrimeApp state (may be expired). */
  session: PrimeSession | null;
  /** History row for this session (provides messageCount, tokens, refund). */
  record?: PrimeSessionRecord;
  /** Effective expiry timestamp (min of hard cap and idle window). */
  effectiveExpiresAt: number | null;
  /** Wall-clock cause of expiry: "idle" | "cap". */
  expiresReason: "idle" | "cap" | null;
  /** Builder for explorer links (settle/refund TXs). */
  explorerHref: (txHash: string) => string;
  addressHref?: (address: string) => string;
  /** Optional callback to clear the cached session locally. */
  onEndSessionLocally?: () => void;
  /** On-chain escrow id for timeout refund fallback. */
  escrowId?: string;
  /** UI state for `refundAfterTimeout()` eligibility. */
  timeoutRefundUi?:
    | { kind: "hidden" }
    | { kind: "checking" }
    | { kind: "waiting"; countdown: string }
    | { kind: "claimable"; amountDisplay: string }
    | { kind: "claiming" }
    | { kind: "released" };
  /** Claim stuck escrow funds after the on-chain timeout (~90 min). */
  onClaimTimeoutRefund?: () => void;
}

function timeAgo(ts?: number): string {
  if (!ts) return "–";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatUntil(ts: number | null): string {
  if (ts == null) return "–";
  const diff = ts - Date.now();
  if (diff <= 0) return "expired";
  const min = Math.round(diff / 60000);
  if (min < 1) return "<1 min";
  return `${min} min`;
}

function shortHash(h?: string): string {
  if (!h) return "–";
  const clean = h.startsWith("0x") ? h : `0x${h}`;
  return `${clean.slice(0, 8)}…${clean.slice(-6)}`;
}

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export function SessionInfo(props: Props) {
  const {
    open,
    onClose,
    session,
    record,
    effectiveExpiresAt,
    expiresReason,
    explorerHref,
    addressHref,
    onEndSessionLocally,
    escrowId,
    timeoutRefundUi,
    onClaimTimeoutRefund,
  } = props;

  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !session) return null;

  const authorizedDisplay = session.authorizedAmountDisplay;
  const refunded = record?.refundedAmount;
  const spent = record?.spentAmount;
  const apiSpent = record?.apiReportedSpentBaseUnits;
  let remainingEstimate: string | null = null;
  if (apiSpent && session.authorizedAmount) {
    try {
      const rem = BigInt(session.authorizedAmount) - BigInt(apiSpent);
      if (rem >= 0n) {
        remainingEstimate = formatTokenAmount(rem.toString());
      }
    } catch {
      /* ignore */
    }
  }
  const messageCount = record?.messageCount ?? 0;
  const tokensIn = record?.tokensIn ?? 0;
  const tokensOut = record?.tokensOut ?? 0;
  const tokensTotal = tokensIn + tokensOut;
  const isExpired =
    effectiveExpiresAt != null && effectiveExpiresAt - Date.now() <= 0;

  return (
    <div className="session-popover" ref={ref} role="dialog" aria-label="Session details">
      <div className="session-popover-header">
        <div className="session-popover-title">
          {isExpired ? "Session expired" : "Active session"}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <dl className="session-rows">
        <Row label="Session ID" value={<code title={session.sessionId}>{shortId(session.sessionId)}</code>} />
        <Row label="Opened" value={timeAgo(session.openedAt)} />
        <Row
          label={isExpired ? "Closed" : "Closes in"}
          value={
            isExpired
              ? record?.closedAt
                ? timeAgo(record.closedAt)
                : "now"
              : `${formatUntil(effectiveExpiresAt)}${
                  expiresReason ? ` (${expiresReason === "idle" ? "idle" : "hard cap"})` : ""
                }`
          }
        />
        <Row
          label="Authorized"
          value={
            <span className="session-amount">
              <UsdcMark size={12} /> {authorizedDisplay}
            </span>
          }
        />
        {refunded && (
          <Row
            label="Refunded"
            value={
              <span className="session-amount session-amount-pos">
                <UsdcMark size={12} /> {formatTokenAmount(refunded)}
              </span>
            }
          />
        )}
        {spent && (
          <Row
            label="Spent"
            value={
              <span className="session-amount">
                <UsdcMark size={12} /> {formatTokenAmount(spent)}
              </span>
            }
          />
        )}
        {remainingEstimate && !refunded && sessionStateActive(session, isExpired) && (
          <Row
            label="Est. remaining"
            value={
              <span
                className="session-amount"
                title="API-reported charges only; on-chain escrow is authoritative"
              >
                <UsdcMark size={12} /> {remainingEstimate}
              </span>
            }
          />
        )}
        <Row
          label="Messages"
          value={`${messageCount} ${messageCount === 1 ? "request" : "requests"}`}
        />
        {tokensTotal > 0 && (
          <Row
            label="Tokens"
            value={
              <span title={`in ${tokensIn} · out ${tokensOut}`}>
                {tokensTotal.toLocaleString()} (in {tokensIn.toLocaleString()} / out {tokensOut.toLocaleString()})
              </span>
            }
          />
        )}
        <Row
          label="Settle TX"
          value={
            session.paymentTxHash ? (
              <a
                href={explorerHref(session.paymentTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="session-link"
                title={session.paymentTxHash}
              >
                {shortHash(session.paymentTxHash)}
              </a>
            ) : (
              "–"
            )
          }
        />
        <Row
          label="Refund TX"
          value={
            record?.refundTxHash ? (
              <a
                href={explorerHref(record.refundTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="session-link"
                title={record.refundTxHash}
              >
                {shortHash(record.refundTxHash)}
              </a>
            ) : isExpired ? (
              <span className="session-pending">awaiting on-chain release…</span>
            ) : (
              <span className="session-muted">released after close</span>
            )
          }
        />
        {session.payTo && addressHref && (
          <Row
            label="Escrow"
            value={
              <a
                href={addressHref(session.payTo)}
                target="_blank"
                rel="noopener noreferrer"
                className="session-link"
                title={session.payTo}
              >
                {shortHash(session.payTo)}
              </a>
            }
          />
        )}
        <Row label="Network" value={<code>{session.network}</code>} />
        {escrowId && (
          <Row
            label="Escrow ID"
            value={<code title={escrowId}>{shortHash(escrowId)}</code>}
          />
        )}
      </dl>

      {timeoutRefundUi && timeoutRefundUi.kind !== "hidden" && (
        <div className="session-timeout-refund" role="status">
          {timeoutRefundUi.kind === "checking" && (
            <p className="session-muted">Checking on-chain escrow…</p>
          )}
          {timeoutRefundUi.kind === "waiting" && (
            <p className="session-muted">
              Timeout refund available in {timeoutRefundUi.countdown} if Fortytwo
              has not released funds.
            </p>
          )}
          {(timeoutRefundUi.kind === "claimable" ||
            timeoutRefundUi.kind === "claiming") &&
            onClaimTimeoutRefund && (
            <>
              {timeoutRefundUi.kind === "claimable" && (
                <p className="session-timeout-refund-hint">
                  Escrow still locked ({timeoutRefundUi.amountDisplay} USDC). You
                  can claim a timeout refund on-chain.
                </p>
              )}
              <button
                type="button"
                className="btn-ghost session-popover-end"
                onClick={onClaimTimeoutRefund}
                disabled={timeoutRefundUi.kind === "claiming"}
              >
                {timeoutRefundUi.kind === "claiming"
                  ? "Claiming…"
                  : "Claim timeout refund"}
              </button>
            </>
          )}
          {timeoutRefundUi.kind === "released" && isExpired && !refunded && (
            <p className="session-muted">
              No active escrow on-chain. A normal release may still be pending as
              a USDC transfer.
            </p>
          )}
        </div>
      )}

      {onEndSessionLocally && !isExpired && (
        <div className="session-popover-actions">
          <button
            type="button"
            className="btn-ghost session-popover-end"
            onClick={onEndSessionLocally}
            title="Forget the local session, next message will require a new signature"
          >
            End session locally
          </button>
        </div>
      )}
    </div>
  );
}

function sessionStateActive(
  session: PrimeSession,
  isExpired: boolean
): boolean {
  return !isExpired && !!session.sessionId;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="session-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
