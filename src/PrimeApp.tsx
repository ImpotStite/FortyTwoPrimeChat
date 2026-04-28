import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type Address, type Hex } from "viem";
import { Sidebar } from "./components/Sidebar";
import { Message } from "./components/Message";
import { Composer } from "./components/Composer";
import { Welcome } from "./components/Welcome";
import { useTheme } from "./hooks/useTheme";
import { uid } from "./lib/id";
import {
  loadPrimeConversations,
  savePrimeConversations,
} from "./lib/storage";
import { exportAllJson, parseImport } from "./lib/exportImport";
import {
  askPrime,
  clearSession,
  loadSession,
  saveSession,
  type PrimeSession,
} from "./lib/fortytwo";
import { monad } from "./lib/privy";
import { readUsdcBalance, type UsdcBalance } from "./lib/usdc";
import { UsdcMark } from "./components/Icons";
import type {
  ChatMessage,
  Conversation,
  ImageAttachment,
} from "./types";

const RETRY_PATTERNS = [/upstream/i, /\b50\d\b/, /timeout/i, /network/i];

function newConversation(): Conversation {
  const now = Date.now();
  return {
    id: uid("c_"),
    title: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
    model: "fortytwo-prime",
  };
}

function shortAddress(addr?: string | null): string {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export default function PrimeApp() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [session, setSession] = useState<PrimeSession | null>(null);
  const [signingState, setSigningState] = useState<
    "idle" | "awaiting-confirm" | "waiting-wallet"
  >("idle");
  const [pendingAmount, setPendingAmount] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<UsdcBalance | null>(null);
  const [usdcLoading, setUsdcLoading] = useState(false);
  /** Forces session pill label to recompute as wall-clock time advances. */
  const [sessionTimerTick, setSessionTimerTick] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const confirmResolverRef = useRef<((accept: boolean) => void) | null>(null);

  const wallet = useMemo(() => {
    return wallets.find((w) => w.connectorType !== "embedded") ?? wallets[0] ?? null;
  }, [wallets]);
  const address = (wallet?.address as Address | undefined) ?? null;

  // ---- Init: load conversations + cached session for the current wallet ----
  useEffect(() => {
    const stored = loadPrimeConversations();
    if (stored.length > 0) {
      setConversations(stored);
      setActiveId(stored[0].id);
    } else {
      const c = newConversation();
      setConversations([c]);
      setActiveId(c.id);
    }
  }, []);

  useEffect(() => {
    if (conversations.length > 0) savePrimeConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (!address) {
      setSession(null);
      return;
    }
    setSession(loadSession(address));
  }, [address]);

  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => {
      setSessionTimerTick((n) => n + 1);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [session?.sessionId, session?.expiresAt]);

  // Poll USDC balance: on connect, after each successful reply, every 30s.
  useEffect(() => {
    if (!address) {
      setUsdcBalance(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      setUsdcLoading(true);
      readUsdcBalance(address)
        .then((b) => {
          if (!cancelled) setUsdcBalance(b);
        })
        .catch(() => {
          if (!cancelled) setUsdcBalance(null);
        })
        .finally(() => {
          if (!cancelled) setUsdcLoading(false);
        });
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, session?.sessionId]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [active?.messages]);

  const updateActive = useCallback(
    (updater: (c: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? updater(c) : c))
      );
    },
    [activeId]
  );

  // ---- Conversation management ----

  const handleNew = useCallback(() => {
    const c = newConversation();
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    setAttachments([]);
    setError(null);
  }, []);

  const handleSelect = (id: string) => {
    setActiveId(id);
    setError(null);
    setSidebarOpen(false);
  };

  const handleDelete = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const c = newConversation();
        setActiveId(c.id);
        return [c];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  const handleRename = (id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  };

  const handleTogglePin = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  };

  const handleClearAll = () => {
    if (!confirm("Delete all conversations?")) return;
    const c = newConversation();
    setConversations([c]);
    setActiveId(c.id);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  };

  const handleDisconnectWallet = useCallback(() => {
    if (address) clearSession(address);
    setSession(null);
    void logout();
  }, [address, logout]);

  // ---- Wallet signing helper ----

  /** Build a viem-compatible signTypedData function from the connected wallet. */
  const buildSigner = useCallback(async () => {
    if (!wallet || !address) {
      throw new Error("No wallet connected");
    }
    // Make sure the wallet is on Monad before signing.
    try {
      await wallet.switchChain(monad.id);
    } catch {
      // Some wallets surface a generic error if already on the right chain;
      // we ignore it and let the signature step fail loudly if needed.
    }
    const provider = await wallet.getEthereumProvider();
    const client = createWalletClient({
      account: address,
      chain: monad,
      transport: custom(provider),
    });
    return async (params: {
      domain: Parameters<typeof client.signTypedData>[0]["domain"];
      types: Record<string, { name: string; type: string }[]>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex> => {
      // viem's signTypedData type wants its own narrow generic; we cast at the call site.
      const sig = await client.signTypedData({
        account: address,
        domain: params.domain,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        types: params.types as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        primaryType: params.primaryType as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message: params.message as any,
      });
      return sig;
    };
  }, [wallet, address]);

  // ---- Streaming runner ----

  const runStream = useCallback(
    async (
      conversationId: string,
      assistantId: string,
      userQuery: string
    ) => {
      if (!address) {
        setError("Connect your wallet to continue.");
        setIsLoading(false);
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setIsLoading(true);
      setError(null);

      const updateAssistant = (
        patch: (m: ChatMessage) => ChatMessage
      ) => {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== conversationId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantId ? patch(m) : m
              ),
              updatedAt: Date.now(),
            };
          })
        );
      };

      const MAX_ATTEMPTS = 2;
      let lastError: Error | null = null;

      const signer = await buildSigner().catch((e) => {
        setError((e as Error).message);
        setIsLoading(false);
        return null;
      });
      if (!signer) return;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 600));
          updateAssistant((m) => ({ ...m, content: "", error: false }));
        }
        try {
          const cachedSession = address ? loadSession(address) : null;
          const result = await askPrime({
            query: userQuery,
            address,
            signTypedDataAsync: signer,
            session: cachedSession,
            signal: ctrl.signal,
            onChunk: (delta) => {
              updateAssistant((m) => ({
                ...m,
                content: (m.content ?? "") + delta,
              }));
            },
            onSession: (s) => {
              if (address) saveSession(address, s);
              setSession(s);
              setSigningState("idle");
              setPendingAmount(null);
            },
            onPaymentRequired: (accept) => {
              const decimals = 6;
              const human = (Number(accept.amount) / 10 ** decimals).toString();
              setPendingAmount(`${human} USDC`);
              setSigningState("awaiting-confirm");
              return new Promise<void>((resolve, reject) => {
                confirmResolverRef.current = (ok) => {
                  if (ok) {
                    setSigningState("waiting-wallet");
                    resolve();
                  } else {
                    ctrl.abort();
                    reject(new Error("Authorization cancelled"));
                  }
                };
              });
            },
          });
          // Final-shot fallback: if streaming didn't emit chunks, drop the full text now.
          updateAssistant((m) => ({
            ...m,
            content: m.content && m.content.length > 0 ? m.content : result.text,
          }));
          lastError = null;
          break;
        } catch (e) {
          if (ctrl.signal.aborted) {
            lastError = null;
            break;
          }
          const err = e as Error;
          lastError = err;
          const transient = RETRY_PATTERNS.some((re) =>
            re.test(err.message || "")
          );
          if (!transient || attempt === MAX_ATTEMPTS - 1) break;
        }
      }

      if (lastError) {
        const msg = lastError.message || "Unknown error";
        setError(msg);
        updateAssistant((m) => ({
          ...m,
          content: m.content
            ? `${m.content}\n\n---\n**Error:** ${msg}`
            : `**Error:** ${msg}`,
          error: true,
        }));
      }

      setSigningState("idle");
      setPendingAmount(null);
      setIsLoading(false);
      abortRef.current = null;

      // Refresh on-chain USDC balance after settlement (best-effort).
      if (address) {
        readUsdcBalance(address)
          .then((b) => setUsdcBalance(b))
          .catch(() => {
            /* ignore */
          });
      }
    },
    [address, buildSigner]
  );

  // ---- Submit / Edit / Regenerate ----

  const handleSubmit = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || isLoading || !active) return;
      if (!authenticated || !address) {
        setError("Connect your wallet first.");
        return;
      }

      const userMsg: ChatMessage = {
        id: uid("m_"),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      const assistantMsg: ChatMessage = {
        id: uid("m_"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: "fortytwo-prime",
      };

      const isFirstMessage = active.messages.length === 0;
      const newTitle = isFirstMessage ? text.slice(0, 60) : active.title;
      const newMessages = [...active.messages, userMsg, assistantMsg];

      updateActive((c) => ({
        ...c,
        title: newTitle,
        messages: newMessages,
        updatedAt: Date.now(),
      }));

      setInput("");
      setAttachments([]);

      await runStream(active.id, assistantMsg.id, text);
    },
    [active, address, authenticated, input, isLoading, runStream, updateActive]
  );

  const handleEditUser = useCallback(
    async (messageId: string, newContent: string) => {
      if (!active) return;
      const idx = active.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      const user = active.messages[idx];
      if (user.role !== "user") return;

      const truncated = active.messages.slice(0, idx);
      const editedUser: ChatMessage = {
        ...user,
        content: newContent,
        edited: true,
      };
      const assistantMsg: ChatMessage = {
        id: uid("m_"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: "fortytwo-prime",
      };
      const next = [...truncated, editedUser, assistantMsg];

      updateActive((c) => ({
        ...c,
        messages: next,
        updatedAt: Date.now(),
      }));

      await runStream(active.id, assistantMsg.id, newContent);
    },
    [active, runStream, updateActive]
  );

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!active) return;
      const idx = active.messages.findIndex((m) => m.id === messageId);
      if (idx < 0 || active.messages[idx].role !== "assistant") return;
      // Find preceding user message to replay its query.
      const prevUser = [...active.messages.slice(0, idx)]
        .reverse()
        .find((m) => m.role === "user");
      if (!prevUser) return;

      const history = active.messages.slice(0, idx);
      const newAssistant: ChatMessage = {
        id: uid("m_"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: "fortytwo-prime",
      };
      const next = [...history, newAssistant];

      updateActive((c) => ({
        ...c,
        messages: next,
        updatedAt: Date.now(),
      }));

      await runStream(active.id, newAssistant.id, prevUser.content);
    },
    [active, runStream, updateActive]
  );

  const handleDeleteMessage = (messageId: string) => {
    updateActive((c) => ({
      ...c,
      messages: c.messages.filter((m) => m.id !== messageId),
      updatedAt: Date.now(),
    }));
  };

  // ---- Import / Export ----

  const handleExportAll = () => {
    if (conversations.length === 0) return;
    exportAllJson(conversations);
  };

  const handleImportClick = () => importRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const incoming = parseImport(text);
      const valid = incoming.filter(
        (c) => c && c.id && Array.isArray(c.messages)
      );
      if (valid.length === 0) throw new Error("Empty or invalid import file");
      setConversations((prev) => {
        const existing = new Map(prev.map((c) => [c.id, c] as const));
        for (const c of valid) existing.set(c.id, c);
        return [...existing.values()].sort(
          (a, b) => b.updatedAt - a.updatedAt
        );
      });
      alert(`Import complete: ${valid.length} conversation(s) merged.`);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  };

  // ---- Keyboard shortcuts ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      } else if (meta && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleNew();
      } else if (e.key === "Escape" && isLoading) {
        handleStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNew, isLoading]);

  // ---- Confirm signing modal ----
  const confirmSign = (ok: boolean) => {
    confirmResolverRef.current?.(ok);
    confirmResolverRef.current = null;
    if (!ok) {
      setSigningState("idle");
      setPendingAmount(null);
      setIsLoading(false);
    }
  };

  const sessionState = useMemo<{
    active: boolean;
    label: string;
    title: string;
  }>(() => {
    if (!session)
      return {
        active: false,
        label: "No session",
        title: "First message will require a one-time signature",
      };
    const ms = session.expiresAt - Date.now();
    if (ms <= 0)
      return {
        active: false,
        label: "Session expired",
        title: "Next message will require a fresh signature",
      };
    const mins = Math.max(1, Math.round(ms / 60000));
    return {
      active: true,
      label: `Session · ${mins}m left`,
      title: `Up to ${session.authorizedAmountDisplay} authorized — no further signature needed for ~${mins} min`,
    };
  }, [session, sessionTimerTick]);

  return (
    <div
      className={`app ${sidebarOpen ? "sidebar-open" : ""}`}
      data-theme={theme}
    >
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportFile}
        hidden
      />

      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
        onTogglePin={handleTogglePin}
        onClearAll={handleClearAll}
        onExportAll={handleExportAll}
        onImport={handleImportClick}
        modelLabel="FortyTwo Prime"
      />

      {sidebarOpen && (
        <div
          className="sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn-2 menu-btn"
            onClick={() => setSidebarOpen(true)}
            title="Menu"
          >
            <BurgerIcon />
          </button>
          <div className="topbar-title">
            {active?.title || "New chat"}
          </div>
          <div className="topbar-tools">
            {ready && authenticated && address && (
              <span
                className={`session-pill ${
                  sessionState.active ? "is-active" : "is-idle"
                }`}
                title={sessionState.title}
              >
                <span
                  className={`session-dot ${
                    sessionState.active ? "is-active" : "is-idle"
                  }`}
                />
                {sessionState.label}
              </span>
            )}
            {ready && authenticated && address ? (
              <div
                className="wallet-pill"
                title={`${address} · Monad`}
              >
                <span
                  className="wallet-balance"
                  title={
                    usdcBalance
                      ? `${usdcBalance.formatted} USDC on Monad`
                      : "Reading USDC balance…"
                  }
                >
                  <UsdcMark size={14} />
                  {usdcBalance
                    ? usdcBalance.display
                    : usdcLoading
                      ? "…"
                      : "—"}
                </span>
                <span className="wallet-addr">{shortAddress(address)}</span>
                <button
                  type="button"
                  className="wallet-disconnect"
                  onClick={handleDisconnectWallet}
                  aria-label="Disconnect wallet"
                  title="Disconnect"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="primary-btn"
                onClick={() => login()}
                disabled={!ready}
              >
                {ready ? "Connect wallet" : "Loading…"}
              </button>
            )}
            <button
              type="button"
              className="icon-btn-2"
              onClick={toggleTheme}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            <a
              className="brand-mark"
              href="/"
              title="FortyTwo · home"
              aria-label="FortyTwo home"
            >
              42
            </a>
          </div>
        </header>

        <div className="messages" ref={scrollRef}>
          {!active || active.messages.length === 0 ? (
            <Welcome
              modelLabel="FortyTwo Prime"
              onPick={(p) => {
                setInput(p);
                if (authenticated) void handleSubmit(p);
              }}
            />
          ) : (
            <div className="messages-inner">
              {active.messages.map((m, i) => {
                const isLast = i === active.messages.length - 1;
                const streaming =
                  isLoading && isLast && m.role === "assistant";
                const thinking =
                  streaming && (m.content ?? "").trim().length === 0;
                const prevUserExists =
                  active.messages
                    .slice(0, i)
                    .some((x) => x.role === "user");
                return (
                  <Message
                    key={m.id}
                    message={m}
                    isStreaming={streaming}
                    isThinking={thinking}
                    isLast={isLast}
                    canRegenerate={
                      m.role === "assistant" && prevUserExists
                    }
                    onEdit={
                      m.role === "user"
                        ? (newContent) => handleEditUser(m.id, newContent)
                        : undefined
                    }
                    onRegenerate={
                      m.role === "assistant"
                        ? () => handleRegenerate(m.id)
                        : undefined
                    }
                    onDelete={() => handleDeleteMessage(m.id)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {!authenticated && (
          <div className="error-bar" role="status">
            Connect your wallet (MetaMask, Rabby, WalletConnect…) to start chatting.
            You'll need USDC on Monad.
          </div>
        )}

        {error && (
          <div className="error-bar" role="alert">
            {error}
          </div>
        )}

        <Composer
          value={input}
          onChange={setInput}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onSubmit={() => handleSubmit()}
          onStop={handleStop}
          isLoading={isLoading}
          disabled={!active || !authenticated}
          visionAllowed={false}
          onError={setError}
        />
      </main>

      {signingState !== "idle" && (
        <div className="modal-scrim" onClick={() => signingState === "awaiting-confirm" && confirmSign(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Authorize FortyTwo Prime session</h2>
            {signingState === "awaiting-confirm" ? (
              <>
                <p className="modal-text">
                  You're about to authorize up to{" "}
                  <span className="modal-amount">
                    <UsdcMark size={16} />
                    <strong>{pendingAmount ?? "—"}</strong>
                  </span>{" "}
                  for this session on <strong>Monad</strong>. Subsequent
                  messages in this session won't require another signature
                  until it expires.
                </p>
                <p className="modal-sub">
                  No tokens move until FortyTwo settles your reply on-chain.
                </p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => confirmSign(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => confirmSign(true)}
                  >
                    Sign
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-text">
                  Waiting for your wallet… open it to review and sign the
                  EIP-712 authorization.
                </p>
                <div className="thinking">
                  <span /><span /><span />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Hidden but keeps user variable referenced so it stays in scope for future use. */}
      {user ? null : null}
    </div>
  );
}

function BurgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1l2.1-2.1M17 7l2.1-2.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 13a8.5 8.5 0 1 1-10-10 7 7 0 0 0 10 10z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
