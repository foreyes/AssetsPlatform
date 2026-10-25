CREATE TABLE ingest_plans(project TEXT NOT NULL,dataset TEXT NOT NULL,version TEXT NOT NULL,manifest_sha TEXT NOT NULL,base_version TEXT,manifest_json TEXT NOT NULL,PRIMARY KEY(project,dataset,version));
CREATE TABLE ingest_files(project TEXT NOT NULL,dataset TEXT NOT NULL,sha TEXT NOT NULL,bytes INTEGER NOT NULL,format TEXT NOT NULL,validation TEXT NOT NULL,PRIMARY KEY(project,dataset,sha));
CREATE TABLE ingest_versions(project TEXT NOT NULL,dataset TEXT NOT NULL,version TEXT NOT NULL,manifest_sha TEXT NOT NULL,file_count INTEGER NOT NULL,total_bytes INTEGER NOT NULL,PRIMARY KEY(project,dataset,version));
CREATE TABLE ingest_active(project TEXT NOT NULL,dataset TEXT NOT NULL,version TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(project,dataset));
