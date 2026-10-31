# WebSocket market feed

Run `bun src/index.ts` from this directory. The server listens on port 7000 and
reads the `engine-events` Redis stream with the `websocket` consumer group.
Engine commands publish `BOOK` after a book change, `TRADE` for each fill, and
`TICKER` after a mark price or best price changes. Events use the market ID from
the database.

Clients subscribe separately to each event type and market:

```json
{"action":"SUBSCRIBE","type":"BOOK","market_id":"<market ID>"}
```

Replace `BOOK` with `TRADE` or `TICKER` for the other feeds. Use `UNSUBSCRIBE`
to stop receiving a feed. The server sends the event's `data` object to matching
clients. The frontend loads an initial depth snapshot over HTTP, then applies
live book updates from this socket.
