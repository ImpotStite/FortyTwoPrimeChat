interface Props {
  onPick: (prompt: string) => void;
  modelLabel: string;
  variant?: "default" | "automation";
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

const AUTOMATION_SUGGESTIONS = [
  {
    title: "Ping",
    prompt: "Reply with the single word: pong.",
  },
  {
    title: "One line",
    prompt: "Say hello in exactly one short sentence.",
  },
  {
    title: "Math check",
    prompt: "What is 2 + 2? Answer with just the number.",
  },
  {
    title: "Timestamp",
    prompt: "Reply with the current UTC time as HH:MM only.",
  },
];

export function Welcome({ onPick, modelLabel, variant = "default" }: Props) {
  const isPrime = modelLabel === "Fortytwo Prime";
  const isAutomation = variant === "automation";
  const picks = isAutomation ? AUTOMATION_SUGGESTIONS : SUGGESTIONS;
  return (
    <div className={`welcome${isAutomation ? " welcome--automation" : ""}`}>
      <div className="welcome-logo">
        <img
          className="welcome-logo-img"
          src="/fortytwo-prime-icon-192.png"
          width={128}
          height={128}
          alt="Fortytwo Prime"
        />
      </div>
      {isAutomation ? (
        <>
          <p className="welcome-pill" role="status">
            Automation · repeat mode
          </p>
          <h1 className="welcome-title">Choose a prompt to run in a loop</h1>
          <p className="welcome-sub">
            After each <strong>successful</strong> Fortytwo Prime reply, the{" "}
            <strong>same</strong> message is sent again automatically. Use{" "}
            <strong>Stop</strong> in the bar above anytime. Each turn uses your
            session and USDC on Monad like normal chat.
          </p>
        </>
      ) : (
        <>
          <h1 className="welcome-title">How can I help you today?</h1>
          <p className="welcome-sub">
            {isPrime ? (
              <>
                Powered by <strong>Fortytwo Prime</strong> · pay-per-use in USDC
                on Monad.
              </>
            ) : (
              <>
                Connected to <code>{modelLabel}</code> via OpenRouter.
              </>
            )}
          </p>
        </>
      )}
      <div className="suggestions">
        {picks.map((s) => (
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
