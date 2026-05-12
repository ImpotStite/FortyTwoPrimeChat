import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

const FOR_MARK = "/fortytwo-prime-mark.png";

type BubbleStyle = CSSProperties;

type Props = {
  targetRef: React.RefObject<HTMLElement | null>;
  onComplete: () => void;
  /** e.g. "+ 3,000 FOR" */
  amountLabel: string;
};

/**
 * Full-viewport “chip” that springs in at center, then flies to the Rewards
 * row in the sidebar (fixed positioning + getBoundingClientRect).
 */
export function FloatingRewardBubble({
  targetRef,
  onComplete,
  amountLabel,
}: Props) {
  const [style, setStyle] = useState<BubbleStyle>(() => ({
    top: "50%",
    left: "50%",
    transform: "translate(-50%, 30px) scale(0.5)",
    opacity: 0,
    transition: "none",
  }));

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const appearTimer = window.setTimeout(() => {
      setStyle({
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%) scale(1.1)",
        opacity: 1,
        transition: "all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
      });
    }, 50);

    const flyTimer = window.setTimeout(() => {
      let targetX = 20;
      let targetY = window.innerHeight - 50;
      const el = targetRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) {
          targetX = rect.left + 32;
          targetY = rect.top + rect.height / 2;
        }
      }
      setStyle({
        top: `${targetY}px`,
        left: `${targetX}px`,
        transform: "translate(-50%, -50%) scale(0) rotate(-45deg)",
        opacity: 0,
        transition:
          "top 0.6s cubic-bezier(0.5, 0, 1, 0.5), left 0.6s cubic-bezier(0, 0.5, 0.5, 1), transform 0.6s cubic-bezier(0.5, 0, 1, 0.5), opacity 0.3s ease-in 0.3s",
      });
    }, 1200);

    const completeTimer = window.setTimeout(() => {
      onCompleteRef.current();
    }, 1800);

    return () => {
      window.clearTimeout(appearTimer);
      window.clearTimeout(flyTimer);
      window.clearTimeout(completeTimer);
    };
  }, [targetRef]);

  return createPortal(
    <div className="reward-fly-bubble" style={style} aria-hidden>
      <img
        src={FOR_MARK}
        alt=""
        className="reward-fly-bubble-img"
        width={20}
        height={20}
      />
      <span className="reward-fly-bubble-text">{amountLabel}</span>
    </div>,
    document.body
  );
}
