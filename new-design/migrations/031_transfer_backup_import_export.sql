SET search_path TO new_design, public;

CREATE TABLE transfer_export_profiles (
  profile_key text PRIMARY KEY CHECK(profile_key IN ('full_system','compact_continue','full_audit','template_bundle','resource_bundle')),
  package_kind text NOT NULL CHECK(package_kind IN ('full_system','book','template','resource')),
  description text NOT NULL,
  included_domains jsonb NOT NULL CHECK(jsonb_typeof(included_domains)='array'),
  excluded_domains jsonb NOT NULL CHECK(jsonb_typeof(excluded_domains)='array'),
  include_version_history boolean NOT NULL,
  include_runtime_evidence boolean NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO transfer_export_profiles(profile_key,package_kind,description,included_domains,excluded_domains,include_version_history,include_runtime_evidence) VALUES
('full_system','full_system','整库 PostgreSQL 逻辑数据、受管附件与一致性清单。','["new_design_schema","managed_assets","migration_history","extension_compatibility"]','["credentials","session_tokens","temporary_urls","absolute_local_paths"]',true,true),
('compact_continue','book','可在另一台机器继续创作的单书正本、当前采用链、必要历史、来源证据与附件。','["book_identity","card_schema","book_cards","planning","chapter_bodies","facts","state","knowledge","timeline","research_references","prompt_bindings","required_runtime_snapshots","managed_assets"]','["age_projection","embedding_vectors","embedding_indexes","transient_outbox_jobs","cache","credentials","unreferenced_history"]',false,true),
('full_audit','book','用于完整追溯的单书正本、全部版本历史、证据、采用记录、必要运行快照与附件。','["book_identity","card_schema","book_cards","planning","chapter_bodies","facts","state","knowledge","timeline","research_references","prompt_bindings","runtime_evidence","managed_assets"]','["age_projection","embedding_vectors","embedding_indexes","transient_outbox_jobs","cache","credentials"]',true,true),
('template_bundle','template','系统模板、卡片类型、字段、表单、模板版本与提示词方案，不包含书籍实例。','["card_types","field_schemas","dictionaries","relations","forms","template_groups","template_versions","prompt_recipes"]','["books","book_cards","chapter_bodies","runtime_jobs","credentials"]',true,false),
('resource_bundle','resource','以稳定 portable key 和版本携带业务资源卡及其显式依赖。','["resource_card_types","resource_cards","resource_versions","resource_dependencies"]','["books","templates","runtime_jobs","credentials"]',true,false);

CREATE TABLE transfer_operations (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id) ON DELETE RESTRICT,
  operation_kind text NOT NULL CHECK(operation_kind IN ('full_backup','full_restore','book_export','book_import','template_export','template_import','resource_export','resource_import')),
  execution_mode text NOT NULL CHECK(execution_mode IN ('execute','dry_run','apply')),
  profile_key text NOT NULL REFERENCES transfer_export_profiles(profile_key),
  source_operation_id uuid REFERENCES transfer_operations(id),
  source_artifact_id uuid,
  target_staging_key text NOT NULL CHECK(target_staging_key ~ '^[a-z][a-z0-9-]{2,79}$'),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','verifying','ready','failed','cancelled','imported','restored','archived')),
  current_step_key text NOT NULL DEFAULT '' CHECK(length(current_step_key)<=120),
  progress_completed bigint NOT NULL DEFAULT 0 CHECK(progress_completed>=0),
  progress_total bigint CHECK(progress_total IS NULL OR progress_total>=progress_completed),
  ready_manifest_id uuid,
  compatibility_policy text NOT NULL DEFAULT 'strict' CHECK(compatibility_policy IN ('strict','explicit_upgrade')),
  max_entry_count integer NOT NULL DEFAULT 100000 CHECK(max_entry_count BETWEEN 1 AND 1000000),
  max_single_file_bytes bigint NOT NULL DEFAULT 2147483648 CHECK(max_single_file_bytes BETWEEN 1 AND 1099511627776),
  max_total_bytes bigint NOT NULL DEFAULT 53687091200 CHECK(max_total_bytes BETWEEN max_single_file_bytes AND 10995116277760),
  max_compression_ratio numeric(12,3) NOT NULL DEFAULT 200 CHECK(max_compression_ratio BETWEEN 1 AND 10000),
  maintenance_mode_required boolean NOT NULL DEFAULT false,
  local_confirmation_digest char(64),
  requested_by text NOT NULL CHECK(length(requested_by) BETWEEN 1 AND 160),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 240),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  last_error_code text NOT NULL DEFAULT '' CHECK(length(last_error_code)<=120),
  last_error_summary text NOT NULL DEFAULT '' CHECK(length(last_error_summary)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  UNIQUE(space_id,idempotency_key),
  UNIQUE(id,space_id),
  CHECK(book_id IS NULL OR operation_kind='book_export'),
  CHECK((operation_kind IN ('full_backup','book_export','template_export','resource_export') AND execution_mode='execute') OR (operation_kind IN ('full_restore','book_import','template_import','resource_import') AND execution_mode IN ('dry_run','apply'))),
  CHECK((operation_kind IN ('full_backup','full_restore') AND profile_key='full_system') OR (operation_kind IN ('book_export','book_import') AND profile_key IN ('compact_continue','full_audit')) OR (operation_kind IN ('template_export','template_import') AND profile_key='template_bundle') OR (operation_kind IN ('resource_export','resource_import') AND profile_key='resource_bundle')),
  CHECK((operation_kind IN ('full_restore','book_import','template_import','resource_import') AND source_artifact_id IS NOT NULL) OR operation_kind NOT IN ('full_restore','book_import','template_import','resource_import')),
  CHECK((execution_mode='apply' AND source_operation_id IS NOT NULL) OR execution_mode<>'apply'),
  CHECK((operation_kind='full_restore' AND execution_mode='apply' AND maintenance_mode_required AND local_confirmation_digest ~ '^[a-f0-9]{64}$') OR ((operation_kind<>'full_restore' OR execution_mode<>'apply') AND NOT maintenance_mode_required AND local_confirmation_digest IS NULL)),
  CHECK((status IN ('ready','failed','cancelled','imported','restored','archived') AND completed_at IS NOT NULL) OR status NOT IN ('ready','failed','cancelled','imported','restored','archived')),
  CHECK((status='archived' AND archived_at IS NOT NULL) OR (status<>'archived' AND archived_at IS NULL))
);

