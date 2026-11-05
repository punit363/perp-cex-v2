import CONFIG from "./config";

export const parseFixed = (value: string): bigint => {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) throw new Error("Invalid decimal price");
  return BigInt(match[1]!) * CONFIG.scale +
    BigInt((match[2] ?? "").padEnd(8, "0") || "0");
};

export const formatFixed = (value: bigint): string => {
  const whole = value / CONFIG.scale;
  const fraction = (value % CONFIG.scale).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? whole + "." + fraction : whole.toString();
};

export const pairKey = (base: string, quote: string): string => base + "-" + quote;

export const bestPrice = (prices: Set<bigint>, side: "bid" | "ask"): bigint | null => {
  let best: bigint | null = null;
  for (const price of prices) {
    if (best === null || (side === "bid" ? price > best : price < best)) best = price;
  }
  return best;
};
