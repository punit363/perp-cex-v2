// Integration tests create accounts, markets, and simulated trades. Require an
// explicit disposable environment so they cannot run against a real database.
export const BACKEND_URL = process.env.E2E_BASE_URL;
export const REDIS_URL = process.env.E2E_REDIS_URL;
export const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN;
export const E2E_ENABLED = process.env.E2E_ALLOW_MUTATIONS === "1" &&
  Boolean(BACKEND_URL && REDIS_URL && ADMIN_TOKEN);
