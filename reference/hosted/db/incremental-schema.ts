import {sqliteTable, text, integer, primaryKey} from 'drizzle-orm/sqlite-core';
// Schema only: no seeded plan, active pointer, identity, existing pilot/batch edit.
export const ingestPlans = sqliteTable('ingest_plans', {
  project: text('project').notNull(), dataset: text('dataset').notNull(),
  version: text('version').notNull(), manifestSHA: text('manifest_sha').notNull(),
  baseVersion: text('base_version'), manifestJSON: text('manifest_json').notNull(),
}, t => [primaryKey({columns: [t.project, t.dataset, t.version]})]);
export const ingestFiles = sqliteTable('ingest_files', {
  project: text('project').notNull(), dataset: text('dataset').notNull(),
  sha: text('sha').notNull(), bytes: integer('bytes').notNull(),
  format: text('format').notNull(), validation: text('validation').notNull(),
}, t => [primaryKey({columns: [t.project, t.dataset, t.sha]})]);
export const ingestVersions = sqliteTable('ingest_versions', {
  project: text('project').notNull(), dataset: text('dataset').notNull(),
  version: text('version').notNull(), manifestSHA: text('manifest_sha').notNull(),
  fileCount: integer('file_count').notNull(), totalBytes: integer('total_bytes').notNull(),
}, t => [primaryKey({columns: [t.project, t.dataset, t.version]})]);
export const ingestActive = sqliteTable('ingest_active', {
  project: text('project').notNull(), dataset: text('dataset').notNull(),
  version: text('version').notNull(), revision: integer('revision').notNull(),
}, t => [primaryKey({columns: [t.project, t.dataset]})]);
