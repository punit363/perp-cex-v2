import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ADMIN_TOKEN, BACKEND_URL, E2E_ENABLED, REDIS_URL } from "./config";

const integration = E2E_ENABLED ? describe : describe.skip;

integration("exchange API integration", () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const maker = `maker_${suffix}`;
  const taker = `taker_${suffix}`;
  const password = "e2e-test-password";
  let makerToken = "";
  let takerToken = "";
  let marketId = "";
  let redis: Bun.RedisClient;
  let sequence = 0;

  async function request(path: string, method = "GET", body?: unknown, token?: string) {
    const response = await fetch(`${BACKEND_URL}/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }

  async function mark() {
    await redis.send("XADD", ["engine", "*", "request", JSON.stringify({
      action: "MARK_PRICE_UPDATE", market_id: marketId, mark_price: "100",
      source_timestamp: Date.now(), producer_id: `test-${suffix}`, sequence: String(++sequence),
    })]);
    // Commands on the same stream are processed in order.
  }

  async function place(token: string, side: "BUY" | "SELL", quantity: string) {
    return request("/order", "POST", { market_id: marketId, side, quantity, price: "100", leverage: "10", type: "LIMIT" }, token);
  }

  beforeAll(async () => {
    redis = new Bun.RedisClient(REDIS_URL!);
    await redis.connect();
    const created = await request("/admin/market", "POST", { market: `E2E${suffix}-USDT` }, ADMIN_TOKEN);
    expect(created.status).toBe(200);
    marketId = created.body.data.market_id;
    for (const username of [maker, taker]) {
      expect((await request("/auth/signup", "POST", { username, password })).status).toBe(200);
      const login = await request("/auth/signin", "POST", { username, password });
      expect(login.status).toBe(200);
      const token = login.body.data.token as string;
      if (username === maker) makerToken = token;
      else takerToken = token;
      expect((await request("/user/onramp", "POST", { amount: "1000" }, token)).status).toBe(200);
    }
    await mark();
  }, 20000);

  afterAll(() => redis?.close());

  it("enforces unique usernames during concurrent registration", async () => {
    const username = `race_${suffix}`;
    const responses = await Promise.all(Array.from({ length: 5 }, () => request("/auth/signup", "POST", { username, password })));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(4);
  });

  it("registers a market once when administrators retry concurrently", async () => {
    const market = `RETRY${suffix}-USDT`;
    const responses = await Promise.all(Array.from({ length: 5 }, () =>
      request("/admin/market", "POST", { market }, ADMIN_TOKEN)));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const ids = new Set(responses.map((response) => response.body.data.market_id));
    expect(ids.size).toBe(1);
    expect((await request(`/market/depth/${responses[0]!.body.data.market_id}`)).status).toBe(200);
  });

  it("rejects invalid credentials and unauthenticated access", async () => {
    expect((await request("/auth/signin", "POST", { username: maker, password: "wrong" })).status).toBe(403);
    expect((await request("/user/balance")).status).toBe(401);
  });

  it("rejects invalid collateral with a failure response", async () => {
    const result = await request("/user/onramp", "POST", { amount: "-1" }, makerToken);
    expect(result.status).toBe(400);
    expect(result.body.status).toBe("FAILURE");
  });

  it("allows self-trades, matches another user, and cancels the remainder", async () => {
    await mark();
    const ask = await place(makerToken, "SELL", "3");
    expect(ask.status).toBe(200);
    const orderId = ask.body.data.engine_response.data.order.order_id;
    const self = await place(makerToken, "BUY", "1");
    expect(self.status).toBe(200);
    expect(self.body.data.engine_response.data.order.filled).toBe("1");
    const matched = await place(takerToken, "BUY", "1");
    expect(matched.status).toBe(200);
    expect(matched.body.data.engine_response.data.order.filled).toBe("1");
    const cancel = await request("/order", "DELETE", { market_id: marketId, order_id: orderId }, makerToken);
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.engine_response.data.rem_qty).toBe("1");
  });
});
