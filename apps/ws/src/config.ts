const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error("JWT_SECRET is required");

const CONFIG = {
  port: Number(process.env.WS_PORT || "7001"),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  jwtSecret,
};

export default CONFIG;
