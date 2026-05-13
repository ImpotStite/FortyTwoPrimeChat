/**
 * Inline SVG marks used in the Fortytwo Prime UI.
 *
 * USDC: simplified version of Circle's official mark, a blue disc with a
 * white "$" cuff. Drawn in pure SVG so it scales with `font-size: currentColor`
 * neighbours and doesn't pull a bitmap.
 *
 * Fortytwo: `FortytwoSign` uses the 192px app icon (sufficient for inline sizes).
 */

interface SizedProps {
  size?: number;
  className?: string;
  title?: string;
}

export function UsdcMark({
  size = 16,
  className,
  title = "USDC",
}: SizedProps) {
  return (
    <img
      src="/usdc-logo.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        // The PNG already has transparent corners, but force-clip the bounding
        // box just in case a host gives the <img> an opaque background.
        overflow: "hidden",
        objectFit: "cover",
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
