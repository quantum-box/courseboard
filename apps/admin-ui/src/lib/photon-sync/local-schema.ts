export const PHOTON_SYNC_SCHEMA_VERSION = 1

export const PHOTON_SYNC_MIGRATIONS = [
	{
		version: 1,
		name: 'create_photon_sync_runtime_tables',
		sql: `
CREATE TABLE IF NOT EXISTS schema_meta (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS projection_entities (
  tenant_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  server_version text,
  server_updated_at timestamptz,
  projection_json jsonb NOT NULL,
  yjs_doc_key text,
  pending_state text NOT NULL DEFAULT 'clean',
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS projection_queries (
  tenant_id text NOT NULL,
  query_key text NOT NULL,
  entity_type text NOT NULL,
  entity_ids jsonb NOT NULL,
  filter_json jsonb NOT NULL,
  server_cursor text,
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz,
  PRIMARY KEY (tenant_id, query_key)
);

CREATE TABLE IF NOT EXISTS pending_operations (
  operation_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_user_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  mutation_type text NOT NULL,
  payload_json jsonb NOT NULL,
  payload_redaction_version integer NOT NULL,
  base_version text,
  base_vector jsonb,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  next_retry_at timestamptz,
  acknowledged_at timestamptz,
  error_summary text
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  tenant_id text NOT NULL,
  domain text NOT NULL,
  cursor text,
  server_time timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, domain)
);

CREATE TABLE IF NOT EXISTS yjs_updates (
  tenant_id text NOT NULL,
  doc_key text NOT NULL,
  seq bigint NOT NULL,
  update_bytes bytea NOT NULL,
  origin_operation_id text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, doc_key, seq)
);

CREATE TABLE IF NOT EXISTS yjs_snapshots (
  tenant_id text NOT NULL,
  doc_key text NOT NULL,
  snapshot_bytes bytea NOT NULL,
  snapshot_seq bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, doc_key)
);
`,
	},
] as const

export function getPhotonSyncMigration(version: number) {
	return PHOTON_SYNC_MIGRATIONS.find(migration => migration.version === version)
}
