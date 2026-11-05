export const SCALE = 100_000_000n;

export function parseFixed(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) throw new Error(`Invalid decimal: ${value}`);
  const absolute = BigInt(match[2]!) * SCALE + BigInt((match[3] || "").padEnd(8, "0") || "0");
  return match[1] === "-" ? -absolute : absolute;
}

export function formatFixed(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${absolute / SCALE}${fraction ? `.${fraction}` : ""}`;
}

export function quotePrice(mid: bigint, side: "BUY" | "SELL", offsetBps: number): bigint {
  const factor = BigInt(side === "BUY" ? 10_000 - offsetBps : 10_000 + offsetBps);
  const numerator = mid * factor;
  return side === "BUY" ? numerator / 10_000n : (numerator + 9_999n) / 10_000n;
}

export function movedBps(a: bigint, b: bigint): bigint {
  if (a <= 0n) return 10_000n;
  const difference = a > b ? a - b : b - a;
  return difference * 10_000n / a;
}
