/**
 * Client-side FOR points model aligned with Fortytwo MCP Rewards Program
 * (https://docs.fortytwo.network/docs/mcp-program). Not authoritative for
 * on-chain balances — use https://platform.fortytwo.network/account for that.
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
/** One-time streak bonus (7+ consecutive calendar days with ≥1 MCP/day). */
export const FOR_STREAK_BONUS = 10_000;
export const STREAK_REQUIRED_DAYS = 7;

const KEY_ACTIVITY = "fortytwo-prime-rewards:activity-days:";
const KEY_STREAK_CLAIMED = "fortytwo-prime-rewards:streak-bonus-claimed:";

function storageActivityKey(address: string): string {
  return KEY_ACTIVITY + address.toLowerCase();
}

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

function loadDaySet(address: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageActivityKey(address));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveDaySet(address: string, days: Set<string>): void {
  try {
    localStorage.setItem(
      storageActivityKey(address),
      JSON.stringify([...days].sort())
    );
  } catch {
    /* quota */
  }
}

/** Days inferred from session rows: any day the session was opened with ≥1 MCP usage. */
export function inferActivityDaysFromHistory(
  records: PrimeSessionRecord[]
): Set<string> {
  const out = new Set<string>();
  for (const r of records) {
    const n = r.messageCount ?? 0;
    if (n > 0) out.add(localDateKey(r.openedAt));
  }
  return out;
}

export function mergeActivityDays(
  address: string,
  records: PrimeSessionRecord[]
): Set<string> {
  const merged = loadDaySet(address);
  for (const d of inferActivityDaysFromHistory(records)) merged.add(d);
  saveDaySet(address, merged);
  return merged;
}

/** Union persisted + history-inferred days without writing (read-only). */
export function readMergedActivityDays(
  address: string,
  records: PrimeSessionRecord[]
): Set<string> {
  const merged = loadDaySet(address);
  for (const d of inferActivityDaysFromHistory(records)) merged.add(d);
  return merged;
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

  const merged = readMergedActivityDays(address, records);
  const totalMcp = totalMcpCallsFromHistory(records);
  const baseFor = totalMcp * FOR_PER_MCP_3X;
  const claimed = isStreakBonusClaimed(address);
  const maxRun = maxConsecutiveDayRun(merged);
  const curStreak = currentCalendarStreak(merged);
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
 * On wallet load / history refresh: merge days, grant one-time streak bonus
 * silently if already eligible. Returns whether the claim flag was just set.
 */
export function applySilentStreakBonusIfEligible(
  address: string,
  records: PrimeSessionRecord[]
): boolean {
  mergeActivityDays(address, records);
  if (isStreakBonusClaimed(address)) return false;
  const merged = loadDaySet(address);
  const maxRun = maxConsecutiveDayRun(merged);
  const cur = currentCalendarStreak(merged);
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
 * Records today as an active day and may grant the one-time streak bonus.
 */
export function recordMcpCallForRewards(
  address: string,
  records: PrimeSessionRecord[]
): AfterMcpRewardResult {
  const merged = loadDaySet(address);
  for (const d of inferActivityDaysFromHistory(records)) merged.add(d);
  merged.add(localDateKey());
  saveDaySet(address, merged);

  const wasClaimed = isStreakBonusClaimed(address);
  let grantStreakBonusFly = false;
  if (!wasClaimed) {
    const maxRun = maxConsecutiveDayRun(merged);
    const cur = currentCalendarStreak(merged);
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
