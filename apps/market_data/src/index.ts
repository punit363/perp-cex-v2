import MarketData from "./market_data";
import RedisHandler from "./redis";
import type { MarkPriceUpdate, SpotVenue } from "./type";
import { MarketRepo } from "db/repositories/market.repo";

const SAMPLE_INTERVAL_MS = 1_000;
const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
const COINBASE_POLL_INTERVAL_MS = 200;
const COINBASE_MAX_QUOTE_AGE_MS = 15_000;
const MAX_CONNECTION_AGE_MS = 5_000;
const DISCOVERY_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;
const MARKET_REFRESH_MS = 5_000;

let markets = await MarketRepo.listMarkets();
if (markets.length === 0) throw new Error("List markets before starting market data");

const marketData = new MarketData(markets.map(({ slug }) => slug));
const producerId = crypto.randomUUID();
let sequence = 0;
let coinbase: WebSocket | null = null;
let kraken: WebSocket | null = null;
let coinbaseOpenedAt = 0;
let krakenOpenedAt = 0;
let coinbaseSubscribed = new Set<string>();
let krakenSubscribed = new Set<string>();
let nextCoinbaseBook = 0;
let lastCoinbaseBookWarning = 0;
const publishedMarkets = new Set<string>();
const sentFundingIntervals = new Map<string, { intervalEnd: number; lastSentAt: number; final: boolean }>();
const unavailableReported = new Set<string>();
const startedAt = Date.now();

function syncCoinbaseSubscriptions(socket: WebSocket, desired: string[]): void {
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
}

function syncKrakenSubscriptions(socket: WebSocket, desired: string[]): void {
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
}

function connectCoinbase(): void {
  const socket = new WebSocket("wss://ws-feed.exchange.coinbase.com");
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
    setTimeout(connectCoinbase, RECONNECT_DELAY_MS);
  });
}

function connectKraken(): void {
  const socket = new WebSocket("wss://ws.kraken.com/v2");
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
    setTimeout(connectKraken, RECONNECT_DELAY_MS);
  });
}

function checkConnection(venue: SpotVenue, socket: WebSocket | null, openedAt: number, subscribed: Set<string>): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const latest = marketData.lastSeenAt(venue) ?? openedAt;
  const timeout = subscribed.size ? MAX_CONNECTION_AGE_MS : DISCOVERY_TIMEOUT_MS;
  if (Date.now() - latest > timeout) {
    console.warn(venue + " source stopped sending messages; reconnecting");
    socket.close();
  }
}

connectCoinbase();
connectKraken();

const redis = new RedisHandler();
await redis.connect();
let publishInProgress = false;
let marketRefreshInProgress = false;

setInterval(async () => {
  if (marketRefreshInProgress) return;
  marketRefreshInProgress = true;
  try {
    const updated = await MarketRepo.listMarkets();
    const signature = (items: typeof markets) => items.map(({ market_id, slug }) => `${market_id}:${slug}`).sort().join("|");
    if (signature(updated) !== signature(markets)) {
      const subscriptions = marketData.setMarkets(updated.map(({ slug }) => slug));
      markets = updated;
      if (coinbase?.readyState === WebSocket.OPEN) syncCoinbaseSubscriptions(coinbase, subscriptions.coinbase);
      if (kraken?.readyState === WebSocket.OPEN) syncKrakenSubscriptions(kraken, subscriptions.kraken);
    }
  } catch (error) {
    console.error("Failed to refresh market list:", error);
  } finally {
    marketRefreshInProgress = false;
  }
}, MARKET_REFRESH_MS);

setInterval(() => {
  checkConnection("coinbase", coinbase, coinbaseOpenedAt, coinbaseSubscribed);
  checkConnection("kraken", kraken, krakenOpenedAt, krakenSubscribed);
}, SAMPLE_INTERVAL_MS);

// Coinbase's public level-2 WebSocket now rejects anonymous subscriptions.
// Its public level-1 REST book gives the current best bid and ask. Spread the
// requests across products to stay below the public 10 requests/second limit.
setInterval(() => {
  if (coinbase?.readyState !== WebSocket.OPEN || coinbaseSubscribed.size === 0) return;
  const symbols = [...coinbaseSubscribed];
  const symbol = symbols[nextCoinbaseBook++ % symbols.length]!;
  void (async () => {
    try {
      const response = await fetch(
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(symbol)}/book?level=1`,
        { signal: AbortSignal.timeout(4_000) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const book = await response.json() as Record<string, unknown>;
      const receivedAt = Date.now();
      const sourceTime = typeof book.time === "string" ? Date.parse(book.time) : NaN;
      // The book timestamp is the last book change, which can be old for a
      // quiet market. The REST response itself is the fresh snapshot.
      if (!coinbaseSubscribed.has(symbol) || book.auction_mode === true || !Number.isFinite(sourceTime) || sourceTime > receivedAt + 1_000) return;
      marketData.normalizeCoinbaseBook({ ...book, type: "snapshot", product_id: symbol }, receivedAt);
    } catch (error) {
      if (Date.now() - lastCoinbaseBookWarning > 10_000) {
        lastCoinbaseBookWarning = Date.now();
        console.warn("Coinbase top-of-book request failed:", symbol, error);
      }
    }
  })();
}, COINBASE_POLL_INTERVAL_MS);

setInterval(async () => {
  if (publishInProgress) return;
  publishInProgress = true;
  try {
    const now = Date.now();
    for (const market of markets) {
      const markPrice = marketData.calculateMarkPrice(market.slug, now, MAX_CONNECTION_AGE_MS, COINBASE_MAX_QUOTE_AGE_MS);
      if (!markPrice) {
        if (publishedMarkets.delete(market.slug)) {
          console.warn(market.slug + " mark unavailable; engine will reject new orders when its previous mark expires");
        } else if (now - startedAt > 20_000 && !unavailableReported.has(market.slug)) {
          unavailableReported.add(market.slug);
          console.warn(market.slug + " mark unavailable: no live two-venue source route");
        }
        continue;
      }
      const update: MarkPriceUpdate = {
        action: "MARK_PRICE_UPDATE",
        market_id: market.market_id,
        mark_price: markPrice,
        source_timestamp: now,
        producer_id: producerId,
        sequence: String(++sequence),
      };
      await redis.sendMarkPriceToEngine(update);
      if (market.slug.endsWith("-USDT")) {
        const intervalEnd = Math.floor(now / FUNDING_INTERVAL_MS) * FUNDING_INTERVAL_MS;
        const sent = sentFundingIntervals.get(market.market_id);
        if (intervalEnd > 0 &&
          (sent?.intervalEnd !== intervalEnd || (!sent.final && now - sent.lastSentAt >= 10_000))) {
          await redis.sendFundingSettlement(market.market_id, intervalEnd);
          sentFundingIntervals.set(market.market_id, {
            intervalEnd, lastSentAt: now, final: now - intervalEnd >= 60_000,
          });
        }
      }
      if (!publishedMarkets.has(market.slug)) {
        publishedMarkets.add(market.slug);
        unavailableReported.delete(market.slug);
        console.log(market.slug + " mark active from Coinbase and Kraken");
      }
    }
  } catch (error) {
    console.error("Failed to publish mark prices:", error);
  } finally {
    publishInProgress = false;
  }
}, SAMPLE_INTERVAL_MS);