CREATE TABLE transfer_manifests (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  manifest_kind text NOT NULL CHECK(manifest_kind IN ('full_backup','book_package','template_package','resource_package')),
  format_version integer NOT NULL CHECK(format_version>0),
  application_version text NOT NULL CHECK(length(application_version) BETWEEN 1 AND 80),
  minimum_application_version text NOT NULL CHECK(length(minimum_application_version) BETWEEN 1 AND 80),
  maximum_application_version text NOT NULL CHECK(length(maximum_application_version) BETWEEN 1 AND 80),
  schema_version text NOT NULL CHECK(length(schema_version) BETWEEN 1 AND 120),
  schema_migrations jsonb NOT NULL CHECK(jsonb_typeof(schema_migrations)='array'),
  migration_hash char(64) NOT NULL CHECK(migration_hash ~ '^[a-f0-9]{64}$'),
  postgres_version text NOT NULL CHECK(length(postgres_version) BETWEEN 1 AND 80),
  age_version text,
  pgvector_version text,
  required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(required_capabilities)='array'),
  card_schema_versions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(card_schema_versions)='array'),
  form_schema_versions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(form_schema_versions)='array'),
  template_schema_versions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(template_schema_versions)='array'),
  prompt_schema_versions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(prompt_schema_versions)='array'),
  encoding text NOT NULL DEFAULT 'UTF8' CHECK(encoding='UTF8'),
  platform_constraints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(platform_constraints)='object'),
  consistency_snapshot text NOT NULL CHECK(length(consistency_snapshot) BETWEEN 1 AND 240),
  consistency_watermark jsonb NOT NULL CHECK(jsonb_typeof(consistency_watermark)='object'),
  content_scope jsonb NOT NULL CHECK(jsonb_typeof(content_scope)='object'),
  excluded_derived_domains jsonb NOT NULL CHECK(jsonb_typeof(excluded_derived_domains)='array'),
  secret_reconfiguration_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(secret_reconfiguration_refs)='array'),
  manifest_hash char(64) NOT NULL UNIQUE CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL CHECK(length(created_by) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id,id)
);
ALTER TABLE transfer_operations ADD CONSTRAINT transfer_operations_manifest_fk FOREIGN KEY(ready_manifest_id,id) REFERENCES transfer_manifests(id,operation_id);

