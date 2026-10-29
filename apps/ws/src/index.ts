import type { ServerWebSocket } from "bun";
import RedisHandler from "./redis";

type PublicEventType = "BOOK" | "TRADE" | "TICKER";

const redis = new RedisHandler();
const subscriptions = new Map<ServerWebSocket<unknown>, Set<string>>();

function isPublicEventType(value: unknown): value is PublicEventType {
  return value === "BOOK" || value === "TRADE" || value === "TICKER";
}

function subscriptionKey(type: PublicEventType, market_id: string): string {
  return `${type}:${market_id}`;
}

Bun.serve({
  port: 7000,
  fetch(req, server) {
    const success = server.upgrade(req);
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

      const { action, type, market_id } = data as Record<string, unknown>;
      if (
        (action !== "SUBSCRIBE" && action !== "UNSUBSCRIBE") ||
        !isPublicEventType(type) ||
        typeof market_id !== "string" ||
        market_id.length === 0
      ) {
        ws.send(JSON.stringify({ error: "Invalid subscription" }));
        return;
      }

      const topics = subscriptions.get(ws);
      if (!topics) return;

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
    const payload = JSON.stringify(event.data);
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
