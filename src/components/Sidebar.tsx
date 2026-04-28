import { useMemo, useState } from "react";
import { compareGroups, groupLabel } from "../lib/format";
import type { Conversation } from "../types";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onClearAll: () => void;
  onExportAll: () => void;
  onImport: () => void;
  modelLabel: string;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  onClearAll,
  onExportAll,
  onImport,
  modelLabel,
}: Props) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  const renderItem = (c: Conversation) => (
    <div
      key={c.id}
      className={`conv-item ${c.id === activeId ? "active" : ""} ${
        c.pinned ? "pinned" : ""
      }`}
      onClick={() => editingId !== c.id && onSelect(c.id)}
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

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-mark">42</div>
          <div className="brand-text">
            <div className="brand-title">Prime Chat</div>
            <div className="brand-sub" title={modelLabel}>
              {modelLabel}
            </div>
          </div>
        </div>
        <button type="button" className="btn btn-primary new-chat" onClick={onNew}>
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

      <div className="sidebar-footer">
        <button type="button" className="btn btn-ghost" onClick={onImport}>
          Import
        </button>
        <button type="button" className="btn btn-ghost" onClick={onExportAll}>
          Export
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClearAll}
          title="Clear all"
        >
          ⌫
        </button>
      </div>
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
