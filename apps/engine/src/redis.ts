import { createClient, type RedisClientType } from "redis";
import {
  EngineEventSchema,
  type EngineEventInput,
} from "commons/src/engine-event";
import type { EngineResponse } from "commons/src/index";
import { RequestToEngineSchema } from "./zod/z";
import type { EngineCommand, EngineCommandResult } from "./types";
import RUNTIME_CONFIG from "./config/runtime.config";
import { REDIS_CONSTANTS } from "./config/constants";

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
  private cleanupInProgress = false;
  private lastCleanupAt = 0;

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

  private trimAcknowledgedStream = async (
    stream: string,
    expectedGroups: readonly string[]
  ): Promise<void> => {
    if (!(await this.publisher.exists(stream))) return;
    const groups = await this.publisher.xInfoGroups(stream);
    if (!expectedGroups.every((name) => groups.some((group) => group.name === name)))
      return;

    let oldestNeededId: string | null = null;
    for (const group of groups) {
      let neededId = group["last-delivered-id"];
      if (group.pending > 0) {
        const pending = await this.publisher.xPending(stream, group.name);
        if (!pending.firstId) return;
        neededId = pending.firstId;
      }
      if (neededId === REDIS_CONSTANTS.INITIAL_STREAM_ID) return;
      if (oldestNeededId === null || compareStreamIds(neededId, oldestNeededId) < 0)
        oldestNeededId = neededId;
    }

    if (oldestNeededId !== null)
      await this.publisher.xTrim(stream, "MINID", oldestNeededId, {
        strategyModifier: "~",
        LIMIT: 100_000,
      });
  };

  public trimProcessedStreams = async (snapshotCursor: string): Promise<void> => {
    if (
      snapshotCursor === REDIS_CONSTANTS.INITIAL_STREAM_ID ||
      this.cleanupInProgress ||
      Date.now() - this.lastCleanupAt < 10_000
    ) return;

    this.cleanupInProgress = true;
    try {
      // The snapshot contains every command through this ID. Keep the cursor
      // itself so recovery can still verify and read the stream after it.
      await this.publisher.xTrim(REDIS_CONSTANTS.REQUEST_STREAM, "MINID", snapshotCursor, {
        strategyModifier: "~",
        LIMIT: 100_000,
      });
      await this.trimAcknowledgedStream(
        REDIS_CONSTANTS.EVENT_STREAM,
        REDIS_CONSTANTS.EVENT_GROUPS
      );
      await this.trimAcknowledgedStream("private-events", ["private-websocket"]);
      // Backend loopback responses expire after ten seconds and are never
      // replayed on restart. Retain a full minute for in-flight readers.
      await this.publisher.xTrim(
        REDIS_CONSTANTS.RESPONSE_STREAM,
        "MINID",
        `${Date.now() - 60_000}-0`,
        { strategyModifier: "~", LIMIT: 100_000 }
      );
      this.lastCleanupAt = Date.now();
    } finally {
      this.cleanupInProgress = false;
    }
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
    const markApplied = (streamId: string) => {
      onApplied(streamId);
      lastAppliedStreamId = streamId;
    };
    const applyMessage = async (
      message: { id: string; message: Record<string, string> },
      replay: boolean
    ) => {
      let raw_request: unknown;
      try {
        raw_request = JSON.parse(String(message.message.request));
      } catch {
        console.error(`Invalid engine request JSON at stream ID ${message.id}`);
        markApplied(message.id);
        return;
      }
      if (
        typeof raw_request !== "object" ||
        raw_request === null ||
        Array.isArray(raw_request)
      ) {
        markApplied(message.id);
        return;
      }

      const { loopback_id, ...request_to_engine } = raw_request as Record<
        string,
        unknown
      >;

      const parseResult = RequestToEngineSchema.safeParse(request_to_engine);

      if (!parseResult.success) {
        markApplied(message.id);
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
      markApplied(message.id);

      if (typeof loopback_id === "string") {
        await this.sendBackendResponse(loopback_id, engine_response);
      }
    };

    // Commands at or before this ID existed when recovery started.
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

    const resumeLiquidations = async () => {
      if (shouldResumeLiquidations()) {
        await this.client.xAdd(REDIS_CONSTANTS.REQUEST_STREAM, "*", {
          request: JSON.stringify({ action: "RETRY_LIQUIDATIONS" }),
        });
      }
    };
    let replaying = compareStreamIds(lastAppliedStreamId, replayEndId) < 0;
    if (!replaying) await resumeLiquidations();

    while (true) {
      const request = await this.client.xRead(
        [{ key: REDIS_CONSTANTS.REQUEST_STREAM, id: lastAppliedStreamId }],
        {
          BLOCK: replaying ? 5_000 : 0,
          COUNT: REDIS_CONSTANTS.READ_BATCH_SIZE,
        }
      );
      if (!request) {
        if (replaying) {
          throw new Error(
            "Engine stream entries required for recovery are unavailable"
          );
        }
        continue;
      }
      for (const stream of request) {
        for (const message of stream.messages) {
          if (replaying && compareStreamIds(message.id, replayEndId) > 0) {
            throw new Error(
              "Engine stream entries required for recovery are unavailable"
            );
          }
          await applyMessage(message, replaying);
          if (replaying && message.id === replayEndId) {
            replaying = false;
            await resumeLiquidations();
          }
        }
      }
    }
  };
}

export default RedisHandler;
