function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveDecimal(name: string, fallback: string): bigint {
  const value = process.env[name] || fallback;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`${name} must be a positive decimal with at most 8 fractional digits`);
  }
  const [whole, fraction = ""] = value.split(".");
  const scaled = BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
  if (scaled <= 0n) throw new Error(`${name} must be greater than zero`);
  return scaled;
}

const CONFIG = {
  port: Number(process.env.API_PORT || "8000"),
  redis_url: process.env.REDIS_URL || "redis://localhost:6379",
  jwt_secret_key: requireSecret("JWT_SECRET"),
  admin_token: process.env.ADMIN_TOKEN || null,
  demo_max_top_up: positiveDecimal("DEMO_MAX_TOP_UP", "10000"),
  cors_origins: (process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export default CONFIG;
