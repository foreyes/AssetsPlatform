import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const entityAssetVersions = sqliteTable("entity_asset_versions", {
  version: text("version").primaryKey().notNull(),
  manifestSHA256: text("manifest_sha256").notNull(),
  fileCount: integer("file_count").notNull(),
  payloadBytes: integer("payload_bytes").notNull(),
});
