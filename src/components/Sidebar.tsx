import { useEffect, useMemo, useRef, useState } from "react";
import { compareGroups, groupLabel } from "../lib/format";
import {
  FOR_PER_MCP_3X,
  FOR_STREAK_BONUS,
  REWARDS_ACCOUNT_URL,
  REWARDS_DOCS_URL,
  STREAK_REQUIRED_DAYS,
  type RewardsSnapshot,
} from "../lib/rewardsProgram";
import type { Conversation } from "../types";
import { FloatingRewardBubble } from "./FloatingRewardBubble";

const DONATION_WALLET = "0xC1F112Cd1D2A6B60B13514602fD0156BA910D488";

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
              src="/fortytwo-prime-mark.png"
              width={38}
              height={38}
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
          <div
            className={
              rewardsPrime?.walletConnected
                ? "sidebar-rewards-tier-wrap"
                : "sidebar-rewards-tier-wrap sidebar-rewards-tier-wrap--plain"
            }
          >
            <div className="sidebar-rewards-head">
              <img
                className="sidebar-rewards-mark"
                src="/fortytwo-prime-mark.png"
                width={32}
                height={32}
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
            {rewardsPrime?.walletConnected ? (
              <p className="sidebar-rewards-tier-pill" title="Assumed tier for this demo UI">
                First 500 agents · 3× — {FOR_PER_MCP_3X.toLocaleString("en-US")}{" "}
                FOR per MCP call
              </p>
            ) : null}
            {rewardsPrime ? (
              <div className="sidebar-rewards-compact">
                <div className="sidebar-rewards-compact-streak" role="status">
                  <span className="sidebar-rewards-streak-label">Day streak</span>
                  <span className="sidebar-rewards-streak-value">
                    {rewardsPrime.snapshot.currentStreakDays} /{" "}
                    {STREAK_REQUIRED_DAYS}
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
                <header className="rewards-detail-dialog-header">
                  <h2 id="rewards-detail-title" className="rewards-detail-dialog-title">
                    Rewards & streak
                  </h2>
                  <form method="dialog">
                    <button
                      type="submit"
                      className="rewards-detail-dialog-close"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </form>
                </header>
                <div className="rewards-detail-dialog-body">
                  <p className="sidebar-rewards-doc">
                    1,000 FOR base per MCP request; early adopters may earn 2× or
                    3× for 30 days. Streak: {STREAK_REQUIRED_DAYS}+ consecutive
                    calendar days, each with at least one billing session launched;
                    multiple launches on the same calendar day count once →{" "}
                    {FOR_STREAK_BONUS.toLocaleString("en-US")} FOR once (
                    <a
                      href={REWARDS_DOCS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      MCP Rewards program
                    </a>
                    ).
                  </p>
                  <div className="sidebar-rewards-streak" role="status">
                    <span className="sidebar-rewards-streak-label">Day streak</span>
                    <span className="sidebar-rewards-streak-value">
                      {rewardsPrime.snapshot.currentStreakDays} /{" "}
                      {STREAK_REQUIRED_DAYS} days
                    </span>
                    {rewardsPrime.snapshot.streakBonusClaimed ? (
                      <span className="sidebar-rewards-streak-badge">
                        Streak bonus claimed
                      </span>
                    ) : null}
                  </div>
                  <div className="sidebar-rewards-links">
                    <a
                      href={REWARDS_DOCS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sidebar-rewards-link"
                    >
                      Program rules
                    </a>
                    <a
                      href={REWARDS_ACCOUNT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sidebar-rewards-link"
                    >
                      Fortytwo account
                    </a>
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
