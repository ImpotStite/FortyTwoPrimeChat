import { useEffect, useMemo, useRef, useState } from "react";
import { compareGroups, groupLabel } from "../lib/format";
import {
  FOR_BASE_PER_REQUEST,
  FOR_MULTIPLIER_FIRST500,
  FOR_MULTIPLIER_501_2000,
  FOR_PER_MCP_3X,
  FOR_PER_MCP_501_2000,
  FOR_STREAK_BONUS,
  REWARDS_ACCOUNT_URL,
  REWARDS_DOCS_URL,
  STREAK_REQUIRED_DAYS,
  type RewardsSnapshot,
} from "../lib/rewardsProgram";
import type { Conversation } from "../types";
import { FloatingRewardBubble } from "./FloatingRewardBubble";

const DONATION_WALLET = "0xC1F112Cd1D2A6B60B13514602fD0156BA910D488";

function RewardsLaunchTimeline({
  current,
  required,
  claimed,
}: {
  current: number;
  required: number;
  claimed: boolean;
}) {
  const filled = Math.min(Math.max(current, 0), required);
  const progressPct = required > 0 ? (filled / required) * 100 : 0;

  return (
    <div className="rewards-launch-timeline">
      <h3 id="rewards-section-streak" className="rewards-launch-timeline-title">
        Launch streak
      </h3>
      <p className="rewards-launch-timeline-desc">
        One step per calendar day when you start a Prime billing session. Multiple
        launches on the same day still count as one step.
      </p>
      <div
        className={`rewards-launch-timeline-board${
          claimed ? " rewards-launch-timeline-board--claimed" : ""
        }`}
      >
        <div className="rewards-launch-days" aria-hidden>
          {Array.from({ length: required }, (_, i) => {
            const dayNum = i + 1;
            const isDone = dayNum <= filled;
            return (
              <div key={dayNum} className="rewards-launch-day">
                <div
                  className={`rewards-launch-day-box${
                    isDone ? " rewards-launch-day-box--done" : ""
                  }`}
                >
                  {isDone ? "✓" : dayNum}
                </div>
                <span
                  className={`rewards-launch-day-label${
                    isDone ? " rewards-launch-day-label--on" : ""
                  }`}
                >
                  Day {dayNum}
                </span>
              </div>
            );
          })}
        </div>
        <div className="rewards-launch-track" aria-hidden>
          <div className="rewards-launch-track-bg" />
          <div
            className="rewards-launch-track-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {claimed ? (
          <div className="rewards-launch-claimed-overlay" role="status">
            <span className="rewards-launch-claimed-ribbon">Streak bonus claimed</span>
          </div>
        ) : null}
      </div>
      <div className="rewards-launch-bonus-row">
        <div>
          <div className="rewards-launch-bonus-title">Streak bonus</div>
          <div className="rewards-launch-bonus-sub">
            Complete {STREAK_REQUIRED_DAYS} consecutive days
          </div>
        </div>
        <div className="rewards-launch-bonus-amt">
          +{FOR_STREAK_BONUS.toLocaleString("en-US")}
        </div>
      </div>
    </div>
  );
}

