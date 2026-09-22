'use strict';

// Pure classification only. No filesystem, database, model or migration work is
// performed here. A classification is NOT permission to discard the source row.
// In particular, physical mirrors must be compared against their retained table;
// action/merged/capability results still require an explicit row transformer.

const physicalAliases=Object.freeze({
 context_manifest_entries:'context_manifest_items',
 ai_task_state_events:'ai_task_events',
 asset_mounts:'asset_links',
 publication_export_manifests:'publication_manifests',
 publication_export_artifacts:'publication_artifacts',
 release_gate_definitions:'release_definitions',
 release_gate_assessments:'release_assessments',
 dependency_state_events:'dependency_events',
 background_job_results:'background_job_events',
 graph_projection_generations:'graph_projection_runs',
 embedding_index_generations:'embedding_generations',
 semantic_retrieval_runs:'retrieval_runs',
 semantic_retrieval_results:'retrieval_results',
 transfer_archive_entries:'transfer_entries',
 transfer_operation_events:'transfer_events',
 transfer_validation_results:'transfer_validations',
 runtime_lifecycle_events:'runtime_events',
 runtime_health_snapshots:'runtime_snapshots',
});

// Exact retained-table catalog from 131, not a plural-name heuristic. 130 staged
// some of these ledgers before 131 renamed them, so a legacy copy may coexist.
const physicalTables=new Set([
 'schema_migrations','system_capabilities','card_spaces','card_types','card_type_versions','cards','card_versions','card_version_actions',
 'relation_types','card_relations','card_relation_versions','field_definitions','field_definition_versions','books',
 'chapter_documents','chapter_body_versions','chapter_body_adoptions','text_anchors','chapter_settlements','chapter_settlement_items','research_documents','research_document_versions',
 'task_contracts','task_contract_versions','prompt_recipes','prompt_recipe_versions','model_credential_refs','model_route_configs','model_route_versions','model_route_snapshots','context_manifests','context_manifest_items',
 'ai_tasks','ai_task_steps','ai_task_attempts','ai_task_events','ai_attempt_usage','asset_content_objects','asset_versions','asset_links','asset_events','media_jobs','media_job_attempts','media_outputs',
 'publication_manifests','publication_artifacts','release_definitions','release_assessments','dependency_resources','dependency_edges','dependency_events',
 'outbox_events','outbox_inbox_receipts','outbox_consumers','outbox_aggregate_sequences','background_jobs','background_job_attempts','background_job_checkpoints','background_job_events',
 'graph_projection_configs','graph_projection_runs','graph_projection_checkpoints','embedding_profiles','embedding_generations','embedding_chunks','embedding_vectors','retrieval_runs','retrieval_results',
 'transfer_operations','transfer_manifests','transfer_entries','transfer_events','transfer_conflicts','transfer_validations','transfer_id_mappings','runtime_installations','runtime_events','runtime_snapshots','runtime_upgrade_plans',
]);

// These names denote installation switches. State type/relation capabilities
// are deliberately absent: they are author/domain records, not feature switches.
const featureCapabilities=Object.freeze({
 book_content_history_capability:'book_content_history_v1',
 character_author_capability:'character_author_v1',
 character_author_influence_capability:'character_author_influence_v1',
 image_preparation_capability:'image_prompt_preparation_v1',
 public_character_profile_capability:'public_character_profile_v1',
 public_character_workshop_capability:'public_character_trial_v1',
 public_title_factory_capability:'public_title_factory_v1',
 resource_supplement_capabilities:null,
 world_package_capability:null,
 world_usage_capability:null,
});

