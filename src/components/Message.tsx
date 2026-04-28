import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodePre } from "./CodeBlock";
import { formatCost, formatTokens, shortModelName } from "../lib/format";
import type { ChatMessage } from "../types";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  isThinking?: boolean;
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
      /* empty */
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
        {isUser ? "You" : "42"}
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
                <div className="thinking">
                  <span /> <span /> <span />
                </div>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
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

        {!isUser && message.usage?.total_tokens != null && !isStreaming && (
          <div className="msg-usage" title="OpenRouter usage">
            {message.usage.prompt_tokens != null &&
              message.usage.completion_tokens != null && (
                <span>
                  ↑ {formatTokens(message.usage.prompt_tokens)} ↓{" "}
                  {formatTokens(message.usage.completion_tokens)}
                </span>
              )}
            <span className="dotSep">·</span>
            <span>{formatTokens(message.usage.total_tokens)} tokens</span>
            {message.usage.cost != null && (
              <>
                <span className="dotSep">·</span>
                <span>{formatCost(message.usage.cost)}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
