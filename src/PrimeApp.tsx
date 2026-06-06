import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type Address, type Hex } from "viem";
import { Sidebar } from "./components/Sidebar";
import { Message } from "./components/Message";
import { Composer } from "./components/Composer";
import { Welcome } from "./components/Welcome";
import { useTheme } from "./hooks/useTheme";
import { useChatAutoScroll } from "./hooks/useChatAutoScroll";
import { uid } from "./lib/id";
import {
  loadPrimeConversations,
  loadPrimeConversationsAutomation,
  savePrimeConversations,
  savePrimeConversationsAutomation,
} from "./lib/storage";
import {
  askPrime,
  clearSession,
  loadPersistedMcpTools,
  loadSession,
  PRIME_SESSION_IDLE_MS,
  saveSession,
  type PrimeRequestPhase,
  type PrimeSession,
} from "./lib/fortytwo";
import { monad } from "./lib/privy";
import {
  FORTYTWO_X402_ESCROW_MONAD,
  readUsdcBalance,
  type UsdcBalance,
} from "./lib/usdc";
import { UsdcMark } from "./components/Icons";
import { Toaster, useToasts } from "./components/Toaster";
import { SessionInfo } from "./components/SessionInfo";
import { SessionHistory } from "./components/SessionHistory";
import {
  appendSessionStarted,
  clearSessionHistory,
  effectivePayTo,
  findRefundTargetRecord,
  formatTokenAmount,
  incrementSessionUsage,
  loadSessionHistory,
  markSessionClosed,
  primeSessionChainId,
  recordSessionRefund,
  recordTimeoutRefundClaim,
  type CloseReason,
  type PrimeSessionRecord,
} from "./lib/primeHistory";
import {
  checkTimeoutRefundEligibility,
  claimTimeoutRefund,
  formatRefundCountdown,
} from "./lib/escrowRefund";
import {
  applySilentStreakBonusIfEligible,
  computeRewardsSnapshot,
  formatForDelta,
  FOR_PER_MCP_3X,
  FOR_STREAK_BONUS,
  recordMcpCallForRewards,
} from "./lib/rewardsProgram";
import { watchUsdcRefunds } from "./lib/escrowEvents";
import { buildPrimeWireQuery } from "./lib/primeMemoryQuery";
import {
  newErrorCorrelationId,
  primeErrorActions,
  type AppSurfaceError,
} from "./lib/appSurfaceError";
import {
  isPrimeOnboardingCompleted,
  markPrimeOnboardingCompleted,
} from "./lib/primeOnboarding";
import { ErrorActionBar } from "./components/ErrorActionBar";
import { PrimeNetworkLoader } from "./components/PrimeNetworkLoader";
import { MemoryToggle } from "./components/MemoryToggle";
import type {
  ChatMessage,
  Conversation,
} from "./types";

const PrimeOnboardingModal = lazy(() =>
  import("./components/PrimeOnboardingModal").then((m) => ({
    default: m.PrimeOnboardingModal,
  }))
);

/** Base URL of the Monad mainnet block explorer. */
const MONAD_EXPLORER_BASE = "https://monadvision.com";

function explorerTxHref(txHash: string): string {
  return `${MONAD_EXPLORER_BASE}/tx/${txHash}`;
}

function explorerAddrHref(addr: string): string {
  return `${MONAD_EXPLORER_BASE}/address/${addr}`;
}

const RETRY_PATTERNS = [/upstream/i, /\b50\d\b/, /timeout/i, /network/i];

/** Persist Memory toggle in localStorage (key). */
const PRIME_MEMORY_STORAGE_KEY = "fortytwo-prime-memory-enabled";
const PRIME_PROGRESS_MESSAGES: Record<PrimeRequestPhase, string> = {
  initializing: "Connecting to Fortytwo…",
  calling_tool: "Sending your request to Fortytwo…",
  needs_payment: "Confirm payment in the dialog above.",
  wallet_payment: "Sign the USDC authorization in your wallet…",
  session_pending:
    "You're all set, finishing session setup, then your reply will stream here.",
  confirming_payment:
    "You're all set, confirming with Fortytwo and opening your session…",
  starting_reply: "You're all set, Fortytwo is generating your reply…",
  streaming: "Receiving the response…",
};

const PENDING_REPLY_TOAST = {
  title: "Reply in progress",
  description:
    "Wait for Fortytwo to finish the current reply before switching chats or starting a new one.",
} as const;

/** Toast duration for "Session launched"; loader waits until this elapses. */
const SESSION_LAUNCHED_TOAST_MS = 4500;

