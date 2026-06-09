interface SizedProps {
  size?: number;
  className?: string;
  title?: string;
  decorative?: boolean;
}

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
