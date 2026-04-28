/**
 * Inline SVG marks used in the FortyTwo Prime UI.
 *
 * USDC: simplified version of Circle's official mark — a blue disc with a
 * white "$" cuff. Drawn in pure SVG so it scales with `font-size: currentColor`
 * neighbours and doesn't pull a bitmap.
 *
 * FortyTwo: thin component that renders the bundled `public/fortytwo-sign.png`
 * with a configurable size. The PNG is the all-black "Sign" mark that the
 * user provided.
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
 * FortyTwo "42" sign as inline SVG. The bundled `public/fortytwo-sign.png`
 * turned out to be a solid-black 1024×682 raster with no alpha channel, so we
 * draw the mark ourselves: a lime square with a black "42" carved out of it,
 * matching the badge style of platform.fortytwo.network.
 */
export function FortytwoSign({
  size = 18,
  className,
  title = "FortyTwo",
}: SizedProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      {title ? <title>{title}</title> : null}
      <rect x="0" y="0" width="24" height="24" rx="3" fill="#d0ff00" />
      <text
        x="12"
        y="13"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize="13"
        letterSpacing="-0.5"
        fill="#000"
      >
        42
      </text>
    </svg>
  );
}
