import { useEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { fileToImageAttachment } from "../lib/image";
import { formatBytes } from "../lib/format";
import type { ImageAttachment } from "../types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  attachments: ImageAttachment[];
  onAttachmentsChange: (a: ImageAttachment[]) => void;
  onSubmit: () => void;
  onStop: () => void;
  isLoading: boolean;
  disabled?: boolean;
  visionAllowed: boolean;
  onError?: (msg: string) => void;
}

export function Composer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  onSubmit,
  onStop,
  isLoading,
  disabled,
  visionAllowed,
  onError,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && (value.trim() || attachments.length))
        onSubmit();
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: ImageAttachment[] = [...attachments];
    for (const f of Array.from(files)) {
      try {
        next.push(await fileToImageAttachment(f));
      } catch (e) {
        onError?.((e as Error).message);
      }
    }
    onAttachmentsChange(next);
  };

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFiles(e.target.files);
    e.target.value = "";
  };

  const onPaste: React.ClipboardEventHandler<HTMLTextAreaElement> = async (e) => {
    if (!visionAllowed) return;
    const items = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (items.length) {
      e.preventDefault();
      const dt = new DataTransfer();
      items.forEach((f) => dt.items.add(f));
      void handleFiles(dt.files);
    }
  };

  const removeAttachment = (id: string) =>
    onAttachmentsChange(attachments.filter((a) => a.id !== id));

  const canSend =
    !disabled && (value.trim().length > 0 || attachments.length > 0);

  return (
    <div className="composer-wrap">
      <div className="composer">
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((a) => (
              <div key={a.id} className="composer-attachment">
                <img src={a.dataUrl} alt={a.name} />
                <button
                  type="button"
                  className="att-remove"
                  onClick={() => removeAttachment(a.id)}
                  title={`Remove ${a.name}`}
                >
                  ×
                </button>
                <span className="att-meta">
                  {a.name} · {formatBytes(a.size)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            type="button"
            className="icon-btn-2"
            onClick={() => fileRef.current?.click()}
            disabled={!visionAllowed || isLoading}
            title={
              visionAllowed
                ? "Attach image"
                : "Current model does not support images"
            }
          >
            <PaperclipIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={onFileInput}
            hidden
          />
          <textarea
            ref={ref}
            value={value}
            rows={1}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            disabled={disabled}
          />
          {isLoading ? (
            <button
              type="button"
              className="send-btn stop"
              onClick={onStop}
              title="Stop"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              onClick={onSubmit}
              disabled={!canSend}
              title="Send"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      <div className="composer-hint">
        Models can make mistakes. Double-check important information.
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12l16-8-6 18-3-7-7-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.5l-8.5 8.5a5.5 5.5 0 1 1-7.78-7.78l9.19-9.19a3.75 3.75 0 0 1 5.3 5.3l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.13-8.13"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
