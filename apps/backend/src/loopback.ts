import type { RequestToEngine } from "commons/src";
import { createClient } from "redis";

const client = createClient();
const publisher = createClient();
await Promise.all([client.connect(), publisher.connect()]);

const loopbackResolve = new Map<string, (value: unknown) => void>();

export const loopback = async (request: RequestToEngine) => {
  try {
    const loopback_id = Math.random().toString();

    let fn_resolve!: (value: unknown) => void;
    const response = new Promise((res) => {
      fn_resolve = res;
    });

    loopbackResolve.set(loopback_id, fn_resolve);

    try {
      await client.xAdd("engine", "*", {
        request: JSON.stringify({ loopback_id, ...request }),
      });
    } catch (error) {
      loopbackResolve.get(loopback_id)?.({
        message: "Failed to process engine request",
        status: 0,
        data: null,
      });
      loopbackResolve.delete(loopback_id);
    }

    let timer: ReturnType<typeof setTimeout>;

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (loopbackResolve.get(loopback_id)) {
          loopbackResolve.delete(loopback_id);
          reject(new Error("Engine request timed out"));
        }
      }, 10000);
    });

    try {
      return await Promise.race([response, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  } catch (error) {
    console.log("looback: err: ", error);
    throw error;
  }
};

const main = async () => {
  try {
    await publisher.xGroupCreate("backend", "backend-group", "0", {
      MKSTREAM: true,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
      throw error;
    }
  }

  while (true) {
    const request = await publisher.xReadGroup(
      "backend-group",
      "backend-consumer-1",
      [{ key: "backend", id: ">" }],
      { BLOCK: 0, COUNT: 1 }
    );

    if (!request) {
      console.log("No request yet");
      continue;
    }
    for (const stream of request) {
      for (const message of stream.messages) {
        let { loopback_id, ...response} = JSON.parse(message.message.response);

        JSON.stringify(response.loopback_id);

        if (loopbackResolve.get(loopback_id)) {
          loopbackResolve.get(loopback_id)?.(response);
          loopbackResolve.delete(loopback_id);
        }
        await publisher.xAck("backend", "backend-group", message.id);
      }
    }
  }
};

main();
