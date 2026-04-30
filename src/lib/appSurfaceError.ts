export type AppSurfaceError = {
  message: string;
  correlationId: string;
  showReconnect: boolean;
  showRetry: boolean;
};

export function newErrorCorrelationId(): string {
  return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Fortytwo Prime: suggest reconnect vs retry from the error text. */
export function primeErrorActions(message: string): {
  showReconnect: boolean;
  showRetry: boolean;
} {
  const m = message.toLowerCase();
  const userRejectedSig =
    /user rejected/.test(m) ||
    /rejected the request/.test(m) ||
    /request rejected/.test(m);
  if (userRejectedSig) {
    return { showReconnect: false, showRetry: true };
  }
  const walletHint =
    /connect your wallet/.test(m) ||
    /wallet/.test(m) ||
    /signing/.test(m) ||
    /sign typed data/.test(m) ||
    /wrong network|switch network|chain id/.test(m) ||
    /must connect|not connected|no wallet|missing provider/.test(m) ||
    (/provider/.test(m) && /ethereum|wallet/.test(m));
  if (walletHint) {
    return { showReconnect: true, showRetry: false };
  }
  const noRetry =
    (/aborted/.test(m) && !/network|timeout|upstream|fetch|50\d/.test(m));
  return {
    showReconnect: false,
    showRetry: !noRetry,
  };
}

/** OpenRouter / Legacy: retry unless it looks like a user abort only. */
export function legacyErrorActions(message: string): { showRetry: boolean } {
  const m = message.toLowerCase();
  const noRetry =
    /authorization cancelled/.test(m) ||
    (/aborted/.test(m) && !/network|timeout|upstream|fetch|50\d/.test(m));
  return { showRetry: !noRetry };
}
