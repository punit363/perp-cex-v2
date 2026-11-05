import Engine from "./engine";
import RedisHandler from "./redis";
import { ENGINE_CONSTANTS } from "./constants";

let retryDelayMs: number = ENGINE_CONSTANTS.RETRY_INITIAL_DELAY_MS;

//This loop is to restart engine at defined interval
while (true) {
  let engine: Engine | undefined;
  let redis: RedisHandler | undefined;

  try {
    engine = await Engine.create();
    redis = new RedisHandler();
    await redis.connect();
    console.info("Engine connected; recovering request stream");
    //start reading engine request stream
    await redis.readEngineRequestStream(
      (request, replayTimestamp, sourceMessageId) =>
        engine!.processEngineCommand(request, replayTimestamp, sourceMessageId),//start processing engine request
      engine.getLastAppliedStreamId(),//resume processing next request after the last processed request
      (streamId) => engine!.recordAppliedStreamId(streamId),//update the latest stream id
      () => engine!.hasActiveLiquidations()//check if any previous liquidations are pending
    );
    throw new Error("Engine request reader stopped unexpectedly");
  } catch (error) {
    const message =
      error instanceof Error ? error.message || error.name : String(error);
    console.error(`Engine unavailable: ${message}`);
  } finally {
    engine?.stopSnapshot(); //stop taking snapshots
    redis?.close(); //close any redis connections
  }

  //delay before attempting restart
  console.error(`Retrying engine recovery in ${retryDelayMs / 1000}s`);
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  retryDelayMs = Math.min(
    retryDelayMs * 2,
    ENGINE_CONSTANTS.RETRY_MAX_DELAY_MS
  );
}
