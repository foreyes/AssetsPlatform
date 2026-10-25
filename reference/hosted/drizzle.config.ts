import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: ["./db/schema.ts", "./db/batch-schema.ts", "./db/incremental-schema.ts"],
  dialect: "sqlite",
});
