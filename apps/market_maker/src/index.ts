import {
  ApiError,
  ExchangeApi,
  type BotUser,
  type Market,
  type OrderSide,
} from "./api";
import { readConfig } from "./config";
import { formatFixed, movedBps, parseFixed, quotePrice } from "./fixed";

const config = readConfig();
const api = new ExchangeApi(config);
const makers: BotUser[] = [];
const takers: BotUser[] = [];
const selectedMarkets = new Map<string, Market>();

type Quote = {
  key: string;
  user: BotUser;
  marketId: string;
  orderId: string;
  side: OrderSide;
  price: bigint;
  reference: bigint;
  placedAt: number;
};
const active = new Map<string, Quote>();
const tradeCount = new Map<string, number>();
let stopping = false;
let wake: (() => void) | undefined;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    wake?.();
    console.log(
      `Received ${signal}; finishing current request and cleaning up quotes.`
    );
  });
}

function wait(ms: number): Promise<void> {
  if (stopping) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = undefined;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = undefined;
      resolve();
    };
  });
}

function quoteKey(
  user: BotUser,
  marketId: string,
  side: OrderSide,
  layer: number
) {
  return `${user.username}:${marketId}:${side}:${layer}`;
}

function isGone(error: unknown) {
  return (
    error instanceof ApiError &&
    error.statusCode === 400 &&
    /this order does not exist/i.test(error.message)
  );
}

async function cancelQuote(quote: Quote): Promise<void> {
  try {
    await api.cancel(quote.user, quote.marketId, quote.orderId);
  } catch (error) {
    if (!isGone(error)) throw error;
  }
  active.delete(quote.key);
}

async function cancelMarket(marketId: string): Promise<void> {
  for (const quote of [...active.values()].filter(
    (item) => item.marketId === marketId
  )) {
    await cancelQuote(quote);
  }
}

