CREATE TABLE `entity_asset_batch_chunks` (
 `version` text NOT NULL,
 `plan_sha256` text NOT NULL,
 `chunk_index` integer NOT NULL,
 `chunk_sha256` text NOT NULL,
 `file_count` integer NOT NULL,
 `payload_bytes` integer NOT NULL,
 PRIMARY KEY (`version`, `plan_sha256`, `chunk_index`)
);
