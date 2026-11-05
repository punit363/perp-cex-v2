import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { requireDatabaseUrl } from "./config";

const adapter = new PrismaPg({
  connectionString: requireDatabaseUrl(),
});

export const prisma = new PrismaClient({ adapter });
