-- AI 上下文、资产媒体、依赖、任务、检索、传输和运行账本映射到共享内核。
-- 仅暂存并核对，最终物理切换由 131 完成。
SET search_path TO new_design, public;

DO $$
DECLARE table_name text;
BEGIN
  IF to_regprocedure('new_design.stage_legacy_table(text,text)') IS NULL THEN
    RAISE EXCEPTION 'migration 127 must be installed before 130';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'context_bindings','context_binding_versions','context_binding_adoptions','context_binding_selectors','context_binding_conflicts','context_management_events','context_previews','context_preview_binding_versions','context_preview_decisions','context_manifest_slots','context_manifest_exclusions','context_manifest_retrieval_traces',
    'ai_approval_requests','ai_approval_decisions','ai_contract_publications','ai_generation_batches','ai_run_previews','ai_run_prompt_sections','ai_run_submissions','prompt_recipe_slots','prompt_recipe_slot_components','model_route_fallbacks','model_route_snapshot_fallbacks',
    'assets','asset_adoptions','asset_derivations','asset_derivation_results','asset_derivation_events','asset_content_integrity_checks','comic_visual_assets','comic_visual_asset_versions','comic_visual_asset_adoptions','comic_render_batches','comic_fact_snapshots','comic_render_versions','comic_render_target_state','comic_render_adoptions','comic_bubble_outputs','comic_export_manifests','comic_export_artifacts','drama_media_tasks','drama_export_manifests','drama_export_artifacts',
    'dependency_resource_states','dependency_invalidation_events','dependency_invalidation_impacts','dependency_change_previews','dependency_conflicts','dependency_recompute_requests','dependency_recompute_receipts','dependency_stale_acceptances','dependency_stale_reasons',
    'background_job_handlers','background_job_results','background_job_replays','background_job_archive_policies','background_job_book_pauses','outbox_event_topics',
    'embedding_attempts','embedding_requests','embedding_results','embedding_source_snapshots','embedding_index_states','embedding_stale_reasons','semantic_retrieval_policies',
    'graph_projection_mapping_definitions','graph_projection_book_states','graph_projection_requests','graph_projection_batches','graph_projection_failures','graph_projection_source_mappings',
    'transfer_artifacts','transfer_checkpoints','transfer_compatibility_snapshots','transfer_export_profiles','transfer_import_sources','transfer_restore_drills','transfer_staging_scopes','transfer_steps',
    'runtime_health_snapshots','runtime_lifecycle_events','creative_hub_threads','creative_hub_turns','comic_projects','comic_source_versions','comic_source_bundle_state','comic_source_bundle_versions','comic_source_bundle_adoptions','comic_episodes','comic_episode_versions','comic_episode_adoptions','comic_panel_sets','comic_panels','comic_panel_set_adoptions','comic_bible_entities','comic_bible_versions','comic_bible_adoptions','drama_projects','drama_source_versions','drama_stage_entities','drama_stage_versions','drama_stage_adoptions','drama_script_entities','drama_script_versions','drama_script_adoptions','drama_quality_reports','drama_storyboard_entities','drama_storyboard_versions','drama_storyboard_adoptions','drama_media_prompt_versions'
  ] LOOP PERFORM stage_legacy_table(table_name,'infrastructure'); END LOOP;
END $$;
