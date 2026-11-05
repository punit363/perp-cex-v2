import { defineConfig } from "prisma/config";
import { DATABASE_CONFIG } from "./config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: DATABASE_CONFIG.url,
  },
});
