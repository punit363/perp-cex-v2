# Mark price producer

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

As of November 1, 2026, public source discovery and a live quote probe produced
marks for 17 of the 18 listed markets. `MATIC-ETH` has no current MATIC spot
product on either venue. Both exchanges list POL instead, but this service does
not treat POL as MATIC. Renaming or migrating that market requires an explicit
product decision.
