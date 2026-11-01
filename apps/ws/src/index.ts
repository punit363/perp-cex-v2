import type { ServerWebSocket } from "bun";
import jwt, { type JwtPayload } from "jsonwebtoken";
import RedisHandler from "./redis";

type PublicEventType = "BOOK" | "TRADE" | "TICKER" | "CANDLE";
type SocketData = { user_id: string | null };

const redis = new RedisHandler();
const subscriptions = new Map<ServerWebSocket<SocketData>, Set<string>>();

function isPublicEventType(value: unknown): value is PublicEventType {
  return value === "BOOK" || value === "TRADE" || value === "TICKER" || value === "CANDLE";
}

function subscriptionKey(type: PublicEventType, market_id: string): string {
  return `${type}:${market_id}`;
}

function verifyToken(token: unknown): string | null {
  if (typeof token !== "string" || !token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "secret") as JwtPayload;
    const user_id = payload.user_id ?? payload.id;
    return typeof user_id === "string" && user_id ? user_id : null;
  } catch {
    return null;
  }
}

Bun.serve<SocketData>({
  port: Number(process.env.WS_PORT || 7001),
  fetch(req, server) {
    const success = server.upgrade(req, { data: { user_id: null } });
    if (success) return undefined;
    return new Response("This is a WebSocket server. Please connect via WS.");
  },
  websocket: {
    open(ws) {
      subscriptions.set(ws, new Set());
      ws.send("Connection secured with Apex ws service");
    },
    message(ws, message) {
      let data: unknown;
      try {
        data = JSON.parse(message.toString());
      } catch {
        ws.send(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        ws.send(JSON.stringify({ error: "Invalid subscription" }));
        return;
      }

      const { action, type, market_id, token } = data as Record<string, unknown>;
      if (action === "AUTHENTICATE") {
        const user_id = verifyToken(token);
        if (!user_id) {
          ws.send(JSON.stringify({ error: "Authentication failed" }));
          return;
        }
        ws.data.user_id = user_id;
        ws.send(JSON.stringify({ action: "AUTHENTICATED" }));
        return;
      }

      if (
        (action !== "SUBSCRIBE" && action !== "UNSUBSCRIBE") ||
        (type !== "ACCOUNT" && !isPublicEventType(type))
      ) {
        ws.send(JSON.stringify({ error: "Invalid subscription" }));
        return;
      }

      const topics = subscriptions.get(ws);
      if (!topics) return;

      if (type === "ACCOUNT") {
        if (!ws.data.user_id) {
          ws.send(JSON.stringify({ error: "Authenticate before subscribing to ACCOUNT" }));
          return;
        }
        if (action === "SUBSCRIBE") topics.add("ACCOUNT");
        else topics.delete("ACCOUNT");
        ws.send(JSON.stringify({ action, type }));
        return;
      }

      if (typeof market_id !== "string" || market_id.length === 0) {
        ws.send(JSON.stringify({ error: "A market_id is required" }));
        return;
      }
      const key = subscriptionKey(type, market_id);
      if (action === "SUBSCRIBE") {
        topics.add(key);
      } else {
        topics.delete(key);
      }
      ws.send(JSON.stringify({ action, type, market_id }));
    },
    close(ws, code, reason) {
      subscriptions.delete(ws);
      console.log(`Client disconnected: ${code} - ${reason}`);
    },
  },
});

void redis
  .readEvents(async (event) => {
    const key = subscriptionKey(event.event_type, event.data.market_id);
    const payload = JSON.stringify({
      event_type: event.event_type,
      occurred_at_ms: event.occurred_at_ms,
      ...event.data,
    });
    for (const [ws, topics] of subscriptions) {
      if (!topics.has(key)) continue;
      try {
        ws.send(payload);
      } catch (error) {
        console.error("Failed to send WebSocket event:", error);
        subscriptions.delete(ws);
      }
    }
  })
  .catch((error) => {
    console.error("Redis event reader stopped:", error);
  });

void redis
  .readPrivateEvents(async (event) => {
    const payload = JSON.stringify(event);
    for (const [ws, topics] of subscriptions) {
      if (ws.data.user_id !== event.user_id || !topics.has("ACCOUNT")) continue;
      try {
        ws.send(payload);
      } catch (error) {
        console.error("Failed to send private WebSocket event:", error);
        subscriptions.delete(ws);
      }
    }
  })
  .catch((error) => {
    console.error("Private Redis event reader stopped:", error);
  });
