// import dotenv from "dotenv";
// import path, { dirname } from "path";
// import { fileURLToPath } from "url";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const CONFIG = {
  port:process.env.API_PORT,
  db_url: process.env.DB_URL,
  jwt_secret_key:process.env.JWT_SECRET ||"secret"
};

export default CONFIG;
