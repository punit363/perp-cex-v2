import { expect, test } from "bun:test";
import { EngineEventSchema } from "commons/src/engine-event";
import Engine from "./engine";
import AccountStore from "./accounts";
import Orderbook from "./orderbook";
import { parseFixed } from "./math/fixed-point";
import { RequestToEngineSchema } from "./zod/z";
import { OrderSide } from "commons/src/order.type";

function createEngineForEventTest(): Engine {
  const engine = Object.create(Engine.prototype) as Engine;
  Object.assign(engine, {
    orderbooks: new Map([["BTC-USDT", new Orderbook({
      market_id: "BTC-USDT",
      last_traded_price: "0",
      last_trade_id: "",
      orders: [],
    })]]),
    accounts: new AccountStore([]),
    markPrices: new Map(),
    markPriceMetadata: new Map(),
    positionUsersByMarket: new Map([["BTC-USDT", new Set()]]),
    MAX_MARK_PRICE_AGE_MS: 5000,
    MAX_MARK_PRICE_CLOCK_SKEW_MS: 1000,
    MAINTENANCE_MARGIN_RATE: parseFixed("0.005"),
  });
  return engine;
}

function command(engine: Engine, input: Record<string, unknown>) {
  const result = engine.processEngineCommand(RequestToEngineSchema.parse(input));
  expect(result.response.status).toBe(1);
  for (const event of result.wsEvents) {
    expect(() => EngineEventSchema.parse({
      source_message_id: "1-0",
      occurred_at_ms: Date.now(),
      destination: "ws",
      ...event,
    })).not.toThrow();
  }
  return result.wsEvents;
}

test("publishes ticker, book, and trade events from engine commands", () => {
  const engine = createEngineForEventTest();
  command(engine, { action: "ONRAMP", user_id: "maker", amount: "1000" });
  command(engine, { action: "ONRAMP", user_id: "taker", amount: "1000" });

  const markEvents = command(engine, {
    action: "MARK_PRICE_UPDATE",
    market_id: "BTC-USDT",
    mark_price: "100",
    source_timestamp: Date.now(),
    producer_id: "test-feed",
    sequence: "1",
  });
  expect(markEvents).toEqual([{ event_type: "TICKER", data: {
    market_id: "BTC-USDT", mark_price: "100",
  } }]);

  const askEvents = command(engine, {
    action: "PLACE_ORDER", user_id: "maker", market_id: "BTC-USDT",
    order_id: "ask-1", price: "100", quantity: "1", filled: "0",
    leverage: "1", status: "OPEN", type: "LIMIT", side: "SELL",
  });
  expect(askEvents).toContainEqual({ event_type: "BOOK", data: {
    market_id: "BTC-USDT", asks: [{ price: "100", quantity: "1" }], bids: [],
  } });
  expect(askEvents).toContainEqual({ event_type: "TICKER", data: {
    market_id: "BTC-USDT", mark_price: "100", best_ask: "100",
  } });

  const fillEvents = command(engine, {
    action: "PLACE_ORDER", user_id: "taker", market_id: "BTC-USDT",
    order_id: "bid-1", price: "100", quantity: "1", filled: "0",
    leverage: "1", status: "OPEN", type: "LIMIT", side: "BUY",
  });
  expect(fillEvents[0]).toEqual({ event_type: "TRADE", data: {
    market_id: "BTC-USDT", trade_id: "tr_bid-1_0", price: "100",
    quantity: "1", taker_side: OrderSide.BUY,
  } });
  expect(fillEvents).toContainEqual({ event_type: "BOOK", data: {
    market_id: "BTC-USDT", asks: [], bids: [],
  } });
  expect(fillEvents).toContainEqual({ event_type: "TICKER", data: {
    market_id: "BTC-USDT", mark_price: "100", last_trade_id: "tr_bid-1_0",
    last_traded_price: "100",
  } });

  command(engine, {
    action: "PLACE_ORDER", user_id: "maker", market_id: "BTC-USDT",
    order_id: "bid-2", price: "90", quantity: "1", filled: "0",
    leverage: "1", status: "OPEN", type: "LIMIT", side: "BUY",
  });
  const cancelEvents = command(engine, {
    action: "CANCEL_ORDER", user_id: "maker", market_id: "BTC-USDT",
    order_id: "bid-2",
  });
  expect(cancelEvents).toContainEqual({ event_type: "BOOK", data: {
    market_id: "BTC-USDT", asks: [], bids: [],
  } });
  expect(cancelEvents.some((event) => event.event_type === "TRADE")).toBe(false);
});
