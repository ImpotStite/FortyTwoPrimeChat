import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchModels,
  isFreeModel,
  isTextOnlyModel,
  modelSupportsImages,
} from "../lib/openrouter";
import { shortModelName } from "../lib/format";
import type { OpenRouterModel } from "../types";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function ModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [vision, setVision] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || models.length > 0) return;
    setLoading(true);
    setError(null);
    fetchModels()
      .then((d) => setModels(d.filter(isFreeModel)))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, models.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models
      .filter((m) =>
        vision ? modelSupportsImages(m) : isTextOnlyModel(m)
      )
      .filter(
        (m) =>
          !q ||
          m.id.toLowerCase().includes(q) ||
          m.name?.toLowerCase().includes(q)
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [models, query, vision]);

  return (
    <div className="model-picker" ref={ref}>
      <button
        type="button"
        className="model-picker-btn"
        onClick={() => setOpen((v) => !v)}
        title="Change model"
      >
        <span className="dot" /> {shortModelName(value)}
        <Chevron />
      </button>
      {open && (
        <div className="model-picker-pop" role="dialog" aria-label="Models">
          <div className="mp-toolbar">
            <input
              autoFocus
              className="mp-search"
              placeholder="Search models…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="mp-toggle">
              <input
                type="checkbox"
                checked={vision}
                onChange={(e) => setVision(e.target.checked)}
              />
              Vision models
            </label>
          </div>
          <div className="mp-list">
            {loading && <div className="mp-empty">Loading…</div>}
            {error && <div className="mp-empty mp-error">{error}</div>}
            {!loading && !error && filtered.length === 0 && (
              <div className="mp-empty">No models.</div>
            )}
            {!loading &&
              !error &&
              filtered.map((m) => {
                const isVision = modelSupportsImages(m);
                return (
                  <button
                    type="button"
                    key={m.id}
                    className={`mp-item ${m.id === value ? "active" : ""}`}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                  >
                    <div className="mp-item-main">
                      <span className="mp-item-name">{m.name || m.id}</span>
                      <span className="mp-item-id">{m.id}</span>
                    </div>
                    <div className="mp-item-tags">
                      {isVision && <span className="mp-tag tag-vision">Vision</span>}
                      <span className="mp-tag tag-free">Free</span>
                      {m.context_length && (
                        <span className="mp-tag tag-ctx">
                          {Math.round(m.context_length / 1000)}k
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
          <div className="mp-footer">
            {filtered.length} free {vision ? "vision" : "text"} model(s) ·{" "}
            <a
              href={
                vision
                  ? "https://openrouter.ai/models?max_price=0"
                  : "https://openrouter.ai/models?max_price=0&input_modalities=text"
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenRouter
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
