SET search_path TO new_design, public;

ALTER TABLE chapter_body_versions
  ADD COLUMN operation_kind text NOT NULL DEFAULT 'manual_draft'
    CHECK(operation_kind IN ('manual_draft','copy','continue','rewrite','expand','shorten','dialogue','conflict','fix','regenerate')),
  ADD COLUMN planning_object_id uuid,
  ADD COLUMN planning_version_id uuid,
  ADD COLUMN context_manifest_id uuid REFERENCES context_manifests(id),
  ADD COLUMN task_contract_version_id uuid REFERENCES task_contract_versions(id),
  ADD COLUMN prompt_recipe_version_id uuid REFERENCES prompt_recipe_versions(id),
  ADD COLUMN model_route_snapshot_id uuid REFERENCES model_route_snapshots(id),
  ADD COLUMN ai_task_id uuid REFERENCES ai_tasks(id),
  ADD COLUMN ai_attempt_id uuid REFERENCES ai_task_attempts(id),
  ADD COLUMN input_body_version_id uuid,
  ADD COLUMN selection_start integer CHECK(selection_start IS NULL OR selection_start>=0),
  ADD COLUMN selection_end integer CHECK(selection_end IS NULL OR selection_end>selection_start),
  ADD CONSTRAINT chapter_body_versions_planning_fk
    FOREIGN KEY(planning_version_id,planning_object_id) REFERENCES planning_versions(id,object_id),
  ADD CONSTRAINT chapter_body_versions_input_fk
    FOREIGN KEY(input_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  ADD CONSTRAINT chapter_body_versions_selection_pair_check
    CHECK((selection_start IS NULL)=(selection_end IS NULL));

UPDATE chapter_body_versions SET operation_kind=CASE
  WHEN source='ai_candidate' THEN 'regenerate'
  WHEN source='revision' THEN 'copy'
  ELSE 'manual_draft'
END;

CREATE TABLE chapter_body_operations (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  operation_kind text NOT NULL CHECK(operation_kind IN ('save_candidate','copy_candidate','archive_candidate')),
  expected_revision integer NOT NULL CHECK(expected_revision>0),
  result_revision integer NOT NULL CHECK(result_revision>0),
  result_body_version_id uuid,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  actor text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(result_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE chapter_writing_requests (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  operation_kind text NOT NULL CHECK(operation_kind IN ('continue','rewrite','expand','shorten','dialogue','conflict','fix','regenerate')),
  planning_object_id uuid NOT NULL,
  planning_version_id uuid NOT NULL,
  planning_content_hash char(64) NOT NULL CHECK(planning_content_hash ~ '^[a-f0-9]{64}$'),
  context_manifest_id uuid NOT NULL REFERENCES context_manifests(id),
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  prompt_recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id),
  model_route_snapshot_id uuid NOT NULL REFERENCES model_route_snapshots(id),
  input_body_version_id uuid,
  input_body_hash char(64),
  selection_start integer CHECK(selection_start IS NULL OR selection_start>=0),
  selection_end integer CHECK(selection_end IS NULL OR selection_end>selection_start),
  instruction text NOT NULL DEFAULT '' CHECK(length(instruction)<=4000),
  expected_document_revision integer NOT NULL CHECK(expected_document_revision>0),
  ai_task_id uuid UNIQUE REFERENCES ai_tasks(id),
  result_body_version_id uuid,
  status text NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','queued','running','succeeded','failed','cancelled','unavailable','stale')),
  error_summary text NOT NULL DEFAULT '' CHECK(length(error_summary)<=2000),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(planning_version_id,planning_object_id) REFERENCES planning_versions(id,object_id),
  FOREIGN KEY(input_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  FOREIGN KEY(result_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  CHECK((selection_start IS NULL)=(selection_end IS NULL)),
  CHECK((input_body_version_id IS NULL)=(input_body_hash IS NULL)),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE chapter_adoption_preparations (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  body_version_id uuid NOT NULL,
  expected_document_revision integer NOT NULL CHECK(expected_document_revision>0),
  planning_object_id uuid NOT NULL,
  planning_version_id uuid NOT NULL,
  planning_content_hash char(64) NOT NULL CHECK(planning_content_hash ~ '^[a-f0-9]{64}$'),
  context_manifest_id uuid REFERENCES context_manifests(id),
  dependency_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(dependency_snapshot)='object'),
  dependency_hash char(64) NOT NULL CHECK(dependency_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','consumed','stale','cancelled')),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  FOREIGN KEY(planning_version_id,planning_object_id) REFERENCES planning_versions(id,object_id),
  UNIQUE(book_id,idempotency_key)
);

CREATE FUNCTION guard_chapter_body_version_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['archived_at']::text[]) THEN
    RAISE EXCEPTION 'chapter body version content and provenance are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL THEN
    RAISE EXCEPTION 'chapter body version archive is one way' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_body_versions_content_guard BEFORE UPDATE ON chapter_body_versions
  FOR EACH ROW EXECUTE FUNCTION guard_chapter_body_version_content();

CREATE FUNCTION validate_chapter_body_version_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_book uuid; document_chapter uuid;
BEGIN
  SELECT book_id,chapter_card_id INTO document_book,document_chapter FROM new_design.chapter_documents WHERE id=NEW.chapter_document_id;
  IF NEW.ai_attempt_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM new_design.ai_task_attempts attempt JOIN new_design.ai_tasks task ON task.id=attempt.task_id
    WHERE attempt.id=NEW.ai_attempt_id AND attempt.task_id=NEW.ai_task_id AND task.book_id=document_book
      AND attempt.task_contract_version_id=NEW.task_contract_version_id
      AND attempt.prompt_recipe_version_id=NEW.prompt_recipe_version_id
      AND attempt.context_manifest_id=NEW.context_manifest_id
      AND attempt.model_route_snapshot_id=NEW.model_route_snapshot_id
  ) THEN RAISE EXCEPTION 'chapter body AI attempt and frozen runtime mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.source='ai_candidate' AND NEW.source_run_id IS NULL AND (
    NEW.ai_task_id IS NULL OR NEW.ai_attempt_id IS NULL OR NEW.planning_version_id IS NULL OR
    NEW.context_manifest_id IS NULL OR NEW.task_contract_version_id IS NULL OR
    NEW.prompt_recipe_version_id IS NULL OR NEW.model_route_snapshot_id IS NULL
  ) THEN RAISE EXCEPTION 'new AI chapter candidate requires frozen provenance' USING ERRCODE='23514'; END IF;
  IF NEW.source<>'ai_candidate' AND (NEW.ai_task_id IS NOT NULL OR NEW.ai_attempt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'manual chapter candidate cannot claim AI execution provenance' USING ERRCODE='23514';
  END IF;
  IF NEW.planning_version_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM new_design.planning_objects object JOIN new_design.planning_versions version ON version.id=NEW.planning_version_id AND version.object_id=object.id
    WHERE object.id=NEW.planning_object_id AND object.book_id=document_book AND object.card_id=document_chapter AND object.level='chapter'
  ) THEN RAISE EXCEPTION 'chapter body planning provenance mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_body_versions_provenance_guard BEFORE INSERT ON chapter_body_versions
  FOR EACH ROW EXECUTE FUNCTION validate_chapter_body_version_provenance();

CREATE FUNCTION guard_chapter_writing_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'chapter writing request cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['ai_task_id','result_body_version_id','status','error_summary','updated_at']::text[])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['ai_task_id','result_body_version_id','status','error_summary','updated_at']::text[]) THEN
    RAISE EXCEPTION 'chapter writing request frozen inputs are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('succeeded','failed','cancelled','stale') THEN
    RAISE EXCEPTION 'terminal chapter writing request is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='preparing' AND NEW.status IN ('queued','unavailable','cancelled')) OR
    (OLD.status='queued' AND NEW.status IN ('running','succeeded','failed','cancelled','unavailable','stale')) OR
    (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled','stale')) OR
    (OLD.status='unavailable' AND NEW.status IN ('preparing','queued','cancelled'))
  ) THEN RAISE EXCEPTION 'illegal chapter writing request transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_writing_requests_guard BEFORE UPDATE OR DELETE ON chapter_writing_requests
  FOR EACH ROW EXECUTE FUNCTION guard_chapter_writing_request();

CREATE FUNCTION validate_chapter_writing_request_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_row chapter_documents%ROWTYPE; manifest_row context_manifests%ROWTYPE; contract_prompt uuid;
BEGIN
  SELECT * INTO document_row FROM new_design.chapter_documents WHERE id=NEW.chapter_document_id;
  IF NOT FOUND OR document_row.book_id IS DISTINCT FROM NEW.book_id THEN RAISE EXCEPTION 'chapter writing request book mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM new_design.planning_objects object WHERE object.id=NEW.planning_object_id AND object.book_id=NEW.book_id AND object.card_id=document_row.chapter_card_id AND object.level='chapter' AND (TG_OP<>'INSERT' OR object.adopted_version_id=NEW.planning_version_id)) THEN RAISE EXCEPTION 'chapter writing request plan mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO manifest_row FROM new_design.context_manifests WHERE id=NEW.context_manifest_id;
  SELECT prompt_recipe_version_id INTO contract_prompt FROM new_design.task_contract_versions WHERE id=NEW.task_contract_version_id;
  IF manifest_row.book_id IS DISTINCT FROM NEW.book_id OR manifest_row.chapter_id IS DISTINCT FROM document_row.chapter_card_id OR manifest_row.status<>'finalized' OR manifest_row.task_contract_version_id IS DISTINCT FROM NEW.task_contract_version_id OR manifest_row.prompt_recipe_version_id IS DISTINCT FROM NEW.prompt_recipe_version_id OR manifest_row.model_route_snapshot_id IS DISTINCT FROM NEW.model_route_snapshot_id OR contract_prompt IS DISTINCT FROM NEW.prompt_recipe_version_id THEN RAISE EXCEPTION 'chapter writing frozen runtime mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.input_body_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM new_design.chapter_body_versions version WHERE version.id=NEW.input_body_version_id AND version.chapter_document_id=NEW.chapter_document_id AND version.content_hash=NEW.input_body_hash) THEN RAISE EXCEPTION 'chapter writing input body mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.ai_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM new_design.ai_tasks task WHERE task.id=NEW.ai_task_id AND task.book_id=NEW.book_id AND task.task_contract_version_id=NEW.task_contract_version_id AND task.source_kind='chapter_writing_request' AND task.source_id=NEW.id) THEN RAISE EXCEPTION 'chapter writing AI task mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.result_body_version_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM new_design.chapter_body_versions version
    WHERE version.id=NEW.result_body_version_id AND version.chapter_document_id=NEW.chapter_document_id
      AND version.source='ai_candidate' AND version.operation_kind=NEW.operation_kind
      AND version.planning_object_id=NEW.planning_object_id AND version.planning_version_id=NEW.planning_version_id
      AND version.context_manifest_id=NEW.context_manifest_id AND version.task_contract_version_id=NEW.task_contract_version_id
      AND version.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND version.model_route_snapshot_id=NEW.model_route_snapshot_id
      AND version.ai_task_id=NEW.ai_task_id AND version.input_body_version_id IS NOT DISTINCT FROM NEW.input_body_version_id
  ) THEN RAISE EXCEPTION 'chapter writing result body mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_writing_requests_scope_guard BEFORE INSERT OR UPDATE ON chapter_writing_requests
  FOR EACH ROW EXECUTE FUNCTION validate_chapter_writing_request_scope();

