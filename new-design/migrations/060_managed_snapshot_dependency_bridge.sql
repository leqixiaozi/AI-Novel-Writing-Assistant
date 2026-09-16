SET search_path TO new_design, public;

-- Preserve function OIDs: existing triggers and resolver callers stay attached.
-- A pre-book managed route is an immutable resource in its own right. It has
-- neither a book nor a task-contract identity; do not manufacture either one.
CREATE OR REPLACE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE
SET search_path TO new_design, ag_catalog, public AS $$
BEGIN
  IF requested_kind='model_route_snapshot' THEN
    RETURN QUERY
      SELECT NULL::uuid,NULL::uuid,snapshot.snapshot_hash
      FROM model_route_snapshots snapshot
      WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id
        AND snapshot.book_id IS NULL AND snapshot.task_contract_version_id IS NULL
        AND snapshot.managed_task_key IN ('directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate','chapter_settlement');
    -- Book-backed snapshots still resolve through the original legacy chain.
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

CREATE OR REPLACE FUNCTION bridge_dependency_creation() RETURNS trigger LANGUAGE plpgsql
SET search_path TO new_design, ag_catalog, public AS $$
DECLARE source_kind text; source_version uuid; source_stable uuid; derived_stable uuid;
BEGIN
  IF TG_TABLE_NAME='context_manifests' THEN
    SELECT recipe_id INTO source_stable FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
    PERFORM add_registered_dependency('prompt_recipe_version',source_stable,NEW.prompt_recipe_version_id,'context_manifest',NEW.id,NEW.id,'configured_by','hard','context_build',NEW.id);
    SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
    PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'context_manifest',NEW.id,NEW.id,'configured_by','hard','context_build',NEW.id);
  ELSIF TG_TABLE_NAME='context_manifest_entries' THEN
    SELECT id INTO derived_stable FROM context_manifests WHERE id=NEW.manifest_id;
    source_kind:=CASE NEW.source_type
      WHEN 'body_version' THEN 'chapter_body_version'
      WHEN 'text_anchor' THEN 'chapter_text_anchor'
      WHEN 'research_version' THEN 'research_record_version'
      WHEN 'research_pack_version' THEN 'research_reference_pack_version'
      WHEN 'story_time' THEN 'story_event_timing'
      WHEN 'prompt_component' THEN 'card_version'
      ELSE NEW.source_type
    END;
    source_version:=COALESCE(NEW.exact_version_id,NEW.stable_object_id);
    PERFORM add_registered_dependency(source_kind,NEW.stable_object_id,source_version,'context_manifest',derived_stable,derived_stable,'context_included','hard','context_build',NEW.manifest_id);
  ELSIF TG_TABLE_NAME='model_route_snapshots' THEN
    IF NEW.managed_task_key IS NOT NULL AND NEW.book_id IS NULL AND NEW.task_contract_version_id IS NULL THEN
      -- The existing scope CHECK restricts this to seven managed tasks. The
      -- registry's existing validation resolves exact UUID/hash above, without
      -- a book-scoped derived edge or a NULL task-contract source.
      PERFORM register_dependency_resource('model_route_snapshot',NEW.id,NEW.id);
    ELSE
      SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
      PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'model_route_snapshot',NEW.id,NEW.id,'configured_by','hard','system',NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME='ai_task_attempts' AND NEW.status='succeeded' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
    PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','hard','ai_result',NEW.id);
    SELECT recipe_id INTO source_stable FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
    PERFORM add_registered_dependency('prompt_recipe_version',source_stable,NEW.prompt_recipe_version_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','hard','ai_result',NEW.id);
    PERFORM add_registered_dependency('context_manifest',NEW.context_manifest_id,NEW.context_manifest_id,'ai_task_attempt',NEW.task_id,NEW.id,'context_included','hard','ai_result',NEW.id);
    PERFORM add_registered_dependency('model_route_snapshot',NEW.model_route_snapshot_id,NEW.model_route_snapshot_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','soft','ai_result',NEW.id);
  ELSIF TG_TABLE_NAME='quality_audit_reports' THEN
    PERFORM add_registered_dependency('context_manifest',NEW.context_manifest_id,NEW.context_manifest_id,'quality_audit_report',NEW.id,NEW.id,'audited_from','hard','audit',NEW.id);
    PERFORM add_registered_dependency('ai_task_attempt',NEW.task_id,NEW.attempt_id,'quality_audit_report',NEW.id,NEW.id,'generated_from','hard','audit',NEW.id);
  ELSIF TG_TABLE_NAME='quality_report_body_versions' THEN
    PERFORM add_registered_dependency('chapter_body_version',NEW.chapter_document_id,NEW.body_version_id,'quality_audit_report',NEW.report_id,NEW.report_id,'audited_from','hard','audit',NEW.report_id);
  ELSIF TG_TABLE_NAME='quality_report_planning_versions' THEN
    PERFORM add_registered_dependency('planning_version',NEW.planning_object_id,NEW.planning_version_id,'quality_audit_report',NEW.report_id,NEW.report_id,'audited_from','hard','audit',NEW.report_id);
  ELSIF TG_TABLE_NAME='quality_report_facts' THEN
    PERFORM add_registered_dependency('canonical_fact',NEW.fact_id,NEW.fact_id,'quality_audit_report',NEW.report_id,NEW.report_id,'audited_from','hard','audit',NEW.report_id);
  END IF;
  RETURN NEW;
END $$;
