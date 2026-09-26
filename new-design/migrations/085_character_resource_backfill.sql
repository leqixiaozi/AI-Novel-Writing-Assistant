-- MANUAL ONLY: not registered in runtime migrations. Apply only after a verified backup and explicit installation.
-- Replaces one guard without changing existing records, columns, triggers or settlement history.
SET search_path TO new_design,public;

CREATE OR REPLACE FUNCTION guard_chapter_settlement_ai_payload() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
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
  IF NEW.frozen_plan IS NOT NULL AND (NEW.frozen_input_hash IS NULL OR NEW.expected_session_revision IS NULL OR NEW.ai_task_id IS NULL OR COALESCE(NEW.frozen_plan->>'assetId','') NOT IN ('new_design.chapter.settlement_candidates','new_design.character.resource_backfill') OR NEW.frozen_plan->>'assetVersion' IS DISTINCT FROM 'v1' OR
    NEW.frozen_plan->'input'->>'sessionId' IS DISTINCT FROM NEW.session_id::text OR NEW.frozen_plan->'input'->>'bodyVersionId' IS DISTINCT FROM NEW.body_version_id::text OR
    NOT EXISTS(SELECT 1 FROM ai_tasks task JOIN task_contract_versions contract ON contract.id=task.task_contract_version_id JOIN task_contracts config ON config.id=contract.contract_id WHERE task.id=NEW.ai_task_id AND task.source_kind='chapter_settlement_extraction' AND task.source_id=NEW.id AND task.book_id=NEW.book_id AND contract.id=NEW.task_contract_version_id AND contract.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND contract.task_group='chapter_settlement' AND config.task_key='chapter_settlement_'||NEW.session_id::text
      AND contract.budget_policy->>'assetId'=NEW.frozen_plan->>'assetId' AND contract.budget_policy->>'assetVersion'=NEW.frozen_plan->>'assetVersion'
      AND EXISTS(SELECT 1 FROM prompt_recipe_versions recipe WHERE recipe.id=NEW.prompt_recipe_version_id AND recipe.variables_schema->'const'=NEW.frozen_plan->'input'))) THEN
    RAISE EXCEPTION 'chapter extraction controlled provenance is incomplete' USING ERRCODE='23514';
  END IF;

  IF NEW.frozen_plan->>'assetId'='new_design.character.resource_backfill' AND (
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope') IS DISTINCT FROM 'object' OR
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope'->'resources') IS DISTINCT FROM 'array' OR
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope'->'anchors') IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION 'resource backfill requires its frozen scope' USING ERRCODE='23514'; END IF;
  -- Validate live sources only for a new claim. Saved receipts remain readable and finishable
  -- after legitimate future edits; every frozen input and model result remains immutable.
  IF TG_OP='INSERT' AND NEW.frozen_plan->>'assetId'='new_design.character.resource_backfill' THEN
    IF NOT EXISTS(
      SELECT 1 FROM books book
      JOIN cards actor ON actor.space_id=book.space_id
      JOIN card_types type ON type.id=actor.card_type_id AND type.type_key='character' AND type.status='published'
      JOIN chapter_documents document ON document.book_id=book.id AND document.adopted_version_id=NEW.body_version_id AND document.status='active'
      JOIN chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      WHERE book.id=NEW.book_id AND book.status='active' AND actor.status='active'
        AND actor.id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterId'
        AND actor.current_version_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterVersionId'
        AND actor.revision=(NEW.frozen_plan->'input'->'resourceScope'->>'characterRevision')::integer
        AND body.content=NEW.frozen_plan->'input'->>'bodyContent'
        AND body.content_hash=NEW.frozen_plan->'input'->>'bodyContentHash'
    ) OR jsonb_array_length(NEW.frozen_plan->'input'->'resourceScope'->'resources')=0 OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(NEW.frozen_plan->'input'->'resourceScope'->'resources') reference
      WHERE NOT EXISTS(
        SELECT 1 FROM card_relations relation JOIN books book ON book.space_id=relation.space_id AND book.id=NEW.book_id
        JOIN cards resource ON resource.id=relation.target_card_id AND resource.space_id=book.space_id AND resource.status='active'
        JOIN card_types type ON type.id=resource.card_type_id AND type.type_key='prop' AND type.status='published'
        JOIN card_relation_versions version ON version.id=relation.current_version_id AND version.card_relation_id=relation.id
        WHERE relation.status='active' AND relation.id::text=reference->>'relationId' AND version.id::text=reference->>'relationVersionId'
          AND relation.source_card_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterId'
          AND relation.relation_type_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'relationTypeId'
          AND resource.id::text=reference->>'id' AND resource.current_version_id::text=reference->>'versionId'
          AND version.revision=relation.revision AND version.status=relation.status AND version.properties=relation.properties
      )
    ) OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(NEW.frozen_plan->'input'->'resourceScope'->'anchors') reference
      WHERE NOT EXISTS(
        SELECT 1 FROM chapter_text_anchors anchor WHERE anchor.id::text=reference->>'id' AND anchor.book_id=NEW.book_id
          AND anchor.body_version_id=NEW.body_version_id AND anchor.status='active'
          AND anchor.subject_card_id::text=reference->>'subjectCardId'
          AND anchor.start_offset=(reference->>'start')::integer AND anchor.end_offset=(reference->>'end')::integer
          AND anchor.excerpt=reference->>'excerpt'
      )
    ) THEN RAISE EXCEPTION 'resource backfill requires exact adopted body and book sources' USING ERRCODE='23514'; END IF;
  END IF;

  IF NEW.generated_output IS NOT NULL AND (NEW.frozen_plan IS NULL OR NEW.generated_execution IS NULL) THEN RAISE EXCEPTION 'chapter extraction model result needs controlled provenance' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.generated_output IS NULL AND NEW.generated_output IS NOT NULL AND (OLD.status<>'running' OR NEW.status<>'running' OR
    NOT EXISTS(SELECT 1 FROM ai_task_attempts attempt WHERE attempt.task_id=NEW.ai_task_id AND attempt.status='running' AND attempt.input_hash=NEW.frozen_input_hash AND attempt.task_contract_version_id=NEW.task_contract_version_id AND attempt.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND attempt.context_manifest_id=NEW.context_manifest_id AND attempt.model_route_snapshot_id=NEW.model_route_snapshot_id)) THEN
    RAISE EXCEPTION 'chapter model output requires its running frozen attempt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
