SET search_path TO new_design, public;

-- Initial values keep their original identity; never relabel them as settled changes.
ALTER TABLE context_manifest_entries DROP CONSTRAINT context_manifest_entries_source_type_check;
ALTER TABLE context_manifest_entries ADD CONSTRAINT context_manifest_entries_source_type_check CHECK(source_type IN (
  'card_version','card_relation','body_version','text_anchor','planning_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','research_version','research_pack_version','prompt_component','retrieval_chunk','asset_version','entity_initial_state'
));
ALTER TABLE dependency_resources DROP CONSTRAINT dependency_resources_resource_kind_check;
ALTER TABLE dependency_resources ADD CONSTRAINT dependency_resources_resource_kind_check CHECK(resource_kind IN (
  'card_type_version','template_group_version','card_version','card_relation','card_mount','tag_version','tag_membership','material_group_version','group_membership','smart_view_version',
  'research_document_version','research_record_version','research_reference_pack_version','chapter_body_version','chapter_text_anchor','canonical_fact','chapter_settlement','state_change','knowledge_state_change','story_event_timing','story_event_relation','planning_version',
  'prompt_recipe_version','task_contract_version','context_binding_version','context_preview','context_manifest','semantic_retrieval_run','model_route_snapshot','ai_task_attempt','quality_audit_report','asset_version','embedding_source_snapshot','embedding_chunk','embedding_result','embedding_index_generation','entity_initial_state'
));

-- Preserve the public function OID and every existing resolver case.
CREATE OR REPLACE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE
SET search_path TO new_design, ag_catalog, public AS $$
BEGIN
  IF requested_kind='entity_initial_state' THEN
    RETURN QUERY SELECT book.space_id,initial.book_id,version.value_hash
      FROM entity_initial_states initial JOIN entity_initial_state_versions version ON version.initial_state_id=initial.id JOIN books book ON book.id=initial.book_id
      WHERE initial.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='model_route_snapshot' THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,snapshot.snapshot_hash FROM model_route_snapshots snapshot
      WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id AND snapshot.book_id IS NULL AND snapshot.task_contract_version_id IS NULL
      AND snapshot.managed_task_key IN ('directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate','chapter_settlement');
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

CREATE FUNCTION invalidate_chapter_initial_source() RETURNS trigger LANGUAGE plpgsql
SET search_path TO new_design, ag_catalog, public AS $$
DECLARE previous uuid; replacement uuid;
BEGIN
  IF OLD.current_version_id IS NOT NULL AND NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
    previous:=register_dependency_resource('entity_initial_state',OLD.id,OLD.current_version_id);
    IF NEW.current_version_id IS NOT NULL THEN replacement:=register_dependency_resource('entity_initial_state',NEW.id,NEW.current_version_id); END IF;
    PERFORM invalidate_registered_resource(previous,replacement,'初始状态来源变化','system',NEW.id,'initial-source:'||NEW.id::text||':'||NEW.revision::text);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_initial_source_invalidation AFTER UPDATE OF current_version_id ON entity_initial_states FOR EACH ROW EXECUTE FUNCTION invalidate_chapter_initial_source();
