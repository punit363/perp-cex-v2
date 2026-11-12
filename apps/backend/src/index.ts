import express from "express";
import CONFIG from "./config";
import cors from "cors";
import apiRouter from "./routes";
import { demoRateLimit } from "./middleware/demo-rate-limit";

const app = express();
// Caddy is the sole public entry point and replaces client-supplied forwarded headers.
app.set("trust proxy", 1);//trust 1 proxy hop (client->loadb.) , 2 inlcudes cdn
app.use("/api/v1", demoRateLimit(600, 60_000, (request) => request.ip || "unknown"));
app.use(cors({ origin: CONFIG.cors_origins }));
app.use(express.json({ limit: "16kb" }));

const PORT = CONFIG.port;

app.use("/api/v1",apiRouter);

app.listen(PORT, (error?: Error) => {
  if (error) {
    console.error(`Failed to listen on port ${PORT}:`, error.message);
    process.exitCode = 1;
    return;
  }

  console.log("Listening on port", PORT);
});