async function clearAccountOrders(
  users: BotUser[],
  markets: Market[]
): Promise<void> {
  const failures: string[] = [];
  for (const user of users) {
    for (const market of markets) {
      try {
        const orders = await api.openOrders(user, market.market_id);
        for (const order of orders) {
          try {
            await api.cancel(user, market.market_id, order.order_id);
          } catch (error) {
            if (!isGone(error)) {
              failures.push(
                `${user.username} ${market.slug} ${order.order_id}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
        }
        if (orders.length)
          console.log(
            `Cleared ${orders.length} old ${market.slug} order(s) for ${user.username}`
          );
      } catch (error) {
        failures.push(
          `${user.username} ${market.slug}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  active.clear();
  if (failures.length)
    throw new Error(
      `Could not clear ${failures.length} order group(s): ${failures.join("; ")}`
    );
}

async function seed(user: BotUser): Promise<void> {
  if (!config.seedBalances) return;
  const balance = await api.balance(user);
  const current = parseFixed(balance.available) + parseFixed(balance.reserved);
  const target = parseFixed(config.targetCollateral);
  if (current >= target) return;
  const amount = formatFixed(target - current);
  await api.topUp(user, amount);
  console.log(`Added ${amount} simulated collateral to ${user.username}`);
}

async function setup(): Promise<void> {
  const response = await api.listMarkets();
  if (!Array.isArray(response.markets))
    throw new Error("The market API did not return a market list");
  const bySlug = new Map(
    response.markets.map((market) => [market.slug.toUpperCase(), market])
  );
  for (const slug of config.markets) {
    const market = bySlug.get(slug);
    if (!market)
      throw new Error(
        `${slug} is not listed. Create it before starting the bot.`
      );
    selectedMarkets.set(slug, market);
  }

  for (let index = 1; index <= config.makers; index++) {
    const user = await api.connectUser(
      `${config.prefix}-maker-${String(index).padStart(2, "0")}`
    );
    await seed(user);
    makers.push(user);
  }
  for (let index = 1; index <= config.takers; index++) {
    const user = await api.connectUser(
      `${config.prefix}-taker-${String(index).padStart(2, "0")}`
    );
    await seed(user);
    takers.push(user);
  }
  await clearAccountOrders(
    [...makers, ...takers],
    [...selectedMarkets.values()]
  );
  console.log(
    `Ready: ${makers.length} makers, ${takers.length} takers, ${selectedMarkets.size} market(s).`
  );
}

async function quoteMarket(market: Market): Promise<number> {
  const marketId = market.market_id;
  if (market.trading_halted || !market.mark_price) {
    await cancelMarket(marketId);
    console.log(
      `${market.slug}: ${market.trading_halted ? "trading halted" : "no mark price"}; quotes paused`
    );
    return 0;
  }
  // Market prices are returned by the DB as integers scaled to 1e8.
  const mid = BigInt(market.mark_price);
  if (mid <= 0n) {
    await cancelMarket(marketId);
    console.log(`${market.slug}: invalid mark price; quotes paused`);
    return 0;
  }
  const oldQuotes = [...active.values()].filter(
    (quote) => quote.marketId === marketId
  );
  const refresh = oldQuotes.some(
    (quote) =>
      Date.now() - quote.placedAt >= config.quoteTtlMs ||
      movedBps(quote.reference, mid) >= BigInt(config.repriceBps)
  );
  if (refresh) await cancelMarket(marketId);

  // The depth check reduces accidental taking. The exchange does not yet have
  // a post-only flag, so another order can still arrive between this read and placement.
  const depth = await api.depth(marketId);
  const bestAsk = depth.asks[0] ? parseFixed(depth.asks[0].price) : null;
  const bestBid = depth.bids[0] ? parseFixed(depth.bids[0].price) : null;
  let placed = 0;
  for (const [makerIndex, user] of makers.entries()) {
    for (let layer = 0; layer < config.layers; layer++) {
      for (const side of ["BUY", "SELL"] as const) {
        if (stopping) return placed;
        const key = quoteKey(user, marketId, side, layer);
        if (active.has(key)) continue;
        const offset =
          config.halfSpreadBps + layer * config.layerStepBps + makerIndex;
        let price = quotePrice(mid, side, offset);
        if (side === "BUY" && bestAsk !== null && price >= bestAsk)
          price = bestAsk - 1n;
        if (side === "SELL" && bestBid !== null && price <= bestBid)
          price = bestBid + 1n;
        if (price <= 0n) continue;
        try {
          const order = await api.place(user, {
            market_id: marketId,
            side,
            price: formatFixed(price),
            quantity: config.orderQuantity,
            leverage: config.leverage,
          });
          if (order.status === "OPEN" || order.status === "PARTIALLY_FILLED") {
            active.set(key, {
              key,
              user,
              marketId,
              orderId: order.order_id,
              side,
              price,
              reference: mid,
              placedAt: Date.now(),
            });
          }
          placed++;
        } catch (error) {
          console.error(
            `${market.slug} ${user.username} ${side} layer ${layer + 1}:`,
            error instanceof Error ? error.message : error
          );
        }
      }
    }
  }
  return placed;
}

async function makeTrade(market: Market): Promise<void> {
  const count = tradeCount.get(market.market_id) || 0;
  const side: OrderSide = count % 2 === 0 ? "BUY" : "SELL";
  const taker = takers[Math.floor(count / 2) % takers.length]!;
  const depth = await api.depth(market.market_id);
  const opposite = side === "BUY" ? depth.asks[0] : depth.bids[0];
  if (!opposite) return;
  const quantity =
    parseFixed(opposite.quantity) < parseFixed(config.tradeQuantity)
      ? opposite.quantity
      : config.tradeQuantity;
  if (parseFixed(quantity) <= 0n) return;
  const order = await api.place(taker, {
    market_id: market.market_id,
    side,
    price: opposite.price,
    quantity,
    leverage: config.leverage,
  });
  if (order.status === "OPEN" || order.status === "PARTIALLY_FILLED") {
    try {
      await api.cancel(taker, market.market_id, order.order_id);
    } catch (error) {
      if (!isGone(error)) throw error;
    }
  }
  if (order.filled && parseFixed(order.filled) > 0n) {
    tradeCount.set(market.market_id, count + 1);
    console.log(
      `${market.slug}: ${taker.username} ${side} filled ${order.filled} at ${opposite.price}`
    );
  }
}

async function cycle(number: number): Promise<void> {
  const { markets } = await api.listMarkets();
  const current = new Map(markets.map((market) => [market.market_id, market]));
  for (const initial of selectedMarkets.values()) {
    if (stopping) break;
    const market = current.get(initial.market_id);
    if (!market) {
      console.error(`${initial.slug}: missing from market API; skipping`);
      continue;
    }
    try {
      const placed = await quoteMarket(market);
      if (placed)
        console.log(`${market.slug}: placed ${placed} maker quote(s)`);
      if (
        !market.trading_halted &&
        market.mark_price &&
        config.tradeEveryTicks > 0 &&
        number % config.tradeEveryTicks === 0
      ) {
        await makeTrade(market);
      }
    } catch (error) {
      console.error(
        `${market.slug}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

try {
  await setup();
  for (
    let number = 1;
    !stopping && (config.maxCycles === 0 || number <= config.maxCycles);
    number++
  ) {
    try {
      await cycle(number);
    } catch (error) {
      console.error(
        "Market cycle failed:",
        error instanceof Error ? error.message : error
      );
    }
    if (!stopping && (config.maxCycles === 0 || number < config.maxCycles))
      await wait(config.tickMs);
  }
} catch (error) {
  console.error(
    "Market maker could not start:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
} finally {
  if (config.cancelOnExit && makers.length) {
    const failures: string[] = [];
    // The DB projection can lag, so first cancel every quote the bot still tracks.
    for (const quote of [...active.values()]) {
      try {
        await cancelQuote(quote);
      } catch (error) {
        failures.push(
          `${quote.user.username} ${quote.orderId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    try {
      await clearAccountOrders(
        [...makers, ...takers],
        [...selectedMarkets.values()]
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    if (failures.length) {
      console.error("Could not clear every demo order:", failures.join("; "));
      process.exitCode = 1;
    }
  }
}
