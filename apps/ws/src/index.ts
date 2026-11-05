import type { ServerWebSocket } from "bun";
import jwt, { type JwtPayload } from "jsonwebtoken";
import RedisHandler from "./redis";
import CONFIG from "./config";
import type { PublicEventType, SocketData } from "./types";

const redis = new RedisHandler();
//saves socketconnection by each user and what they have subscribed to
const subscriptions = new Map<ServerWebSocket<SocketData>, Set<string>>();

const isPublicEventType = (value: unknown): value is PublicEventType => {
  return (
    value === "BOOK" ||
    value === "TRADE" ||
    value === "TICKER" ||
    value === "CANDLE" ||
    value === "FUNDING"
  );
};

const subscriptionKey = (type: PublicEventType, market_id: string): string => {
  return `${type}:${market_id}`;
};

//verify jwt from user for private events
const verifyToken = (token: unknown): string | null => {
  if (typeof token !== "string" || !token) return null;
  try {
    const payload = jwt.verify(token, CONFIG.jwtSecret) as JwtPayload;
    const user_id = payload.user_id ?? payload.id;
    return typeof user_id === "string" && user_id ? user_id : null;
  } catch {
    return null;
  }
};

//setup bun server
Bun.serve<SocketData>({
  port: CONFIG.port,
  fetch(req, server) {
    const success = server.upgrade(req, { data: { user_id: null } });
    if (success) return undefined;
    return new Response("This is a WebSocket server. Please connect via WS.");
  },
  websocket: {
    open(ws) {
      //on new connection save it to subscription map
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

      const { action, type, market_id, token } = data as Record<
        string,
        unknown
      >;

      //authenticate for personal socket data
      if (action === "AUTHENTICATE") {
        const user_id = verifyToken(token);
        if (!user_id) {
          ws.send(JSON.stringify({ error: "Authentication failed" }));
          return;
        }
        //upon authentication add user_id to socket stream
        ws.data.user_id = user_id;
        ws.send(JSON.stringify({ action: "AUTHENTICATED" }));
        return;
      }

      //stop if action/type does not match
      if (
        (action !== "SUBSCRIBE" && action !== "UNSUBSCRIBE") ||
        (type !== "ACCOUNT" && !isPublicEventType(type))
      ) {
        ws.send(JSON.stringify({ error: "Invalid subscription" }));
        return;
      }

      const topics = subscriptions.get(ws);
      if (!topics) return;

      //subscribe or unsubscribe to user account socket stream
      if (type === "ACCOUNT") {
        if (!ws.data.user_id) {
          ws.send(
            JSON.stringify({
              error: "Authenticate before subscribing to ACCOUNT",
            })
          );
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

      //subscribe to market data
      const key = subscriptionKey(type, market_id);
      if (action === "SUBSCRIBE") {
        topics.add(key);
      } else {
        topics.delete(key);
      }
      ws.send(JSON.stringify({ action, type, market_id }));
    },
    close(ws, code, reason) {
      //delete the socket before ending the connection
      subscriptions.delete(ws);
      console.log(`Client disconnected: ${code} - ${reason}`);
    },
  },
});

//stream requested public data to saved connections whenever engine stream has new message
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

//stream requested user data to saved connections whenever engine stream has new message
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
