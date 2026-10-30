import { createClient, type RedisClientType } from "redis";
import { EngineEventSchema, type EngineEventInput } from "commons/src/engine-event";
import type { EngineResponse } from "commons/src/index";
import { RequestToEngineSchema, type EngineCommand } from "./zod/z";

const EVENT_STREAM = "engine-events";
const EVENT_GROUPS = ["db-projector", "websocket"] as const;

function compareStreamIds(a: string, b: string): number {
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
}

class RedisHandler {
  private client: RedisClientType;
  private publisher: RedisClientType;
  private eventGroupsInitialized = false;

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
    await this.createEventGroups();
  }

  private async createEventGroups(): Promise<void> {
    if (this.eventGroupsInitialized) return;

    for (const group of EVENT_GROUPS) {
      try {
        await this.publisher.xGroupCreate(EVENT_STREAM, group, "0", {
          MKSTREAM: true,
        });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
          throw error;
        }
      }
    }
    this.eventGroupsInitialized = true;
  }

  public async publishEngineEvent(event: EngineEventInput): Promise<string> {
    const payload = EngineEventSchema.parse(event);
    await this.connect();
    return this.publisher.xAdd(EVENT_STREAM, "*", {
      event: JSON.stringify(payload),
    });
  }

  private async sendBackendResponse(
    loopback_id: string,
    engine_response: EngineResponse
  ) {
    await this.publisher.xAdd("backend", "*", {
      response: JSON.stringify({
        loopback_id,
        ...engine_response,
      }),
    });
  }

  public async readEngineRequestStream(
    onRequest: (request: EngineCommand, replayTimestamp?: number) => EngineResponse,
    initialStreamId: string,
    onApplied: (streamId: string) => void
  ) {
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
      const engine_response = onRequest(parseResult.data, replayTimestamp);
      onApplied(message.id);
      lastAppliedStreamId = message.id;

      if (typeof loopback_id === "string") {
        await this.sendBackendResponse(loopback_id, engine_response);
      }
    };

    // A stateful engine must replay the retained stream itself, including entries
    // that an older consumer group acknowledged or left pending.
    const latest = await this.client.xRevRange("engine", "+", "-", { COUNT: 1 });
    const replayEndId = latest?.[0]?.id ?? "0-0";
    if (compareStreamIds(lastAppliedStreamId, replayEndId) > 0) {
      throw new Error("Engine stream ends before the snapshot cursor; recovery is unsafe");
    }

    while (compareStreamIds(lastAppliedStreamId, replayEndId) < 0) {
      const messages = await this.client.xRange(
        "engine",
        `(${lastAppliedStreamId}`,
        replayEndId,
        { COUNT: 100 }
      );
      if (!messages?.length) {
        throw new Error("Engine stream entries required for recovery are unavailable");
      }
      for (const message of messages) {
        await applyMessage(message, true);
      }
    }

    while (true) {
      const request = await this.client.xRead(
        [{ key: "engine", id: lastAppliedStreamId }],
        { BLOCK: 0, COUNT: 1 }
      );
      if (!request) continue;
      for (const stream of request) {
        for (const message of stream.messages) {
          await applyMessage(message, false);
        }
      }
    }
  }
}

export default RedisHandler;
