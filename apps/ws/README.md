# WebSocket market feed

Run `bun src/index.ts` from this directory. The server listens on port 7001 by
default (`WS_PORT` overrides it) and
reads the `engine-events` Redis stream with the `websocket` consumer group.
Engine commands publish `BOOK` after a book change, `TRADE` for each fill, and
`TICKER` after a mark price or best price changes. Events use the market ID from
the database.

Clients subscribe separately to each event type and market:

```json
{"action":"SUBSCRIBE","type":"BOOK","market_id":"<market ID>"}
```

Replace `BOOK` with `TRADE`, `TICKER`, or `CANDLE` for the other public feeds.
Use `UNSUBSCRIBE` to stop receiving a feed. The server sends the event's `data`
object to matching clients with `event_type` and `occurred_at_ms`. The frontend
loads an initial snapshot over HTTP, then applies live updates from this socket.

## Private account feed

Authenticate on the already-open socket before subscribing to the account feed:

```json
{"action":"AUTHENTICATE","token":"<JWT>"}
```

After receiving `{"action":"AUTHENTICATED"}`, subscribe with:

```json
{"action":"SUBSCRIBE","type":"ACCOUNT"}
```

`ACCOUNT` events contain only the authenticated user's changed balance, orders,
positions, and closed-position market IDs. They are produced by the database
projector after it has persisted the engine event, and are therefore suitable as
live deltas after an HTTP snapshot. On reconnect, clients should fetch fresh
REST snapshots before relying on future events.
