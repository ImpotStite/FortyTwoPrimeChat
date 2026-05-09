/**
 * Client-side FOR points model aligned with Fortytwo MCP Rewards Program
 * (https://docs.fortytwo.network/docs/mcp-program). Not authoritative for
 * on-chain balances, use https://platform.fortytwo.network/account for that.
 */

import type { PrimeSessionRecord } from "./primeHistory";

export const REWARDS_DOCS_URL =
  "https://docs.fortytwo.network/docs/mcp-program";
export const REWARDS_ACCOUNT_URL =
  "https://platform.fortytwo.network/account";

/** Base FOR per MCP request (docs). */
export const FOR_BASE_PER_REQUEST = 1000;
/** Assumed early-adopter tier: first 500 agents → 3× for 30 days. */
export const FOR_MULTIPLIER_FIRST500 = 3;
/** FOR granted per successful MCP call under the 3× tier. */
export const FOR_PER_MCP_3X =
  FOR_BASE_PER_REQUEST * FOR_MULTIPLIER_FIRST500;
/** Illustrative 2× tier for agents 501–2,000 (UI copy; confirm with Fortytwo docs). */
export const FOR_MULTIPLIER_501_2000 = 2;
export const FOR_PER_MCP_501_2000 =
  FOR_BASE_PER_REQUEST * FOR_MULTIPLIER_501_2000;
/** One-time streak bonus (7+ consecutive calendar days with ≥1 launch day). */
export const FOR_STREAK_BONUS = 10_000;
export const STREAK_REQUIRED_DAYS = 7;

const KEY_STREAK_CLAIMED = "fortytwo-prime-rewards:streak-bonus-claimed:";

function storageClaimedKey(address: string): string {
  return KEY_STREAK_CLAIMED + address.toLowerCase();
}

/** Local calendar date `YYYY-MM-DD`. */
export function localDateKey(ms: number = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseKey(key: string): Date {
  const [y, mo, da] = key.split("-").map(Number);
  return new Date(y, mo - 1, da, 12, 0, 0, 0);
}

function prevDayKey(key: string): string {
  const d = parseKey(key);
  d.setDate(d.getDate() - 1);
  return localDateKey(d.getTime());
}

function nextDayKey(key: string): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + 1);
  return localDateKey(d.getTime());
}

/**
 * Distinct local calendar days on which at least one Prime session was launched
 * (settled open), derived only from `PrimeSessionRecord.openedAt` in session
 * history. Multiple sessions on the same day collapse to a single date key.
 */
export function inferActivityDaysFromHistory(
  records: PrimeSessionRecord[]
): Set<string> {
  const out = new Set<string>();
  for (const r of records) {
    out.add(localDateKey(r.openedAt));
  }
  return out;
}

export function isStreakBonusClaimed(address: string): boolean {
  try {
    return localStorage.getItem(storageClaimedKey(address)) === "1";
  } catch {
    return false;
  }
}

export function markStreakBonusClaimed(address: string): void {
  try {
    localStorage.setItem(storageClaimedKey(address), "1");
  } catch {
    /* ignore */
  }
}

/** Longest run of consecutive calendar days in the set. */
export function maxConsecutiveDayRun(days: Set<string>): number {
  if (days.size === 0) return 0;
  const sorted = [...days].sort();
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (nextDayKey(sorted[i - 1]) === sorted[i]) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }
  return best;
}

/**
 * “Current” streak: consecutive days with activity ending today, or ending
 * yesterday if today has no activity yet (common daily-streak UX).
 */
export function currentCalendarStreak(days: Set<string>): number {
  if (days.size === 0) return 0;
  const today = localDateKey();
  const yest = prevDayKey(today);
  let anchor: string | null = null;
  if (days.has(today)) anchor = today;
  else if (days.has(yest)) anchor = yest;
  else return 0;

  let streak = 0;
  let k: string | null = anchor;
  while (k && days.has(k)) {
    streak++;
    k = prevDayKey(k);
  }
  return streak;
}

