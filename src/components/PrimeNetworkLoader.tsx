import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const NODES = [
  { src: "/images/Blue.png", color: "#1a1aff", x: 15, y: 30 },
  { src: "/images/blue_white.png", color: "#00ffff", x: 35, y: 38 },
  { src: "/images/orange.png", color: "#ff6600", x: 60, y: 35 },
  { src: "/images/pink.png", color: "#ff007f", x: 82, y: 45 },
  { src: "/images/black.png", color: "#333333", x: 50, y: 55 },
  { src: "/images/green.png", color: "#99ff00", x: 25, y: 72 },
  { src: "/images/gray.png", color: "#888888", x: 50, y: 78 },
  { src: "/images/orange.png", color: "#ff6600", x: 75, y: 72 },
] as const;

const LINKS: [number, number][] = [
  [0, 1],
  [0, 5],
  [1, 4],
  [1, 2],
  [1, 5],
  [2, 4],
  [2, 3],
  [2, 7],
  [3, 4],
  [3, 7],
  [4, 5],
  [4, 6],
  [4, 7],
  [5, 6],
  [6, 7],
];

function matchesReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function FallbackSprite({ color }: { color: string }) {
  return (
    <svg
      width={64}
      height={64}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M 18 15 L 18 5 M 46 15 L 46 5"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="square"
        fill="none"
      />
      <rect x="16" y="3" width="4" height="4" fill={color} />
      <rect x="44" y="3" width="4" height="4" fill={color} />
      <rect x="10" y="15" width="44" height="30" rx="6" fill={color} />
      <rect x="18" y="24" width="6" height="6" fill="white" />
      <rect x="40" y="24" width="6" height="6" fill="white" />
      <path
        d="M 22 38 L 42 38"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="square"
        strokeDasharray="4 5"
        fill="none"
      />
      <path
        d="M 20 45 L 20 55 M 44 45 L 44 55"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="square"
        fill="none"
      />
      <rect x="18" y="55" width="4" height="4" fill={color} />
      <rect x="42" y="55" width="4" height="4" fill={color} />
    </svg>
  );
}

export function PrimeNetworkLoader() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const dashOffsetRef = useRef(0);
  const [jumpingIndex, setJumpingIndex] = useState<number | null>(null);
  const [failedImg, setFailedImg] = useState<Record<number, true>>({});
  const [dots, setDots] = useState(0);
  const reducedMotion = useRef(matchesReducedMotion());

  useEffect(() => {
    if (reducedMotion.current) return;
    const id = window.setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    const motion = reducedMotion.current;

    const frame = () => {
      if (cancelled) return;
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const pw = Math.floor(w * dpr);
      const ph = Math.floor(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const isDark =
        document.documentElement.getAttribute("data-theme") === "dark";
      ctx.strokeStyle = isDark
        ? "rgba(255, 255, 255, 0.34)"
        : "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = motion ? 0 : -dashOffsetRef.current;
      ctx.lineCap = "square";

      for (const [a, b] of LINKS) {
        const n1 = NODES[a]!;
        const n2 = NODES[b]!;
        const x1 = (n1.x / 100) * w;
        const y1 = (n1.y / 100) * h;
        const x2 = (n2.x / 100) * w;
        const y2 = (n2.y / 100) * h;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      if (!motion) {
        dashOffsetRef.current += 0.5;
      }
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (reducedMotion.current) return;

    let alive = true;
    let nextId: ReturnType<typeof setTimeout> | undefined;
    let clearJumpId: ReturnType<typeof setTimeout> | undefined;

    const loop = () => {
      if (!alive) return;
      const i = Math.floor(Math.random() * NODES.length);
      setJumpingIndex(i);
      clearJumpId = setTimeout(() => {
        if (alive) setJumpingIndex(null);
      }, 800);
      nextId = setTimeout(loop, 1500 + Math.random() * 2500);
    };

    const firstId = setTimeout(loop, 2000);

    return () => {
      alive = false;
      clearTimeout(firstId);
      if (nextId != null) clearTimeout(nextId);
      if (clearJumpId != null) clearTimeout(clearJumpId);
    };
  }, []);

  const markFail = (index: number) => {
    setFailedImg((prev) => ({ ...prev, [index]: true }));
  };

  return (
    <div
      className="prime-network-loader"
      role="status"
      aria-busy="true"
      aria-label="Waiting for Fortytwo response"
    >
      <div className="prime-loader-stage" ref={containerRef}>
        <h2 className="prime-loader-title">
          Waiting for Fortytwo
          <span className="prime-loader-dots" aria-hidden>
            {".".repeat(dots)}
          </span>
        </h2>
        <canvas ref={canvasRef} className="prime-loader-canvas" aria-hidden />
        <div className="prime-loader-nodes">
          {NODES.map((node, index) => (
            <div
              key={index}
              className={`prime-loader-node${
                jumpingIndex === index ? " is-jumping" : ""
              }`}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
            >
              <div className="prime-loader-bubble">!</div>
              <div className="prime-loader-sprite">
                {failedImg[index] ? (
                  <FallbackSprite color={node.color} />
                ) : (
                  <img
                    src={node.src}
                    alt=""
                    width={64}
                    height={64}
                    decoding="async"
                    onError={() => markFail(index)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
