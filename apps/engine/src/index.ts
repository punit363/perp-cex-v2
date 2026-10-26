import { createClient } from "redis";
import { RequestToEngineSchema, type EngineCommand } from "./zod/z";
import Engine from "./engine";

const engine = new Engine();

const client = createClient();
const publisher = createClient();
await Promise.all([client.connect(), publisher.connect()]);

try {
  await client.xGroupCreate("engine", "engine-group", "0", {
    MKSTREAM: true,
  });
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
    throw error;
  }
}

while (true) {
  const request = await client.xReadGroup(
    "engine-group",
    "engine-consumer-1",
    [{ key: "engine", id: ">" }],
    { BLOCK: 0, COUNT: 1 }
  );
  console.log("No request yet");
  if (!request) {
    console.log("No request yet");
    continue;
  }
  for (const stream of request) {
    for (const message of stream.messages) {
      const raw_request: unknown = JSON.parse(String(message.message.request));
      if (
        typeof raw_request !== "object" ||
        raw_request === null ||
        Array.isArray(raw_request)
      ) {
        console.error("Invalid request: expected a JSON object");
        await client.xAck("engine", "engine-group", message.id);
        continue;
      }

      const { loopback_id, ...request_to_engine } = raw_request as Record<
        string,
        unknown
      >;

      const parseResult = RequestToEngineSchema.safeParse(request_to_engine);

      if (!parseResult.success) {
        console.error("Invalid request:", parseResult.error);
        if (typeof loopback_id === "string") {
          await publisher.xAdd("backend", "*", {
            response: JSON.stringify({
              loopback_id,
              message: "Parsing Error: Incorrect data format",
              status: 0,
              data: null,
            }),
          });
        }
        await client.xAck("engine", "engine-group", message.id);
        continue;
      }

      const parsed_request: EngineCommand = parseResult.data;
      console.log("Engine received:", parsed_request);

      const engine_response = engine.processEngineOrder(parsed_request);

      if (typeof loopback_id === "string") {
        await publisher.xAdd("backend", "*", {
          response: JSON.stringify({
            loopback_id,
            ...engine_response,
          }),
        });
      }
      await client.xAck("engine", "engine-group", message.id);
    }
  }
}
