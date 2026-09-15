SET search_path TO new_design, public;

CREATE TABLE runtime_installations (
  installation_id uuid PRIMARY KEY,
  runtime_id text NOT NULL CHECK(runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'),
  manifest_sha256 char(64) NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
  application_version text NOT NULL CHECK(length(application_version) BETWEEN 1 AND 80),
  postgres_version text NOT NULL CHECK(length(postgres_version) BETWEEN 1 AND 80),
  age_version text NOT NULL CHECK(length(age_version) BETWEEN 1 AND 80),
  pgvector_version text NOT NULL CHECK(length(pgvector_version) BETWEEN 1 AND 80),
  pg_trgm_version text NOT NULL CHECK(length(pg_trgm_version) BETWEEN 1 AND 80),
  active_data_generation text NOT NULL CHECK(active_data_generation ~ '^data-[a-f0-9]{16}$'),
  status text NOT NULL CHECK(status IN ('starting','healthy','degraded','stopped','upgrading','restoring','failed')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  last_started_at timestamptz,
  last_stopped_at timestamptz,
  last_health_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runtime_lifecycle_events (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES runtime_installations(installation_id),
  event_kind text NOT NULL CHECK(event_kind IN ('install','start','ready','degraded','stop','crash_detected','upgrade_plan','upgrade_stage','upgrade_switch','upgrade_rollback','restore_stage','restore_switch','failure')),
  from_status text CHECK(from_status IS NULL OR from_status IN ('starting','healthy','degraded','stopped','upgrading','restoring','failed')),
  to_status text NOT NULL CHECK(to_status IN ('starting','healthy','degraded','stopped','upgrading','restoring','failed')),
  runtime_id text NOT NULL CHECK(runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'),
  data_generation text NOT NULL CHECK(data_generation ~ '^data-[a-f0-9]{16}$'),
  error_code text NOT NULL DEFAULT '' CHECK(length(error_code)<=120),
  detail text NOT NULL DEFAULT '' CHECK(length(detail)<=2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runtime_health_snapshots (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES runtime_installations(installation_id),
  runtime_id text NOT NULL CHECK(runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'),
  data_generation text NOT NULL CHECK(data_generation ~ '^data-[a-f0-9]{16}$'),
  outcome text NOT NULL CHECK(outcome IN ('healthy','degraded','failed')),
  package_integrity text NOT NULL CHECK(package_integrity IN ('verified','failed')),
  database_ready boolean NOT NULL,
  extensions jsonb NOT NULL CHECK(jsonb_typeof(extensions)='object' AND transfer_json_is_safe(extensions)),
  migration_count integer NOT NULL CHECK(migration_count BETWEEN 0 AND 10000),
  active_job_count integer NOT NULL CHECK(active_job_count>=0),
  dead_letter_count integer NOT NULL CHECK(dead_letter_count>=0),
  latest_backup_at timestamptz,
  free_disk_bytes bigint NOT NULL CHECK(free_disk_bytes>=0),
  checks_hash char(64) NOT NULL CHECK(checks_hash ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runtime_upgrade_plans (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES runtime_installations(installation_id),
  source_runtime_id text NOT NULL CHECK(source_runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'),
  target_runtime_id text NOT NULL CHECK(target_runtime_id ~ '^[A-Za-z0-9._-]{8,160}$' AND target_runtime_id<>source_runtime_id),
  source_manifest_sha256 char(64) NOT NULL CHECK(source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  target_manifest_sha256 char(64) NOT NULL CHECK(target_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  source_postgres_major integer NOT NULL CHECK(source_postgres_major BETWEEN 12 AND 30),
  target_postgres_major integer NOT NULL CHECK(target_postgres_major BETWEEN 12 AND 30),
  strategy text NOT NULL CHECK(strategy IN ('same_major_staged','cross_major_pg_upgrade','cross_major_logical_restore')),
  backup_operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  compatibility_operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  source_data_generation text NOT NULL CHECK(source_data_generation ~ '^data-[a-f0-9]{16}$'),
  target_data_generation text NOT NULL CHECK(target_data_generation ~ '^data-[a-f0-9]{16}$' AND target_data_generation<>source_data_generation),
  rollback_data_generation text NOT NULL CHECK(rollback_data_generation=source_data_generation),
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','backed_up','staging','verifying','switched','rolled_back','failed')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  last_error_code text NOT NULL DEFAULT '' CHECK(length(last_error_code)<=120),
  last_error_summary text NOT NULL DEFAULT '' CHECK(length(last_error_summary)<=2000),
  created_by text NOT NULL CHECK(length(created_by) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK((status IN ('switched','rolled_back','failed') AND completed_at IS NOT NULL) OR (status NOT IN ('switched','rolled_back','failed') AND completed_at IS NULL)),
  UNIQUE(installation_id,target_runtime_id)
);

CREATE FUNCTION guard_runtime_installation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'runtime installation history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['runtime_id','manifest_sha256','application_version','postgres_version','age_version','pgvector_version','pg_trgm_version','active_data_generation','status','revision','last_started_at','last_stopped_at','last_health_at','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['runtime_id','manifest_sha256','application_version','postgres_version','age_version','pgvector_version','pg_trgm_version','active_data_generation','status','revision','last_started_at','last_stopped_at','last_health_at','updated_at']::text[]) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'invalid runtime installation update' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status=NEW.status) OR (OLD.status='starting' AND NEW.status IN ('healthy','degraded','failed','stopped')) OR (OLD.status='healthy' AND NEW.status IN ('degraded','stopped','upgrading','restoring','failed')) OR (OLD.status='degraded' AND NEW.status IN ('healthy','stopped','upgrading','restoring','failed')) OR (OLD.status='stopped' AND NEW.status IN ('starting','upgrading','restoring')) OR (OLD.status='upgrading' AND NEW.status IN ('healthy','degraded','stopped','failed')) OR (OLD.status='restoring' AND NEW.status IN ('healthy','degraded','stopped','failed')) OR (OLD.status='failed' AND NEW.status IN ('starting','stopped','upgrading','restoring'))) THEN RAISE EXCEPTION 'illegal runtime installation transition' USING ERRCODE='23514'; END IF;
  IF (OLD.runtime_id,OLD.manifest_sha256,OLD.application_version,OLD.postgres_version,OLD.age_version,OLD.pgvector_version,OLD.pg_trgm_version,OLD.active_data_generation) IS DISTINCT FROM (NEW.runtime_id,NEW.manifest_sha256,NEW.application_version,NEW.postgres_version,NEW.age_version,NEW.pgvector_version,NEW.pg_trgm_version,NEW.active_data_generation) AND NOT (OLD.status='upgrading' AND NEW.status IN ('healthy','degraded')) THEN RAISE EXCEPTION 'runtime pointer and versions can change only after verified upgrade' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_installations_guard BEFORE UPDATE OR DELETE ON runtime_installations FOR EACH ROW EXECUTE FUNCTION guard_runtime_installation_update();

CREATE FUNCTION guard_runtime_upgrade_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('switched','rolled_back','failed') THEN RAISE EXCEPTION 'terminal runtime upgrade plan is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','revision','last_error_code','last_error_summary','completed_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','last_error_code','last_error_summary','completed_at']::text[]) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'runtime upgrade inputs are immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='planned' AND NEW.status IN ('backed_up','failed')) OR (OLD.status='backed_up' AND NEW.status IN ('staging','failed')) OR (OLD.status='staging' AND NEW.status IN ('verifying','rolled_back','failed')) OR (OLD.status='verifying' AND NEW.status IN ('switched','rolled_back','failed'))) THEN RAISE EXCEPTION 'illegal runtime upgrade transition' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('failed','rolled_back') AND (NEW.last_error_code='' OR NEW.last_error_summary='') THEN RAISE EXCEPTION 'failed upgrade requires sanitized error detail' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_upgrade_plans_guard BEFORE UPDATE OR DELETE ON runtime_upgrade_plans FOR EACH ROW EXECUTE FUNCTION guard_runtime_upgrade_update();

CREATE FUNCTION guard_runtime_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER runtime_events_append_only BEFORE UPDATE OR DELETE ON runtime_lifecycle_events FOR EACH ROW EXECUTE FUNCTION guard_runtime_append_only();
CREATE TRIGGER runtime_health_append_only BEFORE UPDATE OR DELETE ON runtime_health_snapshots FOR EACH ROW EXECUTE FUNCTION guard_runtime_append_only();

CREATE FUNCTION validate_runtime_upgrade_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM transfer_operations WHERE id=NEW.backup_operation_id AND operation_kind='full_backup' AND status IN ('ready','archived')) THEN RAISE EXCEPTION 'runtime upgrade requires a ready full backup' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM transfer_operations WHERE id=NEW.compatibility_operation_id AND operation_kind='full_restore' AND execution_mode='dry_run' AND status='ready') THEN RAISE EXCEPTION 'runtime upgrade requires a ready compatibility dry-run' USING ERRCODE='23514'; END IF;
  IF NEW.source_postgres_major=NEW.target_postgres_major AND NEW.strategy<>'same_major_staged' THEN RAISE EXCEPTION 'same major upgrade must use staged strategy' USING ERRCODE='23514'; END IF;
  IF NEW.source_postgres_major<>NEW.target_postgres_major AND NEW.strategy='same_major_staged' THEN RAISE EXCEPTION 'cross major upgrade requires pg_upgrade or logical restore' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_upgrade_scope_guard BEFORE INSERT ON runtime_upgrade_plans FOR EACH ROW EXECUTE FUNCTION validate_runtime_upgrade_plan();

CREATE FUNCTION validate_runtime_health_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM runtime_installations WHERE installation_id=NEW.installation_id AND runtime_id=NEW.runtime_id AND active_data_generation=NEW.data_generation) THEN RAISE EXCEPTION 'runtime health snapshot does not match the active installation pointer' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_health_scope_guard BEFORE INSERT ON runtime_health_snapshots FOR EACH ROW EXECUTE FUNCTION validate_runtime_health_snapshot();

CREATE INDEX runtime_events_installation_idx ON runtime_lifecycle_events(installation_id,created_at,id);
CREATE INDEX runtime_health_installation_idx ON runtime_health_snapshots(installation_id,checked_at,id);
CREATE INDEX runtime_upgrade_status_idx ON runtime_upgrade_plans(installation_id,status,created_at,id);

INSERT INTO schema_migrations(id) VALUES('032_private_runtime_lifecycle') ON CONFLICT(id) DO NOTHING;
