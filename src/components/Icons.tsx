/**
 * Inline SVG marks used in the Fortytwo Prime UI.
 *
 * USDC: vector mark (Circle USDC blue) so it stays sharp at any display size.
 * No raster scaling, no extra network request.
 *
 * Fortytwo: `FortytwoSign` uses the 192px app icon (sufficient for inline sizes).
 */

interface SizedProps {
  size?: number;
  className?: string;
  title?: string;
  /** When true, hide from assistive tech (use next to visible "USDC" text). */
  decorative?: boolean;
}

/** Circle USDC brand blue (approximate). */
const USDC_BLUE = "#2775CA";

export function UsdcMark({
  size = 16,
  className,
  title = "USDC",
  decorative = false,
}: SizedProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        borderRadius: "50%",
        overflow: "hidden",
        shapeRendering: "geometricPrecision",
      }}
    >
      {!decorative ? <title>{title}</title> : null}
      <circle cx="16" cy="16" r="16" fill={USDC_BLUE} />
      <text
        x="16"
        y="16"
        dominantBaseline="central"
        textAnchor="middle"
        fill="#fff"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize="17"
        fontWeight="700"
      >
        $
      </text>
    </svg>
  );
}

/**
 * Fortytwo Prime mark, lime square with black 2×2 dots + bars (bundled PNG).
 */
export function FortytwoSign({
  size = 18,
  className,
  title = "Fortytwo",
}: SizedProps) {
  return (
    <img
      src="/fortytwo-prime-icon-192.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 4,
        objectFit: "cover",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    />
  );
}
