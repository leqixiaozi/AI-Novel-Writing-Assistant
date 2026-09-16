SET search_path TO new_design,public;

-- Execution metadata and immutable model reply on the original request, not another body store.
ALTER TABLE chapter_writing_requests ADD COLUMN controlled_snapshot jsonb CHECK(controlled_snapshot IS NULL OR jsonb_typeof(controlled_snapshot)='object');
ALTER TABLE chapter_writing_requests ADD COLUMN controlled_output jsonb CHECK(controlled_output IS NULL OR jsonb_typeof(controlled_output)='object');
ALTER TABLE chapter_writing_requests ADD COLUMN controlled_execution jsonb CHECK(controlled_execution IS NULL OR jsonb_typeof(controlled_execution)='object');
CREATE OR REPLACE FUNCTION guard_chapter_writing_request() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter writing request cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['ai_task_id','result_body_version_id','status','error_summary','updated_at','controlled_output','controlled_execution']::text[]) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['ai_task_id','result_body_version_id','status','error_summary','updated_at','controlled_output','controlled_execution']::text[]) THEN
    RAISE EXCEPTION 'chapter writing request frozen inputs are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('succeeded','failed','cancelled','stale') THEN RAISE EXCEPTION 'terminal chapter writing request is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.controlled_output IS NOT NULL AND ROW(NEW.controlled_output,NEW.controlled_execution) IS DISTINCT FROM ROW(OLD.controlled_output,OLD.controlled_execution) THEN RAISE EXCEPTION 'controlled model reply is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.controlled_output IS NOT NULL AND (NEW.controlled_snapshot IS NULL OR NEW.controlled_execution IS NULL) THEN RAISE EXCEPTION 'controlled reply requires frozen provenance' USING ERRCODE='23514'; END IF;
  IF NEW.controlled_output IS NOT NULL THEN
    IF jsonb_typeof(NEW.controlled_output->'content') IS DISTINCT FROM 'string' OR length(btrim(NEW.controlled_output->>'content'))=0 OR length(NEW.controlled_output->>'content')>2000000 OR NEW.controlled_output->>'decision' IS NULL OR NEW.controlled_output->>'decision' NOT IN ('continue','continue_with_warning','pause_for_manual','stop_for_replan') OR jsonb_typeof(NEW.controlled_output->'warnings') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.controlled_output->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'controlled reply structured fields mismatch' USING ERRCODE='23514'; END IF;
    IF jsonb_array_length(NEW.controlled_output->'warnings')>100 OR length(NEW.controlled_output->>'reason')>4000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.controlled_output->'warnings') warning WHERE jsonb_typeof(warning) IS DISTINCT FROM 'string' OR length(warning#>>'{}') NOT BETWEEN 1 AND 2000) THEN RAISE EXCEPTION 'controlled reply warning boundaries mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF OLD.controlled_output IS NULL AND NEW.controlled_output IS NOT NULL AND (OLD.status<>'running' OR NEW.status<>'running' OR NOT EXISTS(
    SELECT 1 FROM ai_task_steps step JOIN ai_task_attempts attempt ON attempt.id=step.current_attempt_id
    WHERE step.task_id=NEW.ai_task_id AND step.lease_expires_at>now() AND attempt.status='running' AND attempt.task_contract_version_id=NEW.task_contract_version_id
      AND attempt.context_manifest_id=NEW.context_manifest_id AND attempt.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND attempt.model_route_snapshot_id=NEW.model_route_snapshot_id)) THEN RAISE EXCEPTION 'controlled reply needs original live attempt' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='preparing' AND NEW.status IN ('queued','unavailable','cancelled')) OR
    (OLD.status='queued' AND NEW.status IN ('running','succeeded','failed','cancelled','unavailable','stale')) OR
    (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled','stale')) OR
    (OLD.status='unavailable' AND NEW.status IN ('preparing','queued','cancelled'))
  ) THEN RAISE EXCEPTION 'illegal chapter writing request transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_chapter_writing_request_scope() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE document_row chapter_documents%ROWTYPE; manifest_row context_manifests%ROWTYPE; contract_prompt uuid; controlled boolean;
