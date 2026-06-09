import { useEffect, useMemo, useState } from "react";
import { UsdcMark } from "./Icons";

type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastInput {
  kind?: ToastKind;
  title: string;
  description?: string;
  txHash?: string;
  amount?: string;
  durationMs?: number;
  dock?: "left" | "right";
}

export interface Toast extends ToastInput {
  id: string;
  createdAt: number;
}

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  explorerHref?: (txHash: string) => string;
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 5h5v5M19 5l-9 9M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function shortHash(h: string): string {
  if (!h) return "";
  const clean = h.startsWith("0x") ? h : `0x${h}`;
  return `${clean.slice(0, 8)}…${clean.slice(-6)}`;
}

function renderToastRow(
  t: Toast,
  onDismiss: (id: string) => void,
  explorerHref?: (txHash: string) => string
) {
  return (
    <div
      key={t.id}
      className={`toast toast-${t.kind ?? "info"}`}
      role="status"
    >
      <div className="toast-body">
        <div className="toast-title">{t.title}</div>
        {t.description && (
          <div className="toast-desc">{t.description}</div>
        )}
        {(t.amount || t.txHash) && (
          <div className="toast-meta">
            {t.amount && (
              <span className="toast-amount">
                <UsdcMark size={12} />
                {t.amount} USDC
              </span>
            )}
            {t.txHash && explorerHref && (
              <a
                className="toast-link"
                href={explorerHref(t.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                title={t.txHash}
              >
                {shortHash(t.txHash)} <ExternalIcon />
              </a>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(t.id)}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function Toaster({ toasts, onDismiss, explorerHref }: Props) {
  if (toasts.length === 0) return null;
  const left = useMemo(
    () => toasts.filter((t) => t.dock === "left"),
    [toasts]
  );
  const right = useMemo(
    () => toasts.filter((t) => t.dock !== "left"),
    [toasts]
  );
  return (
    <>
      {left.length > 0 ? (
        <div className="toaster toaster--left" aria-live="polite" aria-atomic="false">
          {left.map((t) => renderToastRow(t, onDismiss, explorerHref))}
        </div>
      ) : null}
      {right.length > 0 ? (
        <div className="toaster toaster--right" aria-live="polite" aria-atomic="false">
          {right.map((t) => renderToastRow(t, onDismiss, explorerHref))}
        </div>
      ) : null}
    </>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const api = useMemo(
    () => ({
      push(input: ToastInput): string {
        const id =
          (globalThis.crypto?.randomUUID?.() ?? "") ||
          `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const toast: Toast = {
          ...input,
          id,
          createdAt: Date.now(),
          kind: input.kind ?? "info",
          durationMs: input.durationMs ?? 9000,
        };
        setToasts((prev) => [...prev, toast]);
        return id;
      },
      dismiss(id: string) {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      },
      clear() {
        setToasts([]);
      },
    }),
    []
  );

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts
      .filter((t) => (t.durationMs ?? 0) > 0)
      .map((t) =>
        window.setTimeout(() => {
          api.dismiss(t.id);
        }, t.durationMs)
      );
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [toasts, api]);

  return { toasts, ...api };
}
