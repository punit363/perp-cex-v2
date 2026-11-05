import type { Config } from "./config";

type Envelope<T> = { status?: string; message?: string; data?: T };
type EngineResult<T> = { status?: number; message?: string; data?: T };

export type BotUser = { username: string; token: string };
export type Market = {
  market_id: string;
  slug: string;
  mark_price: string | null;
  last_traded_price: string | null;
  trading_halted?: boolean;
};
export type OrderSide = "BUY" | "SELL";
export type Depth = { asks: { price: string; quantity: string }[]; bids: { price: string; quantity: string }[] };
export type PlacedOrder = {
  order_id: string;
  status: string;
  filled?: string;
};

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

export class ExchangeApi {
  constructor(private config: Config) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new Error(`${init.method || "GET"} ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const payload = await response.json().catch(() => null) as Envelope<T> | null;
    if (!response.ok || payload?.status === "FAILURE") {
      throw new ApiError(response.status, payload?.message || `${response.status} ${response.statusText}`);
    }
    if (!payload || payload.data === undefined || payload.data === null) {
      throw new Error(`Invalid exchange response from ${path}`);
    }
    return payload.data;
  }

  private async signIn(username: string): Promise<string> {
    const data = await this.request<{ token: string }>("/auth/signin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: this.config.password }),
    });
    if (!data.token) throw new Error(`No token returned for ${username}`);
    return data.token;
  }

  async connectUser(username: string): Promise<BotUser> {
    try {
      await this.request<{ username: string }>("/auth/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: this.config.password }),
      });
      console.log(`Created demo user ${username}`);
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 400 || !/exist/i.test(error.message)) throw error;
    }
    return { username, token: await this.signIn(username) };
  }

  private async asUser<T>(user: BotUser, path: string, init: RequestInit = {}): Promise<T> {
    const request = () => this.request<T>(path, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), token: user.token },
    });
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof ApiError) || ![401, 403].includes(error.statusCode)) throw error;
      user.token = await this.signIn(user.username);
      return request();
    }
  }

  listMarkets(): Promise<{ markets: Market[] }> {
    return this.request("/market");
  }

  async depth(marketId: string): Promise<Depth> {
    const data = await this.request<{ engine_response: EngineResult<Depth> }>(`/market/depth/${encodeURIComponent(marketId)}`);
    if (!data.engine_response?.status || !data.engine_response.data) {
      throw new Error(data.engine_response?.message || `Depth unavailable for ${marketId}`);
    }
    return data.engine_response.data;
  }

  async balance(user: BotUser): Promise<{ available: string; reserved: string }> {
    const data = await this.asUser<{ engine_response: EngineResult<{ available: string; reserved: string }> }>(user, "/user/balance");
    if (!data.engine_response?.status || !data.engine_response.data) {
      throw new Error(data.engine_response?.message || `Balance unavailable for ${user.username}`);
    }
    return data.engine_response.data;
  }

  async topUp(user: BotUser, amount: string): Promise<void> {
    const data = await this.asUser<{ engine_response: EngineResult<unknown> }>(user, "/user/onramp", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }),
    });
    if (!data.engine_response?.status) throw new Error(data.engine_response?.message || `Top-up failed for ${user.username}`);
  }

  async openOrders(user: BotUser, marketId: string): Promise<PlacedOrder[]> {
    const query = new URLSearchParams({ market_id: marketId, view: "open" });
    const data = await this.asUser<{ orders: PlacedOrder[] }>(user, `/order?${query}`);
    if (!Array.isArray(data.orders)) throw new Error(`Invalid open orders for ${user.username}`);
    return data.orders;
  }

  async place(user: BotUser, order: {
    market_id: string; price: string; quantity: string; side: OrderSide; leverage: string;
  }): Promise<PlacedOrder> {
    const data = await this.asUser<{ engine_response: EngineResult<{ order: PlacedOrder }> }>(user, "/order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...order, type: "LIMIT" }),
    });
    const placed = data.engine_response?.data?.order;
    if (!data.engine_response?.status || !placed?.order_id || !placed.status) {
      throw new Error(data.engine_response?.message || `Invalid placement response for ${user.username}`);
    }
    return placed;
  }

  async cancel(user: BotUser, marketId: string, orderId: string): Promise<void> {
    const data = await this.asUser<{ engine_response: EngineResult<unknown> }>(user, "/order", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market_id: marketId, order_id: orderId }),
    });
    if (!data.engine_response?.status) throw new Error(data.engine_response?.message || `Cancellation failed for ${orderId}`);
  }
}