function shortEthAddress(addr: string): string {
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  modelLabel: string;
  /** When true, switching chats / new chat is blocked (e.g. Fortytwo reply in flight). */
  navLocked?: boolean;
  /** Tooltip / `aria-label` detail while `navLocked`. */
  navLockTitle?: string;
  /** Fortytwo “FOR” style points shown in the Rewards row. */
  forPoints?: number;
  /** When true, briefly pulse the Rewards row (after a fly animation lands). */
  rewardsHighlight?: boolean;
  /** Pending fly-to-rewards chips (`id` + label shown on the bubble). */
  rewardFlights?: { id: string; amountLabel: string }[];
  onRewardFlyComplete?: (id: string) => void;
  /**
   * When set (Prime route), show MCP program copy, streak, and official links.
   * Omit on /test (Legacy) for a compact card only.
   */
  rewardsPrime?: { walletConnected: boolean; snapshot: RewardsSnapshot } | null;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  modelLabel,
  navLocked = false,
  navLockTitle = "Navigation is temporarily disabled.",
  forPoints = 0,
  rewardsHighlight = false,
  rewardFlights = [],
  onRewardFlyComplete,
  rewardsPrime = null,
}: Props) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [donationCopied, setDonationCopied] = useState(false);
  const [rewardsDetailOpen, setRewardsDetailOpen] = useState(false);
  const donationCopiedTimerRef = useRef<number | null>(null);
  const rewardsDetailDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    return () => {
      if (donationCopiedTimerRef.current != null) {
        window.clearTimeout(donationCopiedTimerRef.current);
      }
    };
  }, []);

  const donationDisplay = shortEthAddress(DONATION_WALLET);

  const rewardsRef = useRef<HTMLDivElement>(null);

  const forPointsDisplay = forPoints.toLocaleString("en-US");

  const openRewardsDetail = () => {
    const d = rewardsDetailDialogRef.current;
    if (!d) return;
    d.showModal();
    setRewardsDetailOpen(true);
  };

  const closeRewardsDetail = () => {
    rewardsDetailDialogRef.current?.close();
  };

  const handleDonationClick = async () => {
    const ok = await copyToClipboard(DONATION_WALLET);
    if (!ok) return;
    if (donationCopiedTimerRef.current != null) {
      window.clearTimeout(donationCopiedTimerRef.current);
    }
    setDonationCopied(true);
    donationCopiedTimerRef.current = window.setTimeout(() => {
      donationCopiedTimerRef.current = null;
      setDonationCopied(false);
    }, 2000);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      if ((c.title ?? "").toLowerCase().includes(q)) return true;
      return c.messages.some((m) =>
        (m.content ?? "").toLowerCase().includes(q)
      );
    });
  }, [conversations, query]);

  const grouped = useMemo(() => {
    const pinned = filtered.filter((c) => c.pinned);
    const rest = filtered.filter((c) => !c.pinned);
    const map = new Map<string, Conversation[]>();
    for (const c of rest) {
      const label = groupLabel(c.updatedAt);
      const arr = map.get(label) ?? [];
      arr.push(c);
      map.set(label, arr);
    }
    const ordered = [...map.entries()].sort((a, b) =>
      compareGroups(a[0], b[0])
    );
    for (const [, arr] of ordered) arr.sort((a, b) => b.updatedAt - a.updatedAt);
    pinned.sort((a, b) => b.updatedAt - a.updatedAt);
    return { pinned, ordered };
  }, [filtered]);

  const startRename = (c: Conversation) => {
    setEditingId(c.id);
    setEditValue(c.title);
  };
  const commitRename = () => {
    if (editingId && editValue.trim()) onRename(editingId, editValue.trim());
    setEditingId(null);
  };

  const renderItem = (c: Conversation) => {
    const inactiveLocked = navLocked && c.id !== activeId;
    return (
    <div
      key={c.id}
      className={`conv-item ${c.id === activeId ? "active" : ""} ${
        c.pinned ? "pinned" : ""
      } ${inactiveLocked ? "conv-item-nav-locked" : ""}`}
      onClick={() => editingId !== c.id && onSelect(c.id)}
      title={inactiveLocked ? navLockTitle : undefined}
      aria-disabled={inactiveLocked ? true : undefined}
    >
      {c.pinned && <PinIcon className="conv-pin" />}
      {editingId === c.id ? (
        <input
          autoFocus
          className="conv-rename"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditingId(null);
          }}
        />
      ) : (
        <span
          className="conv-title"
          title={c.title}
          onDoubleClick={(e) => {
            e.stopPropagation();
            startRename(c);
          }}
        >
          {c.title || "Untitled"}
        </span>
      )}
      <div className="conv-actions">
        <button
          type="button"
          className="icon-btn"
          title={c.pinned ? "Unpin" : "Pin"}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(c.id);
          }}
        >
          <PinIcon filled={c.pinned} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation();
            startRename(c);
          }}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(c.id);
          }}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-mark">
            <img
              className="brand-mark-img"
              src="/fortytwo-prime-icon-192.png"
              width={76}
              height={76}
              alt=""
            />
          </div>
          <div className="brand-text">
            <div className="brand-title">Prime Chat</div>
            <div className="brand-sub" title={modelLabel}>
              {modelLabel}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary new-chat"
          onClick={onNew}
          disabled={navLocked}
          title={navLocked ? navLockTitle : undefined}
        >
          <PlusIcon /> New chat
        </button>
        <div className="search-wrap">
          <SearchIcon />
          <input
            className="search-input"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-btn search-clear"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="conv-list">
        {filtered.length === 0 && (
          <div className="empty">
            {query ? "No results." : "No chats yet."}
          </div>
        )}

        {grouped.pinned.length > 0 && (
          <div className="conv-group">
            <div className="conv-group-label">★ Pinned</div>
            {grouped.pinned.map(renderItem)}
          </div>
        )}
        {grouped.ordered.map(([label, arr]) => (
          <div className="conv-group" key={label}>
            <div className="conv-group-label">{label}</div>
            {arr.map(renderItem)}
          </div>
        ))}
      </div>

      <div className="sidebar-bottom">
        <div
          ref={rewardsRef}
          className={`sidebar-rewards${
            rewardsHighlight ? " sidebar-rewards--flash" : ""
          }`}
          aria-live="polite"
        >
          <div className="sidebar-rewards-tier-wrap sidebar-rewards-tier-wrap--plain">
            <div className="sidebar-rewards-head">
              <img
                className="sidebar-rewards-mark"
                src="/fortytwo-prime-icon-192.png"
                width={64}
                height={64}
                alt=""
              />
              <div className="sidebar-rewards-text">
                <div className="sidebar-rewards-label">Rewards</div>
                <div
                  className={`sidebar-rewards-value${
                    rewardsHighlight ? " sidebar-rewards-value--hot" : ""
                  }`}
                >
                  {forPointsDisplay} FOR
                </div>
              </div>
            </div>
            {rewardsPrime ? (
              <div className="sidebar-rewards-compact">
                <div className="sidebar-rewards-compact-streak" role="status">
                  <span className="sidebar-rewards-streak-label">Day streak</span>
                  <span className="sidebar-rewards-streak-value">
                    {rewardsPrime.snapshot.currentStreakDays} / {STREAK_REQUIRED_DAYS}
                  </span>
                </div>
                <button
                  type="button"
                  className="sidebar-rewards-details-btn"
                  onClick={openRewardsDetail}
                  aria-expanded={rewardsDetailOpen}
                  aria-haspopup="dialog"
                  aria-controls="rewards-detail-dialog"
                >
                  Details
                </button>
              </div>
            ) : null}
          </div>

          {rewardsPrime ? (
            <dialog
              ref={rewardsDetailDialogRef}
              id="rewards-detail-dialog"
              className="rewards-detail-dialog"
              aria-labelledby="rewards-detail-title"
              onClose={() => setRewardsDetailOpen(false)}
              onClick={(e) => {
                if (e.target === e.currentTarget) closeRewardsDetail();
              }}
            >
              <div
                className="rewards-detail-dialog-panel"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="rewards-detail-dialog-close-x"
                  onClick={closeRewardsDetail}
                  aria-label="Close"
                >
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M18 6L6 18M6 6l12 12"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                  </svg>
                </button>

                <div className="rewards-detail-split">
                  <aside className="rewards-detail-left">
                    <div className="rewards-detail-left-inner">
                      <h2 id="rewards-detail-title" className="rewards-detail-left-title">
                        Rewards & Streak
                      </h2>
                      <div className="rewards-detail-estimate">
                        <div className="rewards-detail-estimate-label">Local estimate</div>
                        <div className="rewards-detail-estimate-row">
                          <span className="rewards-detail-estimate-num">
                            {rewardsPrime.snapshot.displayTotalFor.toLocaleString("en-US")}
                          </span>
                          <span className="rewards-detail-estimate-unit">FOR</span>
                        </div>
                      </div>
                      <div className="rewards-detail-disclaimer">
                        <p>
                          This is an estimated balance calculated locally. Verify your
                          official on-chain balance via the Fortytwo platform.
                        </p>
                      </div>
                    </div>
                    <div className="rewards-detail-left-foot">
                      <h3 className="rewards-detail-left-foot-title">Account & rules</h3>
                      <div className="rewards-detail-link-rows">
                        <a
                          href={REWARDS_DOCS_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rewards-detail-link-row"
                        >
                          <span>Official MCP Rewards</span>
                          <span className="rewards-detail-link-row-arrow" aria-hidden>
                            →
                          </span>
                        </a>
                        <a
                          href={REWARDS_ACCOUNT_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rewards-detail-link-row"
                        >
                          <span>Fortytwo account</span>
                          <span className="rewards-detail-link-row-arrow" aria-hidden>
                            ↗
                          </span>
                        </a>
                      </div>
                    </div>
                  </aside>

                  <div className="rewards-detail-right">
                    <RewardsLaunchTimeline
                      current={rewardsPrime.snapshot.currentStreakDays}
                      required={STREAK_REQUIRED_DAYS}
                      claimed={rewardsPrime.snapshot.streakBonusClaimed}
                    />

                    <section className="rewards-detail-rate-section" aria-labelledby="rewards-rate-heading">
                      <h3 id="rewards-rate-heading" className="rewards-detail-rate-heading">
                        MCP earnings rate
                      </h3>
                      <div className="rewards-detail-rate-grid">
                        <article className="rewards-detail-rate-card rewards-detail-rate-card--muted">
                          <div className="rewards-detail-rate-kicker">Base program</div>
                          <div className="rewards-detail-rate-mult">1×</div>
                          <div className="rewards-detail-rate-for">
                            {FOR_BASE_PER_REQUEST.toLocaleString("en-US")} FOR / call
                          </div>
                          <p className="rewards-detail-rate-desc">Standard rate</p>
                        </article>
                        <article className="rewards-detail-rate-card rewards-detail-rate-card--active">
                          <span className="rewards-detail-rate-active-flag">Active</span>
                          <div className="rewards-detail-rate-kicker rewards-detail-rate-kicker--lime">
                            First 500 agents
                          </div>
                          <div className="rewards-detail-rate-mult rewards-detail-rate-mult--lime">
                            {FOR_MULTIPLIER_FIRST500}×
                          </div>
                          <div className="rewards-detail-rate-for rewards-detail-rate-for--lime">
                            {FOR_PER_MCP_3X.toLocaleString("en-US")} FOR / call
                          </div>
                          <p className="rewards-detail-rate-desc">Early multiplier</p>
                        </article>
                        <article className="rewards-detail-rate-card">
                          <div className="rewards-detail-rate-kicker">Agents 501–2,000</div>
                          <div className="rewards-detail-rate-mult">{FOR_MULTIPLIER_501_2000}×</div>
                          <div className="rewards-detail-rate-for">
                            {FOR_PER_MCP_501_2000.toLocaleString("en-US")} FOR / call
                          </div>
                          <p className="rewards-detail-rate-desc">Next wave</p>
                        </article>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </dialog>
          ) : null}
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-donation"
            onClick={() => void handleDonationClick()}
            title={`Copy address: ${DONATION_WALLET}`}
            aria-label={`Copy wallet address to buy a coffee. ${DONATION_WALLET}`}
          >
            <span className="sidebar-donation-label">Buy me a coffee:</span>
            <span className="sidebar-donation-addr">{donationDisplay}</span>
            {donationCopied ? (
              <span className="sidebar-donation-copied" role="status">
                Copied
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {rewardFlights.map((f) => (
        <FloatingRewardBubble
          key={f.id}
          targetRef={rewardsRef}
          amountLabel={f.amountLabel}
          onComplete={() => onRewardFlyComplete?.(f.id)}
        />
      ))}
    </aside>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10-10-4-4L4 16v4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M14 4l6 6-3 1-3 5-3-3-5 5-1-3 5-5-3-3 5-3z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
