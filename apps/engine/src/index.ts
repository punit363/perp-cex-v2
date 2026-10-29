import Engine from "./engine";
import RedisHandler from "./redis";

const engine = new Engine();
const redis = new RedisHandler();

await redis.readEngineRequestStream(engine);
