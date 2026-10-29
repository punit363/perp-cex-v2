import { createClient, type RedisClientType } from "redis";
import { RequestToEngineSchema, type EngineCommand } from "./zod/z";

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

  private async sendBackendResponse(loopback_id: string, engine_response: any) {
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

  public async readEngineRequestStream(engine: {
    processEngineOrder: (command: EngineCommand) => any;
  }) {
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

          const engine_response = engine.processEngineOrder(parsed_request);

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
