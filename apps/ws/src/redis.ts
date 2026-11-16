import { createClient, type RedisClientType } from "redis";
import {
  EngineEventSchema,
  PrivateAccountEventSchema,
  type PrivateAccountEvent,
} from "commons/src/engine-event";
import type { WSEvent } from "./z";
import CONFIG from "./config";

const STREAM = "engine-events";
const GROUP = "websocket";
const CONSUMER = "ws-consumer-1";
const PRIVATE_STREAM = "private-events";
const PRIVATE_GROUP = "private-websocket";
const PRIVATE_CONSUMER = "private-ws-consumer-1";

class RedisHandler {
  private client: RedisClientType = createClient({ url: CONFIG.redisUrl });
  private privateClient: RedisClientType = createClient({
    url: CONFIG.redisUrl,
  });

  private async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
    if (!this.privateClient.isOpen) {
      await this.privateClient.connect();
    }
  }

  private async createPrivateGroup(): Promise<void> {
    try {
      await this.privateClient.xGroupCreate(
        PRIVATE_STREAM,
        PRIVATE_GROUP,
        "0",
        {
          MKSTREAM: true,
        }
      );
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
        throw error;
      }
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

  //read data from stream and call socket function to share market public data
  public async readEvents(
    onEvent: (event: WSEvent) => Promise<void>
  ): Promise<void> {
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
            throw new Error(
              `Invalid ${STREAM} entry ${message.id}: ${parsed.error.message}`
            );
          }

          if (parsed.data.destination === "ws") {
            await onEvent(parsed.data);
          }
          await this.client.xAck(STREAM, GROUP, message.id);
        }
      }
    }
  }

  //read data from stream and call socket function to share market private data
  public async readPrivateEvents(
    onEvent: (event: PrivateAccountEvent) => Promise<void>
  ): Promise<void> {
    await this.connect();
    await this.createPrivateGroup();

    while (true) {
      const streams = await this.privateClient.xReadGroup(
        PRIVATE_GROUP,
        PRIVATE_CONSUMER,
        [{ key: PRIVATE_STREAM, id: ">" }],
        { BLOCK: 0, COUNT: 1 }
      );
      if (!streams) continue;

      for (const stream of streams) {
        for (const message of stream.messages) {
          let payload: unknown;
          try {
            payload = JSON.parse(String(message.message.event));
          } catch (error) {
            throw new Error(
              `Invalid JSON in ${PRIVATE_STREAM} entry ${message.id}`,
              { cause: error }
            );
          }

          const parsed = PrivateAccountEventSchema.safeParse(payload);
          if (!parsed.success) {
            throw new Error(
              `Invalid ${PRIVATE_STREAM} entry ${message.id}: ${parsed.error.message}`
            );
          }
          await onEvent(parsed.data);
          await this.privateClient.xAck(
            PRIVATE_STREAM,
            PRIVATE_GROUP,
            message.id
          );
        }
      }
    }
  }
}

export default RedisHandler;
