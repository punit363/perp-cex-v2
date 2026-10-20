import express from "express";
import router from "./routes/auth.route";
import CONFIG from "./config";
import cors from "cors";
import apiRouter from "./routes";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const PORT = Number(CONFIG.port || 8000);

app.use("/api/v1",apiRouter);

app.listen(PORT, (error?: Error) => {
  if (error) {
    console.error(`Failed to listen on port ${PORT}:`, error.message);
    process.exitCode = 1;
    return;
  }

  console.log("Listening on port", PORT);
});