BEGIN
  SELECT * INTO document_row FROM chapter_documents WHERE id=NEW.chapter_document_id;
  IF NOT FOUND OR document_row.book_id IS DISTINCT FROM NEW.book_id THEN RAISE EXCEPTION 'chapter writing request book mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM planning_objects object WHERE object.id=NEW.planning_object_id AND object.book_id=NEW.book_id AND object.card_id=document_row.chapter_card_id AND object.level='chapter' AND (TG_OP<>'INSERT' OR object.adopted_version_id=NEW.planning_version_id)) THEN RAISE EXCEPTION 'chapter writing request plan mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO manifest_row FROM context_manifests WHERE id=NEW.context_manifest_id;
  SELECT prompt_recipe_version_id INTO contract_prompt FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
  controlled:=NEW.controlled_snapshot IS NOT NULL;
  IF controlled THEN
    IF NEW.controlled_snapshot->'input'->>'operation' IS DISTINCT FROM NEW.operation_kind OR NEW.controlled_snapshot->'input'->'body'->>'versionId' IS DISTINCT FROM NEW.input_body_version_id::text OR NEW.controlled_snapshot->'input'->'body'->>'contentHash' IS DISTINCT FROM NEW.input_body_hash::text OR NEW.controlled_snapshot->'input'->'selection'->>'start' IS DISTINCT FROM NEW.selection_start::text OR NEW.controlled_snapshot->'input'->'selection'->>'end' IS DISTINCT FROM NEW.selection_end::text THEN RAISE EXCEPTION 'controlled body operation mismatch' USING ERRCODE='23514'; END IF;
    IF NEW.input_body_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chapter_body_versions body WHERE body.id=NEW.input_body_version_id AND body.chapter_document_id=NEW.chapter_document_id AND body.content=NEW.controlled_snapshot->'input'->'body'->>'content') THEN RAISE EXCEPTION 'controlled frozen body content mismatch' USING ERRCODE='23514'; END IF;
    IF NEW.selection_start IS NOT NULL AND (NEW.controlled_snapshot->'candidateBoundary'->>'prefix'||(NEW.controlled_snapshot->'input'->'selection'->>'text')||(NEW.controlled_snapshot->'candidateBoundary'->>'suffix')) IS DISTINCT FROM NEW.controlled_snapshot->'input'->'body'->>'content' THEN RAISE EXCEPTION 'controlled selection boundary mismatch' USING ERRCODE='23514'; END IF;
    IF NEW.result_body_version_id IS NOT NULL THEN
      IF NEW.controlled_output IS NULL OR NOT EXISTS(SELECT 1 FROM chapter_body_versions body WHERE body.id=NEW.result_body_version_id AND body.content=CASE WHEN NEW.selection_start IS NULL THEN NEW.controlled_output->>'content' ELSE (NEW.controlled_snapshot->'candidateBoundary'->>'prefix')||(NEW.controlled_output->>'content')||(NEW.controlled_snapshot->'candidateBoundary'->>'suffix') END) THEN RAISE EXCEPTION 'controlled candidate differs from saved reply' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  IF controlled AND (NEW.controlled_snapshot->>'assetId' IS DISTINCT FROM 'new_design.chapter.generate_candidate' OR NEW.controlled_snapshot->>'assetVersion' IS DISTINCT FROM 'v1' OR
    NEW.controlled_snapshot->'input'->>'bookId' IS DISTINCT FROM NEW.book_id::text OR NEW.controlled_snapshot->'input'->>'chapterCardId' IS DISTINCT FROM document_row.chapter_card_id::text OR
    NEW.controlled_snapshot->>'contextManifestId' IS DISTINCT FROM NEW.context_manifest_id::text OR NEW.controlled_snapshot->>'taskContractVersionId' IS DISTINCT FROM NEW.task_contract_version_id::text OR
    NOT EXISTS(SELECT 1 FROM task_contract_versions version JOIN task_contracts contract ON contract.id=version.contract_id JOIN prompt_recipe_versions recipe ON recipe.id=version.prompt_recipe_version_id
      WHERE version.id=NEW.task_contract_version_id AND version.task_group='controlled_chapter_generation' AND contract.task_key='controlled_chapter_'||NEW.id::text
        AND version.input_schema->'const'=NEW.controlled_snapshot->'input' AND recipe.variables_schema->'const'=NEW.controlled_snapshot->'input')) THEN RAISE EXCEPTION 'controlled chapter runtime scope mismatch' USING ERRCODE='23514'; END IF;
  IF manifest_row.book_id IS DISTINCT FROM NEW.book_id OR manifest_row.chapter_id IS DISTINCT FROM document_row.chapter_card_id OR
    (CASE WHEN controlled THEN manifest_row.status<>'complete' ELSE manifest_row.status<>'finalized' END) OR
    manifest_row.task_contract_version_id IS DISTINCT FROM NEW.task_contract_version_id OR manifest_row.prompt_recipe_version_id IS DISTINCT FROM NEW.prompt_recipe_version_id OR
    manifest_row.model_route_snapshot_id IS DISTINCT FROM NEW.model_route_snapshot_id OR contract_prompt IS DISTINCT FROM NEW.prompt_recipe_version_id THEN RAISE EXCEPTION 'chapter writing frozen runtime mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.input_body_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chapter_body_versions version WHERE version.id=NEW.input_body_version_id AND version.chapter_document_id=NEW.chapter_document_id AND version.content_hash=NEW.input_body_hash) THEN RAISE EXCEPTION 'chapter writing input body mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.ai_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_tasks task WHERE task.id=NEW.ai_task_id AND task.book_id=NEW.book_id AND task.task_contract_version_id=NEW.task_contract_version_id AND task.source_kind='chapter_writing_request' AND task.source_id=NEW.id) THEN RAISE EXCEPTION 'chapter writing AI task mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.result_body_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chapter_body_versions version WHERE version.id=NEW.result_body_version_id AND version.chapter_document_id=NEW.chapter_document_id AND version.source='ai_candidate' AND version.operation_kind=NEW.operation_kind AND version.planning_object_id=NEW.planning_object_id AND version.planning_version_id=NEW.planning_version_id AND version.context_manifest_id=NEW.context_manifest_id AND version.task_contract_version_id=NEW.task_contract_version_id AND version.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND version.model_route_snapshot_id=NEW.model_route_snapshot_id AND version.ai_task_id=NEW.ai_task_id AND version.input_body_version_id IS NOT DISTINCT FROM NEW.input_body_version_id) THEN RAISE EXCEPTION 'chapter writing result body mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE TABLE production_director_runs (
  id uuid PRIMARY KEY,book_id uuid NOT NULL REFERENCES books(id),request_key uuid NOT NULL,request_hash char(64) NOT NULL,
  issue_policy text NOT NULL CHECK(issue_policy IN ('completion_first','quality_first')),instruction text NOT NULL CHECK(length(instruction)<=4000),
  knowledge_sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(knowledge_sources)='array' AND jsonb_array_length(knowledge_sources)<=20),
  status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','running','paused','waiting_recovery','failed','completed','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),pause_requested boolean NOT NULL DEFAULT false,
  lease_token uuid,lease_expires_at timestamptz,failure jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,request_key),UNIQUE(id,book_id)
);
CREATE TABLE production_director_chapters (
  run_id uuid NOT NULL,book_id uuid NOT NULL,sort_order integer NOT NULL CHECK(sort_order>=0),
  planning_object_id uuid NOT NULL,planning_version_id uuid NOT NULL,expected_planning_revision integer NOT NULL CHECK(expected_planning_revision>0),
  chapter_card_id uuid NOT NULL REFERENCES cards(id),title text NOT NULL,
  current_request_id uuid REFERENCES chapter_writing_requests(id),current_request_key uuid NOT NULL,boundary_completed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(run_id,chapter_card_id),UNIQUE(run_id,sort_order),
  FOREIGN KEY(run_id,book_id) REFERENCES production_director_runs(id,book_id),
  FOREIGN KEY(planning_version_id,planning_object_id) REFERENCES planning_versions(id,object_id)
);
CREATE TABLE production_director_commands (
  book_id uuid NOT NULL REFERENCES books(id),request_key uuid NOT NULL,run_id uuid NOT NULL,
  request_hash char(64) NOT NULL,action text NOT NULL CHECK(action IN ('create','run','pause','resume','retry_failed','end_expired','cancel')),
  accepted_revision integer NOT NULL CHECK(accepted_revision>0),created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(book_id,request_key),FOREIGN KEY(run_id,book_id) REFERENCES production_director_runs(id,book_id)
);
CREATE FUNCTION guard_production_director_metadata() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'director execution metadata cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='production_director_commands' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'director command receipt is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='production_director_runs' THEN
    IF ROW(NEW.id,NEW.book_id,NEW.request_key,NEW.request_hash,NEW.issue_policy,NEW.instruction,NEW.knowledge_sources,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.book_id,OLD.request_key,OLD.request_hash,OLD.issue_policy,OLD.instruction,OLD.knowledge_sources,OLD.created_at) THEN RAISE EXCEPTION 'director scope is immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='production_director_chapters' THEN
    IF (to_jsonb(NEW)-ARRAY['current_request_id','current_request_key','boundary_completed']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_request_id','current_request_key','boundary_completed']::text[]) THEN RAISE EXCEPTION 'director frozen chapter range is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER director_runs_metadata_guard BEFORE UPDATE OR DELETE ON production_director_runs FOR EACH ROW EXECUTE FUNCTION guard_production_director_metadata();
CREATE TRIGGER director_chapters_metadata_guard BEFORE UPDATE OR DELETE ON production_director_chapters FOR EACH ROW EXECUTE FUNCTION guard_production_director_metadata();
CREATE TRIGGER director_commands_metadata_guard BEFORE UPDATE OR DELETE ON production_director_commands FOR EACH ROW EXECUTE FUNCTION guard_production_director_metadata();
CREATE FUNCTION validate_production_director_chapter_scope() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM planning_objects object WHERE object.id=NEW.planning_object_id AND object.book_id=NEW.book_id AND object.card_id=NEW.chapter_card_id AND object.level='chapter') THEN RAISE EXCEPTION 'director target chapter scope mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.current_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chapter_writing_requests request JOIN chapter_documents document ON document.id=request.chapter_document_id WHERE request.id=NEW.current_request_id AND request.book_id=NEW.book_id AND document.chapter_card_id=NEW.chapter_card_id AND request.planning_object_id=NEW.planning_object_id AND request.planning_version_id=NEW.planning_version_id AND request.idempotency_key=NEW.current_request_key::text AND request.controlled_snapshot IS NOT NULL) THEN RAISE EXCEPTION 'director original request scope mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER director_chapter_scope_guard BEFORE INSERT OR UPDATE ON production_director_chapters FOR EACH ROW EXECUTE FUNCTION validate_production_director_chapter_scope();
COMMENT ON TABLE production_director_chapters IS 'Frozen scope and pointers to original chapter generation requests. No body, adopted plan, relation or quality fact copy.';