// A template names row fields; it must never be evaluated as code. Consumers
// must validate the field's allowed business values before constructing a key.
const actionMappings=Object.freeze({
 prompt_command_receipts:{actionKey:'prompt.save',requestKeyTemplate:'prompt-command:{idempotency_key}'},
 professional_resource_receipts:{actionKey:'professional.resource.command',requestKeyTemplate:'professional-resource:{request_key}'},
 public_title_factory_choices:{actionKey:'public_title.choice',requestKeyTemplate:'public-title:choice:{request_key}'},
 public_character_portrait_events:{actionKey:'public_character.portrait',requestKeyTemplate:'public-character:portrait:{request_key}'},
 ai_approval_decisions:{actionKey:'ai.approval.decide',ownerType:'ai_approval_request',ownerField:'request_id',requestKeyTemplate:'ai-approval-decision:{request_id}'},
 character_dialogue_selections:{actionKey:'character_dialogue.select',ownerType:'character_dialogue_session',ownerField:'session_id',requestKeyTemplate:'character_dialogue.select:{book_id}:{request_key}'},
 character_author_influence_decisions:{actionKey:'character_author.influence_decision',ownerType:'character_author_influence_candidate',ownerField:'candidate_id',requestKeyTemplate:'character_author.influence_decision:{request_key}'},
 canonical_fact_review_actions:{actionKeyTemplate:'canonical_fact.{action}',ownerType:'canonical_fact',ownerField:'fact_id'},
 knowledge_state_review_actions:{actionKeyTemplate:'knowledge_state.{action}',ownerType:'knowledge_state_proposal',ownerField:'proposal_id'},
 story_time_review_actions:{actionKeyTemplate:'story_time.{action}',ownerType:'story_time_proposal',ownerField:'proposal_id'},
 story_relation_review_actions:{actionKeyTemplate:'story_relation.{action}',ownerType:'story_relation_proposal',ownerField:'proposal_id'},
 chapter_settlement_events:{actionKeyTemplate:'chapter_settlement.{event_kind}',ownerType:'chapter_adoption_session',ownerField:'session_id'},
 association_actions:{actionKeyTemplate:'association.{action}'},
 structure_write_receipts:{actionKeyTemplate:'structure.{kind}.{operation}'},
 card_archive_events:{actionKeys:['card.archive','card.restore'],selectorField:'to_status'},
});

const mergedMappings=Object.freeze({
 outbox_event_topics:{targetType:'background_job_handler',joinFields:['topic','event_version'],reason:'Reconcile each topic contract/status with all matching handlers; unmatched or contradictory topics cannot be discarded.'},
 world_package_versions:{targetType:'world_package_snapshot',reason:'Reconstruct the frozen frame, original receipt and publish action together with card/relation refs; not a type-only rename.'},
 world_package_card_refs:{targetType:'world_package_snapshot',reason:'Merge exact source card/version refs into the package frame without resolving current heads.'},
 world_package_relation_refs:{targetType:'world_package_snapshot',reason:'Merge exact relation/end-point versions into the same frozen package frame.'},
 world_package_installations:{targetType:'world_package_installation',reason:'Reconstruct cards, relations, origin, original input/receipt and install action with all installation children.'},
 world_package_install_card_refs:{targetType:'world_package_installation',reason:'Merge source-to-target exact card/version mappings into installation.cards.'},
 world_package_install_relation_refs:{targetType:'world_package_installation',reason:'Merge source-to-target exact relation/version mappings into installation.relations.'},
 world_package_sync_commands:{targetType:'world_package_sync_command',reason:'Preserve command sequence, original receipt, added mappings and both-side baselines, then append the original sync action.'},
 world_package_added_card_refs:{targetType:'world_package_sync_command',reason:'Merge command-owned added card mappings, retaining installation ownership and original sequence.'},
 world_package_field_baselines:{targetType:'world_package_sync_command',reason:'Merge fieldBaselines with exact public/local versions and values; never substitute current values.'},
 world_package_relation_baselines:{targetType:'world_package_sync_command',reason:'Merge relationBaselines, preserving absent/present state and exact public/local versions.'},
});

