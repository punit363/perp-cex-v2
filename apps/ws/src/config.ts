const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error("JWT_SECRET is required");

const siteAddress = process.env.SITE_ADDRESS || ":80";
const defaultOrigins = siteAddress === ":80"
  ? ["http://localhost", "http://127.0.0.1", "http://localhost:3000", "http://127.0.0.1:3000"]
  : [`https://${siteAddress}`];

const CONFIG = {
  port: Number(process.env.WS_PORT || "7001"),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  jwtSecret,
  allowHttpSameHost: siteAddress === ":80",
  allowedOrigins: new Set((process.env.WS_ALLOWED_ORIGINS || defaultOrigins.join(","))
    .split(",").map((origin) => origin.trim()).filter(Boolean)),
  maxConnectionsPerIp: 20,
  maxTopicsPerSocket: 80,
  maxMessagesPerWindow: 120,
  messageWindowMs: 60_000,
  maxPayloadLength: 4_096,
};

export default CONFIG;
