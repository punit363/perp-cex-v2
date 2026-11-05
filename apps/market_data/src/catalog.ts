import type { Product } from "./type";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const coinbaseProducts = (message: unknown): Product[] | null => {
  if (!isRecord(message) || message.type !== "status" || !Array.isArray(message.products)) return null;
  const products: Product[] = [];
  for (const item of message.products) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.base_currency !== "string" || typeof item.quote_currency !== "string" || typeof item.status !== "string") continue;
    products.push({ symbol: item.id, base: item.base_currency, quote: item.quote_currency, status: item.status });
  }
  return products;
};

export const krakenProducts = (message: unknown): { products: Product[]; replace: boolean } | null => {
  if (!isRecord(message) || message.channel !== "instrument" || !isRecord(message.data) || !Array.isArray(message.data.pairs)) return null;
  const products: Product[] = [];
  for (const item of message.data.pairs) {
    if (!isRecord(item) || typeof item.symbol !== "string" || typeof item.base !== "string" || typeof item.quote !== "string" || typeof item.status !== "string") continue;
    products.push({ symbol: item.symbol, base: item.base === "XBT" ? "BTC" : item.base, quote: item.quote, status: item.status });
  }
  return { products, replace: message.type === "snapshot" };
};
