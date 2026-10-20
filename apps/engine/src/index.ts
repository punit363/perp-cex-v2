import { createClient } from "redis";

const client = createClient();
client.connect();

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
    continue
  }
  for (const stream of request) {
    for (const message of stream.messages) {
      const request = JSON.parse(String(message.message.data));

      console.log("Engine received:", request);

      await client.xAck("engine", "engine-group", message.id);
    }
  }
}
