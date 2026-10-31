import Engine from "./engine";
import RedisHandler from "./redis";

const engine = await Engine.create();
const redis = new RedisHandler();

await redis.readEngineRequestStream(
  (request, replayTimestamp, sourceMessageId) =>
    engine.processEngineCommand(request, replayTimestamp, sourceMessageId),
  engine.getLastAppliedStreamId(),
  (streamId) => engine.recordAppliedStreamId(streamId)
);
