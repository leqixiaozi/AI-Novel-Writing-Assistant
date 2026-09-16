SET search_path TO new_design, public;

-- Extend only metadata: existing book-backed scope and every data row remain intact.
ALTER TABLE model_route_snapshots DROP CONSTRAINT model_route_snapshots_managed_scope_check;
ALTER TABLE model_route_snapshots ADD CONSTRAINT model_route_snapshots_managed_scope_check CHECK (
  (book_id IS NOT NULL AND task_contract_version_id IS NOT NULL AND managed_task_key IS NULL) OR
  (book_id IS NULL AND task_contract_version_id IS NULL AND managed_task_key IS NOT NULL AND managed_task_key IN ('directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate','chapter_settlement'))
);

ALTER TABLE chapter_proposal_extraction_requests ADD COLUMN frozen_plan jsonb CHECK(frozen_plan IS NULL OR jsonb_typeof(frozen_plan)='object');
ALTER TABLE chapter_proposal_extraction_requests ADD COLUMN frozen_input_hash text CHECK(frozen_input_hash IS NULL OR frozen_input_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE chapter_proposal_extraction_requests ADD COLUMN expected_session_revision integer CHECK(expected_session_revision IS NULL OR expected_session_revision>0);
ALTER TABLE chapter_proposal_extraction_requests ADD COLUMN generated_output jsonb CHECK(generated_output IS NULL OR jsonb_typeof(generated_output)='object');
ALTER TABLE chapter_proposal_extraction_requests ADD COLUMN generated_execution jsonb CHECK(generated_execution IS NULL OR jsonb_typeof(generated_execution)='object');
ALTER TABLE chapter_proposal_extraction_requests ADD COLUMN failure jsonb CHECK(failure IS NULL OR jsonb_typeof(failure)='object');
COMMENT ON COLUMN chapter_proposal_extraction_requests.generated_output IS 'Single governed model result, not adopted facts. Retained when proposal import fails; explicit import retry never invokes the model again.';

CREATE FUNCTION guard_chapter_settlement_ai_payload() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter extraction receipts cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.frozen_plan,NEW.frozen_input_hash,NEW.expected_session_revision) IS DISTINCT FROM ROW(OLD.frozen_plan,OLD.frozen_input_hash,OLD.expected_session_revision) THEN
      RAISE EXCEPTION 'chapter extraction input is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.generated_output IS NOT NULL AND ROW(NEW.generated_output,NEW.generated_execution) IS DISTINCT FROM ROW(OLD.generated_output,OLD.generated_execution) THEN
      RAISE EXCEPTION 'chapter extraction model result is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.frozen_plan IS NOT NULL AND OLD.ai_task_id IS DISTINCT FROM NEW.ai_task_id THEN RAISE EXCEPTION 'chapter extraction task is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.generated_execution IS NOT NULL AND NEW.generated_execution IS DISTINCT FROM OLD.generated_execution THEN RAISE EXCEPTION 'chapter extraction execution trace is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status='succeeded' AND (NEW.status<>OLD.status OR NEW.failure IS DISTINCT FROM OLD.failure) THEN RAISE EXCEPTION 'saved extraction import is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.frozen_plan IS NOT NULL AND OLD.status IN ('stale','cancelled') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'ended extraction is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.frozen_plan IS NOT NULL AND (NEW.frozen_input_hash IS NULL OR NEW.expected_session_revision IS NULL OR NEW.ai_task_id IS NULL OR NEW.frozen_plan->>'assetId' IS DISTINCT FROM 'new_design.chapter.settlement_candidates' OR NEW.frozen_plan->>'assetVersion' IS DISTINCT FROM 'v1' OR
    NEW.frozen_plan->'input'->>'sessionId' IS DISTINCT FROM NEW.session_id::text OR NEW.frozen_plan->'input'->>'bodyVersionId' IS DISTINCT FROM NEW.body_version_id::text OR
    NOT EXISTS(SELECT 1 FROM ai_tasks task JOIN task_contract_versions contract ON contract.id=task.task_contract_version_id JOIN task_contracts config ON config.id=contract.contract_id WHERE task.id=NEW.ai_task_id AND task.source_kind='chapter_settlement_extraction' AND task.source_id=NEW.id AND task.book_id=NEW.book_id AND contract.id=NEW.task_contract_version_id AND contract.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND contract.task_group='chapter_settlement' AND config.task_key='chapter_settlement_'||NEW.session_id::text)) THEN
    RAISE EXCEPTION 'chapter extraction controlled provenance is incomplete' USING ERRCODE='23514';
  END IF;
  IF NEW.generated_output IS NOT NULL AND (NEW.frozen_plan IS NULL OR NEW.generated_execution IS NULL) THEN RAISE EXCEPTION 'chapter extraction model result needs controlled provenance' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.generated_output IS NULL AND NEW.generated_output IS NOT NULL AND (OLD.status<>'running' OR NEW.status<>'running' OR
    NOT EXISTS(SELECT 1 FROM ai_task_attempts attempt WHERE attempt.task_id=NEW.ai_task_id AND attempt.status='running' AND attempt.input_hash=NEW.frozen_input_hash AND attempt.task_contract_version_id=NEW.task_contract_version_id AND attempt.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND attempt.context_manifest_id=NEW.context_manifest_id AND attempt.model_route_snapshot_id=NEW.model_route_snapshot_id)) THEN
    RAISE EXCEPTION 'chapter model output requires its running frozen attempt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_settlement_ai_payload_guard BEFORE INSERT OR UPDATE OR DELETE ON chapter_proposal_extraction_requests FOR EACH ROW EXECUTE FUNCTION guard_chapter_settlement_ai_payload();

CREATE FUNCTION validate_chapter_settlement_ai_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE task ai_tasks%ROWTYPE;
BEGIN
  SELECT * INTO task FROM ai_tasks WHERE id=NEW.task_id;
  IF task.source_kind='chapter_settlement_extraction' AND (NEW.attempt_number<>1 OR NEW.trigger_kind<>'initial' OR NEW.status NOT IN ('queued','running') OR NOT EXISTS(SELECT 1 FROM ai_task_steps step WHERE step.id=NEW.step_id AND step.task_id=NEW.task_id AND step.max_attempts=1)) THEN
    RAISE EXCEPTION 'chapter extraction is one initial attempt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_settlement_ai_attempt_guard BEFORE INSERT ON ai_task_attempts FOR EACH ROW EXECUTE FUNCTION validate_chapter_settlement_ai_attempt();
