import Engine from "./engine";
import RedisHandler from "./redis";

const engine = await Engine.create();
const redis = new RedisHandler();

await redis.readEngineRequestStream(
  (request, replayTimestamp) => engine.processEngineOrder(request, replayTimestamp),
  engine.getLastAppliedStreamId(),
  (streamId) => engine.recordAppliedStreamId(streamId)
);