CREATE TABLE transfer_artifacts (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  manifest_id uuid REFERENCES transfer_manifests(id),
  artifact_kind text NOT NULL CHECK(artifact_kind IN ('database_dump','managed_asset','package','manifest','validation_report')),
  media_type text NOT NULL CHECK(length(media_type) BETWEEN 1 AND 160),
  storage_locator text NOT NULL CHECK(length(storage_locator) BETWEEN 1 AND 480),
  normalized_case_locator text NOT NULL CHECK(length(normalized_case_locator) BETWEEN 1 AND 480),
  display_filename text NOT NULL CHECK(length(display_filename) BETWEEN 1 AND 255),
  checksum_algorithm text NOT NULL DEFAULT 'sha256' CHECK(checksum_algorithm='sha256'),
  checksum char(64),
  byte_size bigint CHECK(byte_size IS NULL OR byte_size>=0),
  entry_count integer CHECK(entry_count IS NULL OR entry_count>=0),
  compressed_bytes bigint CHECK(compressed_bytes IS NULL OR compressed_bytes>=0),
  uncompressed_bytes bigint CHECK(uncompressed_bytes IS NULL OR uncompressed_bytes>=0),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed','quarantined')),
  error_code text NOT NULL DEFAULT '' CHECK(length(error_code)<=120),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  UNIQUE(operation_id,normalized_case_locator),
  UNIQUE(id,operation_id),
  CHECK((status='ready' AND checksum ~ '^[a-f0-9]{64}$' AND byte_size IS NOT NULL AND ready_at IS NOT NULL) OR status<>'ready'),
  CHECK(uncompressed_bytes IS NULL OR compressed_bytes IS NULL OR uncompressed_bytes>=compressed_bytes)
);
ALTER TABLE transfer_artifacts ADD CONSTRAINT transfer_artifacts_manifest_operation_fk FOREIGN KEY(manifest_id,operation_id) REFERENCES transfer_manifests(id,operation_id);
ALTER TABLE transfer_operations ADD CONSTRAINT transfer_operations_source_artifact_fk FOREIGN KEY(source_artifact_id) REFERENCES transfer_artifacts(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE transfer_archive_entries (
  id uuid PRIMARY KEY,
  artifact_id uuid NOT NULL REFERENCES transfer_artifacts(id),
  archive_path text NOT NULL CHECK(length(archive_path) BETWEEN 1 AND 480),
  normalized_case_path text NOT NULL CHECK(length(normalized_case_path) BETWEEN 1 AND 480),
  entry_kind text NOT NULL CHECK(entry_kind IN ('file','directory')),
  checksum char(64),
  compressed_bytes bigint NOT NULL DEFAULT 0 CHECK(compressed_bytes>=0),
  uncompressed_bytes bigint NOT NULL DEFAULT 0 CHECK(uncompressed_bytes>=0),
  compression_ratio numeric(12,3) NOT NULL DEFAULT 1 CHECK(compression_ratio BETWEEN 0 AND 10000),
  symbolic_link boolean NOT NULL DEFAULT false CHECK(NOT symbolic_link),
  reparse_point boolean NOT NULL DEFAULT false CHECK(NOT reparse_point),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_id,normalized_case_path),
  CHECK((entry_kind='file' AND checksum ~ '^[a-f0-9]{64}$') OR (entry_kind='directory' AND checksum IS NULL))
);

