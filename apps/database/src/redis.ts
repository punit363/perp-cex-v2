import { createClient, type RedisClientType } from "redis";
import { EngineEventSchema } from "commons/src/engine-event";
import type { DBEvent } from "./z";

const STREAM = "engine-events";
const GROUP = "db-projector";
const CONSUMER = "db-consumer-1";

class RedisHandler {
  private client: RedisClientType = createClient();

  public async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  private async createGroup(): Promise<void> {
    try {
      await this.client.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

  public async readEvents(onEvent: (event: DBEvent) => Promise<void>): Promise<void> {
    await this.connect();
    await this.createGroup();

    while (true) {
      const streams = await this.client.xReadGroup(
        GROUP,
        CONSUMER,
        [{ key: STREAM, id: ">" }],
        { BLOCK: 0, COUNT: 1 }
      );
      if (!streams) continue;

      for (const stream of streams) {
        for (const message of stream.messages) {
          let payload: unknown;
          try {
            payload = JSON.parse(String(message.message.event));
          } catch (error) {
            throw new Error(`Invalid JSON in ${STREAM} entry ${message.id}`, {
              cause: error,
            });
          }

          const parsed = EngineEventSchema.safeParse(payload);
          if (!parsed.success) {
            throw new Error(`Invalid ${STREAM} entry ${message.id}: ${parsed.error.message}`);
          }

          if (parsed.data.destination === "db") {
            await onEvent(parsed.data);
          }
          await this.client.xAck(STREAM, GROUP, message.id);
        }
      }
    }
  }
}

export default RedisHandler;
