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
];
