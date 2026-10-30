# APEX Exchange frontend

The landing page uses Bun, React, and Tailwind. It connects to the backend's
authentication and balance endpoints at `http://localhost:8000/api/v1` during
local development.

From the repository root, install dependencies with `bun install`. Start the
backend on port 8000, then run the frontend from this directory:

```sh
bun dev
```

Check and build with:

```sh
bun check
bun run build
```

Sign-in sessions are held in memory for the current page. The landing page
does not display invented market volume or latency values.

The Markets view reads listed markets from `GET /api/v1/market` and subscribes
to ticker updates from the WebSocket service on port 7000 during local
development. Price history starts when live updates arrive. If the backend is
unavailable or no markets have been listed, it shows labeled preview pairs
using the icons in `public/icons` without fabricated prices or charts.

The Balances page is available at `/balances` without a frontend route guard.
When signed in, it fetches available and reserved collateral from the engine.
When signed out, it keeps the page visible and shows an account connection
prompt without displaying invented balances. The Markets page is available at
`/markets`, and browser back/forward navigation works for both pages.

Selecting a market opens `/market/:id`. The trading page reads a market record
and order-book snapshot from the backend, then subscribes to book, trade, and
ticker updates from the WebSocket service. Its line chart shows prices received
during the current browser session; historical candles are not available yet.
The order form submits limit and market orders to the engine. Open orders and
order history come from the database projector, while the position tab reads
the engine's current position for that market. Account tabs remain accessible
while signed out and prompt for sign-in when private data is needed.