CREATE TABLE transfer_compatibility_snapshots (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  source_format_version integer NOT NULL CHECK(source_format_version>0),
  source_application_version text NOT NULL,
  current_application_version text NOT NULL,
  source_schema_version text NOT NULL,
  current_schema_version text NOT NULL,
  source_migration_hash char(64) NOT NULL CHECK(source_migration_hash ~ '^[a-f0-9]{64}$'),
  current_migration_hash char(64) NOT NULL CHECK(current_migration_hash ~ '^[a-f0-9]{64}$'),
  extension_versions jsonb NOT NULL CHECK(jsonb_typeof(extension_versions)='object'),
  required_capabilities jsonb NOT NULL CHECK(jsonb_typeof(required_capabilities)='array'),
  missing_capabilities jsonb NOT NULL CHECK(jsonb_typeof(missing_capabilities)='array'),
  unknown_required_capabilities jsonb NOT NULL CHECK(jsonb_typeof(unknown_required_capabilities)='array'),
  outcome text NOT NULL CHECK(outcome IN ('compatible','upgrade_required','incompatible','unavailable')),
  detail text NOT NULL DEFAULT '' CHECK(length(detail)<=4000),
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transfer_steps (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  step_key text NOT NULL CHECK(step_key ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled','skipped')),
  progress_completed bigint NOT NULL DEFAULT 0 CHECK(progress_completed>=0),
  progress_total bigint CHECK(progress_total IS NULL OR progress_total>=progress_completed),
  checkpoint_key text NOT NULL DEFAULT '' CHECK(length(checkpoint_key)<=240),
  error_code text NOT NULL DEFAULT '' CHECK(length(error_code)<=120),
  error_summary text NOT NULL DEFAULT '' CHECK(length(error_summary)<=2000),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(operation_id,step_key),
  UNIQUE(id,operation_id)
);

CREATE TABLE transfer_checkpoints (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  step_id uuid NOT NULL,
  checkpoint_key text NOT NULL CHECK(length(checkpoint_key) BETWEEN 1 AND 240),
  checkpoint_data jsonb NOT NULL CHECK(jsonb_typeof(checkpoint_data)='object' AND octet_length(checkpoint_data::text)<=16384),
  checkpoint_hash char(64) NOT NULL CHECK(checkpoint_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(step_id,operation_id) REFERENCES transfer_steps(id,operation_id),
  UNIQUE(operation_id,step_id,checkpoint_key,checkpoint_hash)
);

CREATE TABLE transfer_validation_results (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  stage text NOT NULL CHECK(stage IN ('preflight','archive_scan','checksum','compatibility','database_integrity','asset_integrity','staging_integrity','publish_gate','restore_drill')),
  rule_key text NOT NULL CHECK(rule_key ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  outcome text NOT NULL CHECK(outcome IN ('passed','warning','failed','unavailable')),
  subject_kind text NOT NULL CHECK(length(subject_kind) BETWEEN 1 AND 120),
  subject_ref text NOT NULL DEFAULT '' CHECK(length(subject_ref)<=240),
  detail text NOT NULL DEFAULT '' CHECK(length(detail)<=4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transfer_conflicts (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  conflict_kind text NOT NULL CHECK(conflict_kind IN ('portable_key_exists','version_exists','missing_dependency','schema_incompatible','unknown_required_capability','target_exists')),
  entity_kind text NOT NULL CHECK(length(entity_kind) BETWEEN 1 AND 120),
  portable_key text NOT NULL CHECK(length(portable_key) BETWEEN 1 AND 240),
  source_version text NOT NULL DEFAULT '' CHECK(length(source_version)<=120),
  target_version text NOT NULL DEFAULT '' CHECK(length(target_version)<=120),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','blocking')),
  resolution text CHECK(resolution IS NULL OR resolution IN ('new_local_version','remap','skip','abort')),
  resolution_note text NOT NULL DEFAULT '' CHECK(length(resolution_note)<=2000),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(operation_id,conflict_kind,entity_kind,portable_key)
);

CREATE TABLE transfer_id_mappings (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  entity_kind text NOT NULL CHECK(length(entity_kind) BETWEEN 1 AND 120),
  portable_key text NOT NULL CHECK(length(portable_key) BETWEEN 1 AND 240),
  source_internal_id uuid,
  target_internal_id uuid NOT NULL,
  mapping_action text NOT NULL CHECK(mapping_action IN ('created','reused','new_local_version','remapped')),
  target_version text NOT NULL DEFAULT '' CHECK(length(target_version)<=120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id,entity_kind,portable_key)
);

CREATE TABLE transfer_staging_scopes (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES transfer_operations(id),
  staging_kind text NOT NULL CHECK(staging_kind IN ('database','directory','book_space','template_space','resource_space')),
  staging_key text NOT NULL UNIQUE CHECK(staging_key ~ '^[a-z][a-z0-9-]{2,79}$'),
  status text NOT NULL DEFAULT 'allocated' CHECK(status IN ('allocated','validating','ready_to_publish','published','abandoned')),
  target_space_id uuid REFERENCES card_spaces(id),
  target_book_id uuid REFERENCES books(id),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  abandoned_at timestamptz,
  CHECK((status='published' AND published_at IS NOT NULL AND abandoned_at IS NULL) OR (status='abandoned' AND abandoned_at IS NOT NULL AND published_at IS NULL) OR status IN ('allocated','validating','ready_to_publish'))
);

CREATE TABLE transfer_import_sources (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES transfer_operations(id),
  source_artifact_id uuid NOT NULL REFERENCES transfer_artifacts(id),
  source_manifest_id uuid NOT NULL REFERENCES transfer_manifests(id),
  source_installation_hash char(64) NOT NULL CHECK(source_installation_hash ~ '^[a-f0-9]{64}$'),
  source_operation_key text NOT NULL CHECK(length(source_operation_key) BETWEEN 8 AND 240),
  imported_by text NOT NULL CHECK(length(imported_by) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transfer_restore_drills (
  id uuid PRIMARY KEY,
  backup_operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  drill_operation_id uuid NOT NULL UNIQUE REFERENCES transfer_operations(id),
  outcome text NOT NULL CHECK(outcome IN ('passed','failed','cancelled','unavailable')),
  validation_summary jsonb NOT NULL CHECK(jsonb_typeof(validation_summary)='object'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK(completed_at>=started_at)
);

CREATE TABLE transfer_operation_events (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES transfer_operations(id),
  from_status text,
  to_status text NOT NULL,
  action text NOT NULL CHECK(action IN ('request','start','verify','ready','fail','cancel','import','restore','archive')),
  actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 160),
  detail text NOT NULL DEFAULT '' CHECK(length(detail)<=2000),
  operation_revision integer NOT NULL CHECK(operation_revision>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION transfer_json_is_safe(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry record; item jsonb; scalar text;
BEGIN
  IF jsonb_typeof(value)='object' THEN
    FOR entry IN SELECT key,val FROM jsonb_each(value) pair(key,val) LOOP
      IF regexp_replace(lower(entry.key),'[^a-z0-9]','','g') IN ('password','token','accesstoken','refreshtoken','sessiontoken','secret','clientsecret','apikey','privatekey','credential','connectionstring','databaseurl','authorization','cookie','setcookie','absolutepath','temporaryurl') THEN RETURN false; END IF;
      IF NOT transfer_json_is_safe(entry.val) THEN RETURN false; END IF;
    END LOOP;
  ELSIF jsonb_typeof(value)='array' THEN
    FOR item IN SELECT array_item FROM jsonb_array_elements(value) items(array_item) LOOP IF NOT transfer_json_is_safe(item) THEN RETURN false; END IF; END LOOP;
  ELSIF jsonb_typeof(value)='string' THEN
    scalar:=value#>>'{}';
    IF scalar ~ '^[A-Za-z]:[\\/]' OR scalar ~ '^/' OR scalar ~ '^[/\\]{2}' OR scalar ~* '^file://' OR scalar ~* '\mbearer[[:space:]]+[^[:space:]]+' OR scalar ~* '://[^/@:]+:[^/@]+@' OR scalar ~* '[?&](token|signature|x-amz-credential|x-amz-signature)=' THEN RETURN false; END IF;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION transfer_locator_is_safe(value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE segment text;
BEGIN
  IF value IS NULL OR value='' OR position(E'\\' IN value)>0 OR value !~ '^[A-Za-z0-9._/-]+$' OR value ~ '(^/|^[A-Za-z]:|(^|/)\.\.(/|$)|//)' THEN RETURN false; END IF;
  FOR segment IN SELECT part FROM unnest(string_to_array(value,'/')) AS parts(part) LOOP
    IF segment='' OR segment IN ('.','..') OR segment ~ '[ .]$' OR upper(split_part(segment,'.',1)) ~ '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE transfer_export_profiles ADD CONSTRAINT transfer_export_profiles_safe_json CHECK(transfer_json_is_safe(included_domains) AND transfer_json_is_safe(excluded_domains));
ALTER TABLE transfer_manifests ADD CONSTRAINT transfer_manifests_safe_json CHECK(transfer_json_is_safe(schema_migrations) AND transfer_json_is_safe(required_capabilities) AND transfer_json_is_safe(card_schema_versions) AND transfer_json_is_safe(form_schema_versions) AND transfer_json_is_safe(template_schema_versions) AND transfer_json_is_safe(prompt_schema_versions) AND transfer_json_is_safe(platform_constraints) AND transfer_json_is_safe(consistency_watermark) AND transfer_json_is_safe(content_scope) AND transfer_json_is_safe(excluded_derived_domains) AND transfer_json_is_safe(secret_reconfiguration_refs));
ALTER TABLE transfer_compatibility_snapshots ADD CONSTRAINT transfer_compatibility_safe_json CHECK(transfer_json_is_safe(extension_versions) AND transfer_json_is_safe(required_capabilities) AND transfer_json_is_safe(missing_capabilities) AND transfer_json_is_safe(unknown_required_capabilities));
ALTER TABLE transfer_checkpoints ADD CONSTRAINT transfer_checkpoints_safe_json CHECK(transfer_json_is_safe(checkpoint_data) AND outbox_payload_is_reference_only(checkpoint_data));
ALTER TABLE transfer_restore_drills ADD CONSTRAINT transfer_restore_drills_safe_json CHECK(transfer_json_is_safe(validation_summary));
ALTER TABLE transfer_artifacts ADD CONSTRAINT transfer_artifacts_safe_locator CHECK(transfer_locator_is_safe(storage_locator) AND normalized_case_locator=lower(storage_locator));
ALTER TABLE transfer_archive_entries ADD CONSTRAINT transfer_entries_safe_locator CHECK(transfer_locator_is_safe(archive_path) AND normalized_case_path=lower(archive_path));

CREATE FUNCTION guard_transfer_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER transfer_profiles_append_only BEFORE UPDATE OR DELETE ON transfer_export_profiles FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_manifests_append_only BEFORE UPDATE OR DELETE ON transfer_manifests FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_entries_append_only BEFORE UPDATE OR DELETE ON transfer_archive_entries FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_compatibility_append_only BEFORE UPDATE OR DELETE ON transfer_compatibility_snapshots FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_checkpoints_append_only BEFORE UPDATE OR DELETE ON transfer_checkpoints FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_validation_append_only BEFORE UPDATE OR DELETE ON transfer_validation_results FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_mappings_append_only BEFORE UPDATE OR DELETE ON transfer_id_mappings FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_sources_append_only BEFORE UPDATE OR DELETE ON transfer_import_sources FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_drills_append_only BEFORE UPDATE OR DELETE ON transfer_restore_drills FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();
CREATE TRIGGER transfer_events_append_only BEFORE UPDATE OR DELETE ON transfer_operation_events FOR EACH ROW EXECUTE FUNCTION guard_transfer_append_only();

CREATE FUNCTION guard_transfer_artifact_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'pending' THEN RAISE EXCEPTION 'finished transfer artifact is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','checksum','byte_size','entry_count','compressed_bytes','uncompressed_bytes','error_code','ready_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','checksum','byte_size','entry_count','compressed_bytes','uncompressed_bytes','error_code','ready_at']::text[]) THEN RAISE EXCEPTION 'transfer artifact identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status NOT IN ('ready','failed','quarantined') THEN RAISE EXCEPTION 'illegal transfer artifact transition' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('failed','quarantined') AND NEW.error_code='' THEN RAISE EXCEPTION 'failed or quarantined transfer artifact requires an error code' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_artifacts_guard BEFORE UPDATE OR DELETE ON transfer_artifacts FOR EACH ROW EXECUTE FUNCTION guard_transfer_artifact_update();

CREATE FUNCTION guard_transfer_operation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'transfer operation history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','current_step_key','progress_completed','progress_total','ready_manifest_id','revision','last_error_code','last_error_summary','started_at','completed_at','archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_step_key','progress_completed','progress_total','ready_manifest_id','revision','last_error_code','last_error_summary','started_at','completed_at','archived_at']::text[]) THEN RAISE EXCEPTION 'transfer operation frozen input is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'transfer operation revision must advance by one' USING ERRCODE='23514'; END IF;
  IF OLD.ready_manifest_id IS NOT NULL AND NEW.ready_manifest_id IS DISTINCT FROM OLD.ready_manifest_id THEN RAISE EXCEPTION 'ready transfer manifest cannot be replaced' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','failed','cancelled')) OR (OLD.status='running' AND NEW.status IN ('running','verifying','failed','cancelled')) OR (OLD.status='verifying' AND NEW.status IN ('verifying','ready','failed','cancelled','imported','restored')) OR (OLD.status IN ('ready','failed','cancelled','imported','restored') AND NEW.status='archived')) THEN RAISE EXCEPTION 'illegal transfer operation transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NOT ((NEW.execution_mode='execute' AND NEW.operation_kind IN ('full_backup','book_export','template_export','resource_export')) OR NEW.execution_mode='dry_run') THEN RAISE EXCEPTION 'only export, backup, or dry-run operations can become ready' USING ERRCODE='23514'; END IF;
  IF NEW.status='imported' AND NOT (NEW.execution_mode='apply' AND NEW.operation_kind IN ('book_import','template_import','resource_import')) THEN RAISE EXCEPTION 'only apply import can become imported' USING ERRCODE='23514'; END IF;
  IF NEW.status='restored' AND NOT (NEW.operation_kind='full_restore' AND NEW.execution_mode='apply') THEN RAISE EXCEPTION 'only apply full restore can become restored' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('ready','imported','restored') AND (NEW.ready_manifest_id IS NULL OR EXISTS(SELECT 1 FROM transfer_validation_results WHERE operation_id=NEW.id AND outcome IN ('failed','unavailable'))) THEN RAISE EXCEPTION 'transfer operation cannot pass a failed validation gate' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('ready','imported','restored') AND NOT EXISTS(SELECT 1 FROM transfer_compatibility_snapshots WHERE operation_id=NEW.id AND outcome IN ('compatible','upgrade_required') AND jsonb_array_length(unknown_required_capabilities)=0) THEN RAISE EXCEPTION 'transfer operation requires a fail-closed compatibility snapshot' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NEW.execution_mode='execute' AND NOT EXISTS(SELECT 1 FROM transfer_artifacts WHERE operation_id=NEW.id AND manifest_id=NEW.ready_manifest_id AND artifact_kind='package' AND status='ready') THEN RAISE EXCEPTION 'export or backup requires a verified package artifact' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('imported','restored') AND NOT EXISTS(SELECT 1 FROM transfer_import_sources WHERE operation_id=NEW.id) THEN RAISE EXCEPTION 'import or restore requires frozen source evidence' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('failed','cancelled') AND (NEW.last_error_code='' OR NEW.last_error_summary='') THEN RAISE EXCEPTION 'failed or cancelled transfer requires sanitized error detail' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_operations_guard BEFORE UPDATE OR DELETE ON transfer_operations FOR EACH ROW EXECUTE FUNCTION guard_transfer_operation_update();

CREATE FUNCTION guard_transfer_step_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('succeeded','failed','cancelled','skipped') THEN RAISE EXCEPTION 'finished transfer step is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','progress_completed','progress_total','checkpoint_key','error_code','error_summary','revision','started_at','completed_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','progress_completed','progress_total','checkpoint_key','error_code','error_summary','revision','started_at','completed_at']::text[]) THEN RAISE EXCEPTION 'transfer step identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'transfer step revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','skipped','cancelled')) OR (OLD.status='running' AND NEW.status IN ('running','succeeded','failed','cancelled'))) THEN RAISE EXCEPTION 'illegal transfer step transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='failed' AND (NEW.error_code='' OR NEW.error_summary='') THEN RAISE EXCEPTION 'failed transfer step requires sanitized error detail' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_steps_guard BEFORE UPDATE OR DELETE ON transfer_steps FOR EACH ROW EXECUTE FUNCTION guard_transfer_step_update();

CREATE FUNCTION guard_transfer_conflict_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status='resolved' THEN RAISE EXCEPTION 'resolved transfer conflict is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','resolution','resolution_note','revision','resolved_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resolution','resolution_note','revision','resolved_at']::text[]) THEN RAISE EXCEPTION 'transfer conflict evidence is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 OR NEW.status<>'resolved' OR NEW.resolution IS NULL OR NEW.resolved_at IS NULL THEN RAISE EXCEPTION 'invalid transfer conflict resolution' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_conflicts_guard BEFORE UPDATE OR DELETE ON transfer_conflicts FOR EACH ROW EXECUTE FUNCTION guard_transfer_conflict_update();

CREATE FUNCTION guard_transfer_staging_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('published','abandoned') THEN RAISE EXCEPTION 'terminal transfer staging scope is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','target_space_id','target_book_id','revision','published_at','abandoned_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','target_space_id','target_book_id','revision','published_at','abandoned_at']::text[]) THEN RAISE EXCEPTION 'transfer staging identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 OR NOT ((OLD.status='allocated' AND NEW.status IN ('validating','abandoned')) OR (OLD.status='validating' AND NEW.status IN ('ready_to_publish','abandoned')) OR (OLD.status='ready_to_publish' AND NEW.status IN ('published','abandoned'))) THEN RAISE EXCEPTION 'illegal transfer staging transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_staging_guard BEFORE UPDATE OR DELETE ON transfer_staging_scopes FOR EACH ROW EXECUTE FUNCTION guard_transfer_staging_update();

CREATE FUNCTION validate_transfer_operation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND space_id=NEW.space_id) THEN RAISE EXCEPTION 'transfer operation book and space mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.operation_kind='book_export' AND NEW.book_id IS NULL THEN RAISE EXCEPTION 'book export requires a book' USING ERRCODE='23514'; END IF;
  IF NEW.execution_mode='apply' AND NOT EXISTS(SELECT 1 FROM transfer_operations source WHERE source.id=NEW.source_operation_id AND source.status='ready' AND source.execution_mode='dry_run' AND source.operation_kind=NEW.operation_kind AND source.profile_key=NEW.profile_key AND source.source_artifact_id=NEW.source_artifact_id) THEN RAISE EXCEPTION 'apply operation requires a compatible ready dry-run source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_operations_scope_guard BEFORE INSERT ON transfer_operations FOR EACH ROW EXECUTE FUNCTION validate_transfer_operation_scope();

CREATE FUNCTION validate_transfer_import_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM transfer_operations target
    JOIN transfer_operations source ON source.id=target.source_operation_id AND source.status='ready' AND source.execution_mode='dry_run'
    JOIN transfer_artifacts artifact ON artifact.id=NEW.source_artifact_id AND artifact.operation_id=source.id AND artifact.status='ready'
    JOIN transfer_manifests manifest ON manifest.id=NEW.source_manifest_id AND manifest.operation_id=source.id AND source.ready_manifest_id=manifest.id
    WHERE target.id=NEW.operation_id AND target.execution_mode='apply' AND target.source_artifact_id=artifact.id
  ) THEN RAISE EXCEPTION 'import source must match the ready dry-run operation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_import_sources_scope_guard BEFORE INSERT ON transfer_import_sources FOR EACH ROW EXECUTE FUNCTION validate_transfer_import_source();

