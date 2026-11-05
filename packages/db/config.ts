import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// Explicit environment variables take precedence over this local development file.
loadEnv({ path: fileURLToPath(new URL("./.env", import.meta.url)), quiet: true });

export const DATABASE_CONFIG = {
  url: process.env.DATABASE_URL,
};

export function requireDatabaseUrl(): string {
  if (!DATABASE_CONFIG.url) {
    throw new Error("DATABASE_URL is required; set it in the environment or packages/db/.env");
  }
  return DATABASE_CONFIG.url;
}
