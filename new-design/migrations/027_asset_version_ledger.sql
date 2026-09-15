SET search_path TO new_design, public;

CREATE TABLE asset_content_objects (
  id uuid PRIMARY KEY,
  checksum_algorithm text NOT NULL DEFAULT 'sha256' CHECK(checksum_algorithm='sha256'),
  checksum char(64) NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  byte_size bigint NOT NULL CHECK(byte_size>=0),
  mime_type text NOT NULL CHECK(mime_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'),
  storage_kind text NOT NULL CHECK(storage_kind IN ('managed_file','external_object')),
  storage_provider text NOT NULL CHECK(storage_provider ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  storage_locator text NOT NULL CHECK(
    length(storage_locator) BETWEEN 1 AND 1000 AND
    storage_locator ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,999}$' AND
    storage_locator !~ '(^[\\/]|^[A-Za-z]:|(^|/)\.\.(/|$)|\\|://|//)'
  ),
  integrity_state text NOT NULL DEFAULT 'pending' CHECK(integrity_state IN ('pending','verified','missing','corrupt')),
  last_verified_at timestamptz,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(checksum_algorithm,checksum,byte_size),
  UNIQUE(storage_provider,storage_locator),
  CHECK((storage_kind='managed_file' AND storage_provider='local') OR (storage_kind='external_object' AND storage_provider<>'local'))
);

CREATE TABLE asset_content_integrity_checks (
  id uuid PRIMARY KEY,
  content_object_id uuid NOT NULL REFERENCES asset_content_objects(id),
  expected_checksum char(64) NOT NULL,
  observed_checksum char(64) CHECK(observed_checksum IS NULL OR observed_checksum ~ '^[a-f0-9]{64}$'),
  expected_byte_size bigint NOT NULL CHECK(expected_byte_size>=0),
  observed_byte_size bigint CHECK(observed_byte_size IS NULL OR observed_byte_size>=0),
  outcome text NOT NULL CHECK(outcome IN ('verified','missing','corrupt')),
  detail text NOT NULL DEFAULT '',
  checked_by text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CHECK((outcome='verified' AND observed_checksum=expected_checksum AND observed_byte_size=expected_byte_size) OR outcome<>'verified')
);

CREATE FUNCTION validate_asset_integrity_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE registered_checksum char(64); registered_size bigint;
BEGIN
  SELECT checksum,byte_size INTO registered_checksum,registered_size FROM asset_content_objects WHERE id=NEW.content_object_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'asset content object does not exist' USING ERRCODE='23503'; END IF;
  IF NEW.expected_checksum IS DISTINCT FROM registered_checksum OR NEW.expected_byte_size IS DISTINCT FROM registered_size THEN
    RAISE EXCEPTION 'asset integrity baseline does not match registered content' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_integrity_checks_validate BEFORE INSERT ON asset_content_integrity_checks FOR EACH ROW EXECUTE FUNCTION validate_asset_integrity_check();

CREATE FUNCTION guard_asset_content_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF (to_jsonb(NEW)-ARRAY['integrity_state','last_verified_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['integrity_state','last_verified_at']::text[]) THEN
    RAISE EXCEPTION 'asset content identity and locator are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_content_objects_guard BEFORE UPDATE ON asset_content_objects FOR EACH ROW EXECUTE FUNCTION guard_asset_content_object();

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  asset_key text NOT NULL CHECK(asset_key ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  asset_kind text NOT NULL CHECK(asset_kind IN ('attachment','cover','illustration','audio','video','document','dataset','font','other')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(book_id,asset_key),
  UNIQUE(id,book_id),
  CHECK((status='active' AND archived_at IS NULL) OR (status='archived' AND archived_at IS NOT NULL))
);

CREATE TABLE asset_versions (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL,
  book_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0),
  content_object_id uuid NOT NULL REFERENCES asset_content_objects(id),
  base_version_id uuid,
  derived_from_version_id uuid REFERENCES asset_versions(id),
  source_kind text NOT NULL CHECK(source_kind IN ('upload','import','ai_generated','derived','external_reference','migration')),
  source_resource_id uuid REFERENCES dependency_resources(id),
  display_filename text NOT NULL CHECK(length(display_filename) BETWEEN 1 AND 500 AND display_filename !~ '[\\/]'),
  title text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  rebuildable boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id,version),
  UNIQUE(id,asset_id),
  FOREIGN KEY(asset_id,book_id) REFERENCES assets(id,book_id) ON DELETE CASCADE,
  FOREIGN KEY(base_version_id,asset_id) REFERENCES asset_versions(id,asset_id),
  CHECK((source_kind='derived' AND derived_from_version_id IS NOT NULL AND rebuildable) OR source_kind<>'derived')
);

ALTER TABLE assets ADD CONSTRAINT assets_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES asset_versions(id,asset_id);

CREATE TABLE asset_adoptions (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL,
  book_id uuid NOT NULL,
  from_version_id uuid,
  to_version_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('adopt','rollback','readopt')),
  asset_revision integer NOT NULL CHECK(asset_revision>0),
  dependency_preview_id uuid REFERENCES dependency_change_previews(id),
  idempotency_key text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(asset_id,book_id) REFERENCES assets(id,book_id) ON DELETE CASCADE,
  FOREIGN KEY(from_version_id,asset_id) REFERENCES asset_versions(id,asset_id),
  FOREIGN KEY(to_version_id,asset_id) REFERENCES asset_versions(id,asset_id),
  UNIQUE(book_id,idempotency_key),
  CHECK(from_version_id IS NULL OR from_version_id=to_version_id OR dependency_preview_id IS NOT NULL)
);

CREATE TABLE asset_events (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  asset_version_id uuid,
  action text NOT NULL CHECK(action IN ('create','add_version','adopt','rollback','readopt','archive')),
  from_status text,
  to_status text,
  asset_revision integer NOT NULL CHECK(asset_revision>0),
  dependency_preview_id uuid REFERENCES dependency_change_previews(id),
  idempotency_key text,
  actor text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key),
  FOREIGN KEY(asset_id,book_id) REFERENCES assets(id,book_id) ON DELETE CASCADE,
  FOREIGN KEY(asset_version_id,asset_id) REFERENCES asset_versions(id,asset_id)
);

