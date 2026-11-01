import { createClient, type RedisClientType } from "redis";
import { EngineEventSchema } from "commons/src/engine-event";
import type { DBEvent } from "./z";

const STREAM = "engine-events";
const GROUP = "db-projector";
const CONSUMER = "db-consumer-1";

class RedisHandler {
  private client: RedisClientType = createClient();
  private publisher: RedisClientType = createClient();

  public async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
    if (!this.publisher.isOpen) {
      await this.publisher.connect();
    }
  }

  public async publishCandle(candle: {
    source_message_id: string;
    market_id: string;
    start_ms: number;
    open: string;
    high: string;
    low: string;
    close: string;
    base_volume: string;
    quote_volume: string;
    trade_count: number;
  }): Promise<void> {
    const { source_message_id, ...data } = candle;
    const payload = EngineEventSchema.parse({
      source_message_id,
      occurred_at_ms: Date.now(),
      destination: "ws",
      event_type: "CANDLE",
      data,
    });
    await this.publisher.xAdd(STREAM, "*", { event: JSON.stringify(payload) });
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

    // Reprocess this consumer's unacknowledged event after a restart. Fill and
    // candle writes are idempotent, so a crash between persistence and publish
    // can safely retry the event and send the current candle to WebSocket clients.
    let drainingPending = true;
    while (true) {
      const streams = await this.client.xReadGroup(
        GROUP,
        CONSUMER,
        [{ key: STREAM, id: drainingPending ? "0" : ">" }],
        drainingPending ? { COUNT: 1 } : { BLOCK: 0, COUNT: 1 }
      );
      if (!streams?.some((stream) => stream.messages.length)) {
        if (drainingPending) drainingPending = false;
        continue;
      }

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
