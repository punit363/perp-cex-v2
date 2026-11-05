import { createClient, type RedisClientType } from "redis";
import type { MarkPriceUpdate } from "./type";
import CONFIG from "./config";

class RedisHandler {
  private publisher: RedisClientType;

  constructor() {
    this.publisher = createClient({ url: CONFIG.redisUrl });
  }

  public connect = async (): Promise<void> => {
    if (!this.publisher.isOpen) {
      await this.publisher.connect();
    }
  };

  //stream markprice to engine
  public sendMarkPriceToEngine = async (market_data: MarkPriceUpdate): Promise<void> => {
    await this.publisher.xAdd(CONFIG.engineStream, "*", {
      request: JSON.stringify(market_data),
    });
  };

  //stream funding settlement to engine
  public sendFundingSettlement = async (
    market_id: string,
    interval_end_ms: number
  ): Promise<void> => {
    await this.publisher.xAdd(CONFIG.engineStream, "*", {
      request: JSON.stringify({
        action: "SETTLE_FUNDING",
        market_id,
        interval_end_ms,
      }),
    });
  };
}

export default RedisHandler;
