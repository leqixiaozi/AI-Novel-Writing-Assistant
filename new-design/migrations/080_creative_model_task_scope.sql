SET search_path TO new_design, public;

-- Extend managed text tasks only. Native images retain their scoped, dedicated snapshots.
ALTER TABLE model_route_snapshots DROP CONSTRAINT model_route_snapshots_managed_scope_check;
ALTER TABLE model_route_snapshots ADD CONSTRAINT model_route_snapshots_managed_scope_check CHECK (
  (book_id IS NOT NULL AND task_contract_version_id IS NOT NULL AND managed_task_key IS NULL) OR
  (book_id IS NULL AND task_contract_version_id IS NULL AND managed_task_key IS NOT NULL AND managed_task_key IN (
    'directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate',
    'chapter_settlement','chapter_generation','world_consistency','creative_extraction','character_dialogue'
  ))
);

-- Keep the original resolver identity and pre037 fallback for all original fact cases.
CREATE OR REPLACE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE
SET search_path TO pg_catalog, new_design, ag_catalog, public, pg_temp AS $$
BEGIN
  IF requested_kind='entity_initial_state' THEN
    RETURN QUERY SELECT book.space_id,initial.book_id,version.value_hash
      FROM entity_initial_states initial JOIN entity_initial_state_versions version ON version.initial_state_id=initial.id JOIN books book ON book.id=initial.book_id
      WHERE initial.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='model_route_snapshot' THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,snapshot.snapshot_hash FROM model_route_snapshots snapshot
      WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id AND snapshot.book_id IS NULL AND snapshot.task_contract_version_id IS NULL
      AND snapshot.managed_task_key IN ('directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate','chapter_settlement','chapter_generation','world_consistency','creative_extraction','character_dialogue');
    RETURN QUERY SELECT * FROM resolve_dependency_resource_pre037(requested_kind,requested_stable_id,requested_version_id);
  ELSIF requested_kind='context_binding_version' THEN
    RETURN QUERY SELECT binding.space_id,binding.book_id,version.content_hash FROM context_bindings binding JOIN context_binding_versions version ON version.binding_id=binding.id WHERE binding.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='context_preview' THEN
    RETURN QUERY SELECT book.space_id,preview.book_id,preview.source_set_hash FROM context_previews preview JOIN books book ON book.id=preview.book_id WHERE preview.id=requested_stable_id AND preview.id=requested_version_id;
  ELSIF requested_kind='semantic_retrieval_run' THEN
    RETURN QUERY SELECT book.space_id,run.book_id,dependency_content_hash(run.query_hash||run.id::text||run.result_count::text) FROM semantic_retrieval_runs run JOIN books book ON book.id=run.book_id WHERE run.id=requested_stable_id AND run.id=requested_version_id;
  ELSE RETURN QUERY SELECT * FROM resolve_dependency_resource_pre037(requested_kind,requested_stable_id,requested_version_id);
  END IF;
END $$;
