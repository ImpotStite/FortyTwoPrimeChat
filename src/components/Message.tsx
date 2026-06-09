import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { CodePre } from "./CodeBlock";
import { FortytwoSign } from "./Icons";
import {
  formatApproximateCost,
  formatCost,
  formatTokens,
  shortModelName,
} from "../lib/format";
import { estimatePrimeUsdCost } from "../lib/primePricing";
import type { ChatMessage } from "../types";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  isThinking?: boolean;
  progressHint?: string;
  isLast?: boolean;
  canRegenerate?: boolean;
  onEdit?: (newContent: string) => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
}

export function Message({
  message,
  isStreaming,
  isThinking,
  progressHint,
  isLast,
  canRegenerate,
  onEdit,
  onRegenerate,
  onDelete,
}: Props) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => message.content ?? "");
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && editRef.current) {
      const el = editRef.current;
      el.focus();
      el.style.height = "0px";
      el.style.height = Math.min(el.scrollHeight, 320) + "px";
    }
  }, [editing]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
    }
  };

  const startEdit = () => {
    setDraft(message.content ?? "");
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const submitEdit = () => {
    if (draft.trim() && draft !== (message.content ?? ""))
      onEdit?.(draft.trim());
    setEditing(false);
  };

  return (
    <div className={`msg ${isUser ? "msg-user" : "msg-assistant"}`}>
      <div className="msg-avatar" aria-hidden>
        {isUser ? (
          "You"
        ) : (
          <FortytwoSign size={24} title="Fortytwo" />
        )}
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-role">{isUser ? "You" : "Assistant"}</span>
          {message.edited && <span className="msg-edited">edited</span>}
          {!isUser && message.model && (
            <span className="msg-model" title={message.model}>
              {shortModelName(message.model)}
            </span>
          )}
          <div className="msg-actions">
            {!isUser &&
              (message.content ?? "").length > 0 &&
              !isStreaming && (
              <button
                type="button"
                className="copy-btn"
                onClick={onCopy}
                title="Copy"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            )}
            {isUser && onEdit && !editing && (
              <button
                type="button"
                className="copy-btn"
                onClick={startEdit}
                title="Edit"
              >
                Edit
              </button>
            )}
            {!isUser && canRegenerate && onRegenerate && !isStreaming && (
              <button
                type="button"
                className="copy-btn"
                onClick={onRegenerate}
                title="Regenerate"
              >
                ↻ Regenerate
              </button>
            )}
            {onDelete && !isStreaming && isLast && (
              <button
                type="button"
                className="copy-btn"
                onClick={onDelete}
                title="Delete this message"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {message.attachments?.length ? (
          <div className="msg-attachments">
            {message.attachments.map((a) => (
              <a
                key={a.id}
                href={a.dataUrl}
                target="_blank"
                rel="noreferrer"
                className="msg-attachment"
                title={a.name}
              >
                <img src={a.dataUrl} alt={a.name} />
              </a>
            ))}
          </div>
        ) : null}

        <div className="msg-content">
          {isUser ? (
            editing ? (
              <div className="edit-box">
                <textarea
                  ref={editRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancelEdit();
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submitEdit();
                    }
                  }}
                />
                <div className="edit-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={cancelEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={submitEdit}
                  >
                    Resend
                  </button>
                </div>
              </div>
            ) : (
              <p className="user-text">{message.content ?? ""}</p>
            )
          ) : (
            <div className={`markdown ${message.error ? "markdown-error" : ""}`}>
              {isThinking && (message.content ?? "").trim().length === 0 ? (
                <div className="thinking-block">
                  <div className="thinking">
                    <span /> <span /> <span />
                  </div>
                  {progressHint ? (
                    <p className="thinking-hint" role="status">
                      {progressHint}
                    </p>
                  ) : null}
                </div>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex, rehypeHighlight]}
                  components={{ pre: CodePre }}
                >
                  {message.content ?? ""}
                </ReactMarkdown>
              )}
              {isStreaming && (message.content ?? "").length > 0 && (
                <span className="cursor" aria-hidden />
              )}
            </div>
          )}
        </div>

        {!isUser && !isStreaming && message.usage && (() => {
          const u = message.usage;
          const isPrime = message.model === "fortytwo-prime";
          const hasIn = u.prompt_tokens != null;
          const hasOut = u.completion_tokens != null;
          const hasTotal = u.total_tokens != null;
          const hasCost = u.cost != null;

          if (isPrime) {
            const tin = u.prompt_tokens;
            const tout = u.completion_tokens;
            if (tin == null && tout == null) {
              if (!hasTotal) return null;
              return (
                <div
                  className="msg-usage msg-usage-prime"
                  title="Token usage for this reply"
                >
                  <span>{formatTokens(u.total_tokens!)} tokens</span>
                </div>
              );
            }
            const nIn = tin ?? 0;
            const nOut = tout ?? 0;
            const total =
              hasTotal && u.total_tokens != null ? u.total_tokens : nIn + nOut;
            const usd = estimatePrimeUsdCost(nIn, nOut);
            return (
              <div
                className="msg-usage msg-usage-prime"
                title="Estimated cost from list rates: $10 / 1M input, $30 / 1M output"
              >
                <span>
                  {tin != null && <>↑ {formatTokens(tin)}</>}
                  {tin != null && tout != null && " "}
                  {tout != null && <>↓ {formatTokens(tout)}</>}
                </span>
                <span className="dotSep">·</span>
                <span>{formatTokens(total)} tokens</span>
                <span className="dotSep">·</span>
                <span>{formatApproximateCost(usd)}</span>
              </div>
            );
          }

          const showInOut = hasIn || hasOut;
          const showOpenRouterExtras = hasTotal || hasCost;
          if (!showInOut && !showOpenRouterExtras) return null;
          return (
            <div className="msg-usage" title="OpenRouter usage">
              {hasIn && hasOut && (
                <span>
                  ↑ {formatTokens(u.prompt_tokens!)} ↓{" "}
                  {formatTokens(u.completion_tokens!)}
                </span>
              )}
              {hasIn && !hasOut && (
                <span>↑ {formatTokens(u.prompt_tokens!)}</span>
              )}
              {!hasIn && hasOut && (
                <span>↓ {formatTokens(u.completion_tokens!)}</span>
              )}
              {showOpenRouterExtras && (
                <>
                  {showInOut && (hasTotal || hasCost) && (
                    <span className="dotSep">·</span>
                  )}
                  {hasTotal && (
                    <span>{formatTokens(u.total_tokens!)} tokens</span>
                  )}
                  {hasCost && (
                    <>
                      {hasTotal && <span className="dotSep">·</span>}
                      <span>{formatCost(u.cost!)}</span>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
