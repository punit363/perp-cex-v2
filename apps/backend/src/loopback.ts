import type { RequestToEngine } from "commons/src";
import { createClient } from "redis";

const client = createClient();
const publisher = createClient();
await Promise.all([client.connect(), publisher.connect()]);

const loopbackResolve = new Map<string, (value: unknown) => void>();
let responseReaderReady!: () => void;
const readerReady = new Promise<void>((resolve) => {
  responseReaderReady = resolve;
});

export const loopback = async (request: RequestToEngine) => {
  try {
    await readerReady;
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
  // Each backend process needs every response because pending callbacks are local
  // to that process. A shared consumer group would send each response to only one.
  let lastResponseId: string | undefined;
  while (true) {
    try {
      if (lastResponseId === undefined) {
        const latest = await publisher.xRevRange("backend", "+", "-", { COUNT: 1 });
        lastResponseId = latest?.[0]?.id ?? "0-0";
        responseReaderReady();
      }
      const streams = await publisher.xRead(
        [{ key: "backend", id: lastResponseId }],
        { BLOCK: 0, COUNT: 100 }
      );
      if (!streams) continue;

      for (const stream of streams) {
        for (const message of stream.messages) {
          lastResponseId = message.id;
          try {
            const { loopback_id, ...response } = JSON.parse(String(message.message.response));
            const resolve = loopbackResolve.get(loopback_id);
            if (resolve) {
              resolve(response);
              loopbackResolve.delete(loopback_id);
            }
          } catch (error) {
            console.error(`Invalid backend response at ${message.id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("Backend response reader failed:", error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

void main().catch((error) => console.error("Backend response reader stopped:", error));
