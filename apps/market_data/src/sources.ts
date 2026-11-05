import CONFIG from "./config";
import type MarketData from "./market_data";
import type { SpotVenue } from "./type";

type Subscriptions = Record<SpotVenue, string[]>;

export const createSources = (marketData: MarketData) => {
  let coinbase: WebSocket | null = null;
  let kraken: WebSocket | null = null;
  let coinbaseOpenedAt = 0;
  let krakenOpenedAt = 0;
  let coinbaseSubscribed = new Set<string>();
  let krakenSubscribed = new Set<string>();
  let nextCoinbaseBook = 0;
  let lastCoinbaseBookWarning = 0;

  const syncCoinbaseSubscriptions = (socket: WebSocket, desired: string[]): void => {
    const next = new Set(desired);
    const removed = [...coinbaseSubscribed].filter((symbol) => !next.has(symbol));
    const added = desired.filter((symbol) => !coinbaseSubscribed.has(symbol));
    if (removed.length) socket.send(JSON.stringify({
      type: "unsubscribe", product_ids: removed, channels: ["heartbeat"],
    }));
    if (added.length) socket.send(JSON.stringify({
      type: "subscribe", product_ids: added, channels: ["heartbeat"],
    }));
    coinbaseSubscribed = next;
  };

  const syncKrakenSubscriptions = (socket: WebSocket, desired: string[]): void => {
    const next = new Set(desired);
    const removed = [...krakenSubscribed].filter((symbol) => !next.has(symbol));
    const added = desired.filter((symbol) => !krakenSubscribed.has(symbol));
    if (removed.length) socket.send(JSON.stringify({
      method: "unsubscribe", params: { channel: "ticker", symbol: removed },
    }));
    if (added.length) socket.send(JSON.stringify({
      method: "subscribe", params: {
        channel: "ticker", symbol: added, event_trigger: "bbo", snapshot: true,
      },
    }));
    krakenSubscribed = next;
  };

  const connectCoinbase = (): void => {
    const socket = new WebSocket(CONFIG.coinbaseWebSocketUrl);
    coinbase = socket;
    coinbaseSubscribed = new Set();
    socket.addEventListener("open", () => {
      coinbaseOpenedAt = Date.now();
      marketData.markVenueSeen("coinbase", coinbaseOpenedAt);
      socket.send(JSON.stringify({ type: "subscribe", channels: ["status"] }));
      console.log("Coinbase source connected; discovering products");
    });
    socket.addEventListener("message", (event) => {
      try {
        const now = Date.now();
        const message: unknown = JSON.parse(String(event.data));
        marketData.markVenueSeen("coinbase", now);
        const products = marketData.registerCoinbaseProducts(message);
        if (products) syncCoinbaseSubscriptions(socket, products);
      } catch (error) {
        console.warn("Coinbase message ignored:", error);
      }
    });
    socket.addEventListener("error", (error) => {
      console.error("Coinbase source error:", error);
      socket.close();
    });
    socket.addEventListener("close", () => {
      if (coinbase !== socket) return;
      marketData.clearVenue("coinbase");
      coinbaseSubscribed.clear();
      coinbase = null;
      console.warn("Coinbase source disconnected; reconnecting");
      setTimeout(connectCoinbase, CONFIG.reconnectDelayMs);
    });
  };

  const connectKraken = (): void => {
    const socket = new WebSocket(CONFIG.krakenWebSocketUrl);
    kraken = socket;
    krakenSubscribed = new Set();
    socket.addEventListener("open", () => {
      krakenOpenedAt = Date.now();
      marketData.markVenueSeen("kraken", krakenOpenedAt);
      socket.send(JSON.stringify({
        method: "subscribe", params: { channel: "instrument", snapshot: true },
      }));
      console.log("Kraken source connected; discovering instruments");
    });
    socket.addEventListener("message", (event) => {
      try {
        const now = Date.now();
        const message: unknown = JSON.parse(String(event.data));
        marketData.markVenueSeen("kraken", now);
        const instruments = marketData.registerKrakenInstruments(message);
        if (instruments) syncKrakenSubscriptions(socket, instruments);
        marketData.normalizeKrakenTicker(message, now);
      } catch (error) {
        console.warn("Kraken message ignored:", error);
      }
    });
    socket.addEventListener("error", (error) => {
      console.error("Kraken source error:", error);
      socket.close();
    });
    socket.addEventListener("close", () => {
      if (kraken !== socket) return;
      marketData.clearVenue("kraken");
      krakenSubscribed.clear();
      kraken = null;
      console.warn("Kraken source disconnected; reconnecting");
      setTimeout(connectKraken, CONFIG.reconnectDelayMs);
    });
  };

  const checkConnection = (
    venue: SpotVenue, socket: WebSocket | null, openedAt: number, subscribed: Set<string>,
  ): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const latest = marketData.lastSeenAt(venue) ?? openedAt;
    const timeout = subscribed.size ? CONFIG.maxConnectionAgeMs : CONFIG.discoveryTimeoutMs;
    if (Date.now() - latest > timeout) {
      console.warn(venue + " source stopped sending messages; reconnecting");
      socket.close();
    }
  };

  const checkConnections = (): void => {
    checkConnection("coinbase", coinbase, coinbaseOpenedAt, coinbaseSubscribed);
    checkConnection("kraken", kraken, krakenOpenedAt, krakenSubscribed);
  };

  const syncSubscriptions = (subscriptions: Subscriptions): void => {
    if (coinbase?.readyState === WebSocket.OPEN) {
      syncCoinbaseSubscriptions(coinbase, subscriptions.coinbase);
    }
    if (kraken?.readyState === WebSocket.OPEN) {
      syncKrakenSubscriptions(kraken, subscriptions.kraken);
    }
  };

  // Public Coinbase level-2 WebSocket rejects anonymous subscriptions. Poll its
  // level-1 REST book across products to stay below the public request limit.
  const pollCoinbaseBook = async (): Promise<void> => {
    if (coinbase?.readyState !== WebSocket.OPEN || coinbaseSubscribed.size === 0) return;
    const symbols = [...coinbaseSubscribed];
    const symbol = symbols[nextCoinbaseBook++ % symbols.length]!;
    try {
      const response = await fetch(
        `${CONFIG.coinbaseBookUrl}/${encodeURIComponent(symbol)}/book?level=1`,
        { signal: AbortSignal.timeout(CONFIG.coinbaseRequestTimeoutMs) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const book = await response.json() as Record<string, unknown>;
      const receivedAt = Date.now();
      const sourceTime = typeof book.time === "string" ? Date.parse(book.time) : NaN;
      // A quiet book's last-change timestamp can be old; the REST snapshot is fresh.
      if (!coinbaseSubscribed.has(symbol) || book.auction_mode === true ||
        !Number.isFinite(sourceTime) ||
        sourceTime > receivedAt + CONFIG.quoteFutureToleranceMs) return;
      marketData.normalizeCoinbaseBook({ ...book, type: "snapshot", product_id: symbol }, receivedAt);
    } catch (error) {
      if (Date.now() - lastCoinbaseBookWarning > CONFIG.coinbaseWarningIntervalMs) {
        lastCoinbaseBookWarning = Date.now();
        console.warn("Coinbase top-of-book request failed:", symbol, error);
      }
    }
  };

  return {
    start: () => { connectCoinbase(); connectKraken(); },
    checkConnections,
    syncSubscriptions,
    pollCoinbaseBook,
  };
};