function newConversation(overrides?: { title?: string }): Conversation {
  const now = Date.now();
  return {
    id: uid("c_"),
    title: overrides?.title ?? "New chat",
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

export type PrimeAppProps = {
  /** When true, after each successful reply the same user message is sent again (see `/automatisation`). */
  automationLoop?: boolean;
};

export default function PrimeApp({
  automationLoop = false,
}: PrimeAppProps) {
  const { theme, toggle: toggleTheme } = useTheme();
  const { ready, authenticated, login, logout, user, linkWallet } = usePrivy();
  const { wallets } = useWallets();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [surfaceError, setSurfaceError] = useState<AppSurfaceError | null>(
    null
  );
  const [primeProgressPhase, setPrimeProgressPhase] =
    useState<PrimeRequestPhase | null>(null);
  /** When false, hide Fortytwo stream loader / composer status during payment UX. */
  const [allowPrimeStreamVisual, setAllowPrimeStreamVisual] = useState(true);
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
  /** Last successful exchange (ms), used for the 10min idle timeout. */
  const [lastActivityAt, setLastActivityAt] = useState<number>(() => Date.now());
  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<PrimeSessionRecord[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(() => {
    try {
      return localStorage.getItem(PRIME_MEMORY_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [primeOnboardingOpen, setPrimeOnboardingOpen] = useState(
    () => !isPrimeOnboardingCompleted()
  );
  const toasts = useToasts();
  const sessionIdRef = useRef<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  /** Halts automation resend chain (Stop or user leaves route via unmount). */
  const automationLoopHaltedRef = useRef(false);
  /** Bumps when user stops, new chat, or switches conversation — ignores pending auto-resend timeouts. */
  const automationScheduleGenRef = useRef(0);
  const handleSubmitRef = useRef<
    (overrideText?: string, opts?: { bypassBusyGuard?: boolean }) => Promise<void>
  >(async () => {});
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastFailedPrimeRef = useRef<{
    conversationId: string;
    assistantId: string;
    wireQuery: string;
  } | null>(null);
  const confirmResolverRef = useRef<((accept: boolean) => void) | null>(null);
  /**
   * When this run started without a cached x-session-id, skip the assistant
   * loader until payment UI is done or the stream actually starts, avoids a
   * brief loader flash before the session authorization modal.
   */
  const deferPrimeStreamLoaderRef = useRef(false);

  const [timeoutRefundUi, setTimeoutRefundUi] = useState<
    | { kind: "hidden" }
    | { kind: "checking" }
    | { kind: "waiting"; countdown: string }
    | { kind: "claimable"; amountDisplay: string }
    | { kind: "claiming" }
    | { kind: "released" }
  >({ kind: "hidden" });

  const [rewardsRevision, setRewardsRevision] = useState(0);
  const [rewardFlights, setRewardFlights] = useState<
    { id: string; amountLabel: string }[]
  >([]);
  const [rewardsHighlight, setRewardsHighlight] = useState(false);
  /** UI: automation bar; false while looping, true after Stop until next manual send. */
  const [automationLoopHalted, setAutomationLoopHalted] = useState(false);

  const onRewardFlyComplete = useCallback((id: string) => {
    setRewardFlights((prev) => prev.filter((x) => x.id !== id));
    setRewardsHighlight(true);
    window.setTimeout(() => setRewardsHighlight(false), 500);
  }, []);

  const wallet = useMemo(() => {
    return wallets.find((w) => w.connectorType !== "embedded") ?? wallets[0] ?? null;
  }, [wallets]);
  const address = (wallet?.address as Address | undefined) ?? null;

  const rewardsSnapshot = useMemo(
    () => computeRewardsSnapshot(address, historyRecords),
    [address, historyRecords, rewardsRevision]
  );

  // Warm MCP tools cache from prior visits (tools/list runs on first askPrime).
  useEffect(() => {
    void loadPersistedMcpTools();
  }, []);

  // ---- Init: load conversations + cached session for the current wallet ----
  useEffect(() => {
    const stored = automationLoop
      ? loadPrimeConversationsAutomation()
      : loadPrimeConversations();
    if (stored.length > 0) {
      setConversations(stored);
      setActiveId(stored[0].id);
    } else {
      const c = newConversation({
        title: automationLoop ? "Repeat test" : "New chat",
      });
      setConversations([c]);
      setActiveId(c.id);
    }
    if (automationLoop) {
      automationLoopHaltedRef.current = false;
      setAutomationLoopHalted(false);
    }
  }, [automationLoop]);

  useEffect(() => {
    if (conversations.length > 0) {
      if (automationLoop) savePrimeConversationsAutomation(conversations);
      else savePrimeConversations(conversations);
    }
  }, [automationLoop, conversations]);

  useEffect(() => {
    if (!address) {
      setSession(null);
      setHistoryRecords([]);
      return;
    }
    const restored = loadSession(address);
    setSession(restored);
    if (restored) {
      setLastActivityAt(
        restored.lastActivityAt ?? restored.openedAt ?? Date.now()
      );
    } else {
      setLastActivityAt(Date.now());
    }
    setHistoryRecords(loadSessionHistory(address));
  }, [address]);

  useEffect(() => {
    if (!address) {
      setRewardsRevision((r) => r + 1);
      return;
    }
    if (applySilentStreakBonusIfEligible(address, historyRecords)) {
      setRewardsRevision((x) => x + 1);
    }
  }, [address, historyRecords]);

  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => {
      setSessionTimerTick((n) => n + 1);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [session?.sessionId, session?.expiresAt]);

  sessionIdRef.current = session?.sessionId ?? null;

  const refundEscrows = useMemo((): Address[] => {
    if (!address) return [];
    const set = new Set<string>();
    if (session?.payTo) set.add(session.payTo.toLowerCase());
    for (const r of historyRecords) {
      if (r.refundTxHash) continue;
      const p = effectivePayTo(r);
      if (p) set.add(p.toLowerCase());
      // Refund always settles from x402Escrow on Monad; keep watching even if
      // payTo was a facilitator or history row lacks payTo but chain is 143.
      if (primeSessionChainId(r) === 143) {
        set.add(FORTYTWO_X402_ESCROW_MONAD.toLowerCase());
      }
    }
    return Array.from(set) as Address[];
  }, [address, session?.payTo, historyRecords]);

  // ---- On-chain refund watcher (USDC Transfer escrow → user) ----
  useEffect(() => {
    if (!address || refundEscrows.length === 0) return;
    const stop = watchUsdcRefunds({
      user: address,
      escrows: refundEscrows,
      onRefund: (log) => {
        const list = loadSessionHistory(address);
        const target = findRefundTargetRecord(list, {
          sessionId: sessionIdRef.current,
          refundFrom: log.from,
        });
        if (!target) return;
        const applied = recordSessionRefund(address, target.id, {
          txHash: log.txHash,
          amount: log.value.toString(),
        });
        if (!applied) return;
        if (!target.closedAt) {
          markSessionClosed(address, target.id, "refund");
        }
        if (sessionIdRef.current === target.id) {
          clearSession(address);
          setSession(null);
        }
        setHistoryRecords(loadSessionHistory(address));
        toasts.push({
          kind: "success",
          title: "Refund received",
          description: "Unused USDC has been returned to your wallet.",
          amount: formatTokenAmount(log.value.toString()),
          txHash: log.txHash,
        });
        readUsdcBalance(address)
          .then((b) => setUsdcBalance(b))
          .catch(() => {
            /* ignore */
          });
      },
    });
    return stop;
  }, [address, refundEscrows, toasts.push]);

  // ---- Detect local session expiry (idle 10min or hard cap 60min) ----
  useEffect(() => {
    if (!address || !session) return;
    const idleAt = lastActivityAt + PRIME_SESSION_IDLE_MS;
    const effective = Math.min(session.expiresAt, idleAt);
    if (Date.now() < effective) return;
    const reason: CloseReason =
      idleAt < session.expiresAt ? "idle" : "hard-cap";
    markSessionClosed(address, session.sessionId, reason);
    clearSession(address);
    setSession(null);
    setHistoryRecords(loadSessionHistory(address));
    toasts.push({
      kind: "info",
      title: "Session ended",
      description:
        reason === "idle"
          ? "Idle timeout (10 min). Unused USDC will be refunded on-chain."
          : "Session reached the 60-minute limit. Unused USDC will be refunded on-chain.",
      durationMs: 9000,
    });
  }, [address, session, sessionTimerTick, lastActivityAt, toasts.push]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PRIME_MEMORY_STORAGE_KEY,
        memoryEnabled ? "1" : "0"
      );
    } catch {
      /* ignore */
    }
  }, [memoryEnabled]);

  // Poll USDC balance: on connect, after each reply, every 30s.
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

  const { onScroll, jumpToLatest, showJumpToLatest } = useChatAutoScroll(
    scrollRef,
    {
      messages: active?.messages,
      activeConversationId: activeId,
      isLoading,
    }
  );

  const composerStatusLine = useMemo(() => {
    if (!isLoading || !primeProgressPhase || !allowPrimeStreamVisual)
      return null;
    const last = active?.messages[active.messages.length - 1];
    if (
      primeProgressPhase === "streaming" &&
      last?.role === "assistant" &&
      (last.content?.length ?? 0) > 0
    ) {
      return null;
    }
    return PRIME_PROGRESS_MESSAGES[primeProgressPhase];
  }, [isLoading, primeProgressPhase, active?.messages, allowPrimeStreamVisual]);

  const showPrimeNetworkLoader = useMemo(() => {
    if (!allowPrimeStreamVisual) return false;
    if (!isLoading || !active?.messages.length) return false;
    const last = active.messages[active.messages.length - 1];
    return (
      last?.role === "assistant" &&
      (last.content?.trim() ?? "").length === 0
    );
  }, [isLoading, active?.messages, allowPrimeStreamVisual]);

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
    if (isLoading) {
      toasts.push({
        kind: "warning",
        title: PENDING_REPLY_TOAST.title,
        description: PENDING_REPLY_TOAST.description,
        durationMs: 7000,
      });
      return;
    }
    if (automationLoop) {
      automationScheduleGenRef.current += 1;
    }
    const c = newConversation({
      title: automationLoop ? "Repeat test" : "New chat",
    });
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    setSurfaceError(null);
  }, [automationLoop, isLoading, toasts]);

  const handleSelect = useCallback(
    (id: string) => {
      if (isLoading && id !== activeId) {
        toasts.push({
          kind: "warning",
          title: PENDING_REPLY_TOAST.title,
          description: PENDING_REPLY_TOAST.description,
          durationMs: 7000,
        });
        return;
      }
      if (automationLoop && id !== activeId) {
        automationScheduleGenRef.current += 1;
      }
      setActiveId(id);
      setSurfaceError(null);
      setSidebarOpen(false);
    },
    [activeId, automationLoop, isLoading, toasts]
  );

  const handleDelete = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const c = newConversation({
          title: automationLoop ? "Repeat test" : "New chat",
        });
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

  const handleStop = () => {
    // Reject the payment gate if open (Escape during modal); same as Cancel.
    confirmSign(false);
    abortRef.current?.abort();
    abortRef.current = null;
    lastFailedPrimeRef.current = null;
    deferPrimeStreamLoaderRef.current = false;
    setAllowPrimeStreamVisual(true);
    setPrimeProgressPhase(null);
    setIsLoading(false);
    if (automationLoop) {
      automationLoopHaltedRef.current = true;
      setAutomationLoopHalted(true);
      automationScheduleGenRef.current += 1;
    }
  };

  const handleDisconnectWallet = useCallback(() => {
    if (address && session) {
      markSessionClosed(address, session.sessionId, "manual");
    }
    if (address) clearSession(address);
    setSession(null);
    void logout();
  }, [address, logout, session]);

  /** Privy: `login()` often no-ops when already authenticated but no wallet is linked. */
  const handleConnectWalletClick = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (!ready) return;
      if (authenticated && !address) {
        linkWallet(e);
      } else {
        login(e);
      }
    },
    [ready, authenticated, address, login, linkWallet]
  );

  const openWalletConnection = useCallback(() => {
    if (!ready) return;
    if (authenticated && !address) {
      void linkWallet();
    } else {
      void login();
    }
  }, [ready, authenticated, address, login, linkWallet]);

  const handleEndSessionLocally = useCallback(() => {
    if (!address || !session) return;
    markSessionClosed(address, session.sessionId, "manual");
    clearSession(address);
    setSession(null);
    setSessionPopoverOpen(false);
    setHistoryRecords(loadSessionHistory(address));
    toasts.push({
      kind: "info",
      title: "Session ended",
      description:
        "Refund will arrive on-chain when Fortytwo settles the unused balance.",
      durationMs: 7000,
    });
  }, [address, session, toasts]);

  const handleClearHistory = useCallback(() => {
    if (!address) return;
    clearSessionHistory(address);
    setHistoryRecords([]);
  }, [address]);

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

  const buildWalletClient = useCallback(async () => {
    if (!wallet || !address) {
      throw new Error("No wallet connected");
    }
    try {
      await wallet.switchChain(monad.id);
    } catch {
      /* may already be on Monad */
    }
    const provider = await wallet.getEthereumProvider();
    return createWalletClient({
      account: address,
      chain: monad,
      transport: custom(provider),
    });
  }, [wallet, address]);

  // ---- Streaming runner ----

  const runStream = useCallback(
    async (
      conversationId: string,
      assistantId: string,
      wireQuery: string
    ): Promise<boolean> => {
      if (!address) {
        const msg = "Connect your wallet to continue.";
        const a = primeErrorActions(msg);
        setSurfaceError({
          message: msg,
          correlationId: newErrorCorrelationId(),
          showReconnect: a.showReconnect,
          showRetry: false,
        });
        setPrimeProgressPhase(null);
        setIsLoading(false);
        return false;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const seedSession = loadSession(address);
      deferPrimeStreamLoaderRef.current = !seedSession?.sessionId;
      setIsLoading(true);
      setAllowPrimeStreamVisual(!deferPrimeStreamLoaderRef.current);
      setSurfaceError(null);

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
        const msg = (e as Error).message;
        const a = primeErrorActions(msg);
        setSurfaceError({
          message: msg,
          correlationId: newErrorCorrelationId(),
          showReconnect: a.showReconnect,
          showRetry: false,
        });
        setPrimeProgressPhase(null);
        setIsLoading(false);
        return null;
      });
      if (!signer) {
        deferPrimeStreamLoaderRef.current = false;
        setAllowPrimeStreamVisual(true);
        setPrimeProgressPhase(null);
        return false;
      }

      lastFailedPrimeRef.current = {
        conversationId,
        assistantId,
        wireQuery,
      };

      let streamCompletedOk = false;
      try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 600));
            updateAssistant((m) => ({ ...m, content: "", error: false }));
          }
          try {
            const cachedSession = address ? loadSession(address) : null;
            // Local session id used to attribute usage on the same call,
            // closure-stable, unlike the React state which only updates on
            // the next render.
            let activeSessionId = cachedSession?.sessionId ?? null;
            const onRequestPhase = (phase: PrimeRequestPhase) => {
              if (phase === "session_pending") {
                setSigningState("idle");
                setPendingAmount(null);
                setAllowPrimeStreamVisual(true);
                deferPrimeStreamLoaderRef.current = false;
              } else if (
                phase === "starting_reply" &&
                deferPrimeStreamLoaderRef.current
              ) {
                deferPrimeStreamLoaderRef.current = false;
                setAllowPrimeStreamVisual(true);
              }
              setPrimeProgressPhase(phase);
            };
            const result = await askPrime({
              query: wireQuery,
              address,
              signTypedDataAsync: signer,
              session: cachedSession,
              signal: ctrl.signal,
              onRequestPhase,
              onChunk: (delta) => {
                updateAssistant((m) => ({
                  ...m,
                  content: (m.content ?? "") + delta,
                }));
              },
              onSession: (s) => {
                activeSessionId = s.sessionId;
                const stamped: PrimeSession = {
                  ...s,
                  lastActivityAt: Date.now(),
                };
                if (address) {
                  saveSession(address, stamped);
                  appendSessionStarted(address, {
                    id: s.sessionId,
                    network: s.network,
                    authorizedAmount: s.authorizedAmount,
                    authorizedAmountDisplay: s.authorizedAmountDisplay,
                    openedAt: s.openedAt ?? Date.now(),
                    settleTxHash: s.paymentTxHash,
                    asset: s.asset,
                    payTo: s.payTo,
                    paymentNetwork: s.paymentAuth?.network ?? s.network,
                    paymentClient: s.paymentAuth?.client,
                    paymentNonce: s.paymentAuth?.nonce,
                    escrowId: s.escrowId,
                    paymentSignatureB64: s.paymentSignatureB64,
                    paymentResponseB64: s.paymentResponseB64,
                  });
                  setHistoryRecords(loadSessionHistory(address));
                }
                setSession(stamped);
                setLastActivityAt(Date.now());
                setSigningState("idle");
                setPendingAmount(null);
              },
              onUsage: (usage) => {
                if (!address || !activeSessionId) return;
                incrementSessionUsage(address, activeSessionId, {
                  tokensIn: usage.tokensIn,
                  tokensOut: usage.tokensOut,
                  usdcChargedBaseUnits: usage.usdcChargedBaseUnits,
                });
                const next = loadSessionHistory(address);
                setHistoryRecords(next);
                const { grantStreakBonusFly } = recordMcpCallForRewards(
                  address,
                  next
                );
                setRewardsRevision((r) => r + 1);
                setRewardFlights((prev) => [
                  ...prev,
                  {
                    id: uid("fly_"),
                    amountLabel: formatForDelta(FOR_PER_MCP_3X),
                  },
                ]);
                if (grantStreakBonusFly) {
                  setRewardFlights((prev) => [
                    ...prev,
                    {
                      id: uid("fly_"),
                      amountLabel: formatForDelta(FOR_STREAK_BONUS),
                    },
                  ]);
                }
              },
              onPaymentRequired: (accept) => {
                setAllowPrimeStreamVisual(false);
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
              beforeAssistantStream: async ({ session: s }) => {
                const decimals = 6;
                const human = (Number(s.authorizedAmount) / 10 ** decimals).toString();
                toasts.push({
                  kind: "success",
                  title: "Session launched",
                  description:
                    "Your billing session is active. Fortytwo is preparing your reply.",
                  dock: "left",
                  amount: human,
                  txHash: s.paymentTxHash,
                  durationMs: SESSION_LAUNCHED_TOAST_MS,
                });
                await new Promise<void>((r) =>
                  setTimeout(r, SESSION_LAUNCHED_TOAST_MS)
                );
                setAllowPrimeStreamVisual(true);
              },
            });
            // Final-shot fallback: if streaming didn't emit chunks, drop the full text now.
            // Surface per-reply token usage (Fortytwo _meta) for the assistant bubble.
            updateAssistant((m) => {
              const u = result.usage;
              const usage: ChatMessage["usage"] | undefined =
                u && (u.tokensIn != null || u.tokensOut != null)
                  ? {
                      ...(u.tokensIn != null
                        ? { prompt_tokens: u.tokensIn }
                        : {}),
                      ...(u.tokensOut != null
                        ? { completion_tokens: u.tokensOut }
                        : {}),
                      total_tokens: (u.tokensIn ?? 0) + (u.tokensOut ?? 0),
                    }
                  : undefined;
              return {
                ...m,
                content:
                  m.content && m.content.length > 0 ? m.content : result.text,
                ...(usage ? { usage } : {}),
              };
            });
            const now = Date.now();
            setLastActivityAt(now);
            if (address && result.session) {
              const merged: PrimeSession = {
                ...result.session,
                lastActivityAt: now,
              };
              saveSession(address, merged);
              setSession(merged);
            }
            lastError = null;
            lastFailedPrimeRef.current = null;
            streamCompletedOk = true;
            break;
          } catch (e) {
            if (ctrl.signal.aborted) {
              lastError = null;
              lastFailedPrimeRef.current = null;
              streamCompletedOk = false;
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
          streamCompletedOk = false;
          const msg = lastError.message || "Unknown error";
          const a = primeErrorActions(msg);
          setSurfaceError({
            message: msg,
            correlationId: newErrorCorrelationId(),
            showReconnect: a.showReconnect,
            showRetry:
              a.showRetry && lastFailedPrimeRef.current != null,
          });
          updateAssistant((m) => ({
            ...m,
            content: m.content
              ? `${m.content}\n\n---\n**Error:** ${msg}`
              : `**Error:** ${msg}`,
            error: true,
          }));
        }
      } finally {
        deferPrimeStreamLoaderRef.current = false;
        setPrimeProgressPhase(null);
        setSigningState("idle");
        setPendingAmount(null);
        setAllowPrimeStreamVisual(true);
        setIsLoading(false);
        abortRef.current = null;

        if (address) {
          readUsdcBalance(address)
            .then((b) => setUsdcBalance(b))
            .catch(() => {
              /* ignore */
            });
        }
      }
      return streamCompletedOk;
    },
    [address, buildSigner]
  );

  const retryLastPrimeRequest = useCallback(() => {
    const ctx = lastFailedPrimeRef.current;
    if (!ctx) return;
    setSurfaceError(null);
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== ctx.conversationId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === ctx.assistantId
              ? { ...m, content: "", error: false }
              : m
          ),
          updatedAt: Date.now(),
        };
      })
    );
    void runStream(ctx.conversationId, ctx.assistantId, ctx.wireQuery);
  }, [runStream]);

  // ---- Submit / Edit / Regenerate ----

  const handleSubmit = useCallback(
    async (
      overrideText?: string,
      opts?: { bypassBusyGuard?: boolean }
    ) => {
      if (automationLoop && !opts?.bypassBusyGuard) {
        automationLoopHaltedRef.current = false;
        setAutomationLoopHalted(false);
      }

      const text = (overrideText ?? input).trim();
      if (
        !text ||
        (!opts?.bypassBusyGuard && isLoading) ||
        !active ||
        activeId == null
      ) {
        return;
      }
      if (!authenticated || !address) {
        const msg = "Connect your wallet first.";
        const a = primeErrorActions(msg);
        setSurfaceError({
          message: msg,
          correlationId: newErrorCorrelationId(),
          showReconnect: a.showReconnect,
          showRetry: false,
        });
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

      let wireMessages: ChatMessage[] = [];
      updateActive((c) => {
        const isFirstMessage = c.messages.length === 0;
        const newTitle = isFirstMessage ? text.slice(0, 60) : c.title;
        wireMessages = [...c.messages, userMsg, assistantMsg];
        return {
          ...c,
          title: newTitle,
          messages: wireMessages,
          updatedAt: Date.now(),
        };
      });

      setInput("");

      const wireQuery = buildPrimeWireQuery({
        memoryEnabled,
        messages: wireMessages,
        assistantMessageId: assistantMsg.id,
        currentUserMessage: text,
      });
      const ok = await runStream(activeId, assistantMsg.id, wireQuery);
      if (
        automationLoop &&
        ok &&
        !automationLoopHaltedRef.current
      ) {
        const scheduleGen = automationScheduleGenRef.current;
        window.setTimeout(() => {
          if (scheduleGen !== automationScheduleGenRef.current) return;
          if (!automationLoop || automationLoopHaltedRef.current) return;
          void handleSubmitRef.current?.(text, { bypassBusyGuard: true });
        }, 0);
      }
    },
    [
      active,
      activeId,
      address,
      authenticated,
      automationLoop,
      input,
      isLoading,
      memoryEnabled,
      runStream,
      updateActive,
    ]
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    return () => {
      if (automationLoop) {
        automationScheduleGenRef.current += 1;
      }
    };
  }, [automationLoop]);

  const handleEditUser = useCallback(
    async (messageId: string, newContent: string) => {
      if (!activeId) return;

      const assistantMsg: ChatMessage = {
        id: uid("m_"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: "fortytwo-prime",
      };

      let wireNext: ChatMessage[] | null = null;
      updateActive((c) => {
        const idx = c.messages.findIndex((m) => m.id === messageId);
        if (idx < 0) return c;
        const user = c.messages[idx];
        if (user.role !== "user") return c;

        const truncated = c.messages.slice(0, idx);
        const editedUser: ChatMessage = {
          ...user,
          content: newContent,
          edited: true,
        };
        wireNext = [...truncated, editedUser, assistantMsg];
        return {
          ...c,
          messages: wireNext,
          updatedAt: Date.now(),
        };
      });

      if (!wireNext) return;

      const wireQuery = buildPrimeWireQuery({
        memoryEnabled,
        messages: wireNext,
        assistantMessageId: assistantMsg.id,
        currentUserMessage: newContent,
      });
      await runStream(activeId, assistantMsg.id, wireQuery);
    },
    [activeId, memoryEnabled, runStream, updateActive]
  );

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!activeId) return;

      const newAssistant: ChatMessage = {
        id: uid("m_"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: "fortytwo-prime",
      };

      let wireNext: ChatMessage[] | null = null;
      let replayUserText = "";

      updateActive((c) => {
        const idx = c.messages.findIndex((m) => m.id === messageId);
        if (idx < 0 || c.messages[idx].role !== "assistant") return c;
        const prevUser = [...c.messages.slice(0, idx)]
          .reverse()
          .find((m) => m.role === "user");
        if (!prevUser) return c;

        replayUserText = prevUser.content;
        const history = c.messages.slice(0, idx);
        wireNext = [...history, newAssistant];
        return {
          ...c,
          messages: wireNext,
          updatedAt: Date.now(),
        };
      });

      if (!wireNext || !replayUserText) return;

      const wireQuery = buildPrimeWireQuery({
        memoryEnabled,
        messages: wireNext,
        assistantMessageId: newAssistant.id,
        currentUserMessage: replayUserText,
      });
      await runStream(activeId, newAssistant.id, wireQuery);
    },
    [activeId, memoryEnabled, runStream, updateActive]
  );

  const handleDeleteMessage = (messageId: string) => {
    updateActive((c) => ({
      ...c,
      messages: c.messages.filter((m) => m.id !== messageId),
      updatedAt: Date.now(),
    }));
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

  const dismissPrimeOnboarding = useCallback(() => {
    markPrimeOnboardingCompleted();
    setPrimeOnboardingOpen(false);
  }, []);

  const sessionState = useMemo<{
    active: boolean;
    label: string;
    title: string;
    effectiveExpiresAt: number | null;
    reason: "idle" | "cap" | null;
  }>(() => {
    if (!session)
      return {
        active: false,
        label: "No session",
        title: "First message will require a one-time signature",
        effectiveExpiresAt: null,
        reason: null,
      };
    // Fortytwo closes a session on the *earlier* of the 60min hard cap or
    // 10min idle timeout, mirror that locally so the pill matches reality.
    const idleExpiry = lastActivityAt + PRIME_SESSION_IDLE_MS;
    const effectiveExpiry = Math.min(session.expiresAt, idleExpiry);
    const reason: "idle" | "cap" =
      idleExpiry < session.expiresAt ? "idle" : "cap";
    const ms = effectiveExpiry - Date.now();
    if (ms <= 0)
      return {
        active: false,
        label: "Session expired",
        title: "Next message will require a fresh signature",
        effectiveExpiresAt: effectiveExpiry,
        reason,
      };
    const mins = Math.max(1, Math.round(ms / 60000));
    return {
      active: true,
      label: `Session · ${mins}m left`,
      title:
        reason === "idle"
          ? `Idle timeout in ~${mins} min, send any message to keep the session alive (up to ${session.authorizedAmountDisplay} authorized)`
          : `Up to ${session.authorizedAmountDisplay} authorized, no further signature needed for ~${mins} min`,
      effectiveExpiresAt: effectiveExpiry,
      reason,
    };
  }, [session, sessionTimerTick, lastActivityAt]);

  /** Active session record (for popover), null until first reply. */
  const activeRecord = useMemo<PrimeSessionRecord | undefined>(() => {
    if (!session) return undefined;
    return historyRecords.find((r) => r.id === session.sessionId);
  }, [session, historyRecords]);

  const activeEscrowId =
    activeRecord?.escrowId ?? session?.escrowId ?? undefined;

  // Poll x402Escrow for timeout-refund eligibility when a session closed without refund.
  useEffect(() => {
    if (!address || !activeEscrowId) {
      setTimeoutRefundUi({ kind: "hidden" });
      return;
    }
    if (activeRecord?.refundTxHash || activeRecord?.timeoutRefundTxHash) {
      setTimeoutRefundUi({ kind: "hidden" });
      return;
    }
    const sessionExpired =
      sessionState.effectiveExpiresAt != null &&
      sessionState.effectiveExpiresAt - Date.now() <= 0;
    const recordClosed = activeRecord?.closedAt != null;
    if (!sessionExpired && !recordClosed) {
      setTimeoutRefundUi({ kind: "hidden" });
      return;
    }

    let cancelled = false;
    const escrowId = activeEscrowId as Hex;

    const tick = async () => {
      if (cancelled) return;
      setTimeoutRefundUi((prev) =>
        prev.kind === "claiming" ? prev : { kind: "checking" }
      );
      try {
        const elig = await checkTimeoutRefundEligibility(escrowId);
        if (cancelled) return;
        if (elig.status === "claimable") {
          setTimeoutRefundUi({
            kind: "claimable",
            amountDisplay: formatTokenAmount(elig.amount.toString()),
          });
        } else if (elig.status === "waiting") {
          setTimeoutRefundUi({
            kind: "waiting",
            countdown: formatRefundCountdown(elig.secondsLeft),
          });
        } else if (elig.status === "released") {
          setTimeoutRefundUi({ kind: "released" });
        } else {
          setTimeoutRefundUi({ kind: "hidden" });
        }
      } catch {
        if (!cancelled) setTimeoutRefundUi({ kind: "hidden" });
      }
    };

    void tick();
    const handle = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [
    address,
    activeEscrowId,
    activeRecord?.closedAt,
    activeRecord?.refundTxHash,
    activeRecord?.timeoutRefundTxHash,
    sessionState.effectiveExpiresAt,
  ]);

  const handleClaimTimeoutRefund = useCallback(async () => {
    const escrowId = activeEscrowId as Hex | undefined;
    const sessionId = session?.sessionId ?? activeRecord?.id;
    if (!address || !escrowId || !sessionId) return;
    setTimeoutRefundUi({ kind: "claiming" });
    try {
      const wc = await buildWalletClient();
      const hash = await claimTimeoutRefund(wc, escrowId);
      const elig = await checkTimeoutRefundEligibility(escrowId);
      const amount =
        elig.status === "claimable" ? elig.amount.toString() : undefined;
      recordTimeoutRefundClaim(address, sessionId, {
        txHash: hash,
        amount,
      });
      if (sessionIdRef.current === sessionId) {
        clearSession(address);
        setSession(null);
      }
      setHistoryRecords(loadSessionHistory(address));
      toasts.push({
        kind: "success",
        title: "Timeout refund claimed",
        description:
          "USDC was returned via refundAfterTimeout on the escrow contract.",
        txHash: hash,
        durationMs: 12_000,
      });
      readUsdcBalance(address)
        .then((b) => setUsdcBalance(b))
        .catch(() => {
          /* ignore */
        });
      setTimeoutRefundUi({ kind: "hidden" });
    } catch (err) {
      try {
        const elig = await checkTimeoutRefundEligibility(escrowId);
        if (elig.status === "claimable") {
          setTimeoutRefundUi({
            kind: "claimable",
            amountDisplay: formatTokenAmount(elig.amount.toString()),
          });
        } else {
          setTimeoutRefundUi({ kind: "hidden" });
        }
      } catch {
        setTimeoutRefundUi({ kind: "hidden" });
      }
      toasts.push({
        kind: "error",
        title: "Refund claim failed",
        description:
          (err as Error).message ||
          "Could not send refundAfterTimeout. Try again later.",
        durationMs: 10_000,
      });
    }
  }, [
    activeEscrowId,
    activeRecord?.id,
    address,
    buildWalletClient,
    session?.sessionId,
    toasts,
  ]);

  return (
    <div
      className={`app ${sidebarOpen ? "sidebar-open" : ""}`}
      data-page={automationLoop ? "automation" : "prime"}
      data-theme={theme}
    >
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
        onTogglePin={handleTogglePin}
        modelLabel="Fortytwo Prime"
        brandTitle={automationLoop ? "Automation" : undefined}
        brandSubtitle={
          automationLoop
            ? "Fortytwo Prime · repeat after each reply"
            : undefined
        }
        navLocked={isLoading}
        navLockTitle={PENDING_REPLY_TOAST.description}
        forPoints={rewardsSnapshot.displayTotalFor}
        rewardsHighlight={rewardsHighlight}
        rewardFlights={rewardFlights}
        onRewardFlyComplete={onRewardFlyComplete}
        rewardsPrime={
          address
            ? {
                walletConnected: !!(ready && authenticated && address),
                snapshot: rewardsSnapshot,
              }
            : null
        }
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
            {automationLoop ? (
              <span className="topbar-mode-badge" title="Automation route">
                Loop
              </span>
            ) : null}
            <span className="topbar-title-chat">
              {active?.title || (automationLoop ? "Repeat test" : "New chat")}
            </span>
          </div>
          <div className="topbar-tools">
            <div className="topbar-tools-cluster">
              {ready && authenticated && address && (
                <MemoryToggle
                  enabled={memoryEnabled}
                  onChange={setMemoryEnabled}
                />
              )}
              {ready && authenticated && address && (
                <div className="session-pill-wrap">
                  <button
                    type="button"
                    className={`session-pill ${
                      sessionState.active ? "is-active" : "is-idle"
                    }`}
                    title={sessionState.title}
                    onClick={() =>
                      session && setSessionPopoverOpen((v) => !v)
                    }
                    disabled={!session}
                    aria-haspopup="dialog"
                    aria-expanded={sessionPopoverOpen}
                  >
                    <span
                      className={`session-dot ${
                        sessionState.active ? "is-active" : "is-idle"
                      }`}
                    />
                    <span className="session-pill-label">
                      {sessionState.label}
                    </span>
                  </button>
                  <SessionInfo
                    open={sessionPopoverOpen}
                    onClose={() => setSessionPopoverOpen(false)}
                    session={session}
                    record={activeRecord}
                    effectiveExpiresAt={sessionState.effectiveExpiresAt}
                    expiresReason={sessionState.reason}
                    explorerHref={explorerTxHref}
                    addressHref={explorerAddrHref}
                    onEndSessionLocally={
                      sessionState.active
                        ? handleEndSessionLocally
                        : undefined
                    }
                    escrowId={activeEscrowId}
                    timeoutRefundUi={timeoutRefundUi}
                    onClaimTimeoutRefund={handleClaimTimeoutRefund}
                  />
                </div>
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
                        : "–"}
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
                  onClick={handleConnectWalletClick}
                  disabled={!ready}
                >
                  {ready ? "Connect wallet" : "Loading…"}
                </button>
              )}
            </div>
            <div className="topbar-tools-actions">
              {ready && authenticated && address && (
                <button
                  type="button"
                  className="icon-btn-2"
                  onClick={() => setHistoryOpen(true)}
                  title="Session history"
                  aria-label="Session history"
                >
                  <HistoryIcon />
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
            </div>
          </div>
        </header>

        {automationLoop && (
          <div
            className={`automation-loop-bar${
              automationLoopHalted ? " automation-loop-bar--halted" : ""
            }`}
            role="region"
            aria-label="Automation mode"
          >
            <div className="automation-loop-bar-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 1l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3 11V9a4 4 0 0 1 4-4h14"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7 23l-4-4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M21 13v2a4 4 0 0 1-4 4H3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="automation-loop-bar-text">
              {automationLoopHalted
                ? "Automation stopped. Send a message to resume repeating after each reply."
                : "Live loop: after each successful reply, the same user message is sent again until you press Stop or an error occurs. Every turn bills like a normal chat."}
            </p>
            {!automationLoopHalted && (
              <button
                type="button"
                className="automation-loop-bar-stop"
                onClick={handleStop}
                aria-label="Stop automation"
              >
                Stop
              </button>
            )}
          </div>
        )}

        <div className="messages-wrap">
          <div
            className={`messages${
              !active || active.messages.length === 0
                ? " messages--empty-chat"
                : ""
            }`}
            ref={scrollRef}
            onScroll={onScroll}
          >
            {!active || active.messages.length === 0 ? (
              <Welcome
                modelLabel="Fortytwo Prime"
                variant={automationLoop ? "automation" : "default"}
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
                    streaming &&
                    (m.content ?? "").trim().length === 0 &&
                    signingState === "idle" &&
                    allowPrimeStreamVisual;
                  const progressHint =
                    thinking &&
                    allowPrimeStreamVisual &&
                    primeProgressPhase
                      ? isLast && showPrimeNetworkLoader
                        ? undefined
                        : PRIME_PROGRESS_MESSAGES[primeProgressPhase]
                      : undefined;
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
                      progressHint={progressHint}
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
                {showPrimeNetworkLoader ? (
                  <PrimeNetworkLoader />
                ) : null}
              </div>
            )}
          </div>
          {showJumpToLatest && (
            <button
              type="button"
              className="jump-latest-btn"
              onClick={jumpToLatest}
              aria-label="Jump to latest messages"
            >
              ↓ Latest
            </button>
          )}
        </div>

        {!authenticated && (
          <div className="wallet-hint-bar" role="status">
            <p>
              {automationLoop
                ? "Connect your wallet to run the repeat loop. You need USDC on Monad; each iteration uses your session like a normal message."
                : "Connect your wallet (MetaMask, Rabby, WalletConnect…) to start chatting. You'll need USDC on Monad."}
            </p>
            <div className="wallet-hint-actions">
              <button
                type="button"
                className="error-action-btn error-action-btn-primary"
                onClick={openWalletConnection}
                disabled={!ready}
              >
                Connect wallet
              </button>
            </div>
          </div>
        )}

        {surfaceError && (
          <ErrorActionBar
            message={surfaceError.message}
            correlationId={surfaceError.correlationId}
            showReconnect={surfaceError.showReconnect}
            showRetry={surfaceError.showRetry}
            onReconnect={openWalletConnection}
            onRetry={retryLastPrimeRequest}
            onDismiss={() => setSurfaceError(null)}
          />
        )}

        <Composer
          value={input}
          onChange={setInput}
          attachments={[]}
          onAttachmentsChange={() => {
            /* Prime route: text-only (Fortytwo MCP); no image modality in tool args */
          }}
          onSubmit={() => handleSubmit()}
          onStop={handleStop}
          isLoading={isLoading}
          statusLine={composerStatusLine}
          disabled={!active || !authenticated}
          visionAllowed={false}
          automationMode={automationLoop}
          inputPlaceholder={
            automationLoop
              ? "Message to repeat after each successful reply…"
              : undefined
          }
          onError={(msg) =>
            setSurfaceError({
              message: msg,
              correlationId: newErrorCorrelationId(),
              showReconnect: false,
              showRetry: false,
            })
          }
        />
      </main>

      {signingState !== "idle" && (
        <div className="modal-scrim" onClick={() => signingState === "awaiting-confirm" && confirmSign(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Authorize Fortytwo Prime session</h2>
            {signingState === "awaiting-confirm" ? (
              <>
                <p className="modal-text">
                  You're about to authorize up to{" "}
                  <span className="modal-amount">
                    <UsdcMark size={16} />
                    <strong>{pendingAmount ?? "–"}</strong>
                  </span>{" "}
                  for this session on <strong>Monad</strong>. Subsequent
                  messages in this session won't require another signature
                  until it expires.
                </p>
                <p className="modal-sub">
                  No tokens move until Fortytwo settles your reply on-chain.
                </p>
                {primeProgressPhase === "needs_payment" ? (
                  <p className="modal-phase-hint" role="status">
                    {PRIME_PROGRESS_MESSAGES.needs_payment}
                  </p>
                ) : null}
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
                <p className="modal-text modal-text-signing-gap">
                  This step may take about a minute or several minutes.
                </p>
                {primeProgressPhase ? (
                  <p className="modal-phase-hint" role="status">
                    {PRIME_PROGRESS_MESSAGES[primeProgressPhase]}
                  </p>
                ) : null}
                <p className="modal-signing-warn">
                  <strong>
                    Do not reload this page while signing is in progress.
                  </strong>
                </p>
                <div className="thinking">
                  <span /><span /><span />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <SessionHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        records={historyRecords}
        explorerHref={explorerTxHref}
        addressHref={explorerAddrHref}
        onClear={handleClearHistory}
      />

      <Toaster
        toasts={toasts.toasts}
        onDismiss={toasts.dismiss}
        explorerHref={explorerTxHref}
      />

      {primeOnboardingOpen ? (
        <Suspense
          fallback={
            <div
              className="prime-onb-lazy-fallback"
              aria-busy="true"
              aria-live="polite"
            />
          }
        >
          <PrimeOnboardingModal onClose={dismissPrimeOnboarding} />
        </Suspense>
      ) : null}

      {/* Hidden but keeps user variable referenced so it stays in scope for future use. */}
      {user ? null : null}
    </div>
  );
}

function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 12a9 9 0 1 0 3-6.7M3 5v4h4M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
