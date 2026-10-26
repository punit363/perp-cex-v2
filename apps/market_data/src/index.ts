import MarketData from "./market_data";
import RedisHandler from "./redis";
import type { MarkPriceUpdate } from "./type";

const market_data = new MarketData();

const SAMPLE_INTERVAL_MS = 100;
const MAX_QUOTE_AGE_MS = 1_000;
const SOURCE_MARKET_ID = "BTC-USD";
const ENGINE_MARKET_ID = "market123";
const PRODUCER_ID = crypto.randomUUID();
let markPriceSequence = 0;

const ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");

ws.addEventListener("open", () => {
  console.log("Connected to coinbase SPOT market feed");
  ws.send(
    JSON.stringify({
      type: "subscribe",
      product_ids: ["BTC-USD"],
      channels: ["ticker"],
    })
  );
});

ws.addEventListener("message", (event) => {
  const quote = market_data.normalizeCoinbaseTicker(
    JSON.parse(String(event.data)),
    Date.now()
  );
});

const ws2 = new WebSocket("wss://ws.kraken.com/v2");

ws2.addEventListener("open", () => {
  console.log("Connected to Kraken SPOT market feed");
  ws2.send(
    JSON.stringify({
      method: "subscribe",
      params: {
        channel: "ticker",
        symbol: ["BTC/USD"],
        event_trigger: "bbo",
        snapshot: true,
      },
    })
  );
});

ws2.addEventListener("message", (event) => {
  const quotes = market_data.normalizeKrakenTicker(
    JSON.parse(String(event.data)),
    Date.now()
  );
});

const redis = new RedisHandler();
await redis.connect();
let publishInProgress = false;

setInterval(async () => {
  if (publishInProgress) {
    return;
  }

  publishInProgress = true;

  try {
    const now = Date.now();
    const quotes = market_data.fetchLatestQuotes(SOURCE_MARKET_ID);

    const coinbase = quotes?.get("coinbase");
    const kraken = quotes?.get("kraken");

    if (!coinbase || !kraken) {
      return;
    }

    if (
      now - coinbase.received_at_ms > MAX_QUOTE_AGE_MS ||
      now - kraken.received_at_ms > MAX_QUOTE_AGE_MS
    ) {
      console.warn("Insufficient fresh quotes for BTC-USD");
      return;
    }

    const mark_price = market_data.calculateMarkPrice(coinbase, kraken);

    const engine_request_payload: MarkPriceUpdate = {
      action: "MARK_PRICE_UPDATE",
      market_id: ENGINE_MARKET_ID,
      mark_price,
      source_timestamp: Date.now(),
      producer_id: PRODUCER_ID,
      sequence: String(++markPriceSequence),
    };

    await redis.sendMarkPriceToEngine(engine_request_payload);
  } catch (error) {
    console.error("Failed to publish mark price:", error);
  } finally {
    publishInProgress = false;
  }
}, SAMPLE_INTERVAL_MS);
