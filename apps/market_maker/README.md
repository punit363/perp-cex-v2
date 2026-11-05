# Demo market maker

This is a separate Bun process for a **simulated** Apex exchange. It uses the same HTTP API as the frontend. It creates several dedicated maker users, posts bid and ask layers around each market's live mark price, and uses separate taker users for small crossing trades. The fills flow through the engine, database, WebSocket service, and candlestick pipeline normally.

## Start

Run the backend, engine, database worker, Redis, PostgreSQL, and mark-price service first. The selected markets must already be registered. The engine requires a **fresh mark price** before accepting orders.

From the repository root:

```sh
cp apps/market_maker/.env.example apps/market_maker/.env
# Edit MM_PASSWORD and MM_MARKETS in the new file.
cd apps/market_maker
bun run start
```

Run one cycle, then cancel the quotes it placed:

```sh
bun src/index.ts --once
```

The bot is intentionally **not** attached to `turbo run dev`; start it only when you want demo activity. It refuses a remote API unless `MM_ALLOW_REMOTE=true` is explicitly set. Use a dedicated `MM_USERNAME_PREFIX`; startup and shutdown cancel open orders belonging to those users.

## Controls

| Variable | Default | Meaning |
| --- | --- | --- |
| `MM_MARKETS` | `BTC-USDT` | Comma-separated registered market slugs. |
| `MM_MAKERS`, `MM_TAKERS` | `3`, `1` | Number of independent maker and taker users. |
| `MM_LAYERS` | `2` | Bid and ask levels per maker and market. |
| `MM_HALF_SPREAD_BPS` | `15` | Distance of the nearest quote from the mark price, in basis points. |
| `MM_LAYER_STEP_BPS` | `10` | Extra distance for each deeper level. |
| `MM_REPRICE_BPS` | `5` | Mark-price move that refreshes quotes. |
| `MM_QUOTE_TTL_MS` | `30000` | Maximum lifetime of a quote before refresh. |
| `MM_TICK_MS` | `4000` | Delay between quote cycles. |
| `MM_TRADE_EVERY_TICKS` | `3` | Crossing trade frequency; `0` makes quotes only. |
| `MM_ORDER_QUANTITY`, `MM_TRADE_QUANTITY` | `0.01`, `0.005` | Base-asset quantities; trade quantity cannot exceed quote quantity. |
| `MM_LEVERAGE` | `1` | Leverage sent with each order. |
| `MM_TARGET_COLLATERAL` | `10000` | Target total demo collateral per user on startup. |
| `MM_SEED_BALANCES` | `true` | Set `false` to fund users manually. |
| `MM_MAX_CYCLES` | `0` | Stop after this many cycles; `0` runs until interrupted. |
| `MM_CANCEL_ON_EXIT` | `true` | Cancel the bot users' open orders on normal exit. |

The bot uses the current order book to avoid crossing the spread when posting quotes. Because the API has no post-only order option, a quote can still execute immediately if the book changes before placement. A taker order that is not fully filled is canceled immediately. On restart, the bot clears the dedicated users' open orders before placing new quotes. Existing positions remain in their accounts.

After a hard crash, an accepted order may not yet appear in the database-backed open-orders endpoint. Check the dedicated demo accounts and their open orders before restarting if the database worker was behind or unavailable. A normal shutdown cancels known order IDs directly before consulting that endpoint.

The backend caps each demo top-up and rate-limits top-up requests. Configure the target within that cap. Keep this bot on a demo deployment and clearly label its trades as simulated.
