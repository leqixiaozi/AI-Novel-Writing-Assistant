-- 开书、章节修订、结算辅助、导演、人物试验、历史恢复与资源补充收敛。
-- 仅暂存并核对，131 前不删除旧表。
SET search_path TO new_design, public;

DO $$
DECLARE table_name text;
BEGIN
  IF to_regprocedure('new_design.stage_legacy_table(text,text)') IS NULL THEN
    RAISE EXCEPTION 'migration 127 must be installed before 129';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'book_creation_sessions','book_creation_research_selections','book_change_sets','book_template_syncs','book_lifecycle_events','book_sources','book_content_sources',
    'chapter_writing_requests','chapter_body_operations','chapter_adoption_preparations','chapter_adoption_sessions','chapter_revision_plans','chapter_revision_plan_items','chapter_revision_previews','chapter_revision_executions','chapter_revision_recompute_steps','chapter_revision_impacts','chapter_revision_events','chapter_revision_protection_marks','chapter_revision_review_flags','chapter_proposal_extraction_requests','chapter_quality_requests',
    'chapter_settlement_events','chapter_settlement_item_versions','chapter_stable_checkpoints','book_settlement_policies','settlement_policy_versions','settlement_relation_configuration_drafts','settlement_relation_configuration_versions','settlement_relation_configuration_receipts',
    'production_director_runs','production_director_chapters','production_director_commands','character_author_trials','character_author_influence_candidates','character_author_influence_decisions','public_character_trials','public_character_portrait_events','character_dialogue_sessions','character_dialogue_rounds','character_dialogue_selections',
    'public_title_factory_trials','public_title_factory_choices','book_content_history_snapshots','book_content_history_restores','chapter_resource_supplements','resource_supplement_correction_origins','resource_supplement_formal_commits','resource_supplement_impact_reviews','resource_supplement_integrity_issues','resource_supplement_integrity_journals','resource_supplement_integrity_resolutions','resource_adoptions',
    'creative_extraction_previews','creative_extraction_write_receipts','inspiration_candidates','image_prompt_preparations','professional_resource_receipts','structure_write_receipts','prompt_command_receipts','association_actions','card_archive_events','card_archive_previews','card_field_origins','card_version_ai_draft_sources','card_version_local_values','card_tree_value_snapshots','narrative_placements','entity_initial_states','entity_initial_state_versions','payoff_windows','payoff_window_versions'
  ] LOOP PERFORM stage_legacy_table(table_name,'author_workflow'); END LOOP;
END $$;
