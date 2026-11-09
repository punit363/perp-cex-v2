import { fileURLToPath } from "node:url";
import { RUNTIME_DEFAULTS } from "./constants";

const RUNTIME_CONFIG = {
  redisUrl: process.env.REDIS_URL || RUNTIME_DEFAULTS.REDIS_URL,
  snapshotPath:
    process.env.ENGINE_SNAPSHOT_PATH ||
    fileURLToPath(
      new URL(`../../${RUNTIME_DEFAULTS.SNAPSHOT_FILENAME}`, import.meta.url)
    ),
};

export default RUNTIME_CONFIG;
