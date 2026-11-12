# Apex Exchange

Apex is a demonstration perpetual futures exchange. It combines a price-time-priority matching engine, USDT collateral and positions, live market data, an HTTP API, WebSocket updates, and a browser trading interface. Trading and balances are simulated; no real assets are held or settled.

## Architecture

| Component | Role |
| --- | --- |
| `apps/frontend` | React trading interface with markets, charts, order entry, balances, and account activity. |
| `apps/backend` | Express API for authentication, markets, orders, and demo account actions. |
| `apps/engine` | In-memory order books, matching, margin, fees, funding, liquidation, candles, and snapshot recovery. |
| `apps/market_data` | Fetches spot quotes from Coinbase and Kraken to produce mark prices. |
| `apps/database` | Persists engine events to PostgreSQL and publishes private account updates. |
| `apps/ws` | Streams public market data and authenticated account updates to clients. |
| `apps/market_maker` | Optional demo bot that quotes markets and generates sample trades. |
| `packages/db` | Prisma schema, migrations, seeding, and repositories. |
| `packages/commons` | Shared market definitions, fixed-point helpers, and event types. |

Redis carries commands and events between services. PostgreSQL stores account and trade records. The engine maintains the live trading state and restores it from a snapshot plus the Redis stream after a restart. Caddy serves the frontend and proxies `/api` and `/ws`.

## Run locally with Docker

Install Docker Desktop or another Docker engine and a Compose command. On macOS with Colima, start it first:

```sh
colima start
```

From the repository root, create a local environment file:

```sh
cp .env.example .env
```

Edit `.env` before starting. Set `POSTGRES_PASSWORD` and use the same password in `DATABASE_URL`. Set independent values for `JWT_SECRET` and `ADMIN_TOKEN`. For local access on port 3000, keep `SITE_ADDRESS=:80` and set `WEB_HTTP_PORT=3000`. The example values are for configuration guidance and should be replaced.

Start the stack with the Compose command installed on your machine:

```sh
docker compose up -d --build
# If "docker compose" is unavailable:
docker-compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000). The initial startup builds the images, applies Prisma migrations, and seeds the supported markets. The `migrate` and `seed` containers should exit with status 0; the other services remain running. Market data requires outbound access to Coinbase and Kraken, and order entry requires a fresh mark price from both sources.

Useful commands:

```sh
docker-compose ps -a
docker-compose logs -f --tail=100 engine market_data backend ws database web
docker-compose down
```

Use `docker compose` in place of `docker-compose` if that is your installed command. `down` preserves the named PostgreSQL, Redis, engine snapshot, and Caddy volumes. `down -v` removes them and deletes local trading state.

## Development

The repository uses Bun workspaces. Install dependencies with `bun install`. You can run individual services from their directories with `bun src/index.ts`, but they require the corresponding PostgreSQL, Redis, environment variables, and seeded markets. The frontend can run separately with `cd apps/frontend && bun run dev`; its development API target is `http://localhost:8000/api/v1`.

The market maker is separate from the default Compose stack. Its settings are in `apps/market_maker/.env.example`; use it only for demo activity with dedicated accounts.

## Deployment

For the single-server AWS setup, see [EC2 deployment](deploy/EC2.md). Set `SITE_ADDRESS` to your domain and expose only Caddy on ports 80 and 443. Keep `.env` out of version control and retain the PostgreSQL, Redis, and engine snapshot volumes together when backing up or moving the deployment.
