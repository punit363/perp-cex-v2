import { createClient, type RedisClientType } from "redis";
import {
  EngineEventSchema,
  type EngineEventInput,
} from "commons/src/engine-event";
import type { EngineResponse } from "commons/src/index";
import { RequestToEngineSchema } from "./zod/z";
import type { EngineCommand, EngineCommandResult } from "./types";
import RUNTIME_CONFIG from "./config/runtime.config";
import { REDIS_CONSTANTS } from "./constants";

const compareStreamIds = (a: string, b: string): number => {
  const [aTime, aSequence] = a.split("-");
  const [bTime, bSequence] = b.split("-");
  const aMilliseconds = BigInt(aTime!);
  const bMilliseconds = BigInt(bTime!);
  if (aMilliseconds !== bMilliseconds) {
    return aMilliseconds < bMilliseconds ? -1 : 1;
  }
  const aCounter = BigInt(aSequence!);
  const bCounter = BigInt(bSequence!);
  return aCounter < bCounter ? -1 : aCounter > bCounter ? 1 : 0;
};

class RedisHandler {
  private client: RedisClientType;
  private publisher: RedisClientType;
  private eventGroupsInitialized = false;

  constructor() {
    this.publisher = createClient({ url: RUNTIME_CONFIG.redisUrl });
    this.client = createClient({ url: RUNTIME_CONFIG.redisUrl });
  }

  close = (): void => {
    this.client.destroy();
    this.publisher.destroy();
  };

  public connect = async (): Promise<void> => {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
    if (!this.publisher.isOpen) {
      await this.publisher.connect();
    }
    await this.createEventGroups();
  };

  private createEventGroups = async (): Promise<void> => {
    if (this.eventGroupsInitialized) return;

    for (const group of REDIS_CONSTANTS.EVENT_GROUPS) {
      try {
        await this.publisher.xGroupCreate(
          REDIS_CONSTANTS.EVENT_STREAM,
          group,
          REDIS_CONSTANTS.GROUP_START_ID,
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
    this.eventGroupsInitialized = true;
  };

  //stream engine events for ws and database
  public publishEngineEvent = async (
    event: EngineEventInput
  ): Promise<string> => {
    const payload = EngineEventSchema.parse(event);
    await this.connect();
    return this.publisher.xAdd(REDIS_CONSTANTS.EVENT_STREAM, "*", {
      event: JSON.stringify(payload),
    });
  };

  //return response to backend api request
  private sendBackendResponse = async (
    loopback_id: string,
    engine_response: EngineResponse
  ) => {
    await this.publisher.xAdd(REDIS_CONSTANTS.RESPONSE_STREAM, "*", {
      response: JSON.stringify({
        loopback_id,
        ...engine_response,
      }),
    });
  };

  //process request from backend
  public readEngineRequestStream = async (
    onRequest: (
      request: EngineCommand,
      replayTimestamp: number | undefined,
      sourceMessageId: string
    ) => EngineCommandResult,
    initialStreamId: string,
    onApplied: (streamId: string) => void,
    shouldResumeLiquidations: () => boolean
  ) => {
    await this.connect();
    let lastAppliedStreamId = initialStreamId;
    const applyMessage = async (
      message: { id: string; message: Record<string, string> },
      replay: boolean
    ) => {
      let raw_request: unknown;
      try {
        raw_request = JSON.parse(String(message.message.request));
      } catch {
        console.error(`Invalid engine request JSON at stream ID ${message.id}`);
        onApplied(message.id);
        lastAppliedStreamId = message.id;
        return;
      }
      if (
        typeof raw_request !== "object" ||
        raw_request === null ||
        Array.isArray(raw_request)
      ) {
        onApplied(message.id);
        lastAppliedStreamId = message.id;
        return;
      }

      const { loopback_id, ...request_to_engine } = raw_request as Record<
        string,
        unknown
      >;

      const parseResult = RequestToEngineSchema.safeParse(request_to_engine);

      if (!parseResult.success) {
        onApplied(message.id);
        lastAppliedStreamId = message.id;
        if (typeof loopback_id === "string") {
          const engine_response = {
            loopback_id,
            message: "Parsing Error: Incorrect data format",
            status: 0,
            data: null,
          };
          await this.sendBackendResponse(loopback_id, engine_response);
        }
        return;
      }

      const replayTimestamp = replay
        ? Number(message.id.split("-")[0])
        : undefined;
      if (replay && !Number.isSafeInteger(replayTimestamp)) {
        throw new Error(`Invalid engine stream timestamp at ${message.id}`);
      }
      const {
        response: engine_response,
        dbEvents,
        wsEvents,
      } = onRequest(parseResult.data, replayTimestamp, message.id);
      const occurred_at_ms = replayTimestamp ?? Date.now();
      for (const dbEvent of dbEvents) {
        await this.publishEngineEvent({
          source_message_id: message.id,
          occurred_at_ms,
          destination: "db",
          ...dbEvent,
        });
      }
      for (const wsEvent of wsEvents) {
        await this.publishEngineEvent({
          source_message_id: message.id,
          occurred_at_ms,
          destination: "ws",
          ...wsEvent,
        });
      }
      onApplied(message.id);
      lastAppliedStreamId = message.id;

      if (typeof loopback_id === "string") {
        await this.sendBackendResponse(loopback_id, engine_response);
      }
    };

    // A stateful engine must replay the retained stream itself, including entries
    // that an older consumer group acknowledged or left pending.
    const latest = await this.client.xRevRange(
      REDIS_CONSTANTS.REQUEST_STREAM,
      "+",
      "-",
      {
        COUNT: REDIS_CONSTANTS.LATEST_ENTRY_COUNT,
      }
    );
    const replayEndId = latest?.[0]?.id ?? REDIS_CONSTANTS.INITIAL_STREAM_ID;
    if (compareStreamIds(lastAppliedStreamId, replayEndId) > 0) {
      throw new Error(
        "Engine stream ends before the snapshot cursor; recovery is unsafe"
      );
    }

    while (compareStreamIds(lastAppliedStreamId, replayEndId) < 0) {
      const messages = await this.client.xRange(
        REDIS_CONSTANTS.REQUEST_STREAM,
        `(${lastAppliedStreamId}`,
        replayEndId,
        { COUNT: REDIS_CONSTANTS.REPLAY_BATCH_SIZE }
      );
      if (!messages?.length) {
        throw new Error(
          "Engine stream entries required for recovery are unavailable"
        );
      }
      for (const message of messages) {
        await applyMessage(message, true);
      }
    }

    if (shouldResumeLiquidations()) {
      await this.client.xAdd(REDIS_CONSTANTS.REQUEST_STREAM, "*", {
        request: JSON.stringify({ action: "RETRY_LIQUIDATIONS" }),
      });
    }

    while (true) {
      const request = await this.client.xRead(
        [{ key: REDIS_CONSTANTS.REQUEST_STREAM, id: lastAppliedStreamId }],
        { BLOCK: 0, COUNT: REDIS_CONSTANTS.LIVE_BATCH_SIZE }
      );
      if (!request) continue;
      for (const stream of request) {
        for (const message of stream.messages) {
          await applyMessage(message, false);
        }
      }
    }
  };
}

export default RedisHandler;
