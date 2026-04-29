/** Fortytwo Prime list rates (USD per 1M tokens). */
export const PRIME_USD_PER_M_INPUT = 10;
export const PRIME_USD_PER_M_OUTPUT = 30;

/** Estimated USD for one reply from token counts (list pricing). */
export function estimatePrimeUsdCost(
  tokensIn: number,
  tokensOut: number
): number {
  return (
    (tokensIn * PRIME_USD_PER_M_INPUT) / 1_000_000 +
    (tokensOut * PRIME_USD_PER_M_OUTPUT) / 1_000_000
  );
}
