import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const TIP = {
  title: "What Memory does",
  body:
    "Prior messages in this chat are sent with each Fortytwo request so replies can use context. That increases input tokens, so cost may be higher—especially on long threads.",
} as const;

type Props = {
  enabled: boolean;
  onChange: (next: boolean) => void;
};

function readViewportBox(): {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
} {
  const vv = window.visualViewport;
  if (vv) {
    return {
      vx: vv.offsetLeft,
      vy: vv.offsetTop,
      vw: vv.width,
      vh: vv.height,
    };
  }
  return { vx: 0, vy: 0, vw: window.innerWidth, vh: window.innerHeight };
}

export function MemoryToggle({ enabled, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    maxW: number;
  } | null>(null);

  const showTip = hover || helpOpen;

  const layoutTip = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { vx, vy, vw, vh } = readViewportBox();
    const margin = 12;
    const maxW = Math.min(280, Math.max(180, vw - margin * 2));
    let left = r.left + r.width / 2 - maxW / 2;
    left = Math.max(vx + margin, Math.min(left, vx + vw - maxW - margin));
    const gap = 8;
    const th = tipRef.current?.getBoundingClientRect().height;
    const tipH = th != null && th > 1 ? th : 140;
    let top = r.bottom + gap;
    if (top + tipH > vy + vh - margin) {
      top = r.top - gap - tipH;
    }
    top = Math.max(vy + margin, Math.min(top, vy + vh - tipH - margin));
    setPos((prev) => {
      const next = { top, left, maxW };
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.maxW === next.maxW
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    if (!showTip) {
      setPos(null);
      return;
    }
    layoutTip();
  }, [showTip, layoutTip]);

  useLayoutEffect(() => {
    if (!showTip || !tipRef.current) return;
    const node = tipRef.current;
    const ro = new ResizeObserver(() => layoutTip());
    ro.observe(node);
    layoutTip();
    return () => ro.disconnect();
  }, [showTip, layoutTip]);

  useEffect(() => {
    if (!showTip) return;
    const onScroll = () => layoutTip();
    const onResize = () => layoutTip();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
    };
  }, [showTip, layoutTip]);

  useEffect(() => {
    if (!helpOpen) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && hostRef.current?.contains(t)) return;
      setHelpOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [helpOpen]);

  const tipId = "memory-help-desc";

  const portal =
    showTip &&
    pos &&
    createPortal(
      <div
        ref={tipRef}
        className="memory-toggle-tooltip-portal"
        role="tooltip"
        aria-hidden={helpOpen ? undefined : "true"}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: pos.maxW,
          maxWidth: "min(280px, calc(100vw - 24px))",
          zIndex: 10_000,
        }}
      >
        <span className="memory-toggle-tooltip-title">{TIP.title}</span>
        <span className="memory-toggle-tooltip-body">{TIP.body}</span>
      </div>,
      document.body
    );

  return (
    <>
      <div
        ref={hostRef}
        className="memory-toggle"
        onMouseEnter={() => {
          setHover(true);
          requestAnimationFrame(() => layoutTip());
        }}
        onMouseLeave={() => setHover(false)}
      >
        <p id={tipId} className="memory-toggle-sr-desc">
          {TIP.title}. {TIP.body}
        </p>
        <button
          type="button"
          className="memory-toggle-switch"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="memory-toggle-name"
          aria-describedby={tipId}
          onClick={() => onChange(!enabled)}
        >
          <span className="memory-toggle-track" aria-hidden>
            <span className="memory-toggle-thumb" />
          </span>
        </button>
        <span className="memory-toggle-name" id="memory-toggle-name">
          Memory
        </span>
        <button
          type="button"
          className="memory-toggle-help"
          aria-label="About Memory"
          title="About Memory"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setHelpOpen((v) => !v);
          }}
        >
          i
        </button>
      </div>
      {portal}
    </>
  );
}
