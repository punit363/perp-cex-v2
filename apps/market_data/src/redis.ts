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
}

export default RedisHandler;
