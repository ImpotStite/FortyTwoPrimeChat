export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "Free";
  if (usd < 0.0001) return `<$0.0001`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatApproximateCost(usd: number): string {
  const s = formatCost(usd);
  if (s === "Free") return s;
  return `~${s}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const DAY_MS = 86_400_000;

export function groupLabel(timestamp: number): string {
  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const diff = startToday - timestamp;
  if (timestamp >= startToday) return "Today";
  if (diff < DAY_MS) return "Yesterday";
  if (diff < 7 * DAY_MS) return "Last 7 days";
  if (diff < 30 * DAY_MS) return "Last 30 days";
  return "Older";
}

const GROUP_ORDER = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "Older",
];

export function compareGroups(a: string, b: string): number {
  return GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b);
}

export function shortModelName(id: string | undefined | null): string {
  const s = id == null ? "" : String(id);
  const noFree = s.replace(/:free$/, "");
  const parts = noFree.split("/");
  return parts[parts.length - 1] || s;
}
