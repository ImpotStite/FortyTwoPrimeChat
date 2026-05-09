import { useState } from "react";

type Props = {
  message: string;
  correlationId: string;
  showReconnect?: boolean;
  showRetry?: boolean;
  onReconnect?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
};

export function ErrorActionBar({
  message,
  correlationId,
  showReconnect,
  showRetry,
  onReconnect,
  onRetry,
  onDismiss,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copiedDetails, setCopiedDetails] = useState(false);

  const copyErrorId = async () => {
    try {
      await navigator.clipboard.writeText(correlationId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const copySupportDetails = async () => {
    const block = `${message}\n\nRequest ID: ${correlationId}`;
    try {
      await navigator.clipboard.writeText(block);
      setCopiedDetails(true);
      setTimeout(() => setCopiedDetails(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="error-action-bar" role="alert">
      <div className="error-action-bar-row">
        <p className="error-action-bar-msg">{message}</p>
        {onDismiss && (
          <button
            type="button"
            className="error-action-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
      <div className="error-action-bar-actions">
        {showReconnect && onReconnect && (
          <button
            type="button"
            className="error-action-btn error-action-btn-primary"
            onClick={onReconnect}
          >
            Reconnect wallet
          </button>
        )}
        {showRetry && onRetry && (
          <button
            type="button"
            className="error-action-btn error-action-btn-primary"
            onClick={onRetry}
          >
            Retry request
          </button>
        )}
        <button type="button" className="error-action-btn" onClick={copyErrorId}>
          {copied ? "Copied" : "Copy request ID"}
        </button>
        <button
          type="button"
          className="error-action-btn"
          onClick={copySupportDetails}
          title="Full message and request ID for support or bug reports"
        >
          {copiedDetails ? "Copied" : "Copy details for support"}
        </button>
      </div>
    </div>
  );
}
