# Mark price producer

## Code layout

- `src/index.ts` starts the service and refreshes the market list.
- `src/sources.ts` owns Coinbase and Kraken connections, subscriptions, health checks, and Coinbase book polling.
- `src/market_data.ts` stores discovered products and normalized venue quotes.
- `src/catalog.ts`, `src/price_utils.ts`, and `src/pricing.ts` parse source data and calculate fixed-point mark prices.
- `src/publisher.ts` sends mark updates and funding settlement requests through `src/redis.ts`.
- `src/config.ts` holds source URLs, intervals, freshness limits, and the Redis URL.

Seed markets, then run `bun src/index.ts` with Postgres and Redis available.
The producer reads the listed market IDs from the database and discovers live
spot products from Coinbase and Kraken. It sends one mark-price update per
market per second to the engine only while **both** venues provide usable
quotes.

Coinbase's public status and heartbeat WebSocket channels identify available
products and confirm the connection is alive. Current best bids and asks come
from its public level-1 product-book REST endpoint, polled at five requests
per second across all needed products. A Coinbase quote expires 15 seconds
after its last successful snapshot. Kraken's instrument channel discovers
products, and its ticker channel provides best bids and asks; its automatic
heartbeat confirms the connection is alive. Both connections reconnect after
an interruption.

For each market, the producer prefers a direct base/quote spot pair on each
venue. It can invert a quote/base pair or calculate base/quote through fresh
USD or USDT legs on the **same venue**. It averages the two venue midprices.
If either source or a required leg is unavailable, the producer stops sending
updates; the engine's five-second mark freshness check then rejects new orders.

The exchange currently lists 13 USDT-quoted markets whose two-venue spot routes
were verified. ETH-quoted markets are excluded because the engine's collateral,
margin, fees, funding and PnL all settle in USDT. MATIC is excluded because the
price producer has no MATIC spot product from both venues. Existing database
records for delisted markets remain available for recovery and trade history;
new orders for those market IDs are rejected. Runtime quote freshness still
determines whether any listed market is open for trading.
