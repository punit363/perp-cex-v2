import { createClient, type RedisClientType } from "redis";
import type { MarkPriceUpdate } from "./type";

class RedisHandler {
  private publisher: RedisClientType;

  constructor() {
    this.publisher = createClient();
  }

  public async connect(): Promise<void> {
    if (!this.publisher.isOpen) {
      await this.publisher.connect();
    }
  }

  public async sendMarkPriceToEngine(market_data: MarkPriceUpdate) {
    await this.publisher.xAdd("engine", "*", {
      request: JSON.stringify(market_data),
    });
  }

  public async sendFundingSettlement(market_id: string, interval_end_ms: number) {
    await this.publisher.xAdd("engine", "*", {
      request: JSON.stringify({ action: "SETTLE_FUNDING", market_id, interval_end_ms }),
    });
  }
}

export default RedisHandler;