CREATE FUNCTION validate_transfer_restore_drill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM transfer_operations WHERE id=NEW.backup_operation_id AND operation_kind='full_backup' AND status IN ('ready','archived')) OR NOT EXISTS(SELECT 1 FROM transfer_operations WHERE id=NEW.drill_operation_id AND operation_kind='full_restore' AND execution_mode='dry_run' AND ((status='ready' AND NEW.outcome='passed') OR (status='failed' AND NEW.outcome IN ('failed','unavailable')) OR (status='cancelled' AND NEW.outcome='cancelled'))) THEN RAISE EXCEPTION 'restore drill scope mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_restore_drills_scope_guard BEFORE INSERT ON transfer_restore_drills FOR EACH ROW EXECUTE FUNCTION validate_transfer_restore_drill();

CREATE FUNCTION validate_transfer_active_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owning_operation uuid;
BEGIN
  IF TG_TABLE_NAME='transfer_archive_entries' THEN SELECT operation_id INTO owning_operation FROM transfer_artifacts WHERE id=NEW.artifact_id;
  ELSE owning_operation:=NEW.operation_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM transfer_operations WHERE id=owning_operation AND status IN ('running','verifying')) THEN RAISE EXCEPTION 'transfer evidence can only be appended while the operation is active' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_manifests_active_guard BEFORE INSERT ON transfer_manifests FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();
