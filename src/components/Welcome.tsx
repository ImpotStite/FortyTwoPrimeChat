interface Props {
  onPick: (prompt: string) => void;
  modelLabel: string;
}

const SUGGESTIONS = [
  {
    title: "Explain it",
    prompt: "Explain quantum mechanics as if I were 12 years old.",
  },
  {
    title: "Code help",
    prompt:
      "Write a TypeScript debounce function with generic types.",
  },
  {
    title: "Brainstorm",
    prompt: "Give me 10 original side-project ideas for a solo developer.",
  },
  {
    title: "Draft",
    prompt:
      "Draft a professional email to politely decline a meeting.",
  },
];

export function Welcome({ onPick, modelLabel }: Props) {
  const isPrime = modelLabel === "Fortytwo Prime";
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <img
          className="welcome-logo-img"
          src="/fortytwo-prime-mark.png"
          width={64}
          height={64}
          alt="Fortytwo Prime"
        />
      </div>
      <h1 className="welcome-title">How can I help you today?</h1>
      <p className="welcome-sub">
        {isPrime ? (
          <>
            Powered by <strong>Fortytwo Prime</strong> · pay-per-use in USDC on
            Monad.
          </>
        ) : (
          <>
            Connected to <code>{modelLabel}</code> via OpenRouter.
          </>
        )}
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            type="button"
            key={s.title}
            className="suggestion"
            onClick={() => onPick(s.prompt)}
          >
            <span className="suggestion-title">{s.title}</span>
            <span className="suggestion-text">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