CREATE TABLE asset_mounts (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  asset_version_id uuid NOT NULL,
  owner_kind text NOT NULL CHECK(owner_kind IN ('book','card_version','chapter_body_version','research_record_version','prompt_recipe_version','ai_task_attempt','quality_issue_evidence')),
  owner_stable_id uuid NOT NULL,
  owner_exact_version_id uuid NOT NULL,
  role text NOT NULL CHECK(role ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  idempotency_key text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text NOT NULL DEFAULT '',
  FOREIGN KEY(asset_id,book_id) REFERENCES assets(id,book_id) ON DELETE CASCADE,
  FOREIGN KEY(asset_version_id,asset_id) REFERENCES asset_versions(id,asset_id),
  UNIQUE(book_id,idempotency_key),
  CHECK((status='active' AND ended_at IS NULL) OR (status='ended' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX asset_mounts_active_unique ON asset_mounts(book_id,owner_kind,owner_stable_id,owner_exact_version_id,role,asset_version_id) WHERE status='active';
CREATE INDEX asset_mounts_owner_idx ON asset_mounts(book_id,owner_kind,owner_stable_id,status,created_at DESC);
CREATE INDEX asset_mounts_asset_idx ON asset_mounts(book_id,asset_id,status,created_at DESC);

CREATE FUNCTION validate_asset_mount() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_book uuid; version_book uuid;
BEGIN
  SELECT book_id INTO version_book FROM asset_versions WHERE id=NEW.asset_version_id AND asset_id=NEW.asset_id;
  IF version_book IS DISTINCT FROM NEW.book_id THEN RAISE EXCEPTION 'asset version belongs to another book' USING ERRCODE='23514'; END IF;
  CASE NEW.owner_kind
    WHEN 'book' THEN SELECT id INTO owner_book FROM books WHERE id=NEW.owner_stable_id AND id=NEW.owner_exact_version_id;
    WHEN 'card_version' THEN SELECT book.id INTO owner_book FROM card_versions version JOIN cards card ON card.id=version.card_id JOIN books book ON book.space_id=card.space_id WHERE card.id=NEW.owner_stable_id AND version.id=NEW.owner_exact_version_id;
    WHEN 'chapter_body_version' THEN SELECT document.book_id INTO owner_book FROM chapter_body_versions version JOIN chapter_documents document ON document.id=version.chapter_document_id WHERE document.id=NEW.owner_stable_id AND version.id=NEW.owner_exact_version_id;
    WHEN 'research_record_version' THEN SELECT NEW.book_id INTO owner_book FROM research_record_versions version WHERE version.record_id=NEW.owner_stable_id AND version.id=NEW.owner_exact_version_id AND EXISTS(SELECT 1 FROM book_research_references reference WHERE reference.book_id=NEW.book_id AND (reference.research_version_id=version.id OR EXISTS(SELECT 1 FROM research_reference_pack_items item WHERE item.pack_version_id=reference.pack_version_id AND item.research_version_id=version.id)));
    WHEN 'prompt_recipe_version' THEN SELECT NEW.book_id INTO owner_book FROM prompt_recipe_versions version WHERE version.recipe_id=NEW.owner_stable_id AND version.id=NEW.owner_exact_version_id;
    WHEN 'ai_task_attempt' THEN SELECT task.book_id INTO owner_book FROM ai_task_attempts attempt JOIN ai_tasks task ON task.id=attempt.task_id WHERE attempt.task_id=NEW.owner_stable_id AND attempt.id=NEW.owner_exact_version_id;
    WHEN 'quality_issue_evidence' THEN SELECT issue.book_id INTO owner_book FROM quality_issue_evidence evidence JOIN quality_issue_versions version ON version.id=evidence.issue_version_id JOIN quality_issues issue ON issue.id=version.issue_id WHERE evidence.id=NEW.owner_stable_id AND evidence.id=NEW.owner_exact_version_id;
  END CASE;
  IF owner_book IS DISTINCT FROM NEW.book_id THEN RAISE EXCEPTION 'asset mount owner is invalid or belongs to another book' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_mounts_validate BEFORE INSERT ON asset_mounts FOR EACH ROW EXECUTE FUNCTION validate_asset_mount();

CREATE FUNCTION guard_asset_mount_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'asset mounts are append-only' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'active' OR NEW.status<>'ended' OR NEW.ended_at IS NULL OR
     (to_jsonb(NEW)-ARRAY['status','ended_at','end_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','ended_at','end_reason']::text[]) THEN
    RAISE EXCEPTION 'asset mount may only transition from active to ended' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_mounts_append_only BEFORE UPDATE OR DELETE ON asset_mounts FOR EACH ROW EXECUTE FUNCTION guard_asset_mount_append_only();

CREATE TABLE asset_derivations (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_asset_version_id uuid NOT NULL REFERENCES asset_versions(id),
  output_asset_id uuid NOT NULL,
  derivative_kind text NOT NULL CHECK(derivative_kind IN ('thumbnail','ocr_text','transcode','frame_extract','parsed_text','cover_variant','other')),
  recipe_key text NOT NULL CHECK(recipe_key ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  recipe_version text NOT NULL,
  tool_key text NOT NULL CHECK(tool_key ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  tool_version text NOT NULL,
  parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object'),
  parameters_hash char(64) NOT NULL CHECK(parameters_hash ~ '^[a-f0-9]{64}$'),
  expected_source_checksum char(64) NOT NULL CHECK(expected_source_checksum ~ '^[a-f0-9]{64}$'),
  expected_output_asset_revision integer NOT NULL CHECK(expected_output_asset_revision>0),
  expected_output_current_version_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','failed','stale','rebuild_pending','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(output_asset_id,book_id) REFERENCES assets(id,book_id),
  UNIQUE(book_id,idempotency_key)
);

CREATE FUNCTION validate_asset_derivation_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_book uuid; source_checksum char(64); source_current uuid; source_status text;
  output_book uuid; output_revision integer; output_current uuid; output_status text;
BEGIN
  SELECT version.book_id,content.checksum,asset.current_version_id,asset.status
    INTO source_book,source_checksum,source_current,source_status
  FROM asset_versions version
  JOIN assets asset ON asset.id=version.asset_id
  JOIN asset_content_objects content ON content.id=version.content_object_id
  WHERE version.id=NEW.source_asset_version_id;
  SELECT book_id,revision,current_version_id,status
    INTO output_book,output_revision,output_current,output_status
  FROM assets WHERE id=NEW.output_asset_id;
  IF source_book IS DISTINCT FROM NEW.book_id OR output_book IS DISTINCT FROM NEW.book_id THEN
    RAISE EXCEPTION 'asset derivation cannot cross book boundary' USING ERRCODE='23514';
  END IF;
  IF source_status<>'active' OR source_current IS DISTINCT FROM NEW.source_asset_version_id THEN
    RAISE EXCEPTION 'asset derivation source must be the currently adopted version' USING ERRCODE='23514';
  END IF;
  IF output_status<>'active' THEN RAISE EXCEPTION 'asset derivation output asset must be active' USING ERRCODE='23514'; END IF;
  IF source_checksum IS DISTINCT FROM NEW.expected_source_checksum OR
     output_revision IS DISTINCT FROM NEW.expected_output_asset_revision OR
     output_current IS DISTINCT FROM NEW.expected_output_current_version_id THEN
    RAISE EXCEPTION 'asset derivation optimistic snapshot is inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_derivations_validate BEFORE INSERT ON asset_derivations FOR EACH ROW EXECUTE FUNCTION validate_asset_derivation_request();

CREATE TABLE asset_derivation_events (
  id uuid PRIMARY KEY,
  derivation_id uuid NOT NULL REFERENCES asset_derivations(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL CHECK(to_status IN ('pending','processing','succeeded','failed','stale','rebuild_pending','archived')),
  action text NOT NULL CHECK(action IN ('request','start','complete','fail','reject_stale','mark_stale','queue_rebuild','archive')),
  actor text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  derivation_revision integer NOT NULL CHECK(derivation_revision>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_derivation_results (
  id uuid PRIMARY KEY,
  derivation_id uuid NOT NULL REFERENCES asset_derivations(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_asset_version_id uuid NOT NULL REFERENCES asset_versions(id),
  expected_source_checksum char(64) NOT NULL CHECK(expected_source_checksum ~ '^[a-f0-9]{64}$'),
  observed_current_source_version_id uuid,
  output_content_object_id uuid REFERENCES asset_content_objects(id),
  output_asset_version_id uuid REFERENCES asset_versions(id),
  output_checksum char(64) CHECK(output_checksum IS NULL OR output_checksum ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK(outcome IN ('applied','rejected_stale','failed')),
  detail text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key),
  CHECK((outcome='applied' AND output_content_object_id IS NOT NULL AND output_asset_version_id IS NOT NULL AND output_checksum IS NOT NULL) OR outcome<>'applied')
);

CREATE FUNCTION guard_asset_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'asset version history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER asset_versions_immutable BEFORE UPDATE OR DELETE ON asset_versions FOR EACH ROW EXECUTE FUNCTION guard_asset_history_append_only();
CREATE TRIGGER asset_adoptions_immutable BEFORE UPDATE OR DELETE ON asset_adoptions FOR EACH ROW EXECUTE FUNCTION guard_asset_history_append_only();
CREATE TRIGGER asset_events_immutable BEFORE UPDATE OR DELETE ON asset_events FOR EACH ROW EXECUTE FUNCTION guard_asset_history_append_only();
CREATE TRIGGER asset_integrity_checks_immutable BEFORE UPDATE OR DELETE ON asset_content_integrity_checks FOR EACH ROW EXECUTE FUNCTION guard_asset_history_append_only();
CREATE TRIGGER asset_derivation_events_immutable BEFORE UPDATE OR DELETE ON asset_derivation_events FOR EACH ROW EXECUTE FUNCTION guard_asset_history_append_only();
CREATE TRIGGER asset_derivation_results_immutable BEFORE UPDATE OR DELETE ON asset_derivation_results FOR EACH ROW EXECUTE FUNCTION guard_asset_history_append_only();

CREATE FUNCTION guard_asset_derivation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','revision','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at']::text[]) THEN RAISE EXCEPTION 'derivation contract is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 OR NOT (
    (OLD.status='pending' AND NEW.status IN ('processing','failed','stale','archived')) OR
    (OLD.status='processing' AND NEW.status IN ('succeeded','failed','stale')) OR
    (OLD.status='succeeded' AND NEW.status IN ('stale','archived')) OR
    (OLD.status IN ('failed','stale') AND NEW.status IN ('rebuild_pending','archived')) OR
    (OLD.status='rebuild_pending' AND NEW.status IN ('processing','archived'))
  ) THEN RAISE EXCEPTION 'invalid asset derivation transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_derivations_transition BEFORE UPDATE ON asset_derivations FOR EACH ROW EXECUTE FUNCTION guard_asset_derivation_transition();

ALTER TABLE dependency_resources DROP CONSTRAINT dependency_resources_resource_kind_check;
ALTER TABLE dependency_resources ADD CONSTRAINT dependency_resources_resource_kind_check CHECK(resource_kind IN (
  'card_type_version','template_group_version','card_version','card_relation',
  'research_document_version','research_record_version','research_reference_pack_version',
  'chapter_body_version','chapter_text_anchor','canonical_fact','chapter_settlement',
  'state_change','knowledge_state_change','story_event_timing','story_event_relation',
  'planning_version','prompt_recipe_version','task_contract_version','context_manifest',
  'model_route_snapshot','ai_task_attempt','quality_audit_report','asset_version'
));

CREATE OR REPLACE FUNCTION validate_dependency_resource() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved record;
BEGIN
  IF NEW.resource_kind='asset_version' THEN
    SELECT asset.space_id,version.book_id,content.checksum INTO resolved
    FROM asset_versions version JOIN assets asset ON asset.id=version.asset_id JOIN asset_content_objects content ON content.id=version.content_object_id
    WHERE version.asset_id=NEW.stable_object_id AND version.id=NEW.exact_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'asset dependency resource reference does not resolve' USING ERRCODE='23503'; END IF;
    NEW.space_id:=resolved.space_id; NEW.book_id:=resolved.book_id; NEW.content_hash:=resolved.checksum;
  ELSE
    SELECT * INTO resolved FROM resolve_dependency_resource(NEW.resource_kind,NEW.stable_object_id,NEW.exact_version_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'dependency resource reference does not resolve' USING ERRCODE='23503'; END IF;
    NEW.space_id:=resolved.resolved_space_id; NEW.book_id:=resolved.resolved_book_id; NEW.content_hash:=resolved.resolved_hash;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE dependency_invalidation_events DROP CONSTRAINT dependency_invalidation_events_trigger_source_check;
ALTER TABLE dependency_invalidation_events ADD CONSTRAINT dependency_invalidation_events_trigger_source_check CHECK(trigger_source IN ('body_adoption','planning_adoption','fact_review','settlement','knowledge_review','story_time_review','story_relation_review','contract_publication','quality_stale','asset_adoption','asset_archive','manual','system'));

CREATE FUNCTION bridge_asset_version_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_asset_id uuid;
BEGIN
  PERFORM register_dependency_resource('asset_version',NEW.asset_id,NEW.id);
  IF NEW.derived_from_version_id IS NOT NULL THEN
    SELECT asset_id INTO source_asset_id FROM asset_versions WHERE id=NEW.derived_from_version_id;
    PERFORM add_registered_dependency('asset_version',source_asset_id,NEW.derived_from_version_id,'asset_version',NEW.asset_id,NEW.id,'derived_from','hard','system',NEW.id);
  END IF;
  IF NEW.source_resource_id IS NOT NULL THEN
    INSERT INTO dependency_edges(id,space_id,book_id,source_resource_id,derived_resource_id,dependency_kind,dependency_strength,origin_kind,origin_id)
    SELECT gen_random_uuid(),asset.space_id,NEW.book_id,NEW.source_resource_id,derived.id,'generated_from','hard',CASE WHEN NEW.source_kind='ai_generated' THEN 'ai_result' ELSE 'system' END,NEW.id
    FROM assets asset JOIN dependency_resources derived ON derived.resource_kind='asset_version' AND derived.stable_object_id=NEW.asset_id AND derived.exact_version_id=NEW.id
    WHERE asset.id=NEW.asset_id
    ON CONFLICT(source_resource_id,derived_resource_id,dependency_kind) WHERE status='active' DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_versions_dependency_bridge AFTER INSERT ON asset_versions FOR EACH ROW EXECUTE FUNCTION bridge_asset_version_dependency();

CREATE FUNCTION bridge_asset_change_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_resource uuid; new_resource uuid; event_id uuid;
BEGIN
  IF TG_TABLE_NAME='asset_adoptions' AND NEW.from_version_id IS NOT NULL AND NEW.from_version_id<>NEW.to_version_id THEN
    old_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.from_version_id);
    new_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.to_version_id);
    event_id:=record_dependency_invalidation(gen_random_uuid(),NEW.book_id,old_resource,new_resource,'附件采用版本发生变化。','asset_adoption','stale',NEW.id,'asset-adoption:'||NEW.id::text,NEW.dependency_preview_id,NULL);
  ELSIF TG_TABLE_NAME='asset_events' AND NEW.action='archive' AND NEW.asset_version_id IS NOT NULL THEN
    old_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.asset_version_id);
    event_id:=record_dependency_invalidation(gen_random_uuid(),NEW.book_id,old_resource,NULL,'附件已归档。','asset_archive','invalid',NEW.id,'asset-archive:'||NEW.id::text,NEW.dependency_preview_id,NULL);
  END IF;
  IF event_id IS NOT NULL THEN
    INSERT INTO asset_derivation_events(id,derivation_id,from_status,to_status,action,actor,detail,derivation_revision)
    SELECT gen_random_uuid(),derivation.id,'succeeded','stale','mark_stale','system','来源附件版本发生变化，派生结果等待重建。',derivation.revision+1
    FROM asset_derivations derivation
    WHERE derivation.status='succeeded' AND EXISTS(
      SELECT 1
      FROM dependency_invalidation_impacts impact
      JOIN dependency_resources resource ON resource.id=impact.resource_id AND resource.resource_kind='asset_version'
      JOIN asset_derivation_results result ON result.output_asset_version_id=resource.exact_version_id AND result.derivation_id=derivation.id
      WHERE impact.event_id=event_id
    );
    UPDATE asset_derivations derivation SET status='stale',revision=revision+1,updated_at=now()
    WHERE derivation.status='succeeded' AND EXISTS(
      SELECT 1
      FROM dependency_invalidation_impacts impact
      JOIN dependency_resources resource ON resource.id=impact.resource_id AND resource.resource_kind='asset_version'
      JOIN asset_derivation_results result ON result.output_asset_version_id=resource.exact_version_id AND result.derivation_id=derivation.id
      WHERE impact.event_id=event_id
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_adoptions_dependency_change AFTER INSERT ON asset_adoptions FOR EACH ROW EXECUTE FUNCTION bridge_asset_change_events();
CREATE TRIGGER asset_archive_dependency_change AFTER INSERT ON asset_events FOR EACH ROW EXECUTE FUNCTION bridge_asset_change_events();

CREATE INDEX asset_versions_asset_idx ON asset_versions(asset_id,version DESC);
CREATE INDEX assets_book_status_idx ON assets(book_id,status,updated_at DESC);
CREATE INDEX asset_derivations_queue_idx ON asset_derivations(book_id,status,created_at,id);
CREATE INDEX asset_derivation_results_request_idx ON asset_derivation_results(derivation_id,created_at,id);

INSERT INTO schema_migrations(id) VALUES('027_asset_version_ledger') ON CONFLICT(id) DO NOTHING;
