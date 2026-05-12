import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FortytwoSign } from "./Icons";
import "./PrimeOnboardingModal.css";

/** Same asset and framing patterns as the main app (Welcome, rewards row, assistant bubble). */
const FT_MARK = "/fortytwo-prime-mark.png";
const USDC_LOGO = "/usdc-logo.png";
const MONAD_LOGO = "/monad-logo.png";

function IconRefresh({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function IconDollar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconZap({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        stroke="#000000"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconWallet({ stroke = "#fafafa" }: { stroke?: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4Z"
        stroke={stroke}
        strokeWidth={1.5}
      />
    </svg>
  );
}

function IconLock({ color = "#d0ff00" }: { color?: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="11"
        width="18"
        height="11"
        rx="2"
        ry="2"
        stroke={color}
        strokeWidth={2}
      />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={color} strokeWidth={2} />
    </svg>
  );
}

function IconChevronDown({ delay }: { delay?: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="prime-onb-animate-slide-up"
      style={delay ? { animationDelay: delay } : undefined}
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#d0ff00"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconX({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function IconChevronRight({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="prime-onb-cta-icon"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FortytwoMarkFramed({
  variant,
  glow = false,
  className = "",
}: {
  variant: "welcome" | "reward";
  glow?: boolean;
  className?: string;
}) {
  const frameClass =
    variant === "welcome"
      ? "prime-onb-ft-frame prime-onb-ft-frame--welcome"
      : "prime-onb-ft-frame prime-onb-ft-frame--reward";
  return (
    <div
      className={`${frameClass}${glow ? " prime-onb-animate-glow" : ""}${className ? ` ${className}` : ""}`.trim()}
    >
      <img
        src={FT_MARK}
        alt=""
        className={`prime-onb-img-ft-inset prime-onb-img-ft-inset--${variant}`}
        decoding="async"
      />
    </div>
  );
}

function VisualWelcome() {
  return (
    <div className="prime-onb-v prime-onb-welcome">
      <div className="prime-onb-welcome-inner">
        <FortytwoMarkFramed variant="welcome" glow />
        <div className="prime-onb-icon-row">
          <IconRefresh />
          <IconDollar />
          <IconZap />
        </div>
      </div>
    </div>
  );
}

function VisualTrigger() {
  return (
    <div className="prime-onb-v prime-onb-trigger">
      <div className="prime-onb-trigger-inner">
        <div className="prime-onb-trigger-row">
          <div className="prime-onb-trigger-ava" aria-hidden>
            <div className="prime-onb-assistant-avatar">
              <FortytwoSign size={24} title="Fortytwo" />
            </div>
          </div>
          <div className="prime-onb-trigger-bubble">
            <div className="prime-onb-skel" style={{ width: "75%" }} />
            <div className="prime-onb-skel" />
          </div>
        </div>
        <div className="prime-onb-trigger-input">
          <div className="prime-onb-trigger-input-inner">
            <span className="prime-onb-caret" />
            <span className="prime-onb-trigger-placeholder">Ask anything…</span>
          </div>
          <div className="prime-onb-send-fab">
            <IconSend />
          </div>
        </div>
      </div>
    </div>
  );
}

function VisualAuth() {
  return (
    <div className="prime-onb-v prime-onb-auth">
      <div className="prime-onb-auth-glow" />
      <svg className="prime-onb-auth-line" aria-hidden>
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="40"
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray="4"
          className="prime-onb-animate-flow"
        />
      </svg>
      <div className="prime-onb-auth-card">
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "#0a0a0a",
            border: "1px solid rgba(250,250,250,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          <IconWallet />
        </div>
        <div className="prime-onb-auth-label">Signature Request</div>
        <div className="prime-onb-auth-title">Escrow Init</div>
        <div className="prime-onb-auth-row-usdc">
          <div className="prime-onb-auth-usdc-label">
            <div className="prime-onb-auth-badge-wrap">
              <img
                src={USDC_LOGO}
                alt=""
                width={24}
                height={24}
                className="prime-onb-img-usdc"
                decoding="async"
              />
              <img
                src={MONAD_LOGO}
                alt=""
                width={15}
                height={15}
                className="prime-onb-img-monad-badge"
                decoding="async"
              />
            </div>
            <span className="prime-onb-label-usdc">USDC</span>
          </div>
          <span className="prime-onb-mono-amount">2.00</span>
        </div>
        <div className="prime-onb-auth-sign-btn">Sign to Pre-authorize</div>
      </div>
    </div>
  );
}

function VisualEscrow() {
  return (
    <div className="prime-onb-v prime-onb-escrow">
      <div className="prime-onb-escrow-card">
        <div className="prime-onb-escrow-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconLock />
            <span>x402 Escrow Active</span>
          </div>
          <span className="prime-onb-dot-pulse" />
        </div>
        <div>
          <div className="prime-onb-escrow-row">
            <span style={{ color: "#858585", display: "flex", alignItems: "center", gap: 6 }}>
              <IconRefresh size={12} />
              AI Output
            </span>
            <span className="prime-onb-escrow-mono">Computing...</span>
          </div>
          <div className="prime-onb-escrow-row prime-onb-escrow-cost">
            <span style={{ color: "#858585" }}>Current Cost</span>
            <span className="prime-onb-escrow-cost-amount">
              −$0.123
              <svg
                width={10}
                height={10}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="prime-onb-spin"
                aria-hidden
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function VisualRefund() {
  return (
    <div className="prime-onb-v prime-onb-refund">
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div className="prime-onb-refund-pill prime-onb-animate-refund">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          +$1.877 USDC
        </div>
        <div className="prime-onb-refund-arrows">
          <IconChevronDown />
          <IconChevronDown delay="0.2s" />
        </div>
        <div className="prime-onb-refund-wallet">
          <IconWallet />
        </div>
      </div>
    </div>
  );
}

function VisualMemory() {
  return (
    <div className="prime-onb-v prime-onb-memory">
      <div className="prime-onb-memory-deco">
        <svg width={200} height={200} viewBox="0 0 200 200" aria-hidden>
          <circle cx={100} cy={100} r={80} stroke="#858585" strokeWidth={1} strokeDasharray="4 4" fill="none" />
          <circle cx={100} cy={100} r={60} stroke="#fafafa" strokeWidth={1} strokeDasharray="2 6" fill="none" />
        </svg>
      </div>
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div className="prime-onb-memory-card">
          <div className="prime-onb-memory-head">
            <span>Memory Mode</span>
            <div className="prime-onb-memory-toggle" />
          </div>
          <div className="prime-onb-memory-hint">
            Sends past conversation context for much smarter AI answers.
          </div>
        </div>
        <div className="prime-onb-memory-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function VisualAutoProtection() {
  return (
    <div className="prime-onb-v prime-onb-auto">
      <div className="prime-onb-auto-glow" />
      <div className="prime-onb-auto-timer">
        <svg
          className="prime-onb-auto-timer-clock"
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle cx={12} cy={12} r={10} stroke="#858585" strokeWidth={2} />
          <path
            d="M12 6v6l4 2"
            stroke="#858585"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
        <svg
          className="prime-onb-auto-timer-ring"
          viewBox="0 0 36 36"
          aria-hidden
        >
          <circle
            cx={18}
            cy={18}
            r={15}
            fill="none"
            stroke="rgba(208, 255, 0, 0.15)"
            strokeWidth={2}
          />
          <circle
            cx={18}
            cy={18}
            r={15}
            fill="none"
            stroke="#d0ff00"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="22 72"
            strokeDashoffset="0"
          />
        </svg>
      </div>
      <div className="prime-onb-auto-badge">
        <span className="prime-onb-dot-pulse" />
        <span>Auto-close in 10m</span>
      </div>
    </div>
  );
}

function VisualPrivacy() {
  return (
    <div className="prime-onb-v prime-onb-privacy">
      <div className="prime-onb-privacy-stack">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="#858585"
          strokeWidth={1}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.1 }}
          aria-hidden
        >
          <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" />
        </svg>
        <div className="prime-onb-privacy-shield prime-onb-animate-slide-up">
          <IconShield />
        </div>
      </div>
      <div className="prime-onb-privacy-chip">
        <IconLock color="#d0ff00" />
        <span style={{ opacity: 0.85 }}>localStorage</span>
      </div>
    </div>
  );
}

function VisualRewards() {
  return (
    <div className="prime-onb-v" style={{ background: "#111111", overflow: "hidden" }}>
      <div className="prime-onb-rewards-bg" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div className="prime-onb-rewards-wrap">
          <div className="prime-onb-rewards-hero prime-onb-animate-refund">
            <FortytwoMarkFramed variant="reward" glow />
          </div>
          <div className="prime-onb-rewards-label">+3K FOR</div>
          <div className="prime-onb-rewards-sub">Earned this session</div>
        </div>
      </div>
    </div>
  );
}

type StepDef = {
  id: number;
  title: string;
  description: string;
  buttonText: string;
  Visual: () => ReactNode;
};

const STEPS: StepDef[] = [
  {
    id: 1,
    title: "Uncapped AI, zero subscriptions",
    description:
      "Welcome to Prime Chat. Fortytwo Prime acts as a swarm of the world's best AIs, working together to deliver the single best answer. No subscriptions, pay only for the compute you consume.",
    buttonText: "See how it works",
    Visual: VisualWelcome,
  },
  {
    id: 2,
    title: "1. Write your prompt",
    description:
      "Use it just like any other AI assistant. Type your message or question. Costs are only calculated when you hit send.",
    buttonText: "Next",
    Visual: VisualTrigger,
  },
  {
    id: 3,
    title: "2. Escrow locks 2 USDC",
    description:
      "Your wallet will ask for a signature to start the session. This temporarily locks 2 USDC in Fortytwo's smart contract to guarantee your compute budget.",
    buttonText: "Next",
    Visual: VisualAuth,
  },
  {
    id: 4,
    title: "3. Real-time Deduction",
    description:
      "As the AI streams your answer, Fortytwo's x402 smart contract securely deducts the exact fraction of a cent per token on the fly.",
    buttonText: "Next",
    Visual: VisualEscrow,
  },
  {
    id: 5,
    title: "4. Instant Refund",
    description:
      "When the generation finishes, the unused balance from your 2 USDC is instantly refunded to your Monad wallet. You never overpay.",
    buttonText: "Next",
    Visual: VisualRefund,
  },
  {
    id: 6,
    title: "Session Auto-Protection",
    description:
      "Your funds are safe. To protect your wallet, any active session automatically closes and refunds your USDC after 10 minutes of inactivity or 60 minutes total.",
    buttonText: "Next",
    Visual: VisualAutoProtection,
  },
  {
    id: 7,
    title: "100% Local Privacy",
    description:
      "Your chat history never leaves your device. All your conversations and billing history are stored locally in your browser, ensuring total privacy.",
    buttonText: "Next",
    Visual: VisualPrivacy,
  },
  {
    id: 8,
    title: "Earn FOR Points",
    description:
      "Every time you interact with the AI, you earn FOR points. Use the protocol, gather points, and track your rewards directly in the app.",
    buttonText: "Next",
    Visual: VisualRewards,
  },
  {
    id: 9,
    title: "Pro-tip: Memory Mode",
    description:
      "Enable 'Memory' in the sidebar to give the AI context from your past messages. It uses a bit more compute, but delivers much smarter answers.",
    buttonText: "Let's Start Trading Data!",
    Visual: VisualMemory,
  },
];

export interface PrimeOnboardingModalProps {
  onClose: () => void;
}

const SWIPE_MIN_PX = 52;
const SWIPE_DOMINANCE = 1.12;
const STEP_SLIDE_MS = 260;

type StepAnim =
  | "idle"
  | "exit-forward"
  | "enter-forward-prep"
  | "enter-forward"
  | "exit-back"
  | "enter-back-prep"
  | "enter-back";

function stepPanelClass(phase: StepAnim): string {
  if (phase === "idle") return "prime-onb-step-panel";
  return `prime-onb-step-panel prime-onb-step-panel--${phase}`;
}

export function PrimeOnboardingModal({ onClose }: PrimeOnboardingModalProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [stepAnim, setStepAnim] = useState<StepAnim>("idle");

  const currentStep = STEPS[currentStepIndex]!;
  const isLastStep = currentStepIndex === STEPS.length - 1;
  const Visual = currentStep.Visual;

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isClosingRef = useRef(false);
  const stepAnimRef = useRef<StepAnim>("idle");
  const transitionLockRef = useRef(false);
  const stepIndexRef = useRef(0);
  const goToStepRef = useRef<(idx: number) => void>(() => {});
  const handleNextRef = useRef<() => void>(() => {});

  const finishClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    window.setTimeout(finishClose, 300);
  }, [finishClose]);

  const goToStep = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(STEPS.length - 1, idx));
      if (clamped === currentStepIndex) return;
      if (transitionLockRef.current) return;

      const prefersReduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (prefersReduce) {
        setCurrentStepIndex(clamped);
        return;
      }

      const forward = clamped > currentStepIndex;
      transitionLockRef.current = true;
      setStepAnim(forward ? "exit-forward" : "exit-back");

      window.setTimeout(() => {
        setCurrentStepIndex(clamped);
        setStepAnim(forward ? "enter-forward-prep" : "enter-back-prep");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setStepAnim(forward ? "enter-forward" : "enter-back");
            window.setTimeout(() => {
              setStepAnim("idle");
              transitionLockRef.current = false;
            }, STEP_SLIDE_MS);
          });
        });
      }, STEP_SLIDE_MS);
    },
    [currentStepIndex]
  );

  const handleNext = useCallback(() => {
    if (transitionLockRef.current) return;
    if (isLastStep) {
      handleClose();
    } else {
      goToStep(currentStepIndex + 1);
    }
  }, [currentStepIndex, goToStep, handleClose, isLastStep]);

  useEffect(() => {
    isClosingRef.current = isClosing;
    stepAnimRef.current = stepAnim;
    stepIndexRef.current = currentStepIndex;
    goToStepRef.current = goToStep;
    handleNextRef.current = handleNext;
  });

  const onShellTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const { target } = e;
    if (target instanceof Element && target.closest("button, a, input, textarea, select")) {
      return;
    }
    const t = e.touches[0]!;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const onShellTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || e.changedTouches.length !== 1) return;
    if (isClosingRef.current || stepAnimRef.current !== "idle") return;

    const t = e.changedTouches[0]!;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;

    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return;

    if (dx < 0) {
      handleNextRef.current();
    } else {
      const i = stepIndexRef.current;
      if (i > 0) goToStepRef.current(i - 1);
    }
  }, []);

  const onShellTouchCancel = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  return (
    <div
      className={`prime-onb-overlay${isClosing ? " is-closing" : ""}`}
      role="presentation"
    >
      <div className="prime-onb-backdrop" onClick={handleClose} aria-hidden />
      <div
        className={`prime-onb-shell${isClosing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prime-onb-title"
        aria-busy={stepAnim !== "idle"}
        onTouchStart={onShellTouchStart}
        onTouchEnd={onShellTouchEnd}
        onTouchCancel={onShellTouchCancel}
      >
        <div className="prime-onb-shell-top-line" />
        <button
          type="button"
          className="prime-onb-skip"
          onClick={handleClose}
          aria-label={isLastStep ? "Close tutorial" : "Skip tutorial"}
        >
          {isLastStep ? (
            <IconX size={16} />
          ) : (
            <span className="prime-onb-skip-sr">Skip</span>
          )}
        </button>

        <div className={stepPanelClass(stepAnim)}>
          <div className="prime-onb-visual-wrap">
            <Visual />
            <div className="prime-onb-visual-fade" />
          </div>

          <div className="prime-onb-body">
            <div className="prime-onb-text-block">
              <h2 id="prime-onb-title" className="prime-onb-title">
                {currentStep.title}
              </h2>
              <p className="prime-onb-desc">{currentStep.description}</p>
            </div>
            <div className="prime-onb-footer">
              <div className="prime-onb-dots">
                {STEPS.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`prime-onb-dot${idx === currentStepIndex ? " is-active" : ""}`}
                    onClick={() => goToStep(idx)}
                    aria-label={`Go to step ${idx + 1}`}
                  />
                ))}
              </div>
              <p className="prime-onb-swipe-hint">Swipe to change steps</p>
              <button
                type="button"
                className={`prime-onb-cta${isLastStep ? " prime-onb-cta--final" : " prime-onb-cta--default"}`}
                onClick={handleNext}
              >
                {currentStep.buttonText}
                {!isLastStep ? <IconChevronRight /> : <IconCheck />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
