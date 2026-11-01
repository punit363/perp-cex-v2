import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// The DB package is imported from several apps, each with its own working directory.
// Explicit environment variables still take precedence over the package's local file.
config({ path: fileURLToPath(new URL("./.env", import.meta.url)), quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing; set it in packages/db/.env or the environment");
}

const adapter = new PrismaPg({
  connectionString,
});

export const prisma = new PrismaClient({ adapter });