CREATE FUNCTION guard_chapter_writing_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'chapter writing audit row is append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER chapter_body_operations_append_only BEFORE UPDATE OR DELETE ON chapter_body_operations
  FOR EACH ROW EXECUTE FUNCTION guard_chapter_writing_append_only();

CREATE FUNCTION validate_chapter_adoption_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM new_design.chapter_documents document
    JOIN new_design.chapter_body_versions body ON body.id=NEW.body_version_id AND body.chapter_document_id=document.id
    JOIN new_design.planning_objects object ON object.id=NEW.planning_object_id
    WHERE document.id=NEW.chapter_document_id AND document.book_id=NEW.book_id AND document.revision=NEW.expected_document_revision
      AND body.archived_at IS NULL AND body.planning_version_id=NEW.planning_version_id
      AND body.context_manifest_id IS NOT DISTINCT FROM NEW.context_manifest_id
      AND object.book_id=NEW.book_id AND object.card_id=document.chapter_card_id AND object.level='chapter'
      AND object.adopted_version_id=NEW.planning_version_id
  ) THEN RAISE EXCEPTION 'chapter adoption preparation dependencies mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_adoption_preparations_scope_guard BEFORE INSERT ON chapter_adoption_preparations
  FOR EACH ROW EXECUTE FUNCTION validate_chapter_adoption_preparation();

CREATE FUNCTION guard_chapter_adoption_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status']::text[]) THEN
    RAISE EXCEPTION 'chapter adoption preparation identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'prepared' OR NEW.status NOT IN ('consumed','stale','cancelled') THEN
    RAISE EXCEPTION 'illegal chapter adoption preparation transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_adoption_preparations_guard BEFORE UPDATE OR DELETE ON chapter_adoption_preparations
  FOR EACH ROW EXECUTE FUNCTION guard_chapter_adoption_preparation();

CREATE INDEX chapter_writing_requests_document_idx ON chapter_writing_requests(chapter_document_id,created_at DESC,id);
CREATE INDEX chapter_writing_requests_task_idx ON chapter_writing_requests(ai_task_id) WHERE ai_task_id IS NOT NULL;
CREATE INDEX chapter_adoption_preparations_document_idx ON chapter_adoption_preparations(chapter_document_id,created_at DESC,id);
CREATE INDEX chapter_body_versions_provenance_idx ON chapter_body_versions(chapter_document_id,planning_version_id,context_manifest_id,created_at DESC);