CREATE TRIGGER transfer_entries_active_guard BEFORE INSERT ON transfer_archive_entries FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();
CREATE TRIGGER transfer_compatibility_active_guard BEFORE INSERT ON transfer_compatibility_snapshots FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();
CREATE TRIGGER transfer_checkpoints_active_guard BEFORE INSERT ON transfer_checkpoints FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();
CREATE TRIGGER transfer_validation_active_guard BEFORE INSERT ON transfer_validation_results FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();
CREATE TRIGGER transfer_conflicts_active_guard BEFORE INSERT ON transfer_conflicts FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();
CREATE TRIGGER transfer_mappings_active_guard BEFORE INSERT ON transfer_id_mappings FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();
CREATE TRIGGER transfer_staging_active_guard BEFORE INSERT ON transfer_staging_scopes FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();
CREATE TRIGGER transfer_sources_active_guard BEFORE INSERT ON transfer_import_sources FOR EACH ROW EXECUTE FUNCTION validate_transfer_active_evidence();

CREATE FUNCTION validate_transfer_artifact_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM transfer_operations operation WHERE operation.id=NEW.operation_id AND (operation.status IN ('running','verifying') OR (operation.status='queued' AND operation.execution_mode='dry_run' AND operation.source_artifact_id=NEW.id AND NEW.artifact_kind='package' AND NEW.status='pending'))) THEN RAISE EXCEPTION 'transfer artifact is outside the active or initial dry-run scope' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_artifacts_insert_guard BEFORE INSERT ON transfer_artifacts FOR EACH ROW EXECUTE FUNCTION validate_transfer_artifact_insert();

