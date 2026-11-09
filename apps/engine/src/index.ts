import Engine from "./engine";
import RedisHandler from "./redis";
import { ENGINE_CONSTANTS } from "./config/constants";

// Restart after a failed connection or request reader.
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
        engine!.processEngineCommand(request, replayTimestamp, sourceMessageId), //start processing engine request
      engine.getLastAppliedStreamId(), //resume processing next request after the last processed request
      (streamId) => engine!.recordAppliedStreamId(streamId), //update the latest stream id
      () => engine!.hasActiveLiquidations() //check if any previous liquidations are pending
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

  console.error(
    `Retrying engine recovery in ${ENGINE_CONSTANTS.RETRY_DELAY_MS / 1000}s`
  );
  await new Promise((resolve) =>
    setTimeout(resolve, ENGINE_CONSTANTS.RETRY_DELAY_MS)
  );
}