const complexMappings=Object.freeze({
 embedding_source_snapshots:{targetType:'embedding_source_snapshot',reason:'Move content_text to the exact source-kind embedding_chunks row; keep metadata, stale state and logical snapshot ID.'},
 embedding_attempts:{targetType:'embedding_attempt',reason:'Retained replies require raw response_vector attempt rows and vectorId metadata; validate original precision/hash and frozen source.'},
 embedding_results:{targetType:'embedding_result',reason:'Split vector_value into result-kind embedding_vectors. Missing original reply precision/hash cannot be reconstructed from rounded pgvector data.'},
 creative_extraction_previews:{targetType:'creative_extraction_preview',reason:'Five frozen JSON payload fields require managed_json_v1 content objects and exact file/hash validation.'},
 creative_extraction_write_receipts:{actionKey:'creative_extraction.command',reason:'Rebuild the immutable command action and externalize its full receipt through managed_json_v1.'},
 public_character_trials:{targetType:'public_character_trial',reason:'Portrait reply base64 must become checked managed image bytes plus imageContentObjectId; inspect kind before migrating.'},
 book_content_history_snapshots:{targetType:'book_content_history_snapshot',reason:'Verify exact chapter body versions and source hash before removing duplicate content; capture action is mandatory.'},
 book_content_history_restores:{targetType:'book_content_history_restore',reason:'Preserve original restore receipt and build book_history.restore.prepared action with the correct physical owner.'},
 material_tag_target_membership_versions:{targetType:'material_tag_target_membership',reason:'Legacy version rows need explicit reconstruction of membership history; not independent current membership records.'},
 context_binding_conflicts:{reason:'No clean conflict-record consumer is defined; unresolved conflict identity and gating need an explicit preservation mapping.'},
 graph_projection_mapping_definitions:{reason:'No clean mapping-definition record consumer exists; reconcile custom mappings with physical graph configuration before continuing.'},
 book_sources:{reason:'Do not conflate legacy book source ownership with book_content_source without a field-level source-identity mapping.'},
 world_generation_candidates:{targetType:'world_generation_session',reason:'123 folded candidates into workflow versions; compare against the existing session history, do not replay generation.'},
 world_generation_publications:{targetType:'world_generation_session',reason:'123 folded publication into session state/actions; retain original publication identities without duplicating effects.'},
 creative_hub_turns:{targetType:'creative_hub_thread',reason:'126 folded turns into thread history/actions; reconcile existing migration output and exact input/reply ledger.'},
});

// 124/125 converged these entities, versions and adoptions together. Merely
// deriving a singular would silently lose ownership, adopted heads or actions.
const convergedWorkflowGroups=Object.freeze({
 comic_bible:['comic_bible_entities','comic_bible_versions','comic_bible_adoptions'],
 comic_episode:['comic_episode_versions','comic_episode_adoptions'],
 comic_panel_script:['comic_panel_sets','comic_panels','comic_panel_set_adoptions'],
 comic_render_target:['comic_render_batches','comic_fact_snapshots','comic_render_target_state','comic_render_versions','comic_render_adoptions'],
 comic_source_bundle:['comic_source_versions','comic_source_bundle_state','comic_source_bundle_versions','comic_source_bundle_adoptions'],
 comic_visual_asset:['comic_visual_asset_adoptions'],
 drama_project:['drama_source_versions'],
 drama_stage:['drama_stage_entities','drama_stage_versions','drama_stage_adoptions'],
 drama_script:['drama_script_entities','drama_script_versions','drama_script_adoptions'],
 drama_storyboard:['drama_storyboard_entities','drama_storyboard_versions','drama_storyboard_adoptions'],
 drama_media_prompt:['drama_media_prompt_versions'],
});

// Explicit aliases may be added only with source/consumer evidence. These are
// invariant grammatical forms, not broad replacement rules for unrelated words.
const recordAliases=Object.freeze({
 assets:'asset',
 canonical_fact_evidence:'canonical_fact_evidence',
 quality_issue_evidence:'quality_issue_evidence',
 research_evidence:'research_evidence',
 standard_field_semantics:'standard_field_semantic',
 background_job_archive_policies:'background_job_archive_policy',
 semantic_retrieval_policies:'semantic_retrieval_policy',
});

function blocked(sourceType,reason,extra={}){
 return{kind:'unsupported',sourceType,reason,...extra};
}

/**
 * @param {string} legacyTypeName legacy.foo or the exact old table name foo.
 * @param {Set<string>} nativeTypeKeys Actual available clean record catalog.
 * @returns {object} record/physical/action/merged/capability/complex/unsupported.
 * Only record is a one-record mapping candidate. Even record requires identity,
 * scope, revision, archive, version-history and reference checks by the caller.
 */
