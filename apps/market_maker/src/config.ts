import { parseFixed } from "./fixed";

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function enabled(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} must be true or false`);
}

function decimal(name: string, fallback: string): string {
  const value = process.env[name] || fallback;
  if (parseFixed(value) <= 0n) throw new Error(`${name} must be greater than zero`);
  return value;
}

export function readConfig() {
  const baseUrl = new URL(process.env.MM_API_BASE_URL || "http://127.0.0.1:8000/api/v1");
  if (!/[\/]api[\/]v1[\/]?$/.test(baseUrl.pathname)) {
    throw new Error("MM_API_BASE_URL must end in /api/v1");
  }
  if (baseUrl.username || baseUrl.password || !["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("MM_API_BASE_URL must be an HTTP(S) URL without embedded credentials");
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(baseUrl.hostname);
  if (!local && !enabled("MM_ALLOW_REMOTE", false)) {
    throw new Error("Remote API requires MM_ALLOW_REMOTE=true; this bot generates real demo orders");
  }
  const password = process.env.MM_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set MM_PASSWORD to at least 12 characters");
  const prefix = process.env.MM_USERNAME_PREFIX || "demo-mm";
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,24}$/.test(prefix)) {
    throw new Error("MM_USERNAME_PREFIX must be 3–25 letters, digits, underscores or hyphens, starting with a letter");
  }
  const markets = (process.env.MM_MARKETS || "BTC-USDT")
    .split(",").map((slug) => slug.trim().toUpperCase()).filter(Boolean);
  if (markets.length === 0 || markets.some((slug) => !/^[A-Z0-9]+-[A-Z0-9]+$/.test(slug))) {
    throw new Error("MM_MARKETS must be a comma-separated list such as BTC-USDT,ETH-USDT");
  }
  const orderQuantity = decimal("MM_ORDER_QUANTITY", "0.01");
  const tradeQuantity = decimal("MM_TRADE_QUANTITY", "0.005");
  if (parseFixed(tradeQuantity) > parseFixed(orderQuantity)) {
    throw new Error("MM_TRADE_QUANTITY must not exceed MM_ORDER_QUANTITY");
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    password,
    prefix,
    markets: [...new Set(markets)],
    makers: integer("MM_MAKERS", 3, 1, 12),
    takers: integer("MM_TAKERS", 1, 1, 4),
    layers: integer("MM_LAYERS", 2, 1, 5),
    halfSpreadBps: integer("MM_HALF_SPREAD_BPS", 15, 1, 1000),
    layerStepBps: integer("MM_LAYER_STEP_BPS", 10, 1, 1000),
    repriceBps: integer("MM_REPRICE_BPS", 5, 0, 1000),
    tickMs: integer("MM_TICK_MS", 4000, 1000, 60_000),
    quoteTtlMs: integer("MM_QUOTE_TTL_MS", 30_000, 5000, 600_000),
    tradeEveryTicks: integer("MM_TRADE_EVERY_TICKS", 3, 0, 1000),
    orderQuantity,
    tradeQuantity,
    leverage: decimal("MM_LEVERAGE", "1"),
    targetCollateral: decimal("MM_TARGET_COLLATERAL", "10000"),
    seedBalances: enabled("MM_SEED_BALANCES", true),
    cancelOnExit: enabled("MM_CANCEL_ON_EXIT", true),
    maxCycles: process.argv.includes("--once") ? 1 : integer("MM_MAX_CYCLES", 0, 0, 1_000_000),
  };
}

export type Config = ReturnType<typeof readConfig>;
