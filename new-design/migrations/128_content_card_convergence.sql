-- 规划、研究、质量、事实、状态、知识、时间线与世界能力收敛。
-- 仅暂存并核对，131 前不删除旧表。
SET search_path TO new_design, public;

DO $$
DECLARE table_name text;
BEGIN
  IF to_regprocedure('new_design.stage_legacy_table(text,text)') IS NULL THEN
    RAISE EXCEPTION 'migration 127 must be installed before 128';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'planning_objects','planning_versions','planning_adoptions','planning_impacts','planning_operation_events','planning_version_actions','planning_version_references','planning_ai_candidate_runs',
    'research_records','research_record_versions','research_candidates','research_candidate_versions','research_candidate_batches','research_candidate_adoptions','research_evidence',
    'research_reference_packs','research_reference_pack_versions','research_reference_pack_items','book_research_references','book_research_adoption_batches','book_research_adoption_items','book_research_adoption_events',
    'quality_audit_reports','quality_issues','quality_issue_versions','quality_issue_events','quality_issue_evidence','quality_fix_candidates','quality_fix_candidate_versions','quality_fix_candidate_events','quality_fix_adoptions','quality_rechecks',
    'quality_report_body_versions','quality_report_facts','quality_report_material_versions','quality_report_planning_versions','canonical_facts','canonical_fact_evidence','canonical_fact_conflicts','canonical_fact_review_actions',
    'state_changes','state_change_proposals','state_change_proposal_versions','state_milestone_snapshots','current_state_projections','knowledge_state_changes','knowledge_state_proposals','knowledge_state_proposal_versions','knowledge_state_review_actions','current_knowledge_state_projections','epistemic_claims',
    'story_time_positions','story_time_proposals','story_time_proposal_versions','story_time_review_actions','story_event_timings','story_event_relations','story_event_narrative_occurrences','story_relation_proposals','story_relation_proposal_versions','story_relation_review_actions',
    'world_package_versions','world_package_installations','world_package_card_refs','world_package_relation_refs','world_package_install_card_refs','world_package_install_relation_refs','world_package_added_card_refs','world_package_field_baselines','world_package_relation_baselines','world_package_push_candidates','world_package_sync_commands','world_package_catalog_actions',
    'world_library_candidates','world_library_commands','world_usage_candidates','world_usage_adoptions','world_consistency_requests','world_generation_sessions','world_generation_candidates','world_generation_publications'
  ] LOOP PERFORM stage_legacy_table(table_name,'content'); END LOOP;
END $$;
