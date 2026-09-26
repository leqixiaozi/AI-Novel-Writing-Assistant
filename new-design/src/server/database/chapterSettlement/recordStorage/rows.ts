import {storyRecordCtes} from '../../storyTimeline/persistence';
export const settlementRecordCtes={...storyRecordCtes,
 settlement_relation_configuration_receipts:`settlement_relation_configuration_receipts AS (
 SELECT row.id,row.book_id,row.request_key,row.input_hash,version.values->'receipt' AS receipt,row.created_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='settlement_relation_configuration_receipt'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,request_key text,input_hash text,receipt jsonb,created_at timestamptz) WHERE card.status='active'
)`,
 settlement_relation_configuration_drafts:`settlement_relation_configuration_drafts AS (
 SELECT row.id,row.book_id,row.revision,row.current_version_id,row.relation_type_id,row.source_relation_type_id,row.expected_relation_type_revision,row.status,row.created_at,row.updated_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='settlement_relation_configuration_draft'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,revision integer,current_version_id uuid,relation_type_id uuid,source_relation_type_id uuid,expected_relation_type_revision integer,status text,created_at timestamptz,updated_at timestamptz) WHERE card.status='active'
)`,
 settlement_relation_configuration_versions:`settlement_relation_configuration_versions AS (
 SELECT row.id,row.draft_id,row.version,version.values->'definition' AS definition,row.relation_type_id,row.source_relation_type_id,row.expected_relation_type_revision,row.created_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='settlement_relation_configuration_version'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,draft_id uuid,version integer,definition jsonb,relation_type_id uuid,source_relation_type_id uuid,expected_relation_type_revision integer,created_at timestamptz) WHERE card.status='active'
)`,
 chapter_proposal_extraction_requests:`chapter_proposal_extraction_requests AS (
 SELECT row.id,row.session_id,row.book_id,row.body_version_id,row.task_contract_version_id,row.prompt_recipe_version_id,row.context_manifest_id,row.model_route_snapshot_id,row.ai_task_id,row.status,row.request_hash,row.idempotency_key,row.created_by,row.error_summary,row.created_at,row.updated_at,row.frozen_plan,row.frozen_input_hash,row.expected_session_revision,row.generated_output,row.generated_execution,row.failure,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_proposal_extraction_request'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,session_id uuid,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb) WHERE card.status='active'
)`,
 chapter_adoption_sessions:`chapter_adoption_sessions AS (
 SELECT row.id,row.book_id,row.chapter_document_id,row.body_version_id,row.preparation_id,row.prior_body_version_id,row.adoption_id,row.settlement_id,row.policy_version_id,row.planning_object_id,row.planning_version_id,row.context_manifest_id,row.dependency_hash,row.adoption_kind,row.status,row.revision,row.idempotency_key,row.created_by,row.error_summary,row.created_at,row.updated_at,row.supplement_base_checkpoint_id,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_adoption_session'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active'
)`,
 chapter_settlement_events:`chapter_settlement_events AS (SELECT row.* FROM new_design.card_version_actions action CROSS JOIN LATERAL jsonb_to_record(action.payload || jsonb_build_object('id',action.id,'created_at',action.created_at)) AS row(id uuid,session_id uuid,event_kind text,from_status text,to_status text,item_id uuid,idempotency_key text,actor text,detail jsonb,created_at timestamptz,editing_request_key text,editing_input_hash char(64),editing_receipt jsonb) WHERE split_part(action.action_key,'.',1)='chapter_settlement')`,
 chapter_stable_checkpoints:`chapter_stable_checkpoints AS (
 SELECT row.id,row.book_id,row.chapter_document_id,row.body_version_id,row.session_id,row.settlement_id,row.previous_checkpoint_id,row.chapter_order,version.values->'summary' AS summary,row.dependency_hash,row.status,row.created_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active'
)`,
 chapter_resource_supplements:`chapter_resource_supplements AS (
 SELECT row.session_id,row.book_id,row.base_checkpoint_id,row.request_key,version.values->'full_input' AS full_input,row.input_hash,version.values->'source_snapshot' AS source_snapshot,row.source_hash,version.values->'original_receipt' AS original_receipt,row.actor,row.created_at,card.id AS id,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_resource_supplement'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active'
)`,
 book_settlement_policies:`book_settlement_policies AS (
 SELECT row.book_id,row.current_version_id,row.revision,row.updated_at,card.id AS id,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='book_settlement_policy'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(book_id uuid,current_version_id uuid,revision integer,updated_at timestamptz) WHERE card.status='active'
)`,
 settlement_policy_versions:`settlement_policy_versions AS (
 SELECT row.id,row.book_id,row.version,row.auto_confirm_low_risk,row.allowed_auto_categories,row.major_fact_categories,row.confidence_floor,row.created_by,row.note,row.created_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='settlement_policy_version'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,version integer,auto_confirm_low_risk boolean,allowed_auto_categories text[],major_fact_categories text[],confidence_floor numeric(5,4),created_by text,note text,created_at timestamptz) WHERE card.status='active'
)`,
 chapter_adoption_preparations:`chapter_adoption_preparations AS (
 SELECT row.id,row.book_id,row.chapter_document_id,row.body_version_id,row.expected_document_revision,row.planning_object_id,row.planning_version_id,row.planning_content_hash,row.context_manifest_id,version.values->'dependency_snapshot' AS dependency_snapshot,row.dependency_hash,row.status,row.idempotency_key,row.created_by,row.created_at,row.supplement_base_checkpoint_id,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_adoption_preparation'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,expected_document_revision integer,planning_object_id uuid,planning_version_id uuid,planning_content_hash char(64),context_manifest_id uuid,dependency_snapshot jsonb,dependency_hash char(64),status text,idempotency_key text,created_by text,created_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active'
)`,
 chapter_settlement_item_versions:`chapter_settlement_item_versions AS (
 SELECT row.id,row.item_id,row.version,version.values->'snapshot' AS snapshot,row.editor,row.note,row.created_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_settlement_item_version'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,item_id uuid,version integer,snapshot jsonb,editor text,note text,created_at timestamptz) WHERE card.status='active'
)`,
 embedding_profile_versions:`embedding_profile_versions AS (
 SELECT row.id,row.profile_id,row.version,row.provider_key,row.model_key,row.dimensions,row.distance_metric,row.normalize,row.chunker_key,row.chunker_version,row.max_chunk_chars,row.overlap_chars,row.allowed_source_kinds,row.content_hash,row.created_by,row.created_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='embedding_profile_version'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,profile_id uuid,version integer,provider_key text,model_key text,dimensions integer,distance_metric text,normalize boolean,chunker_key text,chunker_version text,max_chunk_chars integer,overlap_chars integer,allowed_source_kinds text[],content_hash char(64),created_by text,created_at timestamptz) WHERE card.status='active'
)`,
 embedding_source_snapshots:`embedding_source_snapshots AS (
 SELECT row.id,row.space_id,row.book_id,row.profile_version_id,row.dependency_source_resource_id,row.source_kind,row.source_stable_id,row.source_version_id,row.source_revision,row.source_hash,row.title,chunk.chunk_text AS content_text,row.chunk_recipe_hash,row.status,row.created_by,row.created_at,row.stale_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='embedding_source_snapshot'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 LEFT JOIN new_design.embedding_chunks chunk ON chunk.id=(version.values->>'id')::uuid AND chunk.record_kind='source'
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,space_id uuid,book_id uuid,profile_version_id uuid,dependency_source_resource_id uuid,source_kind text,source_stable_id uuid,source_version_id uuid,source_revision integer,source_hash char(64),title text,content_text text,chunk_recipe_hash char(64),status text,created_by text,created_at timestamptz,stale_at timestamptz) WHERE card.status='active'
)`,
 chunking_requests:`chunking_requests AS (
 SELECT row.id,row.book_id,row.source_snapshot_id,row.profile_version_id,row.expected_source_hash,row.status,row.attempt_count,row.idempotency_key,row.last_error,row.created_at,row.started_at,row.completed_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chunking_request'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,book_id uuid,source_snapshot_id uuid,profile_version_id uuid,expected_source_hash char(64),status text,attempt_count integer,idempotency_key text,last_error text,created_at timestamptz,started_at timestamptz,completed_at timestamptz) WHERE card.status='active'
)`,
 dependency_resource_states:`dependency_resource_states AS (
 SELECT row.resource_id,row.book_id,row.state,row.revision,row.last_event_id,row.updated_at,card.id AS id,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='dependency_resource_state'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(resource_id uuid,book_id uuid,state text,revision bigint,last_event_id uuid,updated_at timestamptz) WHERE card.status='active'
)`,
 ai_contract_publications:`ai_contract_publications AS (
 SELECT row.id,row.entity_kind,row.entity_id,row.from_version_id,row.to_version_id,row.entity_revision,row.action,row.actor,row.idempotency_key,row.created_at,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='ai_contract_publication'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,entity_kind text,entity_id uuid,from_version_id uuid,to_version_id uuid,entity_revision integer,action text,actor text,idempotency_key text,created_at timestamptz) WHERE card.status='active'
)`,
 context_manifest_slots:`context_manifest_slots AS (
 SELECT row.id,row.manifest_id,row.slot_key,row.sort_order,row.required,row.token_budget,card.id record_card_id FROM new_design.cards card
 JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='context_manifest_slot'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) AS row(id uuid,manifest_id uuid,slot_key text,sort_order integer,required boolean,token_budget integer) WHERE card.status='active'
)`,
} as const;
