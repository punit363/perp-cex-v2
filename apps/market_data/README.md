# Mark price producer

Seed the markets before starting this service. Run `bun src/index.ts` from this
directory with Postgres and Redis available. At startup it resolves the listed
`BTC-USDT` market ID from the database, reads BTC/USD spot quotes from Coinbase
and Kraken, and sends mark price updates to the engine stream. BTC/USDT is the
only pair fed by this producer at present.