export function totalMcpCallsFromHistory(
  records: PrimeSessionRecord[]
): number {
  let n = 0;
  for (const r of records) n += r.messageCount ?? 0;
  return n;
}

export interface RewardsSnapshot {
  totalMcpCalls: number;
  baseFor: number;
  streakBonusFor: number;
  displayTotalFor: number;
  currentStreakDays: number;
  maxConsecutiveDays: number;
  streakBonusClaimed: boolean;
  streakBonusEligible: boolean;
}

export function computeRewardsSnapshot(
  address: string | null,
  records: PrimeSessionRecord[]
): RewardsSnapshot {
  const empty: RewardsSnapshot = {
    totalMcpCalls: 0,
    baseFor: 0,
    streakBonusFor: 0,
    displayTotalFor: 0,
    currentStreakDays: 0,
    maxConsecutiveDays: 0,
    streakBonusClaimed: false,
    streakBonusEligible: false,
  };
  if (!address) return empty;

  const launchDays = inferActivityDaysFromHistory(records);
  const totalMcp = totalMcpCallsFromHistory(records);
  const baseFor = totalMcp * FOR_PER_MCP_3X;
  const claimed = isStreakBonusClaimed(address);
  const maxRun = maxConsecutiveDayRun(launchDays);
  const curStreak = currentCalendarStreak(launchDays);
  const eligible = maxRun >= STREAK_REQUIRED_DAYS || curStreak >= STREAK_REQUIRED_DAYS;
  const streakBonusFor = claimed ? FOR_STREAK_BONUS : 0;

  return {
    totalMcpCalls: totalMcp,
    baseFor,
    streakBonusFor,
    displayTotalFor: baseFor + streakBonusFor,
    currentStreakDays: curStreak,
    maxConsecutiveDays: maxRun,
    streakBonusClaimed: claimed,
    streakBonusEligible: eligible,
  };
}

/**
 * On wallet load / history refresh: if session history shows a 7-day launch
 * streak and the one-time bonus was not yet recorded, set the claim flag.
 * Returns whether the claim flag was just set.
 */
export function applySilentStreakBonusIfEligible(
  address: string,
  records: PrimeSessionRecord[]
): boolean {
  if (isStreakBonusClaimed(address)) return false;
  const launchDays = inferActivityDaysFromHistory(records);
  const maxRun = maxConsecutiveDayRun(launchDays);
  const cur = currentCalendarStreak(launchDays);
  if (maxRun >= STREAK_REQUIRED_DAYS || cur >= STREAK_REQUIRED_DAYS) {
    markStreakBonusClaimed(address);
    return true;
  }
  return false;
}

export interface AfterMcpRewardResult {
  snapshot: RewardsSnapshot;
  /** First-time streak bonus granted on this MCP (show +10k fly). */
  grantStreakBonusFly: boolean;
}

/**
 * Call after each successful MCP (e.g. after `incrementSessionUsage`).
 * Re-reads streak eligibility from session history (launch days) and may grant
 * the one-time streak bonus when the run crosses the threshold.
 */
export function recordMcpCallForRewards(
  address: string,
  records: PrimeSessionRecord[]
): AfterMcpRewardResult {
  const launchDays = inferActivityDaysFromHistory(records);
  const wasClaimed = isStreakBonusClaimed(address);
  let grantStreakBonusFly = false;
  if (!wasClaimed) {
    const maxRun = maxConsecutiveDayRun(launchDays);
    const cur = currentCalendarStreak(launchDays);
    if (maxRun >= STREAK_REQUIRED_DAYS || cur >= STREAK_REQUIRED_DAYS) {
      markStreakBonusClaimed(address);
      grantStreakBonusFly = true;
    }
  }

  const snapshot = computeRewardsSnapshot(address, records);
  return { snapshot, grantStreakBonusFly };
}

export function formatForDelta(amount: number): string {
  const s = amount.toLocaleString("en-US");
  return `+ ${s} FOR`;
}
