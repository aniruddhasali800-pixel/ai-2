export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Bills are rounded to the nearest rupee; the difference is recorded as roundOff. */
export function roundToRupee(value: number): { total: number; roundOff: number } {
  const rounded = Math.round(value);
  return { total: rounded, roundOff: round2(rounded - value) };
}
