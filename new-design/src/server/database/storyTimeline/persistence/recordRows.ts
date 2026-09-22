/** Typed, query-local projections of the story record cards. No database views or SQL rewriting. */
export const storyRecordCtes = {
  canonical_facts: `canonical_facts AS (
  SELECT row.id,row.book_id,row.subject_card_id,row.predicate,row.value_kind,version.values->'value_json' AS value_json,row.value_hash,row.object_card_id,row.valid_story_start,row.valid_story_end,row.status,row.confidence,row.source_method,row.supersedes_fact_id,row.superseded_by_fact_id,row.revision,row.created_by,row.created_at,row.updated_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='canonical_fact'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,subject_card_id uuid,predicate text,value_kind text,value_json jsonb,value_hash char(64),object_card_id uuid,valid_story_start numeric,valid_story_end numeric,status text,confidence numeric(5,4),source_method text,supersedes_fact_id uuid,superseded_by_fact_id uuid,revision integer,created_by text,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  planning_versions: `planning_versions AS (
  SELECT row.id,row.object_id,row.book_id,row.version,row.base_version_id,row.based_on_parent_version_id,row.source,row.status,version.values->'content' AS content,row.content_hash,row.source_body_version_id,row.created_by,row.stale_at,row.stale_reason,row.created_at,row.execution_mode,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text)
  WHERE card.status='active'
)`,
  planning_objects: `planning_objects AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_object'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,level text,parent_object_id uuid,card_id uuid,title text,sort_order integer,status text,current_version_id uuid,adopted_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  state_change_proposals: `state_change_proposals AS (
  SELECT row.id,row.book_id,row.chapter_document_id,row.body_version_id,row.text_anchor_id,row.cause_event_card_id,row.subject_kind,row.subject_id,row.state_key,row.before_json,version.values->'after_json' AS after_json,row.delta_json,row.reason,row.effective_story_order,row.source,row.status,row.confirmed_state_change_id,row.revision,row.created_at,row.updated_at,row.before_known,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_change_proposal'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean)
  WHERE card.status='active'
)`,
  story_time_proposal_versions: `story_time_proposal_versions AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='story_time_proposal_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,proposal_id uuid,version integer,lifecycle text,time_mode text,start_certainty text,end_certainty text,start_instant timestamptz,end_instant timestamptz,timezone_name text,calendar_key text,start_label text,end_label text,normalized_start numeric,normalized_end numeric,duration_value numeric,duration_unit text,relative_to_event_card_id uuid,relative_relation text,relative_offset numeric,evidence_kind text,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,fact_id uuid,plan_version_id uuid,state_proposal_id uuid,replaces_timing_id uuid,reason text,editor text,created_at timestamptz)
  WHERE card.status='active'
)`,
  story_time_proposals: `story_time_proposals AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='story_time_proposal'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,event_card_id uuid,proposal_source text,status text,current_version_id uuid,confirmed_timing_id uuid,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  story_time_review_actions: `story_time_review_actions AS (
  SELECT row.* FROM new_design.card_version_actions action
  CROSS JOIN LATERAL jsonb_to_record(action.payload || jsonb_build_object('id',action.id,'created_at',action.created_at,'idempotency_key',action.payload->'idempotency_key')) AS row(id uuid,proposal_id uuid,proposal_version_id uuid,action text,actor text,note text,idempotency_key text,created_at timestamptz)
  WHERE split_part(action.action_key,'.',1)='story_time'
)`,
  story_time_positions: `story_time_positions AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='story_time_position'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,space_id uuid,card_id uuid,start_order numeric(14,3),end_order numeric(14,3),start_label text,end_label text,uncertainty text,revision integer,created_at timestamptz,updated_at timestamptz,canonical_timing_id uuid)
  WHERE card.status='active'
)`,
  story_event_narrative_occurrences: `story_event_narrative_occurrences AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='story_event_narrative_occurrence'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,event_card_id uuid,chapter_card_id uuid,scene_card_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,source_time_proposal_version_id uuid,role text,narrative_order numeric,source_kind text,note text,status text,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  story_event_timings: `story_event_timings AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='story_event_timing'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,sequence bigint,book_id uuid,event_card_id uuid,proposal_id uuid,proposal_version_id uuid,lifecycle text,status text,time_mode text,start_certainty text,end_certainty text,start_instant timestamptz,end_instant timestamptz,timezone_name text,calendar_key text,start_label text,end_label text,normalized_start numeric,normalized_end numeric,duration_value numeric,duration_unit text,relative_to_event_card_id uuid,relative_relation text,relative_offset numeric,evidence_kind text,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,fact_id uuid,plan_version_id uuid,state_proposal_id uuid,replaces_timing_id uuid,confirmed_by text,reason text,confirmed_at timestamptz)
  WHERE card.status='active'
)`,
  story_relation_proposal_versions: `story_relation_proposal_versions AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='story_relation_proposal_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,proposal_id uuid,version integer,relation_family text,relation_type text,source_event_card_id uuid,target_event_card_id uuid,evidence_kind text,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,fact_id uuid,plan_version_id uuid,state_proposal_id uuid,confidence numeric,reason text,editor text,created_at timestamptz)
  WHERE card.status='active'
)`,
  story_relation_proposals: `story_relation_proposals AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='story_relation_proposal'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,proposal_source text,status text,current_version_id uuid,confirmed_relation_id uuid,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  story_relation_review_actions: `story_relation_review_actions AS (
  SELECT row.* FROM new_design.card_version_actions action
  CROSS JOIN LATERAL jsonb_to_record(action.payload || jsonb_build_object('id',action.id,'created_at',action.created_at,'idempotency_key',action.payload->'idempotency_key')) AS row(id uuid,proposal_id uuid,proposal_version_id uuid,action text,actor text,note text,idempotency_key text,created_at timestamptz)
  WHERE split_part(action.action_key,'.',1)='story_relation'
)`,
  story_event_relations: `story_event_relations AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='story_event_relation'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,sequence bigint,book_id uuid,proposal_id uuid,proposal_version_id uuid,relation_family text,relation_type text,source_event_card_id uuid,target_event_card_id uuid,confidence numeric,status text,confirmed_by text,reason text,created_at timestamptz)
  WHERE card.status='active'
)`,
  epistemic_claims: `epistemic_claims AS (
  SELECT row.id,row.book_id,row.subject_card_id,row.predicate,row.value_kind,version.values->'value_json' AS value_json,row.object_card_id,row.value_hash,row.truth_fact_id,row.created_by,row.created_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='epistemic_claim'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,subject_card_id uuid,predicate text,value_kind text,value_json jsonb,object_card_id uuid,value_hash char(64),truth_fact_id uuid,created_by text,created_at timestamptz)
  WHERE card.status='active'
)`,
  knowledge_state_proposal_versions: `knowledge_state_proposal_versions AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='knowledge_state_proposal_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,proposal_id uuid,version integer,stance text,confidence numeric,acquisition_method text,source_character_card_id uuid,source_event_card_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,effective_story_order numeric,effective_narrative_order numeric,reason text,editor text,created_at timestamptz)
  WHERE card.status='active'
)`,
  knowledge_state_proposals: `knowledge_state_proposals AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='knowledge_state_proposal'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,claim_id uuid,holder_kind text,holder_key text,holder_card_id uuid,current_version_id uuid,source text,status text,confirmed_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  knowledge_state_review_actions: `knowledge_state_review_actions AS (
  SELECT row.* FROM new_design.card_version_actions action
  CROSS JOIN LATERAL jsonb_to_record(action.payload || jsonb_build_object('id',action.id,'created_at',action.created_at,'idempotency_key',action.payload->'idempotency_key')) AS row(id uuid,proposal_id uuid,proposal_version_id uuid,action text,actor text,note text,idempotency_key text,created_at timestamptz)
  WHERE split_part(action.action_key,'.',1)='knowledge_state'
)`,
  knowledge_state_changes: `knowledge_state_changes AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='knowledge_state_change'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,sequence bigint,book_id uuid,proposal_id uuid,proposal_version_id uuid,claim_id uuid,holder_kind text,holder_key text,holder_card_id uuid,stance text,confidence numeric,effective_story_order numeric,effective_narrative_order numeric,status text,confirmed_by text,created_at timestamptz)
  WHERE card.status='active'
)`,
  current_knowledge_state_projections: `current_knowledge_state_projections AS (
  SELECT row.*,card.id AS id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='current_knowledge_state_projection'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(book_id uuid,holder_kind text,holder_key text,holder_card_id uuid,claim_id uuid,source_change_id uuid,stance text,confidence numeric,effective_story_order numeric,effective_narrative_order numeric,projection_revision bigint,rebuilt_at timestamptz)
  WHERE card.status='active'
)`,
  current_state_projections: `current_state_projections AS (
  SELECT row.book_id,row.subject_kind,row.subject_id,row.state_key,version.values->'value_json' AS value_json,row.source_initial_version_id,row.source_state_change_id,row.projection_revision,row.is_stale,row.rebuilt_at,card.id AS id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='current_state_projection'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(book_id uuid,subject_kind text,subject_id uuid,state_key text,value_json jsonb,source_initial_version_id uuid,source_state_change_id uuid,projection_revision bigint,is_stale boolean,rebuilt_at timestamptz)
  WHERE card.status='active'
)`,
  entity_initial_state_versions: `entity_initial_state_versions AS (
  SELECT row.id,row.initial_state_id,row.version,version.values->'value_json' AS value_json,row.value_hash,row.source_fact_id,row.actor,row.note,row.created_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='entity_initial_state_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,initial_state_id uuid,version integer,value_json jsonb,value_hash char(64),source_fact_id uuid,actor text,note text,created_at timestamptz)
  WHERE card.status='active'
)`,
  entity_initial_states: `entity_initial_states AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='entity_initial_state'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,subject_kind text,subject_id uuid,state_key text,current_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  state_changes: `state_changes AS (
  SELECT row.id,row.sequence,row.book_id,row.settlement_id,row.proposal_id,row.chapter_document_id,row.body_version_id,row.text_anchor_id,row.cause_event_card_id,row.subject_kind,row.subject_id,row.state_key,row.before_json,version.values->'after_json' AS after_json,row.delta_json,row.reason,row.effective_story_order,row.status,row.created_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_change'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz)
  WHERE card.status='active'
)`,
chapter_adoption_sessions: `chapter_adoption_sessions AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_adoption_session'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid)
  WHERE card.status='active'
)`,
  state_milestone_snapshots: `state_milestone_snapshots AS (
  SELECT row.id,row.book_id,row.kind,row.label,row.chapter_document_id,row.body_version_id,row.source_settlement_id,row.projection_revision,version.values->'snapshot' AS snapshot,row.status,row.created_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_milestone_snapshot'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,kind text,label text,chapter_document_id uuid,body_version_id uuid,source_settlement_id uuid,projection_revision bigint,snapshot jsonb,status text,created_at timestamptz)
  WHERE card.status='active'
)`,
  canonical_fact_conflicts: `canonical_fact_conflicts AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='canonical_fact_conflict'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,fact_a_id uuid,fact_b_id uuid,predicate text,reason text,status text,resolution_fact_id uuid,revision integer,created_at timestamptz,resolved_at timestamptz)
  WHERE card.status='active'
)`,
  dictionary_items: `dictionary_items AS (
  SELECT row.id,row.dictionary_id,row.item_key,row.label,version.values->'value' AS value,row.sort_order,row.status,row.created_at,row.updated_at,row.parent_id,row.description,row.revision,row.current_version_id,row.source_item_id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='dictionary_item'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,dictionary_id uuid,item_key text,label text,value jsonb,sort_order integer,status text,created_at timestamptz,updated_at timestamptz,parent_id uuid,description text,revision integer,current_version_id uuid,source_item_id uuid)
  WHERE card.status='active'
)`,
  dictionary_definitions: `dictionary_definitions AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='dictionary_definition'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,dictionary_key text,name text,description text,scope text,owner_space_id uuid,status text,revision integer,created_at timestamptz,updated_at timestamptz,read_only boolean,source_dictionary_id uuid)
  WHERE card.status='active'
)`,
  dictionary_item_versions: `dictionary_item_versions AS (
  SELECT row.id,row.item_id,row.version,row.label,row.description,row.parent_id,row.sort_order,version.values->'value' AS value,row.status,row.path_node_ids,row.path_labels,row.created_by,row.created_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='dictionary_item_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,item_id uuid,version integer,label text,description text,parent_id uuid,sort_order integer,value jsonb,status text,path_node_ids uuid[],path_labels text[],created_by text,created_at timestamptz)
  WHERE card.status='active'
)`,
  card_version_local_values: `card_version_local_values AS (
  SELECT row.card_version_id,row.field_definition_id,row.field_definition_version_id,version.values->'value' AS value,row.created_at,card.id AS id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='card_version_local_value'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz)
  WHERE card.status='active'
)`,
  state_relation_capabilities: `state_relation_capabilities AS (
  SELECT row.*,card.id AS id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_relation_capability'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(space_id uuid,relation_key text,settlement_capability text,state_mode text,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  state_relation_dimensions: `state_relation_dimensions AS (
  SELECT row.*,card.id AS id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_relation_dimension'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(space_id uuid,relation_key text,dimension_key text,label text,direction text,settlement_policy text,state_mode text,revision integer,updated_at timestamptz)
  WHERE card.status='active'
)`,
  state_type_capabilities: `state_type_capabilities AS (
  SELECT row.*,card.id AS id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_type_capability'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(space_id uuid,type_key text,settlement_capability text,state_mode text,default_field_policy text,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  state_field_policies: `state_field_policies AS (
  SELECT row.*,card.id AS id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_field_policy'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(space_id uuid,type_key text,field_key text,settlement_policy text,state_mode text,revision integer,updated_at timestamptz)
  WHERE card.status='active'
)`,
  state_change_proposal_versions: `state_change_proposal_versions AS (
  SELECT row.id,row.proposal_id,row.version,version.values->'before_json' AS before_json,version.values->'after_json' AS after_json,row.delta_json,row.reason,row.effective_story_order,row.editor,row.created_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_change_proposal_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,proposal_id uuid,version integer,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,editor text,created_at timestamptz)
  WHERE card.status='active'
)`,
  state_value_mappings: `state_value_mappings AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_value_mapping'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,space_id uuid,type_key text,field_key text,current_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  state_value_mapping_versions: `state_value_mapping_versions AS (
  SELECT row.id,row.mapping_id,row.version,version.values->'ranges' AS ranges,row.prompt_component_version_id,row.note,row.created_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_value_mapping_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,mapping_id uuid,version integer,ranges jsonb,prompt_component_version_id uuid,note text,created_at timestamptz)
  WHERE card.status='active'
)`,
  research_evidence: `research_evidence AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='research_evidence'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,research_version_id uuid,source_document_version_id uuid,field_path text,excerpt text,start_offset integer,end_offset integer,certainty text,note text,created_at timestamptz)
  WHERE card.status='active'
)`,
  canonical_fact_evidence: `canonical_fact_evidence AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='canonical_fact_evidence'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,fact_id uuid,chapter_text_anchor_id uuid,card_version_id uuid,research_evidence_id uuid,extraction_method text,note text,stale_at timestamptz,stale_reason text,created_at timestamptz)
  WHERE card.status='active'
)`,
  canonical_fact_review_actions: `canonical_fact_review_actions AS (
  SELECT row.* FROM new_design.card_version_actions action
  CROSS JOIN LATERAL jsonb_to_record(action.payload || jsonb_build_object('id',action.id,'created_at',action.created_at,'idempotency_key',action.payload->'idempotency_key')) AS row(id uuid,fact_id uuid,action text,from_status text,to_status text,idempotency_key text,actor text,note text,created_at timestamptz)
  WHERE split_part(action.action_key,'.',1)='canonical_fact'
)`,
  payoff_window_versions: `payoff_window_versions AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='payoff_window_version'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,card_id uuid,version integer,start_chapter_order integer,end_chapter_order integer,idempotency_key uuid,created_at timestamptz)
  WHERE card.status='active'
)`,
  payoff_windows: `payoff_windows AS (
  SELECT row.*,card.id AS id,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='payoff_window'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(book_id uuid,card_id uuid,current_version_id uuid,revision integer,updated_at timestamptz)
  WHERE card.status='active'
)`,
  chapter_stable_checkpoints: `chapter_stable_checkpoints AS (
  SELECT row.id,row.book_id,row.chapter_document_id,row.body_version_id,row.session_id,row.settlement_id,row.previous_checkpoint_id,row.chapter_order,version.values->'summary' AS summary,row.dependency_hash,row.status,row.created_at,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz)
  WHERE card.status='active'
)`,
  narrative_placements: `narrative_placements AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='narrative_placement'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,space_id uuid,subject_card_id uuid,chapter_card_id uuid,scene_card_id uuid,role text,note text,status text,revision integer,created_at timestamptz,updated_at timestamptz)
  WHERE card.status='active'
)`,
  planning_version_references: `planning_version_references AS (
  SELECT row.*,card.id AS record_card_id FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_version_reference'
  JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,planning_version_id uuid,planning_object_id uuid,book_id uuid,reference_role text,card_id uuid,card_version_id uuid,action_key text,note text,sort_order integer,created_at timestamptz)
  WHERE card.status='active'
)`,
} as const;
