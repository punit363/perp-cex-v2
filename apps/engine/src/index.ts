import Engine from "./engine";
import RedisHandler from "./redis";

let retryDelayMs = 1000;

while (true) {
  let engine: Engine | undefined;
  let redis: RedisHandler | undefined;

  try {
    engine = await Engine.create();
    redis = new RedisHandler();
    await redis.connect();
    console.info("Engine connected; recovering request stream");
    await redis.readEngineRequestStream(
      (request, replayTimestamp, sourceMessageId) =>
        engine!.processEngineCommand(request, replayTimestamp, sourceMessageId),
      engine.getLastAppliedStreamId(),
      (streamId) => engine!.recordAppliedStreamId(streamId),
      () => engine!.hasActiveLiquidations(),
    );
    throw new Error("Engine request reader stopped unexpectedly");
  } catch (error) {
    const message = error instanceof Error
      ? error.message.trim().split("\n").at(-1) || error.name
      : String(error);
    console.error(`Engine unavailable: ${message}`);
  } finally {
    engine?.stopSnapshot();
    redis?.close();
  }

  console.error(`Retrying engine recovery in ${retryDelayMs / 1000}s`);
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  retryDelayMs = Math.min(retryDelayMs * 2, 10000);
}
