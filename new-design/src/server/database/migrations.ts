export interface Migration {
  id: string;
  fileName: string;
}

export const migrations: Migration[] = [
  {
    id: "001_card_kernel",
    fileName: "001_card_kernel.sql",
  },
  {
    id: "002_builtin_novel_cards",
    fileName: "002_builtin_novel_cards.sql",
  },
  {
    id: "003_novel_card_catalog",
    fileName: "003_novel_card_catalog.sql",
  },
  {
    id: "004_xianxia_production_demo",
    fileName: "004_xianxia_production_demo.sql",
  },
  {
    id: "005_card_composition_kernel",
    fileName: "005_card_composition_kernel.sql",
  },
  {
    id: "006_template_books",
    fileName: "006_template_books.sql",
  },
  {
    id: "007_unified_book_creation",
    fileName: "007_unified_book_creation.sql",
  },
  {
    id: "008_card_type_categories",
    fileName: "008_card_type_categories.sql",
  },
  {
    id: "009_strategy_resources",
    fileName: "009_strategy_resources.sql",
  },
  {
    id: "010_prompt_components",
    fileName: "010_prompt_components.sql",
  },
  {
    id: "011_book_multiview",
    fileName: "011_book_multiview.sql",
  },
  {
    id: "012_book_change_sets",
    fileName: "012_book_change_sets.sql",
  },
  {
    id: "013_research_foundation",
    fileName: "013_research_foundation.sql",
  },
  {
    id: "014_market_radar",
    fileName: "014_market_radar.sql",
  },
  {
    id: "015_research_reuse",
    fileName: "015_research_reuse.sql",
  },
  {
    id: "016_chapter_body_versions",
    fileName: "016_chapter_body_versions.sql",
  },
  {
    id: "017_canonical_facts",
    fileName: "017_canonical_facts.sql",
  },
  {
    id: "018_state_settlements",
    fileName: "018_state_settlements.sql",
  },
  {
    id: "019_state_proposal_before_guard",
    fileName: "019_state_proposal_before_guard.sql",
  },
  {
    id: "020_knowledge_states",
    fileName: "020_knowledge_states.sql",
  },
  {
    id: "021_story_timeline",
    fileName: "021_story_timeline.sql",
  },
  {
    id: "022_planning_versions",
    fileName: "022_planning_versions.sql",
  },
  {
    id: "023_ai_execution_contracts",
    fileName: "023_ai_execution_contracts.sql",
  },
  {
    id: "024_ai_task_ledger",
    fileName: "024_ai_task_ledger.sql",
  },
  {
    id: "025_quality_audit_ledger",
    fileName: "025_quality_audit_ledger.sql",
  },
  {
    id: "026_dependency_invalidation_ledger",
    fileName: "026_dependency_invalidation_ledger.sql",
  },
  {
    id: "027_asset_version_ledger",
    fileName: "027_asset_version_ledger.sql",
  },
  {
    id: "028_age_graph_projection",
    fileName: "028_age_graph_projection.sql",
  },
  {
    id: "029_pgvector_semantic_retrieval",
    fileName: "029_pgvector_semantic_retrieval.sql",
  },
  {
    id: "030_postgres_outbox_job_runtime",
    fileName: "030_postgres_outbox_job_runtime.sql",
  },
  {
    id: "031_transfer_backup_import_export",
    fileName: "031_transfer_backup_import_export.sql",
  },
  {
    id: "032_private_runtime_lifecycle",
    fileName: "032_private_runtime_lifecycle.sql",
  },
  {
    id: "033_business_form_provenance",
    fileName: "033_business_form_provenance.sql",
  },
  {
    id: "034_scoped_field_definitions",
    fileName: "034_scoped_field_definitions.sql",
  },
  {
    id: "035_association_mount_versions",
    fileName: "035_association_mount_versions.sql",
  },
  {
    id: "036_material_management_smart_views",
    fileName: "036_material_management_smart_views.sql",
  },
  {
    id: "037_context_binding_assembly_snapshots",
    fileName: "037_context_binding_assembly_snapshots.sql",
  },
  {
    id: "038_book_overview_planning_center",
    fileName: "038_book_overview_planning_center.sql",
  },
  {
    id: "039_chapter_writing_workspace",
    fileName: "039_chapter_writing_workspace.sql",
  },
  {
    id: "040_chapter_adoption_settlement",
    fileName: "040_chapter_adoption_settlement.sql",
  },
  {
    id: "041_chapter_revision_recompute",
    fileName: "041_chapter_revision_recompute.sql",
  },
  {
    id: "042_research_prompt_runtime_orchestration",
    fileName: "042_research_prompt_runtime_orchestration.sql",
  },
  {
    id: "043_multiview_quality_workspace",
    fileName: "043_multiview_quality_workspace.sql",
  },
  {
    id: "044_completion_export_release_gate",
    fileName: "044_completion_export_release_gate.sql",
  },
  {
    id: "045_planning_ai_candidates",
    fileName: "045_planning_ai_candidates.sql",
  },
  {
    id: "046_unified_dictionary_tag_trees",
    fileName: "046_unified_dictionary_tag_trees.sql",
  },
  {
    id: "047_tree_value_snapshot_paths",
    fileName: "047_tree_value_snapshot_paths.sql",
  },
  {
    id: "048_unified_book_creation_review",
    fileName: "048_unified_book_creation_review.sql",
  },
  { id: "049_business_form_ai_drafts", fileName: "049_business_form_ai_drafts.sql" },
  { id: "050_scoped_database_function_paths", fileName: "050_scoped_database_function_paths.sql" },
  { id: "051_prompt_component_classification", fileName: "051_prompt_component_classification.sql" },
  { id: "052_managed_model_route_runtime", fileName: "052_managed_model_route_runtime.sql" },
  { id: "053_prompt_composition_debug", fileName: "053_prompt_composition_debug.sql" },
  { id: "054_chapter_settlement_editing", fileName: "054_chapter_settlement_editing.sql" },
  { id: "055_chapter_settlement_ai", fileName: "055_chapter_settlement_ai.sql" },
  { id: "056_settlement_relation_configuration", fileName: "056_settlement_relation_configuration.sql" },
  { id: "057_dependency_bridge_record_guards", fileName: "057_dependency_bridge_record_guards.sql" },
  { id: "058_book_creation_production", fileName: "058_book_creation_production.sql" },
  { id: "059_creation_preparation_ai", fileName: "059_creation_preparation_ai.sql" },
  { id: "060_managed_snapshot_dependency_bridge", fileName: "060_managed_snapshot_dependency_bridge.sql" },
  { id: "061_knowledge_reference_receipts", fileName: "061_knowledge_reference_receipts.sql" },
  { id: "062_author_material_write_receipts", fileName: "062_author_material_write_receipts.sql" },
  { id: "063_professional_resource_receipts", fileName: "063_professional_resource_receipts.sql" },
  { id: "065_book_composition_order_receipts", fileName: "065_book_composition_order_receipts.sql" },
  { id: "066_production_director", fileName: "066_production_director.sql" },
  { id: "067_visual_asset_source_receipts", fileName: "067_visual_asset_source_receipts.sql" },
  { id: "068_book_composition_timeline_receipts", fileName: "068_book_composition_timeline_receipts.sql" },
  { id: "069_chapter_continuity_initial_sources", fileName: "069_chapter_continuity_initial_sources.sql" },
  { id: "070_knowledge_embedding_execution", fileName: "070_knowledge_embedding_execution.sql" },
  { id: "071_structure_write_receipts", fileName: "071_structure_write_receipts.sql" },
  { id: "072_knowledge_embedding_function_scope", fileName: "072_knowledge_embedding_function_scope.sql" },
  { id: "073_knowledge_embedding_profile_parameter", fileName: "073_knowledge_embedding_profile_parameter.sql" },
  { id: "074_asset_receipt_function_scope", fileName: "074_asset_receipt_function_scope.sql" },
  { id: "075_asset_locator_regular_expression", fileName: "075_asset_locator_regular_expression.sql" },
  { id: "076_asset_invalidation_event_identity", fileName: "076_asset_invalidation_event_identity.sql" },
];