CREATE OR REPLACE FUNCTION validate_background_job_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_handler background_job_handlers%ROWTYPE; event_row outbox_events%ROWTYPE; resolved_book uuid; resolved_space uuid;
BEGIN
  SELECT * INTO expected_handler FROM background_job_handlers WHERE handler_key=NEW.handler_key AND job_kind=NEW.job_kind AND specialized_request_kind=NEW.specialized_request_kind AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'job handler or specialized request kind is not registered' USING ERRCODE='23514'; END IF;
  SELECT * INTO event_row FROM outbox_events WHERE id=NEW.outbox_event_id;
  IF NOT FOUND OR event_row.topic IS DISTINCT FROM expected_handler.topic OR event_row.event_version IS DISTINCT FROM expected_handler.event_version OR event_row.space_id IS DISTINCT FROM NEW.space_id OR event_row.book_id IS DISTINCT FROM NEW.book_id OR event_row.ordering_key IS DISTINCT FROM NEW.ordering_key OR event_row.aggregate_sequence IS DISTINCT FROM NEW.aggregate_sequence OR event_row.payload->>'specializedRequestKind' IS DISTINCT FROM NEW.specialized_request_kind OR event_row.payload->>'specializedRequestId' IS DISTINCT FROM NEW.specialized_request_id::text THEN RAISE EXCEPTION 'job and outbox event identity mismatch' USING ERRCODE='23514'; END IF;
  CASE NEW.specialized_request_kind
    WHEN 'dependency_recompute_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM dependency_recompute_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'asset_derivation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM asset_derivations request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'graph_projection_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM graph_projection_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_chunking_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM chunking_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM embedding_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_index_generation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM embedding_index_generations request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'ai_task' THEN SELECT request.book_id,request.space_id INTO resolved_book,resolved_space FROM ai_tasks request WHERE request.id=NEW.specialized_request_id;
    WHEN 'backup_request' THEN SELECT operation.book_id,operation.space_id INTO resolved_book,resolved_space FROM transfer_operations operation WHERE operation.id=NEW.specialized_request_id;
  END CASE;
  IF resolved_space IS NULL OR resolved_book IS DISTINCT FROM NEW.book_id OR resolved_space IS DISTINCT FROM NEW.space_id THEN RAISE EXCEPTION 'job specialized request does not resolve in the same scope' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

