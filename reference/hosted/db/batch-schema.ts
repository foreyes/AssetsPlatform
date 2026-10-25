import {sqliteTable,text,integer,primaryKey} from "drizzle-orm/sqlite-core";
// Immutable readback receipts; existing pilot schema stays byte-identical.
export const entityAssetBatchChunks=sqliteTable("entity_asset_batch_chunks",{
 version:text("version").notNull(),planSHA256:text("plan_sha256").notNull(),chunkIndex:integer("chunk_index").notNull(),chunkSHA256:text("chunk_sha256").notNull(),fileCount:integer("file_count").notNull(),payloadBytes:integer("payload_bytes").notNull(),
},table=>[primaryKey({columns:[table.version,table.planSHA256,table.chunkIndex]})]);
