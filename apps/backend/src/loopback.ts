import type { RequestToEngine } from "commons/src";
import { createClient } from "redis";

const client = createClient();
client.connect();

export const loopback = async (message: RequestToEngine) => {
  try {
    return new Promise(async () => {
      const loopback_id = Math.random().toString();
      await client.xAdd("engine", "*", {
        data: JSON.stringify({ loopback_id, ...message }),
      });
    });
  } catch (error) {
    console.log("looback: err: ", error);
  }
};
