import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Message } from "./components/Message";
import { Composer } from "./components/Composer";
import { Welcome } from "./components/Welcome";
import { ModelPicker } from "./components/ModelPicker";
import { useTheme } from "./hooks/useTheme";
import { uid } from "./lib/id";
import { loadConversations, saveConversations } from "./lib/storage";
import {
  fetchModels,
  isFreeModel,
  modelSupportsImages,
  streamChatCompletion,
} from "./lib/openrouter";
import { exportAllJson, parseImport } from "./lib/exportImport";
import type {
  ChatMessage,
  Conversation,
  ImageAttachment,
  OpenRouterModel,
} from "./types";

const API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;
const ENV_MODEL =
  (import.meta.env.VITE_OPENROUTER_MODEL as string | undefined) ||
  "google/gemma-4-31b-it:free";

const SYSTEM_PROMPT =
  "You are a helpful, precise, and concise assistant. Reply in English by default, using Markdown when appropriate (headings, lists, code blocks).";

const PREF_MODEL_KEY = "fortytwo:default-model";
const RETRY_PROVIDER_PATTERNS = [
  /provider returned error/i,
  /upstream/i,
  /\b50\d\b/,
  /timeout/i,
];

function newConversation(model: string): Conversation {
  const now = Date.now();
  return {
    id: uid("c_"),
    title: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
    model,
  };
}

export default function LegacyApp() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string>(() => {
    try {
      return localStorage.getItem(PREF_MODEL_KEY) || ENV_MODEL;
    } catch {
      return ENV_MODEL;
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [knownModels, setKnownModels] = useState<OpenRouterModel[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = loadConversations();
    if (stored.length > 0) {
      setConversations(stored);
      setActiveId(stored[0].id);
    } else {
      const c = newConversation(defaultModel);
      setConversations([c]);
      setActiveId(c.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (conversations.length > 0) saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_MODEL_KEY, defaultModel);
    } catch {
      /* empty */
    }
  }, [defaultModel]);

  useEffect(() => {
    fetchModels()
      .then((d) => setKnownModels(d.filter(isFreeModel)))
      .catch(() => {
        /* offline ok */
      });
  }, []);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  const activeModel = active?.model || defaultModel;

  const visionAllowed = useMemo(() => {
    const m = knownModels.find((mm) => mm.id === activeModel);
    if (!m) return true; // by default, allow attempt; OpenRouter will error if not supported
    return modelSupportsImages(m);
  }, [knownModels, activeModel]);

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

  const handleNew = useCallback(() => {
    const c = newConversation(defaultModel);
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    setAttachments([]);
    setError(null);
  }, [defaultModel]);

  const handleSelect = (id: string) => {
    setActiveId(id);
    setError(null);
    setSidebarOpen(false);
  };

  const handleDelete = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const c = newConversation(defaultModel);
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
    const c = newConversation(defaultModel);
    setConversations([c]);
    setActiveId(c.id);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  };

  /**
   * Streams the assistant reply. Assumes `messages` ends with an empty
   * assistant placeholder; updates it in place. Retries on transient provider errors.
   */
  const runStream = useCallback(
    async (
      conversationId: string,
      assistantId: string,
      history: ChatMessage[],
      modelId: string
    ) => {
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

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
        try {
          // On retry, clear placeholder content again
          if (attempt > 0) {
            updateAssistant((m) => ({ ...m, content: "", error: false }));
          }
          await streamChatCompletion({
            apiKey: API_KEY!,
            model: modelId,
            messages: history,
            systemPrompt: SYSTEM_PROMPT,
            signal: ctrl.signal,
            onToken: (delta) => {
              updateAssistant((m) => ({
                ...m,
                content: (m.content ?? "") + delta,
              }));
            },
            onMeta: (meta) => {
              updateAssistant((m) => ({
                ...m,
                model: meta.model || m.model,
                usage: meta.usage || m.usage,
              }));
            },
          });
          lastError = null;
          break;
        } catch (e) {
          if (ctrl.signal.aborted) {
            lastError = null;
            break;
          }
          const err = e as Error;
          lastError = err;
          const transient = RETRY_PROVIDER_PATTERNS.some((re) =>
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
            ? `${m.content ?? ""}\n\n---\n**Error:** ${msg}`
            : `**Error:** ${msg}`,
          error: true,
        }));
      }

      setIsLoading(false);
      abortRef.current = null;
    },
    []
  );

  const handleSubmit = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if ((!text && attachments.length === 0) || isLoading || !active) return;
      if (!API_KEY) {
        setError(
          "Missing OpenRouter API key. Set VITE_OPENROUTER_API_KEY in .env.local and restart the dev server."
        );
        return;
      }

      const userMsg: ChatMessage = {
        id: uid("m_"),
        role: "user",
        content: text,
        attachments: attachments.length ? attachments : undefined,
        createdAt: Date.now(),
      };
      const assistantMsg: ChatMessage = {
        id: uid("m_"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: activeModel,
      };

      const isFirstMessage = active.messages.length === 0;
      const newTitle = isFirstMessage
        ? (text || "Image").slice(0, 60)
        : active.title;

      const newMessages = [...active.messages, userMsg, assistantMsg];

      updateActive((c) => ({
        ...c,
        title: newTitle,
        messages: newMessages,
        updatedAt: Date.now(),
      }));

      setInput("");
      setAttachments([]);

      const history = newMessages.slice(0, -1); // all but empty assistant placeholder
      await runStream(active.id, assistantMsg.id, history, activeModel);
    },
    [active, activeModel, attachments, input, isLoading, runStream, updateActive]
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
        model: activeModel,
      };
      const next = [...truncated, editedUser, assistantMsg];

      updateActive((c) => ({
        ...c,
        messages: next,
        updatedAt: Date.now(),
      }));

      const history = next.slice(0, -1);
      await runStream(active.id, assistantMsg.id, history, activeModel);
    },
    [active, activeModel, runStream, updateActive]
  );

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!active) return;
      const idx = active.messages.findIndex((m) => m.id === messageId);
      if (idx < 0 || active.messages[idx].role !== "assistant") return;

      const history = active.messages.slice(0, idx);
      const newAssistant: ChatMessage = {
        id: uid("m_"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: activeModel,
      };
      const next = [...history, newAssistant];

      updateActive((c) => ({
        ...c,
        messages: next,
        updatedAt: Date.now(),
      }));

      await runStream(active.id, newAssistant.id, history, activeModel);
    },
    [active, activeModel, runStream, updateActive]
  );

  const handleDeleteMessage = (messageId: string) => {
    updateActive((c) => ({
      ...c,
      messages: c.messages.filter((m) => m.id !== messageId),
      updatedAt: Date.now(),
    }));
  };

  const handleChangeModel = (id: string) => {
    if (active) {
      updateActive((c) => ({ ...c, model: id }));
    }
    setDefaultModel(id);
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
        modelLabel={activeModel}
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
            <ModelPicker value={activeModel} onChange={handleChangeModel} />
            <button
              type="button"
              className="icon-btn-2"
              onClick={toggleTheme}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </header>

        <div className="messages" ref={scrollRef}>
          {!active || active.messages.length === 0 ? (
            <Welcome
              modelLabel={activeModel}
              onPick={(p) => {
                setInput(p);
                void handleSubmit(p);
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
          disabled={!active}
          visionAllowed={visionAllowed}
          onError={setError}
        />
      </main>
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
