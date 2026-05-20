/**
 * Inline marks used in the Fortytwo Prime UI.
 *
 * USDC: Circle official mark (`public/usdc-logo.png`). Always use this asset,
 * never a redrawn SVG. CSS scales the 224×225 source down for crisp 12–24px UI.
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

/** Official USDC mark bundled in `public/`. */
const USDC_LOGO_SRC = "/usdc-logo.png";

export function UsdcMark({
  size = 16,
  className,
  title = "USDC",
  decorative = false,
}: SizedProps) {
  return (
    <img
      src={USDC_LOGO_SRC}
      alt={decorative ? "" : title}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? "presentation" : undefined}
      decoding="async"
      draggable={false}
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "contain",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    />
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
