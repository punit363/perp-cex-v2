import { createClient } from "redis";
import { RequestToEngineSchema, type EngineCommand } from "./zod/z";
import type { RequestToEngine } from "commons/src";
import process_engine_order from "./engine";

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
      const { loopback_id, ...request_to_engine } = JSON.parse(
        String(message.message.request)
      );

      const parseResult = RequestToEngineSchema.safeParse(request_to_engine);

      if (!parseResult.success) {
        console.error("Invalid request:", parseResult.error);
        await publisher.xAdd("backend", "*", {
          response: JSON.stringify({
            loopback_id,
            message: "Parsing Error: Incorrect data format",
            status: 0,
            data: null,
          }),
        });
        await client.xAck("engine", "engine-group", message.id);
        continue;
      }

      const parsed_request: EngineCommand = parseResult.data;
      console.log("Engine received:", parsed_request);

      const engine_response = process_engine_order(parsed_request);

      await publisher.xAdd("backend", "*", {
        response: JSON.stringify({
          loopback_id,
          ...engine_response,
        }),
      });
      await client.xAck("engine", "engine-group", message.id);
    }
  }
}
