import { createClient, type RedisClientType } from "redis";

class RedisHandler {
  private client: RedisClientType;
  private publisher: RedisClientType;

  constructor() {
    this.publisher = createClient();
    this.client = createClient();
  }

  public async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
    if (!this.publisher.isOpen) {
      await this.publisher.connect();
    }
  }

  private async createEngineGroup() {
    try {
      await this.client.xGroupCreate("engine-events", "db-projector", "0", {
        MKSTREAM: true,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

}

export default RedisHandler;
