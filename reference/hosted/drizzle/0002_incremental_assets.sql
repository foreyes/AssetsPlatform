-- Schema only. Existing 0001 already owns entity_asset_batch_chunks.
CREATE TABLE `ingest_active` (
	`project` text NOT NULL,
	`dataset` text NOT NULL,
	`version` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`project`, `dataset`)
);
--> statement-breakpoint
CREATE TABLE `ingest_files` (
	`project` text NOT NULL,
	`dataset` text NOT NULL,
	`sha` text NOT NULL,
	`bytes` integer NOT NULL,
	`format` text NOT NULL,
	`validation` text NOT NULL,
	PRIMARY KEY(`project`, `dataset`, `sha`)
);
--> statement-breakpoint
CREATE TABLE `ingest_plans` (
	`project` text NOT NULL,
	`dataset` text NOT NULL,
	`version` text NOT NULL,
	`manifest_sha` text NOT NULL,
	`base_version` text,
	`manifest_json` text NOT NULL,
	PRIMARY KEY(`project`, `dataset`, `version`)
);
--> statement-breakpoint
CREATE TABLE `ingest_versions` (
	`project` text NOT NULL,
	`dataset` text NOT NULL,
	`version` text NOT NULL,
	`manifest_sha` text NOT NULL,
	`file_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	PRIMARY KEY(`project`, `dataset`, `version`)
);
