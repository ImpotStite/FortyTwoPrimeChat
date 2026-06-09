import { useEffect, useId, useMemo, useState } from "react";
import { UsdcMark } from "./Icons";
import {
  effectivePayTo,
  formatTokenAmount,
  type PrimeSessionRecord,
} from "../lib/primeHistory";

interface Props {
  open: boolean;
  onClose: () => void;
  records: PrimeSessionRecord[];
  explorerHref: (txHash: string) => string;
  addressHref?: (addr: string) => string;
  onClear?: () => void;
}

const HARD_CAP_MS = 60 * 60 * 1000;

type SessionTone = "active" | "closed";

/**
 * Sessions past the 60 min wall clock cap are treated as closed in the list UI
 * even if `closedAt` was never written to storage.
 */
function stalePastHardCap(r: PrimeSessionRecord, now: number = Date.now()): boolean {
  if (r.closedAt) return false;
  return now - r.openedAt >= HARD_CAP_MS;
}

function effectivelyOpen(r: PrimeSessionRecord, now: number = Date.now()): boolean {
  return !r.closedAt && !stalePastHardCap(r, now);
}

function effectiveClosedAt(
  r: PrimeSessionRecord,
  now: number = Date.now()
): number | undefined {
  if (r.closedAt) return r.closedAt;
  if (stalePastHardCap(r, now)) return r.openedAt + HARD_CAP_MS;
  return undefined;
}

function sessionTone(r: PrimeSessionRecord, now: number = Date.now()): SessionTone {
  return effectivelyOpen(r, now) ? "active" : "closed";
}

function shortHash(h?: string): string {
  if (!h) return "–";
  const clean = h.startsWith("0x") ? h : `0x${h}`;
  return `${clean.slice(0, 8)}…${clean.slice(-6)}`;
}

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

function fmtDateShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function timeAgo(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function recordSpentBaseUnits(r: PrimeSessionRecord): bigint {
  try {
    if (r.spentAmount) return BigInt(r.spentAmount);
    if (r.apiReportedSpentBaseUnits) return BigInt(r.apiReportedSpentBaseUnits);
  } catch {
  }
  return 0n;
}

function Sparkline({ records }: { records: PrimeSessionRecord[] }) {
  const data = useMemo(() => {
    const sorted = [...records].sort((a, b) => a.openedAt - b.openedAt);
    return sorted.map((r) => ({
      ts: r.openedAt,
      value: Number(recordSpentBaseUnits(r)) / 1e6,
    }));
  }, [records]);

  const max = useMemo(
    () => data.reduce((m, d) => (d.value > m ? d.value : m), 0),
    [data]
  );

  if (data.length === 0 || max <= 0) return null;

  const W = 160;
  const H = 36;
  const gap = 2;
  const n = data.length;
  const barW = Math.max(2, (W - gap * (n - 1)) / n);

  return (
    <div className="session-history-spark" aria-hidden>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
      >
        <line
          x1="0"
          y1={H - 0.5}
          x2={W}
          y2={H - 0.5}
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="1"
        />
        {data.map((d, i) => {
          const h = max > 0 ? Math.max(1.5, (d.value / max) * (H - 4)) : 0;
          const x = i * (barW + gap);
          const y = H - h;
          return (
            <rect
              key={`${d.ts}-${i}`}
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={Math.min(1.5, barW / 2)}
              className="session-history-spark-bar"
            >
              <title>
                {`${fmtDateShort(d.ts)} — ${d.value.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 4,
                })} USDC`}
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

function SessionCard({
  r,
  explorerHref,
  addressHref,
}: {
  r: PrimeSessionRecord;
  explorerHref: (txHash: string) => string;
  addressHref?: (addr: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const panelId = useId();
  const now = Date.now();

  const tone = sessionTone(r, now);
  const isLive = effectivelyOpen(r, now);
  const closedAtEff = effectiveClosedAt(r, now);
  const staleCap = stalePastHardCap(r, now);
  const payTo = effectivePayTo(r);
  const msgs = r.messageCount ?? 0;

  const onChainSpent = r.spentAmount ? BigInt(r.spentAmount) : 0n;
  const apiSpent = r.apiReportedSpentBaseUnits
    ? BigInt(r.apiReportedSpentBaseUnits)
    : 0n;
  const refunded = r.refundedAmount ? BigInt(r.refundedAmount) : 0n;
  const awaitingRefund =
    !!closedAtEff &&
    !!r.settleTxHash &&
    !r.refundTxHash &&
    onChainSpent === 0n;

  let headlineKind: "spent" | "api" | "live" | "pending" | "empty" = "empty";
  let headlineValue = "";
  if (onChainSpent > 0n) {
    headlineKind = "spent";
    headlineValue = formatTokenAmount(onChainSpent.toString(), 6, 4);
  } else if (isLive && apiSpent > 0n) {
    headlineKind = "api";
    headlineValue = formatTokenAmount(apiSpent.toString(), 6, 4);
  } else if (isLive) {
    headlineKind = "live";
  } else if (awaitingRefund) {
    headlineKind = "pending";
  } else if (apiSpent > 0n) {
    headlineKind = "api";
    headlineValue = formatTokenAmount(apiSpent.toString(), 6, 4);
  } else {
    headlineKind = "spent";
    headlineValue = "0.00";
  }

  const badgeLabel = isLive ? "active" : "closed";

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
      className={`sh-card sh-card--tone-${tone} ${
        expanded ? "is-expanded" : ""
      }`}
    >
      <button
        type="button"
        className="sh-card-summary"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="sh-card-dot" aria-hidden />

        <span className="sh-card-cost">
          {headlineKind === "live" && (
            <span className="sh-card-cost-live">Live</span>
          )}
          {headlineKind === "pending" && (
            <span className="sh-card-cost-pending">Pending</span>
          )}
          {(headlineKind === "spent" || headlineKind === "api") && (
            <>
              <UsdcMark size={14} aria-hidden />
              <span className="sh-card-cost-value">{headlineValue}</span>
              {headlineKind === "api" && (
                <span className="sh-card-cost-tag" title="API-reported estimate">
                  est.
                </span>
              )}
            </>
          )}
        </span>

        <span className="sh-card-meta">
          <span className="sh-card-when" title={fmtTime(r.openedAt)}>
            {timeAgo(r.openedAt, now)}
          </span>
          <span className="sh-card-sep" aria-hidden>
            ·
          </span>
          <span className="sh-card-duration">
            {fmtDuration(r.openedAt, closedAtEff)}
          </span>
        </span>

        <span className="sh-card-msgs">
          {msgs} {msgs === 1 ? "msg" : "msgs"}
        </span>

        <span className={`sh-card-badge sh-card-badge--${tone}`}>
          {badgeLabel}
        </span>

        <span className="sh-card-chevron" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {expanded && (
      <div
        id={panelId}
        role="region"
        aria-label="Session details"
        className="sh-card-panel"
      >
        <div className="sh-section sh-section-timeline">
          <div className="sh-field">
            <span className="sh-field-label">Opened</span>
            <span className="sh-field-value">{fmtTime(r.openedAt)}</span>
            <span className="sh-field-sub">{timeAgo(r.openedAt, now)}</span>
          </div>
          <div className="sh-field">
            <span className="sh-field-label">Closed</span>
            <span className="sh-field-value">
              {closedAtEff ? fmtTime(closedAtEff) : "–"}
            </span>
            {closedAtEff && (
              <span className="sh-field-sub">
                {timeAgo(closedAtEff, now)}
                {staleCap && !r.closedAt ? " · inferred" : ""}
              </span>
            )}
          </div>
          <div className="sh-field">
            <span className="sh-field-label">Duration</span>
            <span className="sh-field-value">
              {fmtDuration(r.openedAt, closedAtEff)}
            </span>
          </div>
          <div className="sh-field">
            <span className="sh-field-label">Messages</span>
            <span className="sh-field-value">
              {msgs.toLocaleString("en-US")}
            </span>
          </div>
        </div>

        <div className="sh-section sh-section-usage">
          <div className="sh-amounts">
            {onChainSpent > 0n && (
              <div className="sh-amount sh-amount--neg" title="On-chain: authorized − refunded">
                <span className="sh-amount-label">Spent on-chain</span>
                <span className="sh-amount-value">
                  <UsdcMark size={12} />{" "}
                  {formatTokenAmount(onChainSpent.toString(), 6, 4)}
                </span>
              </div>
            )}
            {apiSpent > 0n && (
              <div
                className="sh-amount sh-amount--neutral"
                title="If the MCP payload includes USDC fields in usage metadata"
              >
                <span className="sh-amount-label">Spent (API est.)</span>
                <span className="sh-amount-value">
                  <UsdcMark size={12} />{" "}
                  {formatTokenAmount(apiSpent.toString(), 6, 4)}
                </span>
              </div>
            )}
            {refunded > 0n && (
              <div className="sh-amount sh-amount--pos" title="Refunded">
                <span className="sh-amount-label">Refunded</span>
                <span className="sh-amount-value">
                  + <UsdcMark size={12} />{" "}
                  {formatTokenAmount(refunded.toString(), 6, 4)}
                </span>
              </div>
            )}
            {r.authorizedAmount && (
              <div className="sh-amount sh-amount--muted" title="Authorized for this session">
                <span className="sh-amount-label">Authorized</span>
                <span className="sh-amount-value">
                  <UsdcMark size={12} />{" "}
                  {formatTokenAmount(r.authorizedAmount, 6, 4)}
                </span>
              </div>
            )}
            {awaitingRefund && (
              <div className="sh-amount sh-amount--pending">
                <span className="sh-amount-label">Release</span>
                <span className="sh-amount-value">On-chain release pending…</span>
              </div>
            )}
          </div>
        </div>

        <div className="sh-section sh-section-chain">
          <div className="sh-chain-grid">
            <div className="sh-chain-item">
              <span className="sh-field-label">Wallet</span>
              {linkAddr(r.walletAddress, shortHash(r.walletAddress))}
            </div>
            <div className="sh-chain-item">
              <span className="sh-field-label">USDC</span>
              <span className="sh-chain-value">
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
            <div className="sh-chain-item">
              <span className="sh-field-label">Escrow</span>
              {payTo ? (
                linkAddr(payTo, shortHash(payTo))
              ) : (
                <span className="session-history-mono">–</span>
              )}
            </div>
            <div className="sh-chain-item">
              <span className="sh-field-label">Settle TX</span>
              {r.settleTxHash ? (
                <a
                  href={explorerHref(r.settleTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="session-history-mono-link"
                  title={r.settleTxHash}
                >
                  {shortHash(r.settleTxHash)}
                </a>
              ) : (
                <span className="session-history-mono">–</span>
              )}
            </div>
            <div className="sh-chain-item">
              <span className="sh-field-label">Refund TX</span>
              {r.refundTxHash ? (
                <a
                  href={explorerHref(r.refundTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="session-history-mono-link"
                  title={r.refundTxHash}
                >
                  {shortHash(r.refundTxHash)}
                </a>
              ) : (
                <span className="session-history-mono">–</span>
              )}
            </div>
            <div className="sh-chain-item sh-chain-item--id">
              <span className="sh-field-label">Session ID</span>
              <div className="sh-session-id-row">
                <code className="sh-session-id" title={r.id}>
                  {shortSessionId(r.id)}
                </code>
                <button
                  type="button"
                  className="sh-copy-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    void copySessionId();
                  }}
                >
                  {idCopied ? "Copied" : "Copy ID"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
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
        if (r.closedAt && !r.refundTxHash && r.settleTxHash)
          awaitingRefundCount += 1;
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

  const spentLabel =
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

  const count = records.length;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal sh-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Past sessions"
      >
        <header className="sh-header">
          <div className="sh-header-title">
            <h2 className="modal-title sh-title">Past sessions</h2>
            <span className="sh-subtitle">
              {count === 0
                ? "No sessions yet"
                : `${count} ${count === 1 ? "session" : "sessions"}`}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn sh-close-x"
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
        </header>

        {count === 0 ? (
          <div className="sh-empty">
            <div className="sh-empty-icon" aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 12a9 9 0 1 0 3-6.7M3 5v4h4M12 7v5l3 2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="sh-empty-title">No past sessions yet</p>
            <p className="sh-empty-sub">
              They will appear here after your first paid message.
            </p>
          </div>
        ) : (
          <>
            <section className="sh-summary">
              <dl className="sh-stats">
                <div className="sh-stat sh-stat--spent">
                  <dt
                    className="sh-stat-label"
                    title="USDC kept by the network after escrow release (authorized − refunded on-chain)."
                  >
                    Spent
                  </dt>
                  <dd
                    className={`sh-stat-value${
                      spentLabel === "Pending" ? " is-pending" : ""
                    }`}
                  >
                    <UsdcMark size={14} aria-hidden />
                    <span>{spentLabel}</span>
                  </dd>
                </div>

                <div className="sh-stat sh-stat--refunded">
                  <dt
                    className="sh-stat-label"
                    title="USDC returned to your wallet after the session closed."
                  >
                    Refunded
                  </dt>
                  <dd
                    className={`sh-stat-value${
                      refundedLabel === "Pending" ? " is-pending" : ""
                    }`}
                  >
                    <UsdcMark size={14} aria-hidden />
                    <span>{refundedLabel}</span>
                  </dd>
                </div>

                <div className="sh-stat sh-stat--messages">
                  <dt className="sh-stat-label">Messages</dt>
                  <dd className="sh-stat-value">
                    <span>{totals.messages.toLocaleString("en-US")}</span>
                  </dd>
                </div>

                {apiSpentLabel && (
                  <div className="sh-stat sh-stat--est">
                    <dt
                      className="sh-stat-label"
                      title="Sum of per-call USDC charges if the MCP response includes them in _meta.usage."
                    >
                      Spent (est.)
                    </dt>
                    <dd className="sh-stat-value">
                      <UsdcMark size={14} aria-hidden />
                      <span>{apiSpentLabel}</span>
                    </dd>
                  </div>
                )}
              </dl>

              <Sparkline records={records} />
            </section>

            {totals.auth > 0n &&
              totals.remainder !== 0n &&
              absRemainder <= 50_000n && (
                <p
                  className="sh-note"
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

            <div className="sh-list">
              {records.map((r) => (
                <SessionCard
                  key={r.id}
                  r={r}
                  explorerHref={explorerHref}
                  addressHref={addressHref}
                />
              ))}
            </div>
          </>
        )}

        <footer className="sh-footer">
          {onClear && count > 0 && (
            <button
              type="button"
              className="btn-ghost sh-clear-btn"
              onClick={() => {
                if (confirm("Delete the local session history?")) onClear();
              }}
            >
              Clear history
            </button>
          )}
          <button
            type="button"
            className="primary-btn sh-close-btn"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
