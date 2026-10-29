import { createClient, type RedisClientType } from "redis";
import { EngineEventSchema, type EngineEventInput } from "commons/src/engine-event";
import type { EngineResponse } from "commons/src/index";
import { RequestToEngineSchema, type EngineCommand } from "./zod/z";

const EVENT_STREAM = "engine-events";
const EVENT_GROUPS = ["db-projector", "websocket"] as const;

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

  private async createEngineGroup() {
    try {
      await this.client.xGroupCreate("engine", "engine-group", "0", {
        MKSTREAM: true,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

  public async readEngineRequestStream(
    onRequest: (request: EngineCommand) => EngineResponse | Promise<EngineResponse>
  ) {
    await this.connect();
    await this.createEngineGroup();
    while (true) {
      const request = await this.client.xReadGroup(
        "engine-group",
        "engine-consumer-1",
        [{ key: "engine", id: ">" }],
        { BLOCK: 0, COUNT: 1 }
      );
      if (!request) {
        console.log("No request yet");
        continue;
      }
      for (const stream of request) {
        for (const message of stream.messages) {
          const raw_request: unknown = JSON.parse(
            String(message.message.request)
          );
          if (
            typeof raw_request !== "object" ||
            raw_request === null ||
            Array.isArray(raw_request)
          ) {
            await this.client.xAck("engine", "engine-group", message.id);
            continue;
          }

          const { loopback_id, ...request_to_engine } = raw_request as Record<
            string,
            unknown
          >;

          const parseResult =
            RequestToEngineSchema.safeParse(request_to_engine);

          if (!parseResult.success) {
            if (typeof loopback_id === "string") {
              const engine_response = {
                loopback_id,
                message: "Parsing Error: Incorrect data format",
                status: 0,
                data: null,
              };
              await this.sendBackendResponse(loopback_id, engine_response);
            }
            await this.client.xAck("engine", "engine-group", message.id);
            continue;
          }

          const parsed_request: EngineCommand = parseResult.data;

          const engine_response = await onRequest(parsed_request);

          if (typeof loopback_id === "string") {
            await this.sendBackendResponse(loopback_id, engine_response);
          }
          await this.client.xAck("engine", "engine-group", message.id);
        }
      }
    }
  }
}

export default RedisHandler;