UPDATE background_job_handlers SET status='active' WHERE handler_key='backup.run' AND status='disabled';
INSERT INTO outbox_consumers(consumer_key,handler_key,max_concurrency) VALUES('runtime.backup-run','backup.run',1);

CREATE FUNCTION bridge_transfer_operation_to_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue_registered_background_job('backup_request',NEW.id,NEW.space_id,NEW.book_id,NULL,NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_operations_outbox_bridge AFTER INSERT ON transfer_operations FOR EACH ROW EXECUTE FUNCTION bridge_transfer_operation_to_outbox();

CREATE INDEX transfer_operations_status_idx ON transfer_operations(status,created_at,id);
CREATE INDEX transfer_operations_book_idx ON transfer_operations(book_id,created_at DESC,id) WHERE book_id IS NOT NULL;
CREATE INDEX transfer_artifacts_operation_idx ON transfer_artifacts(operation_id,status,artifact_kind,id);
CREATE INDEX transfer_entries_artifact_idx ON transfer_archive_entries(artifact_id,archive_path,id);
CREATE INDEX transfer_steps_operation_idx ON transfer_steps(operation_id,sort_order,id);
CREATE INDEX transfer_validation_operation_idx ON transfer_validation_results(operation_id,created_at,id);
CREATE INDEX transfer_conflicts_operation_idx ON transfer_conflicts(operation_id,status,created_at,id);
CREATE INDEX transfer_events_operation_idx ON transfer_operation_events(operation_id,created_at,id);

INSERT INTO schema_migrations(id) VALUES('031_transfer_backup_import_export') ON CONFLICT(id) DO NOTHING;