function classifyLegacyType(legacyTypeName,nativeTypeKeys){
 if(!(nativeTypeKeys instanceof Set))throw new TypeError('nativeTypeKeys must be a Set of clean type keys');
 if(typeof legacyTypeName!=='string')return blocked(null,'Legacy type name must be a string.');
 const sourceType=legacyTypeName.startsWith('legacy.')?legacyTypeName.slice(7):legacyTypeName;
 if(!/^[a-z][a-z0-9_]*$/.test(sourceType))return blocked(sourceType,'Malformed or non-legacy-qualified source type.');
 if(Object.hasOwn(physicalAliases,sourceType)||physicalTables.has(sourceType)){
  const targetTable=physicalAliases[sourceType]??sourceType;
  const requiredTransform=targetTable==='retrieval_runs'?'extract_exact_query_response_vector':targetTable==='embedding_vectors'?'preserve_index_rows_and_add_record_kind':targetTable==='embedding_chunks'?'preserve_chunk_rows_and_add_record_kind':null;
  return{kind:'physical',sourceType,targetTable,requiredTransform,reason:'Retained physical ledger: compare identities/content and history before resolving the staged mirror; never copy twice or silently discard differences.'};
 }
 if(Object.hasOwn(featureCapabilities,sourceType)){
  const capabilityKey=featureCapabilities[sourceType];
  return{kind:'capability',sourceType,targetTable:capabilityKey?'system_capabilities':null,capabilityKey,reason:capabilityKey?'Reconcile the legacy switch with the real installed feature, native types and guards; do not overwrite user state or mark operational from a copied flag alone.':'The current consumer derives readiness from native types/guards rather than a dedicated feature row. Preserve and reconcile the legacy switch; do not invent a system_capabilities key or silently discard a disabled setting.'};
 }
 if(Object.hasOwn(actionMappings,sourceType)){
  const mapping=actionMappings[sourceType];
  if(mapping.ownerType&&!nativeTypeKeys.has(mapping.ownerType))return blocked(sourceType,'Action owner type is absent from the native catalog.',{targetType:mapping.ownerType});
  return{kind:'action',sourceType,...mapping,...(mapping.actionKeys?{actionKeys:[...mapping.actionKeys]}:{}),reason:'Preserve original action ID/time, complete payload/receipt and request namespace; resolve the physical owner card without replacing business IDs.'};
 }
 if(Object.hasOwn(mergedMappings,sourceType)){
  const mapping=mergedMappings[sourceType];
  if(!nativeTypeKeys.has(mapping.targetType))return blocked(sourceType,'Merge target is absent from the native catalog.',{targetType:mapping.targetType});
  return{kind:'merged',sourceType,...mapping,...(mapping.joinFields?{joinFields:[...mapping.joinFields]}:{})};
 }
 if(Object.hasOwn(complexMappings,sourceType))return{kind:'complex',sourceType,...complexMappings[sourceType]};
 if(sourceType==='drama_media_tasks')return{kind:'complex',sourceType,targetTable:'media_jobs',reason:'Reconstruct media job, attempts and outputs with original provider snapshots; do not create new model work.'};
 for(const [targetType,sources] of Object.entries(convergedWorkflowGroups)){
  if(sources.includes(sourceType))return{kind:'complex',sourceType,targetType,reason:'Reconcile 124/125 workflow convergence output with all historical versions/adoptions; a table-name alias cannot preserve this workflow.'};
 }
 const candidates=new Set();
 if(Object.hasOwn(recordAliases,sourceType)){
  const targetType=recordAliases[sourceType];
  if(!nativeTypeKeys.has(targetType))return blocked(sourceType,'Explicit record target is absent from the native catalog.',{targetType});
  candidates.add(targetType);
 }
 // Identity supports genuinely invariant names such as research_evidence.
 // s, ies and the common es endings are proposals only, never unconditional.
 candidates.add(sourceType);
 if(sourceType.endsWith('s'))candidates.add(sourceType.slice(0,-1));
 if(sourceType.endsWith('ies'))candidates.add(sourceType.slice(0,-3)+'y');
 if(/(?:ches|shes|xes|zes|sses)$/.test(sourceType))candidates.add(sourceType.slice(0,-2));
 const matches=[...candidates].filter(candidate=>nativeTypeKeys.has(candidate)).sort();
 if(matches.length===1)return{kind:'record',sourceType,targetType:matches[0]};
 if(matches.length>1)return blocked(sourceType,'More than one native type matches; an explicit semantic mapping is required.',{candidates:matches});
 return blocked(sourceType,'No native record type or explicit ledger/action/merge mapping exists; preserve the source and block upgrade.',{candidates:[...candidates].sort()});
}

module.exports={classifyLegacyType};
