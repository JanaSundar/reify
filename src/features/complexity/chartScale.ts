/** A round axis maximum at or above `value` (1, 2, 2.5 or 5 times a power of ten). */
export const niceMax = (value: number): number => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
};

/** Short axis and tooltip numbers: 1.2K, 3.4M. */
export const compact = (value: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
