import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FortytwoSign, UsdcMark } from "./Icons";
import "./PrimeOnboardingModal.css";

const FT_MARK_FRAMED_SRC = "/fortytwo-prime-icon-128.png";
const FT_MARK_FRAMED_SRCSET =
  "/fortytwo-prime-icon-128.png 128w, /fortytwo-prime-icon-192.png 192w";
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
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconWallet({ className }: { className?: string }) {
  return (
    <svg className={className} width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4Z"
        stroke="currentColor"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function IconLock({ className }: { className?: string }) {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="11"
        width="18"
        height="11"
        rx="2"
        ry="2"
        stroke="currentColor"
        strokeWidth={2}
      />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth={2} />
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
      className="prime-onb-icon-lime"
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
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
        src={FT_MARK_FRAMED_SRC}
        srcSet={FT_MARK_FRAMED_SRCSET}
        sizes="64px"
        alt=""
        width={128}
        height={128}
        className={`prime-onb-img-ft-inset prime-onb-img-ft-inset--${variant}`}
        decoding="async"
        fetchPriority="low"
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
        <div className="prime-onb-auth-icon-wrap">
          <IconWallet />
        </div>
        <div className="prime-onb-auth-label">Signature Request</div>
        <div className="prime-onb-auth-title">Escrow Init</div>
        <div className="prime-onb-auth-row-usdc">
          <div className="prime-onb-auth-usdc-label">
            <div className="prime-onb-auth-badge-wrap">
              <UsdcMark
                size={24}
                className="prime-onb-img-usdc"
                decorative
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
          <div className="prime-onb-escrow-title-row">
            <span className="prime-onb-icon-lime">
              <IconLock />
            </span>
            <span>x402 Escrow Active</span>
          </div>
          <span className="prime-onb-dot-pulse" />
        </div>
        <div>
          <div className="prime-onb-escrow-row">
            <span className="prime-onb-escrow-muted">
              <IconRefresh size={12} />
              AI Output
            </span>
            <span className="prime-onb-escrow-mono">Computing...</span>
          </div>
          <div className="prime-onb-escrow-row prime-onb-escrow-cost">
            <span className="prime-onb-escrow-muted">Current Cost</span>
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
      <div className="prime-onb-refund-stack">
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
          <g className="prime-onb-memory-deco-ring-outer">
            <circle cx={100} cy={100} r={80} strokeWidth={1} strokeDasharray="4 4" fill="none" />
          </g>
          <g className="prime-onb-memory-deco-ring-inner">
            <circle cx={100} cy={100} r={60} strokeWidth={1} strokeDasharray="2 6" fill="none" />
          </g>
        </svg>
      </div>
      <div className="prime-onb-memory-stack">
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
          className="prime-onb-auto-timer-dim"
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle cx={12} cy={12} r={10} strokeWidth={2} />
          <path
            d="M12 6v6l4 2"
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
            className="prime-onb-auto-timer-ring-bg"
            cx={18}
            cy={18}
            r={15}
            fill="none"
            strokeWidth={2}
          />
          <circle
            className="prime-onb-auto-timer-ring-fg"
            cx={18}
            cy={18}
            r={15}
            fill="none"
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
          className="prime-onb-privacy-paper"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={1}
          aria-hidden
        >
          <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" />
        </svg>
        <div className="prime-onb-privacy-shield prime-onb-animate-slide-up">
          <IconShield />
        </div>
      </div>
      <div className="prime-onb-privacy-chip">
        <span className="prime-onb-icon-lime" aria-hidden>
          <IconLock />
        </span>
        <span className="prime-onb-privacy-chip-label">localStorage</span>
      </div>
    </div>
  );
}

function VisualRewards() {
  return (
    <div className="prime-onb-v prime-onb-rewards">
      <div className="prime-onb-rewards-bg" />
      <div className="prime-onb-rewards-center">
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
  followGate?: boolean;
};

type FollowGatePhase = "idle" | "verifying" | "success";

function IconBrandX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 22.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function IconExternalLink({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function VisualFollowGate({ phase }: { phase: FollowGatePhase }) {
  return (
    <div className="prime-onb-v prime-onb-follow-gate">
      <div className="prime-onb-follow-gate-vignette" aria-hidden />
      <div
        className={`prime-onb-follow-gate-ring prime-onb-follow-gate-ring--inner${phase === "success" ? " is-success" : ""}`}
        aria-hidden
      />
      <div
        className={`prime-onb-follow-gate-ring prime-onb-follow-gate-ring--outer${phase === "success" ? " is-success" : ""}`}
        aria-hidden
      />
      <div className="prime-onb-follow-gate-center-wrap">
        <div
          className={`prime-onb-follow-gate-hub${
            phase === "success" ? " is-success" : phase === "verifying" ? " is-busy" : ""
          }`}
        >
          {phase === "verifying" && (
            <div className="prime-onb-follow-gate-scan-wrap" aria-hidden>
              <div className="prime-onb-follow-gate-scan-line" />
            </div>
          )}
          {phase === "success" ? (
            <svg
              width={32}
              height={32}
              viewBox="0 0 24 24"
              fill="none"
              className="prime-onb-follow-gate-check"
              aria-hidden
            >
              <path
                d="M20 6L9 17l-5-5"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <IconBrandX
              className={`prime-onb-follow-gate-x${phase === "verifying" ? " is-pulse" : ""}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

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
    buttonText: "Next",
    Visual: VisualMemory,
  },
  {
    id: 10,
    title: "Join the swarm",
    description:
      "Follow the official Fortytwo account on X for product updates. We simulate a quick check so you can see how access feels.",
    buttonText: "Enter Prime Chat",
    Visual: VisualWelcome,
    followGate: true,
  },
];

export interface PrimeOnboardingModalProps {
  onClose: () => void;
}

const SWIPE_MIN_PX = 52;
const SWIPE_DOMINANCE = 1.12;
const STEP_SLIDE_MS = 260;

type SlideDirection = "forward" | "back";
type SlidePhase = "idle" | "prep" | "active";

type SlidePair = {
  from: number;
  to: number;
  direction: SlideDirection;
};

function stepTrackClass(pair: SlidePair | null, phase: SlidePhase): string {
  if (!pair || phase === "idle") return "prime-onb-step-track";
  const dir = pair.direction;
  return `prime-onb-step-track is-sliding is-${dir} is-${phase}`;
}

type OnboardingStepPanelProps = {
  stepIndex: number;
  ownsDialogTitle?: boolean;
  followPhase: FollowGatePhase;
  onGoToStep: (idx: number) => void;
  onNext: () => void;
  onFollowStart: () => void;
  onClose: () => void;
};

function OnboardingStepPanel({
  stepIndex,
  ownsDialogTitle = false,
  followPhase,
  onGoToStep,
  onNext,
  onFollowStart,
  onClose,
}: OnboardingStepPanelProps) {
  const step = STEPS[stepIndex]!;
  const isLastStep = stepIndex === STEPS.length - 1;
  const isFollowGate = Boolean(step.followGate);
  const Visual = step.Visual;

  return (
    <div className="prime-onb-step-panel">
      <div className="prime-onb-visual-wrap">
        {isFollowGate ? <VisualFollowGate phase={followPhase} /> : <Visual />}
        <div className="prime-onb-visual-fade" />
      </div>

      <div className="prime-onb-body">
        <div className="prime-onb-text-block">
          <h2 id={ownsDialogTitle ? "prime-onb-title" : undefined} className="prime-onb-title">
            {isFollowGate
              ? followPhase === "success"
                ? "Verification complete"
                : "Join the swarm"
              : step.title}
          </h2>
          <p className="prime-onb-desc">
            {isFollowGate
              ? followPhase === "success"
                ? "Thanks for completing the flow. You can enter Prime Chat whenever you are ready."
                : step.description
              : step.description}
          </p>
        </div>
        {isFollowGate ? (
          <div className="prime-onb-footer prime-onb-footer--follow">
            <div className="prime-onb-dots">
              {STEPS.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  className={`prime-onb-dot${idx === stepIndex ? " is-active" : ""}`}
                  onClick={() => onGoToStep(idx)}
                  aria-label={`Go to step ${idx + 1}`}
                />
              ))}
            </div>
            <p className="prime-onb-swipe-hint">Swipe to change steps</p>
            <div className="prime-onb-follow-actions">
              <button
                type="button"
                className={`prime-onb-follow-primary${
                  followPhase === "idle"
                    ? " is-idle"
                    : followPhase === "verifying"
                      ? " is-busy"
                      : " is-done"
                }`}
                onClick={onFollowStart}
                disabled={followPhase !== "idle"}
                aria-busy={followPhase === "verifying"}
              >
                {followPhase === "idle" && (
                  <>
                    <IconBrandX className="prime-onb-follow-primary-icon" />
                    Follow @fortytwonetwork
                    <IconExternalLink className="prime-onb-follow-primary-external" />
                  </>
                )}
                {followPhase === "verifying" && (
                  <>
                    <IconRefresh className="prime-onb-spin" size={16} />
                    Verifying…
                  </>
                )}
                {followPhase === "success" && (
                  <>
                    <IconCheck size={16} />
                    Followed successfully
                  </>
                )}
              </button>
              <button
                type="button"
                className="prime-onb-cta prime-onb-cta--final prime-onb-follow-enter"
                onClick={onClose}
                disabled={followPhase !== "success"}
              >
                Enter Prime Chat
                {followPhase === "success" ? <IconChevronRight /> : null}
              </button>
            </div>
          </div>
        ) : (
          <div className="prime-onb-footer">
            <div className="prime-onb-dots">
              {STEPS.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  className={`prime-onb-dot${idx === stepIndex ? " is-active" : ""}`}
                  onClick={() => onGoToStep(idx)}
                  aria-label={`Go to step ${idx + 1}`}
                />
              ))}
            </div>
            <p className="prime-onb-swipe-hint">Swipe to change steps</p>
            <button
              type="button"
              className={`prime-onb-cta${isLastStep ? " prime-onb-cta--final" : " prime-onb-cta--default"}`}
              onClick={onNext}
            >
              {step.buttonText}
              {!isLastStep ? <IconChevronRight /> : <IconCheck />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PrimeOnboardingModal({ onClose }: PrimeOnboardingModalProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [slidePair, setSlidePair] = useState<SlidePair | null>(null);
  const [slidePhase, setSlidePhase] = useState<SlidePhase>("idle");
  const [followPhase, setFollowPhase] = useState<FollowGatePhase>("idle");
  const [followProgress, setFollowProgress] = useState(0);

  const currentStep = STEPS[currentStepIndex]!;
  const isLastStep = currentStepIndex === STEPS.length - 1;
  const isFollowGate = Boolean(currentStep.followGate);
  const isStepTransitioning = slidePair !== null;
  const dialogTitleStepIndex = slidePair?.to ?? currentStepIndex;

  const followTickRef = useRef<number | null>(null);

  const clearFollowTicker = useCallback(() => {
    if (followTickRef.current !== null) {
      window.clearInterval(followTickRef.current);
      followTickRef.current = null;
    }
  }, []);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isClosingRef = useRef(false);
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

      const direction: SlideDirection = clamped > currentStepIndex ? "forward" : "back";
      transitionLockRef.current = true;
      setSlidePair({ from: currentStepIndex, to: clamped, direction });
      setSlidePhase("prep");

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSlidePhase("active");
        });
      });

      window.setTimeout(() => {
        setCurrentStepIndex(clamped);
        setSlidePair(null);
        setSlidePhase("idle");
        transitionLockRef.current = false;
      }, STEP_SLIDE_MS);
    },
    [currentStepIndex]
  );

  const handleNext = useCallback(() => {
    if (transitionLockRef.current) return;
    if (isFollowGate) return;
    if (isLastStep) {
      handleClose();
    } else {
      goToStep(currentStepIndex + 1);
    }
  }, [currentStepIndex, goToStep, handleClose, isFollowGate, isLastStep]);

  useEffect(() => {
    if (!isFollowGate) {
      clearFollowTicker();
      setFollowPhase("idle");
      setFollowProgress(0);
    }
  }, [isFollowGate, clearFollowTicker]);

  useEffect(
    () => () => {
      clearFollowTicker();
    },
    [clearFollowTicker]
  );

  const handleFollowStart = useCallback(() => {
    if (!isFollowGate || followPhase !== "idle") return;
    window.open(
      "https://x.com/intent/follow?screen_name=fortytwonetwork",
      "_blank",
      "noopener,noreferrer"
    );
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setFollowPhase("verifying");
      setFollowProgress(100);
      window.setTimeout(() => setFollowPhase("success"), 280);
      return;
    }
    setFollowPhase("verifying");
    setFollowProgress(0);
    const duration = 5000;
    const tick = 50;
    let acc = 0;
    clearFollowTicker();
    followTickRef.current = window.setInterval(() => {
      acc += (tick / duration) * 100;
      const next = Math.min(acc, 100);
      setFollowProgress(next);
      if (next >= 100) {
        clearFollowTicker();
        setFollowPhase("success");
      }
    }, tick) as unknown as number;
  }, [isFollowGate, followPhase, clearFollowTicker]);

  useEffect(() => {
    isClosingRef.current = isClosing;
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
    if (isClosingRef.current || transitionLockRef.current) return;

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
        aria-busy={isStepTransitioning || followPhase === "verifying"}
        onTouchStart={onShellTouchStart}
        onTouchEnd={onShellTouchEnd}
        onTouchCancel={onShellTouchCancel}
      >
        <div className="prime-onb-shell-top-line" />
        {isFollowGate && (
          <div className="prime-onb-follow-progress" aria-hidden>
            <div
              className={`prime-onb-follow-progress-fill${
                followPhase === "success" ? " is-success" : ""
              }`}
              style={{
                width: followPhase === "idle" ? "0%" : `${followProgress}%`,
              }}
            />
          </div>
        )}
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

        <div className="prime-onb-step-viewport">
          <div className={stepTrackClass(slidePair, slidePhase)}>
            {slidePair ? (
              slidePair.direction === "forward" ? (
                <>
                  <OnboardingStepPanel
                    key={slidePair.from}
                    stepIndex={slidePair.from}
                    followPhase={followPhase}
                    onGoToStep={goToStep}
                    onNext={handleNext}
                    onFollowStart={handleFollowStart}
                    onClose={handleClose}
                  />
                  <OnboardingStepPanel
                    key={slidePair.to}
                    stepIndex={slidePair.to}
                    ownsDialogTitle={slidePair.to === dialogTitleStepIndex}
                    followPhase={followPhase}
                    onGoToStep={goToStep}
                    onNext={handleNext}
                    onFollowStart={handleFollowStart}
                    onClose={handleClose}
                  />
                </>
              ) : (
                <>
                  <OnboardingStepPanel
                    key={slidePair.to}
                    stepIndex={slidePair.to}
                    ownsDialogTitle={slidePair.to === dialogTitleStepIndex}
                    followPhase={followPhase}
                    onGoToStep={goToStep}
                    onNext={handleNext}
                    onFollowStart={handleFollowStart}
                    onClose={handleClose}
                  />
                  <OnboardingStepPanel
                    key={slidePair.from}
                    stepIndex={slidePair.from}
                    ownsDialogTitle={slidePair.from === dialogTitleStepIndex}
                    followPhase={followPhase}
                    onGoToStep={goToStep}
                    onNext={handleNext}
                    onFollowStart={handleFollowStart}
                    onClose={handleClose}
                  />
                </>
              )
            ) : (
              <OnboardingStepPanel
                stepIndex={currentStepIndex}
                ownsDialogTitle
                followPhase={followPhase}
                onGoToStep={goToStep}
                onNext={handleNext}
                onFollowStart={handleFollowStart}
                onClose={handleClose}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
