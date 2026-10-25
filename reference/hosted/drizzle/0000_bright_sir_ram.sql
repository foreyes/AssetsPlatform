CREATE TABLE `entity_asset_versions` (
	`version` text PRIMARY KEY NOT NULL,
	`manifest_sha256` text NOT NULL,
	`file_count` integer NOT NULL,
	`payload_bytes` integer NOT NULL
);
