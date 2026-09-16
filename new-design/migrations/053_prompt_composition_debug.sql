SET search_path TO new_design, public;

ALTER TABLE prompt_recipe_slot_components ADD COLUMN enabled boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN prompt_recipe_slot_components.enabled IS 'Immutable author-selected enablement of an exact prompt component reference; no trust elevation.';

ALTER TABLE ai_run_previews ALTER COLUMN context_preview_id DROP NOT NULL;
ALTER TABLE ai_run_previews ALTER COLUMN model_route_snapshot_id DROP NOT NULL;
ALTER TABLE ai_run_previews ADD CONSTRAINT ai_run_previews_debug_nullable_scope CHECK (
  (source_kind='prompt_composition_debug' AND (status NOT IN ('ready','submitted') OR model_route_snapshot_id IS NOT NULL)) OR
  (source_kind<>'prompt_composition_debug' AND context_preview_id IS NOT NULL AND model_route_snapshot_id IS NOT NULL)
);

ALTER TABLE ai_task_attempts ADD COLUMN debug_result jsonb;
ALTER TABLE ai_task_attempts ADD COLUMN debug_execution jsonb CHECK(debug_execution IS NULL OR jsonb_typeof(debug_execution)='object');
ALTER TABLE ai_task_attempts ADD COLUMN debug_failure jsonb CHECK(debug_failure IS NULL OR jsonb_typeof(debug_failure)='object');
COMMENT ON COLUMN ai_task_attempts.debug_result IS 'Trial output only, never a card/body/planning adoption. Frozen once on running-to-terminal transition.';

CREATE OR REPLACE FUNCTION guard_ai_attempt_update() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE debug_task boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AI attempts cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('succeeded','failed','cancelled','discarded') THEN RAISE EXCEPTION 'finished AI attempt is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','provider_request_digest','result_kind','result_stable_id','result_version_id','result_hash','error_category','retry_eligibility','error_summary','started_at','ended_at','debug_result','debug_execution','debug_failure']::text[]) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','provider_request_digest','result_kind','result_stable_id','result_version_id','result_hash','error_category','retry_eligibility','error_summary','started_at','ended_at','debug_result','debug_execution','debug_failure']::text[]) THEN
    RAISE EXCEPTION 'AI attempt frozen inputs are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','cancelled')) OR (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled','discarded'))) THEN
    RAISE EXCEPTION 'illegal AI attempt status transition' USING ERRCODE='23514';
  END IF;
  SELECT source_kind='prompt_composition_debug' INTO debug_task FROM new_design.ai_tasks WHERE id=OLD.task_id;
  IF debug_task IS true AND NEW.status IN ('succeeded','failed','cancelled','discarded') THEN
    IF (NEW.status='succeeded' AND (NEW.debug_result IS NULL OR NEW.debug_execution IS NULL OR NEW.debug_failure IS NOT NULL)) OR
       (NEW.status IN ('failed','cancelled','discarded') AND (NEW.debug_failure IS NULL OR NEW.debug_result IS NOT NULL)) THEN
      RAISE EXCEPTION 'debug terminal outcome is incomplete' USING ERRCODE='23514';
    END IF;
  END IF;
  IF ROW(NEW.debug_result,NEW.debug_execution,NEW.debug_failure) IS DISTINCT FROM ROW(OLD.debug_result,OLD.debug_execution,OLD.debug_failure) THEN
    IF debug_task IS DISTINCT FROM true OR OLD.status<>'running' OR NEW.status NOT IN ('succeeded','failed','cancelled','discarded') OR OLD.debug_result IS NOT NULL OR OLD.debug_execution IS NOT NULL OR OLD.debug_failure IS NOT NULL THEN
      RAISE EXCEPTION 'debug payload can only be frozen once when a debug attempt terminates' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION validate_debug_attempt_insert() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE debug_task boolean;
BEGIN
  IF NEW.debug_result IS NOT NULL OR NEW.debug_execution IS NOT NULL OR NEW.debug_failure IS NOT NULL THEN
    RAISE EXCEPTION 'debug outcome must be written only by terminal transition' USING ERRCODE='23514';
  END IF;
  SELECT source_kind='prompt_composition_debug' INTO debug_task FROM new_design.ai_tasks WHERE id=NEW.task_id;
  IF debug_task IS true AND (NEW.attempt_number<>1 OR NEW.trigger_kind<>'initial' OR NEW.status NOT IN ('queued','running') OR NOT EXISTS(SELECT 1 FROM new_design.ai_task_steps step WHERE step.id=NEW.step_id AND step.task_id=NEW.task_id AND step.max_attempts=1)) THEN
    RAISE EXCEPTION 'debug run is a single initial attempt, never an automatic retry' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_task_attempts_debug_insert_guard BEFORE INSERT ON ai_task_attempts FOR EACH ROW EXECUTE FUNCTION validate_debug_attempt_insert();

CREATE INDEX ai_run_previews_composition_request_idx ON ai_run_previews(idempotency_key) WHERE source_kind='prompt_composition_debug';
