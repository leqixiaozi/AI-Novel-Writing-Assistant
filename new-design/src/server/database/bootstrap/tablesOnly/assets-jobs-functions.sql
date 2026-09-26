-- Native card-kernel domain functions. Loaded after the tables and kernel_store_record.
-- No compatibility relations or migration-time function rewriting.
SET search_path TO new_design,public;

CREATE OR REPLACE FUNCTION new_design.dependency_content_hash(payload text) RETURNS char(64) LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
  SELECT (md5(COALESCE(payload,'')) || md5(reverse(COALESCE(payload,''))))::char(64)
$$;

CREATE OR REPLACE FUNCTION new_design.resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid) RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 CASE requested_kind
 WHEN 'card_type_version' THEN
  RETURN QUERY SELECT type.space_id,book.id,(dependency_content_hash(version.fields::text)
     )::char(64) FROM card_type_versions version JOIN card_types type ON type.id=version.card_type_id
      LEFT JOIN books book ON book.space_id=type.space_id
      WHERE type.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'template_group_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(dependency_content_hash(version.payload::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,template_id uuid,version integer,payload jsonb,created_at timestamptz) WHERE record_type.type_key='template_group_version') version WHERE version.template_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'card_version' THEN
  RETURN QUERY SELECT card.space_id,book.id,(dependency_content_hash(version.title || version.values::text || version.type_version_id::text)
     )::char(64) FROM card_versions version JOIN cards card ON card.id=version.card_id LEFT JOIN books book ON book.space_id=card.space_id
      WHERE card.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'card_relation' THEN
  RETURN QUERY SELECT relation.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM card_relations relation JOIN card_relation_versions version ON version.card_relation_id=relation.id
    LEFT JOIN books book ON book.space_id=relation.space_id
    WHERE relation.id=requested_stable_id AND version.id=CASE WHEN requested_version_id=relation.id THEN relation.current_version_id ELSE requested_version_id END;
 WHEN 'research_document_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(version.content_hash::char(64)
     )::char(64) FROM research_document_versions version WHERE version.document_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'research_record_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(version.run_hash::char(64)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,record_id uuid,version integer,parent_version_id uuid,source_scope jsonb,template_key text,template_version integer,run_status text,progress integer,budget_tokens integer,used_tokens integer,prompt_snapshot jsonb,model_snapshot jsonb,input_snapshot jsonb,structured_result jsonb,report text,last_error text,cancel_requested boolean,run_hash text,created_at timestamptz,completed_at timestamptz) WHERE record_type.type_key='research_record_version') version WHERE version.record_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'research_reference_pack_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(dependency_content_hash(version.id::text || version.note)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,pack_id uuid,version integer,note text,created_at timestamptz) WHERE record_type.type_key='research_reference_pack_version') version WHERE version.pack_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'chapter_body_version' THEN
  RETURN QUERY SELECT book.space_id,document.book_id,(version.content_hash
     )::char(64) FROM chapter_body_versions version JOIN chapter_documents document ON document.id=version.chapter_document_id JOIN books book ON book.id=document.book_id
      WHERE document.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'chapter_text_anchor' THEN
  RETURN QUERY SELECT book.space_id,anchor.book_id,(anchor.fragment_hash
     )::char(64) FROM new_design.text_anchors anchor JOIN books book ON book.id=anchor.book_id
      WHERE anchor.id=requested_stable_id AND anchor.body_version_id=requested_version_id;
 WHEN 'canonical_fact' THEN
  RETURN QUERY SELECT book.space_id,fact.book_id,(fact.value_hash
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,subject_card_id uuid,predicate text,value_kind text,value_json jsonb,value_hash char(64),object_card_id uuid,valid_story_start numeric,valid_story_end numeric,status text,confidence numeric(5,4),source_method text,supersedes_fact_id uuid,superseded_by_fact_id uuid,revision integer,created_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='canonical_fact') fact JOIN books book ON book.id=fact.book_id
      WHERE fact.id=requested_stable_id AND fact.id=requested_version_id;
 WHEN 'chapter_settlement' THEN
  RETURN QUERY SELECT book.space_id,settlement.book_id,(dependency_content_hash(to_jsonb(settlement)::text)
     )::char(64) FROM chapter_settlements settlement JOIN books book ON book.id=settlement.book_id
      WHERE settlement.chapter_document_id=requested_stable_id AND settlement.id=requested_version_id;
 WHEN 'state_change' THEN
  RETURN QUERY SELECT book.space_id,change.book_id,(dependency_content_hash(to_jsonb(change)::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE record_type.type_key='state_change') change JOIN books book ON book.id=change.book_id
      WHERE change.id=requested_stable_id AND change.id=requested_version_id;
 WHEN 'knowledge_state_change' THEN
  RETURN QUERY SELECT book.space_id,change.book_id,(dependency_content_hash(to_jsonb(change)::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,sequence bigint,book_id uuid,proposal_id uuid,proposal_version_id uuid,claim_id uuid,holder_kind text,holder_key text,holder_card_id uuid,stance text,confidence numeric,effective_story_order numeric,effective_narrative_order numeric,status text,confirmed_by text,created_at timestamptz) WHERE record_type.type_key='knowledge_state_change') change JOIN books book ON book.id=change.book_id
      WHERE change.proposal_id=requested_stable_id AND change.id=requested_version_id;
 WHEN 'story_event_timing' THEN
  RETURN QUERY SELECT book.space_id,timing.book_id,(dependency_content_hash(to_jsonb(timing)::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,sequence bigint,book_id uuid,event_card_id uuid,proposal_id uuid,proposal_version_id uuid,lifecycle text,status text,time_mode text,start_certainty text,end_certainty text,start_instant timestamptz,end_instant timestamptz,timezone_name text,calendar_key text,start_label text,end_label text,normalized_start numeric,normalized_end numeric,duration_value numeric,duration_unit text,relative_to_event_card_id uuid,relative_relation text,relative_offset numeric,evidence_kind text,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,fact_id uuid,plan_version_id uuid,state_proposal_id uuid,replaces_timing_id uuid,confirmed_by text,reason text,confirmed_at timestamptz) WHERE record_type.type_key='story_event_timing') timing JOIN books book ON book.id=timing.book_id
      WHERE timing.id=requested_stable_id AND timing.id=requested_version_id;
 WHEN 'story_event_relation' THEN
  RETURN QUERY SELECT book.space_id,relation.book_id,(dependency_content_hash(to_jsonb(relation)::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,sequence bigint,book_id uuid,proposal_id uuid,proposal_version_id uuid,relation_family text,relation_type text,source_event_card_id uuid,target_event_card_id uuid,confidence numeric,status text,confirmed_by text,reason text,created_at timestamptz) WHERE record_type.type_key='story_event_relation') relation JOIN books book ON book.id=relation.book_id
      WHERE relation.proposal_id=requested_stable_id AND relation.id=requested_version_id;
 WHEN 'planning_version' THEN
  RETURN QUERY SELECT book.space_id,version.book_id,(version.content_hash
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE record_type.type_key='planning_version') version JOIN books book ON book.id=version.book_id
      WHERE version.object_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'prompt_recipe_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(version.content_hash
     )::char(64) FROM prompt_recipe_versions version WHERE version.recipe_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'task_contract_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(version.content_hash
     )::char(64) FROM task_contract_versions version WHERE version.contract_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'context_manifest' THEN
  RETURN QUERY SELECT COALESCE(book.space_id,scope.space_id),manifest.book_id,(manifest.manifest_hash)::char(64) FROM context_manifests manifest LEFT JOIN books book ON book.id=manifest.book_id LEFT JOIN cards scope ON scope.id=COALESCE(manifest.public_character_scope,manifest.public_title_scope) WHERE manifest.id=requested_stable_id AND manifest.id=requested_version_id AND (book.id IS NOT NULL OR scope.id IS NOT NULL);
 WHEN 'model_route_snapshot' THEN
  RETURN QUERY SELECT book.space_id,snapshot.book_id,(snapshot.snapshot_hash)::char(64) FROM model_route_snapshots snapshot LEFT JOIN books book ON book.id=snapshot.book_id WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id AND (book.id IS NOT NULL OR (snapshot.book_id IS NULL AND snapshot.task_contract_version_id IS NULL AND snapshot.managed_task_key IN ('directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate','chapter_settlement','chapter_generation','world_consistency','creative_extraction','character_dialogue','image_generation')));
 WHEN 'ai_task_attempt' THEN
  RETURN QUERY SELECT task.space_id,task.book_id,(COALESCE(attempt.result_hash,attempt.input_hash)
     )::char(64) FROM ai_task_attempts attempt JOIN ai_tasks task ON task.id=attempt.task_id
      WHERE attempt.task_id=requested_stable_id AND attempt.id=requested_version_id;
 WHEN 'quality_audit_report' THEN
  RETURN QUERY SELECT book.space_id,report.book_id,(dependency_content_hash(report.input_hash || report.id::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text) WHERE record_type.type_key='quality_audit_report') report JOIN books book ON book.id=report.book_id
      WHERE report.id=requested_stable_id AND report.id=requested_version_id;
 WHEN 'embedding_source_snapshot' THEN
  RETURN QUERY SELECT snapshot.space_id,snapshot.book_id,(snapshot.source_hash)::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,profile_version_id uuid,dependency_source_resource_id uuid,source_kind text,source_stable_id uuid,source_version_id uuid,source_revision integer,source_hash text,title text,chunk_recipe_hash text,status text,created_by text,created_at timestamptz,stale_at timestamptz) WHERE record_type.type_key='embedding_source_snapshot') snapshot WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id;
 WHEN 'embedding_chunk' THEN
  RETURN QUERY SELECT snapshot.space_id,chunk.book_id,(chunk.content_hash)::char(64) FROM embedding_chunks chunk JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,profile_version_id uuid,dependency_source_resource_id uuid,source_kind text,source_stable_id uuid,source_version_id uuid,source_revision integer,source_hash text,title text,chunk_recipe_hash text,status text,created_by text,created_at timestamptz,stale_at timestamptz) WHERE record_type.type_key='embedding_source_snapshot') snapshot ON snapshot.id=chunk.source_snapshot_id WHERE chunk.record_kind='chunk' AND chunk.id=requested_stable_id AND chunk.id=requested_version_id;
 WHEN 'embedding_result' THEN
  RETURN QUERY SELECT snapshot.space_id,request.book_id,(result.vector_hash)::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,request_id uuid,attempt_id uuid,chunk_id uuid,profile_version_id uuid,observed_source_hash text,observed_chunk_hash text,outcome text,vector_hash text,detail text,created_at timestamptz) WHERE record_type.type_key='embedding_result') result JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,chunk_id uuid,profile_version_id uuid,expected_source_hash text,expected_chunk_hash text,status text,attempt_count integer,idempotency_key text,next_retry_at timestamptz,last_error_code text,last_error_detail text,retryable boolean,created_at timestamptz,updated_at timestamptz,embedding_freeze jsonb,embedding_execution_key uuid,embedding_lease_expires_at timestamptz,embedding_model_state text) WHERE record_type.type_key='embedding_request') request ON request.id=result.request_id JOIN embedding_chunks chunk ON chunk.id=result.chunk_id JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,profile_version_id uuid,dependency_source_resource_id uuid,source_kind text,source_stable_id uuid,source_version_id uuid,source_revision integer,source_hash text,title text,chunk_recipe_hash text,status text,created_by text,created_at timestamptz,stale_at timestamptz) WHERE record_type.type_key='embedding_source_snapshot') snapshot ON snapshot.id=chunk.source_snapshot_id WHERE result.id=requested_stable_id AND result.id=requested_version_id AND result.outcome='applied';
 WHEN 'embedding_index_generation' THEN
  RETURN QUERY SELECT book.space_id,generation.book_id,(generation.checksum)::char(64) FROM new_design.embedding_generations generation JOIN books book ON book.id=generation.book_id WHERE generation.id=requested_stable_id AND generation.id=requested_version_id AND generation.checksum IS NOT NULL;
 WHEN 'card_mount' THEN
  RETURN QUERY SELECT instance.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,card_mount_id uuid,revision integer,form_version_id uuid,source_card_version_id uuid,slot_key text,card_id uuid,sort_order integer,local_values jsonb,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='card_mount_version') version JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,form_instance_id uuid,slot_key text,card_id uuid,relation_id uuid,sort_order integer,local_values jsonb,revision integer,created_at timestamptz,updated_at timestamptz,status text,source_card_version_id uuid,current_version_id uuid,created_by text,ended_by text,ended_at timestamptz) WHERE record_type.type_key='card_mount') mount ON mount.id=version.card_mount_id
    JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,form_version_id uuid,primary_card_id uuid,title text,revision integer,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='card_group_form_instance') instance ON instance.id=mount.form_instance_id LEFT JOIN books book ON book.space_id=instance.space_id
    WHERE mount.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'tag_version' THEN
  RETURN QUERY SELECT tag.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,tag_key text,status text,revision integer,current_version_id uuid,visibility text,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='material_tag') tag JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,tag_id uuid,version integer,name text,aliases text[],color text,metadata jsonb,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='material_tag_version') version ON version.tag_id=tag.id LEFT JOIN books book ON book.space_id=tag.space_id
    WHERE tag.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'tag_membership' THEN
  RETURN QUERY SELECT membership.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,tag_id uuid,card_id uuid,status text,revision integer,current_version_id uuid,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='material_tag_membership') membership JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,membership_id uuid,revision integer,tag_version_id uuid,card_version_id uuid,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='material_tag_membership_version') version ON version.membership_id=membership.id LEFT JOIN books book ON book.space_id=membership.space_id
    WHERE membership.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'material_group_version' THEN
  RETURN QUERY SELECT group_row.space_id,group_row.book_id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,group_key text,parent_id uuid,sort_order integer,status text,revision integer,current_version_id uuid,visibility text,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='material_group') group_row JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,group_id uuid,version integer,name text,parent_id uuid,sort_order integer,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='material_group_version') version ON version.group_id=group_row.id
    WHERE group_row.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'group_membership' THEN
  RETURN QUERY SELECT membership.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,group_id uuid,card_id uuid,sort_order integer,status text,revision integer,current_version_id uuid,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='material_group_membership') membership JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,membership_id uuid,revision integer,group_version_id uuid,card_version_id uuid,sort_order integer,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='material_group_membership_version') version ON version.membership_id=membership.id LEFT JOIN books book ON book.space_id=membership.space_id
    WHERE membership.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'smart_view_version' THEN
  RETURN QUERY SELECT view_row.space_id,view_row.book_id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,view_key text,base_view_key text,status text,revision integer,current_version_id uuid,visibility text,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='smart_view') view_row JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,smart_view_id uuid,version integer,name text,description text,filter_ast jsonb,sort_config jsonb,grouping jsonb,display_columns text[],layout jsonb,copied_from_version_id uuid,created_by text,created_at timestamptz) WHERE record_type.type_key='smart_view_version') version ON version.smart_view_id=view_row.id
    WHERE view_row.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'context_binding_version' THEN
  RETURN QUERY SELECT binding.space_id,binding.book_id,(version.content_hash)::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,binding_key text,scope_kind text,scope_ref text,name text,description text,status text,revision integer,current_version_id uuid,adopted_version_id uuid,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='context_binding') binding JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,binding_id uuid,version integer,base_version_id uuid,inheritance_mode text,activation_rule jsonb,slot_key text,priority integer,content_role text,token_budget integer,trim_strategy text,dedupe_strategy text,status text,content_hash char(64),created_by text,created_at timestamptz) WHERE record_type.type_key='context_binding_version') version ON version.binding_id=binding.id WHERE binding.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'context_preview' THEN
  RETURN QUERY SELECT book.space_id,preview.book_id,(preview.source_set_hash)::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,volume_id uuid,chapter_id uuid,scene_id uuid,task_node_key text,task_group text,one_time_overrides jsonb,status text,total_budget integer,required_tokens integer,reference_tokens integer,included_tokens integer,remaining_tokens integer,candidate_count integer,included_count integer,decision_summary jsonb,source_set_hash char(64),timeout_ms integer,stale_at timestamptz,stale_reason text,created_by text,created_at timestamptz) WHERE record_type.type_key='context_preview') preview JOIN books book ON book.id=preview.book_id WHERE preview.id=requested_stable_id AND preview.id=requested_version_id;
 WHEN 'semantic_retrieval_run' THEN
  RETURN QUERY SELECT book.space_id,run.book_id,(dependency_content_hash(run.query_hash||run.id::text||run.result_count::text))::char(64) FROM new_design.retrieval_runs run JOIN books book ON book.id=run.book_id WHERE run.id=requested_stable_id AND run.id=requested_version_id;
 WHEN 'entity_initial_state' THEN
  RETURN QUERY SELECT book.space_id,initial.book_id,(version.value_hash
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,subject_kind text,subject_id uuid,state_key text,current_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='entity_initial_state') initial JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,initial_state_id uuid,version integer,value_json jsonb,value_hash char(64),source_fact_id uuid,actor text,note text,created_at timestamptz) WHERE record_type.type_key='entity_initial_state_version') version ON version.initial_state_id=initial.id JOIN books book ON book.id=initial.book_id
      WHERE initial.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'asset_version' THEN
  RETURN QUERY SELECT asset.space_id,version.book_id,(content.checksum)::char(64) FROM asset_versions version JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,asset_key text,asset_kind text,title text,status text,current_version_id uuid,revision integer,created_by text,created_at timestamptz,updated_at timestamptz,archived_at timestamptz) WHERE record_type.type_key='asset') asset ON asset.id=version.asset_id JOIN asset_content_objects content ON content.id=version.content_object_id WHERE version.asset_id=requested_stable_id AND version.id=requested_version_id;
 ELSE RAISE EXCEPTION 'unsupported dependency resource kind: %',requested_kind USING ERRCODE='23514';
 END CASE;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_dependency_resource() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE resolved record;
BEGIN
  SELECT * INTO resolved FROM resolve_dependency_resource(NEW.resource_kind,NEW.stable_object_id,NEW.exact_version_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'dependency resource reference does not resolve' USING ERRCODE='23503'; END IF;
  NEW.space_id:=resolved.resolved_space_id;
  NEW.book_id:=resolved.resolved_book_id;
  NEW.content_hash:=resolved.resolved_hash;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_dependency_resource_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'dependency resource registry is immutable' USING ERRCODE='23514'; END $$;

CREATE OR REPLACE FUNCTION new_design.register_dependency_resource(kind text,stable_id uuid,version_id uuid) RETURNS uuid LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE resource_id uuid;
BEGIN
  SELECT id INTO resource_id FROM dependency_resources WHERE resource_kind=kind AND stable_object_id=stable_id AND exact_version_id=version_id;
  IF resource_id IS NOT NULL THEN RETURN resource_id; END IF;
  resource_id:=gen_random_uuid();
  INSERT INTO dependency_resources(id,resource_kind,stable_object_id,exact_version_id,content_hash)
  VALUES(resource_id,kind,stable_id,version_id,''::char(64))
  ON CONFLICT(resource_kind,stable_object_id,exact_version_id) DO NOTHING;
  RETURN (SELECT id FROM dependency_resources WHERE resource_kind=kind AND stable_object_id=stable_id AND exact_version_id=version_id);
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_dependency_edge() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE source_row record; derived_row record;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dependency edges are append-only' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'active' OR NEW.status<>'ended' OR NEW.ended_at IS NULL OR
       (to_jsonb(NEW)-ARRAY['status','ended_at','end_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','ended_at','end_reason']::text[]) THEN
      RAISE EXCEPTION 'dependency edge may only transition from active to ended' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dependency-edges:'||NEW.book_id::text,0));
  SELECT * INTO source_row FROM dependency_resources WHERE id=NEW.source_resource_id;
  SELECT * INTO derived_row FROM dependency_resources WHERE id=NEW.derived_resource_id;
  IF source_row.id IS NULL OR derived_row.id IS NULL THEN RAISE EXCEPTION 'dependency resource not found' USING ERRCODE='23503'; END IF;
  IF derived_row.book_id IS DISTINCT FROM NEW.book_id OR derived_row.space_id IS DISTINCT FROM NEW.space_id OR
     (source_row.book_id IS NOT NULL AND (source_row.book_id IS DISTINCT FROM NEW.book_id OR source_row.space_id IS DISTINCT FROM NEW.space_id)) THEN
    RAISE EXCEPTION 'cross-book dependency is forbidden' USING ERRCODE='23514';
  END IF;
  IF EXISTS(
    WITH RECURSIVE walk(resource_id,path) AS (
      SELECT edge.derived_resource_id,ARRAY[edge.source_resource_id,edge.derived_resource_id]
      FROM dependency_edges edge WHERE edge.source_resource_id=NEW.derived_resource_id AND edge.status='active'
      UNION ALL
      SELECT edge.derived_resource_id,walk.path||edge.derived_resource_id
      FROM walk JOIN dependency_edges edge ON edge.source_resource_id=walk.resource_id AND edge.status='active'
      WHERE NOT edge.derived_resource_id=ANY(walk.path) AND cardinality(walk.path)<100
    ) SELECT 1 FROM walk WHERE resource_id=NEW.source_resource_id
  ) THEN RAISE EXCEPTION 'dependency cycle is forbidden' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.add_registered_dependency(
  source_kind text,source_stable_id uuid,source_version_id uuid,
  derived_kind text,derived_stable_id uuid,derived_version_id uuid,
  edge_kind text,edge_strength text,edge_origin text,edge_origin_id uuid
) RETURNS uuid LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE source_id uuid; derived_id uuid; derived_row record; edge_id uuid;
BEGIN
  source_id:=register_dependency_resource(source_kind,source_stable_id,source_version_id);
  derived_id:=register_dependency_resource(derived_kind,derived_stable_id,derived_version_id);
  SELECT * INTO derived_row FROM dependency_resources WHERE id=derived_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('dependency-edges:'||derived_row.book_id::text,0));
  SELECT id INTO edge_id FROM dependency_edges WHERE source_resource_id=source_id AND derived_resource_id=derived_id AND dependency_kind=edge_kind AND status='active';
  IF edge_id IS NOT NULL THEN RETURN edge_id; END IF;
  edge_id:=gen_random_uuid();
  INSERT INTO dependency_edges(id,space_id,book_id,source_resource_id,derived_resource_id,dependency_kind,dependency_strength,origin_kind,origin_id)
  VALUES(edge_id,derived_row.space_id,derived_row.book_id,source_id,derived_id,edge_kind,edge_strength,edge_origin,edge_origin_id);
  RETURN edge_id;
END $$;

CREATE OR REPLACE FUNCTION new_design.reserve_outbox_aggregate_sequence(requested_space_id uuid,requested_book_id uuid,requested_kind text,requested_id uuid) RETURNS bigint LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE sequence_value bigint;
BEGIN
  INSERT INTO outbox_aggregate_sequences(space_id,book_id,aggregate_kind,aggregate_id,last_sequence) VALUES(requested_space_id,requested_book_id,requested_kind,requested_id,1)
  ON CONFLICT(aggregate_kind,aggregate_id) DO UPDATE SET last_sequence=outbox_aggregate_sequences.last_sequence+1,updated_at=now()
  RETURNING last_sequence INTO sequence_value;
  RETURN sequence_value;
END $$;

CREATE OR REPLACE FUNCTION new_design.enqueue_registered_background_job(request_kind text,request_id uuid,request_space_id uuid,request_book_id uuid,requested_correlation_id uuid,requested_causation_id uuid,requested_producer_kind text DEFAULT 'domain_store') RETURNS uuid LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE handler record; event_id uuid; job_id uuid; sequence_value bigint; payload_value jsonb; ordering_value text; priority_value integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('background-request:'||request_kind||':'||request_id::text,0));
  SELECT * INTO handler FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(handler_key text,job_kind text,topic text,event_version integer,specialized_request_kind text,default_max_attempts integer,default_lease_ms integer,backoff_base_ms integer,backoff_cap_ms integer,status text,created_at timestamptz) WHERE record_type.type_key='background_job_handler') background_job_handlers WHERE specialized_request_kind=request_kind AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'no active handler registered for %',request_kind USING ERRCODE='23514'; END IF;
  IF requested_producer_kind NOT IN ('domain_store','migration_bridge') THEN RAISE EXCEPTION 'invalid specialized request producer kind' USING ERRCODE='23514'; END IF;
  IF request_kind='dependency_recompute_request' THEN SELECT priority INTO priority_value FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,target_resource_id uuid,invalidation_event_id uuid,required_upstream_versions jsonb,priority integer,status text,reason text,strategy_key text,task_contract_version_id uuid,idempotency_key text,created_at timestamptz,started_at timestamptz,completed_at timestamptz) WHERE record_type.type_key='dependency_recompute_request') dependency_recompute_requests WHERE id=request_id;
  ELSIF request_kind='ai_task' THEN SELECT priority INTO priority_value FROM ai_tasks WHERE id=request_id;
  END IF;
  payload_value:=jsonb_build_object('specializedRequestKind',request_kind,'specializedRequestId',request_id,'bookId',request_book_id);
  SELECT id,aggregate_sequence,ordering_key INTO event_id,sequence_value,ordering_value FROM outbox_events WHERE topic=handler.topic AND producer_idempotency_key='request:'||request_kind||':'||request_id::text;
  IF event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbox_events WHERE id=event_id AND space_id IS NOT DISTINCT FROM request_space_id AND book_id IS NOT DISTINCT FROM request_book_id AND payload=payload_value AND event_version=handler.event_version) THEN RAISE EXCEPTION 'background request idempotency scope conflict' USING ERRCODE='23514'; END IF;
  IF event_id IS NULL THEN
    ordering_value:=COALESCE('book:'||request_book_id::text||':handler:'||handler.handler_key,'space:'||request_space_id::text||':handler:'||handler.handler_key);
    sequence_value:=reserve_outbox_aggregate_sequence(request_space_id,request_book_id,CASE WHEN request_book_id IS NULL THEN 'space_runtime' ELSE 'book_runtime' END,COALESCE(request_book_id,request_space_id));
    event_id:=gen_random_uuid();
    INSERT INTO outbox_events(id,space_id,book_id,topic,event_version,aggregate_kind,aggregate_id,aggregate_sequence,ordering_key,producer_kind,producer_idempotency_key,payload,payload_hash,correlation_id,causation_id)
    VALUES(event_id,request_space_id,request_book_id,handler.topic,handler.event_version,CASE WHEN request_book_id IS NULL THEN 'space_runtime' ELSE 'book_runtime' END,COALESCE(request_book_id,request_space_id),sequence_value,ordering_value,requested_producer_kind,'request:'||request_kind||':'||request_id::text,payload_value,dependency_content_hash(payload_value::text),requested_correlation_id,requested_causation_id);
  END IF;
  SELECT id INTO job_id FROM background_jobs WHERE handler_key=handler.handler_key AND specialized_request_kind=request_kind AND specialized_request_id=request_id AND execution_generation=1;
  IF job_id IS NULL THEN
    job_id:=gen_random_uuid();
    INSERT INTO background_jobs(id,outbox_event_id,space_id,book_id,handler_key,job_kind,specialized_request_kind,specialized_request_id,ordering_key,aggregate_sequence,priority,max_attempts)
    VALUES(job_id,event_id,request_space_id,request_book_id,handler.handler_key,handler.job_kind,request_kind,request_id,ordering_value,sequence_value,priority_value,handler.default_max_attempts);
  END IF;
  RETURN job_id;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_outbox_scope() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF NEW.space_id IS NULL THEN RAISE EXCEPTION 'outbox runtime record requires a space' USING ERRCODE='23514'; END IF;
  IF NEW.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND space_id=NEW.space_id) THEN RAISE EXCEPTION 'outbox runtime book and space mismatch' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='outbox_events' AND NOT EXISTS(SELECT 1 FROM outbox_aggregate_sequences aggregate_row WHERE aggregate_row.aggregate_kind=NEW.aggregate_kind AND aggregate_row.aggregate_id=NEW.aggregate_id AND aggregate_row.space_id=NEW.space_id AND aggregate_row.book_id IS NOT DISTINCT FROM NEW.book_id AND aggregate_row.last_sequence>=(to_jsonb(NEW)->>'aggregate_sequence')::bigint) THEN RAISE EXCEPTION 'outbox event aggregate sequence mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_outbox_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514'; END $$;

CREATE OR REPLACE FUNCTION new_design.validate_outbox_inbox_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE expected_hash char(64); job_handler text; consumer_handler text; stored_outcome text;
BEGIN
  SELECT event.payload_hash,job.handler_key INTO expected_hash,job_handler FROM background_jobs job JOIN outbox_events event ON event.id=job.outbox_event_id WHERE job.id=NEW.job_id AND event.id=NEW.event_id;
  SELECT handler_key INTO consumer_handler FROM outbox_consumers WHERE consumer_key=NEW.consumer_key;
  IF expected_hash IS NULL OR expected_hash IS DISTINCT FROM NEW.event_payload_hash OR job_handler IS DISTINCT FROM consumer_handler THEN RAISE EXCEPTION 'inbox receipt does not match event or consumer handler' USING ERRCODE='23514'; END IF;
  IF NEW.result_id IS NULL THEN
    IF NEW.outcome<>'cancelled' THEN RAISE EXCEPTION 'non-cancelled inbox receipt requires a result' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT outcome INTO stored_outcome FROM new_design.background_job_events WHERE id=NEW.result_id AND job_id=NEW.job_id;
    IF (CASE stored_outcome WHEN 'applied' THEN 'succeeded' ELSE stored_outcome END) IS DISTINCT FROM NEW.outcome THEN RAISE EXCEPTION 'inbox receipt outcome does not match result' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_outbox_aggregate_sequence() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'outbox aggregate sequence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['last_sequence','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['last_sequence','updated_at']::text[]) OR NEW.last_sequence<=OLD.last_sequence THEN RAISE EXCEPTION 'outbox aggregate sequence can only advance' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_consumer_update() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'consumer registration cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','revision','pause_reason','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','pause_reason','updated_at']::text[]) THEN RAISE EXCEPTION 'consumer registration is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'consumer revision must advance by one' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_background_job_transition() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'background job history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','attempt_count','next_run_at','lease_owner','lease_until','heartbeat_at','lease_token_digest','fencing_token','current_attempt_id','checkpoint_key','last_error_kind','last_error_code','last_error_summary','result_idempotency_key','revision','updated_at','completed_at','archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','next_run_at','lease_owner','lease_until','heartbeat_at','lease_token_digest','fencing_token','current_attempt_id','checkpoint_key','last_error_kind','last_error_code','last_error_summary','result_idempotency_key','revision','updated_at','completed_at','archived_at']::text[]) THEN RAISE EXCEPTION 'background job frozen identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'background job revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('leased','cancelled','dead_letter')) OR (OLD.status='leased' AND NEW.status IN ('running','queued','retry_scheduled','cancel_requested','cancelled','dead_letter')) OR (OLD.status='running' AND NEW.status IN ('running','queued','succeeded','failed','retry_scheduled','cancel_requested','cancelled','dead_letter')) OR (OLD.status='retry_scheduled' AND NEW.status IN ('leased','cancelled','dead_letter')) OR (OLD.status='cancel_requested' AND NEW.status='cancelled') OR (OLD.status='failed' AND NEW.status IN ('queued','archived')) OR (OLD.status IN ('succeeded','cancelled','dead_letter') AND NEW.status='archived')) THEN RAISE EXCEPTION 'illegal background job status transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_background_attempt_update() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('succeeded','failed','cancelled','released','lease_expired','rejected_stale') THEN RAISE EXCEPTION 'finished job attempt is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','started_at','heartbeat_at','ended_at','error_kind','error_code','error_summary','retryable']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','started_at','heartbeat_at','ended_at','error_kind','error_code','error_summary','retryable']::text[]) THEN RAISE EXCEPTION 'job attempt lease identity is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='leased' AND NEW.status IN ('running','cancelled','released','lease_expired')) OR (OLD.status='running' AND NEW.status IN ('running','succeeded','failed','cancelled','released','lease_expired','rejected_stale'))) THEN RAISE EXCEPTION 'illegal job attempt transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.archive_terminal_background_jobs() RETURNS integer LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE affected integer; policy record;
BEGIN
  SELECT fields.* INTO STRICT policy FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
 CROSS JOIN LATERAL jsonb_to_record(v.values) fields(singleton boolean,terminal_retention_days integer,dead_letter_retention_days integer,archive_batch_limit integer)
 WHERE t.type_key='background_job_archive_policy' AND fields.singleton;
 IF policy.terminal_retention_days NOT BETWEEN 7 AND 3650 OR policy.dead_letter_retention_days NOT BETWEEN policy.terminal_retention_days AND 3650 OR policy.archive_batch_limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid background archive policy' USING ERRCODE='23514'; END IF;
  WITH candidates AS (
    SELECT id FROM background_jobs WHERE ((status IN ('succeeded','failed','cancelled') AND completed_at<now()-make_interval(days=>policy.terminal_retention_days)) OR (status='dead_letter' AND completed_at<now()-make_interval(days=>policy.dead_letter_retention_days)))
    ORDER BY completed_at,id FOR UPDATE SKIP LOCKED LIMIT policy.archive_batch_limit
  ) UPDATE background_jobs job SET status='archived',revision=revision+1,updated_at=now(),archived_at=now() FROM candidates WHERE job.id=candidates.id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_background_job_reference() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE expected_handler record; event_row record; resolved_book uuid; resolved_space uuid;
BEGIN
  SELECT * INTO expected_handler FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(handler_key text,job_kind text,topic text,event_version integer,specialized_request_kind text,default_max_attempts integer,default_lease_ms integer,backoff_base_ms integer,backoff_cap_ms integer,status text,created_at timestamptz) WHERE record_type.type_key='background_job_handler') background_job_handlers WHERE handler_key=NEW.handler_key AND job_kind=NEW.job_kind AND specialized_request_kind=NEW.specialized_request_kind AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'job handler or specialized request kind is not registered' USING ERRCODE='23514'; END IF;
  SELECT * INTO event_row FROM outbox_events WHERE id=NEW.outbox_event_id;
  IF NOT FOUND OR event_row.topic IS DISTINCT FROM expected_handler.topic OR event_row.event_version IS DISTINCT FROM expected_handler.event_version OR event_row.space_id IS DISTINCT FROM NEW.space_id OR event_row.book_id IS DISTINCT FROM NEW.book_id OR event_row.ordering_key IS DISTINCT FROM NEW.ordering_key OR event_row.aggregate_sequence IS DISTINCT FROM NEW.aggregate_sequence OR event_row.payload->>'specializedRequestKind' IS DISTINCT FROM NEW.specialized_request_kind OR event_row.payload->>'specializedRequestId' IS DISTINCT FROM NEW.specialized_request_id::text THEN RAISE EXCEPTION 'job and outbox event identity mismatch' USING ERRCODE='23514'; END IF;
  CASE NEW.specialized_request_kind
    WHEN 'dependency_recompute_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,target_resource_id uuid,invalidation_event_id uuid,required_upstream_versions jsonb,priority integer,status text,reason text,strategy_key text,task_contract_version_id uuid,idempotency_key text,created_at timestamptz,started_at timestamptz,completed_at timestamptz) WHERE record_type.type_key='dependency_recompute_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'asset_derivation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,source_asset_version_id uuid,output_asset_id uuid,derivative_kind text,recipe_key text,recipe_version text,tool_key text,tool_version text,parameters jsonb,parameters_hash text,expected_source_checksum text,expected_output_asset_revision integer,expected_output_current_version_id uuid,status text,revision integer,idempotency_key text,created_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='asset_derivation') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'graph_projection_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,generation_id uuid,request_kind text,dependency_resource_id uuid,source_kind text,source_id uuid,source_version_id uuid,source_revision bigint,source_hash char(64),reason text,status text,attempt_count integer,idempotency_key text,last_error_code text,last_error_detail text,retryable boolean,created_at timestamptz,started_at timestamptz,completed_at timestamptz) WHERE record_type.type_key='graph_projection_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_chunking_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,source_snapshot_id uuid,profile_version_id uuid,expected_source_hash text,status text,attempt_count integer,idempotency_key text,last_error text,created_at timestamptz,started_at timestamptz,completed_at timestamptz,knowledge_index_key uuid,knowledge_index_hash text,knowledge_index_plan jsonb) WHERE record_type.type_key='chunking_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,chunk_id uuid,profile_version_id uuid,expected_source_hash text,expected_chunk_hash text,status text,attempt_count integer,idempotency_key text,next_retry_at timestamptz,last_error_code text,last_error_detail text,retryable boolean,created_at timestamptz,updated_at timestamptz,embedding_freeze jsonb,embedding_execution_key uuid,embedding_lease_expires_at timestamptz,embedding_model_state text) WHERE record_type.type_key='embedding_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_index_generation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM new_design.embedding_generations request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'ai_task' THEN SELECT request.book_id,request.space_id INTO resolved_book,resolved_space FROM ai_tasks request WHERE request.id=NEW.specialized_request_id;
    WHEN 'backup_request' THEN SELECT operation.book_id,operation.space_id INTO resolved_book,resolved_space FROM transfer_operations operation WHERE operation.id=NEW.specialized_request_id;
    WHEN 'publication_export_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,manifest_id uuid,book_id uuid,job_id uuid,requested_by text,idempotency_key text,created_at timestamptz) WHERE record_type.type_key='publication_export_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
  END CASE;
  IF resolved_space IS NULL OR resolved_book IS DISTINCT FROM NEW.book_id OR resolved_space IS DISTINCT FROM NEW.space_id THEN RAISE EXCEPTION 'job specialized request does not resolve in the same scope' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.record_dependency_invalidation(
 event_uuid uuid,event_book_id uuid,old_resource uuid,new_resource uuid,event_reason text,event_source text,
 event_state text,event_trigger_id uuid,event_idempotency_key text,preview_id uuid DEFAULT NULL,change_set_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE event_space uuid; prior jsonb; impact record; impact_id uuid; state_value jsonb; request_uuid uuid; upstream jsonb; impact_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('dependency-invalidation:'||event_book_id::text,0));
 SELECT v.values INTO prior FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
 WHERE t.type_key='dependency_invalidation_event' AND v.values->>'book_id'=event_book_id::text AND v.values->>'idempotency_key'=event_idempotency_key;
 IF prior IS NOT NULL THEN
  IF prior->>'old_resource_id' IS DISTINCT FROM old_resource::text OR prior->>'new_resource_id' IS DISTINCT FROM new_resource::text
   OR prior->>'reason' IS DISTINCT FROM event_reason OR prior->>'trigger_source' IS DISTINCT FROM event_source OR prior->>'requested_state' IS DISTINCT FROM event_state
   OR prior->>'trigger_id' IS DISTINCT FROM event_trigger_id::text OR prior->>'change_preview_id' IS DISTINCT FROM preview_id::text
   OR prior->>'book_change_set_id' IS DISTINCT FROM change_set_id::text THEN RAISE EXCEPTION 'invalidation idempotency conflict' USING ERRCODE='23514'; END IF;
  RETURN (prior->>'id')::uuid;
 END IF;
 SELECT space_id INTO event_space FROM books WHERE id=event_book_id;
 IF event_space IS NULL OR event_state NOT IN ('stale','invalid','needs_review') THEN RAISE EXCEPTION 'invalid invalidation scope or state' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM dependency_resources WHERE id=old_resource AND (book_id IS NULL OR book_id=event_book_id))
 OR (new_resource IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dependency_resources WHERE id=new_resource AND (book_id IS NULL OR book_id=event_book_id))) THEN
  RAISE EXCEPTION 'invalidation resource scope mismatch' USING ERRCODE='23514'; END IF;
 PERFORM kernel_store_record('dependency_invalidation_event',event_space,event_uuid,jsonb_build_object(
  'id',event_uuid,'space_id',event_space,'book_id',event_book_id,'old_resource_id',old_resource,'new_resource_id',new_resource,
  'change_preview_id',preview_id,'book_change_set_id',change_set_id,'reason',event_reason,'trigger_source',event_source,
  'requested_state',event_state,'trigger_id',event_trigger_id,'idempotency_key',event_idempotency_key,'created_at',now()));
 FOR impact IN
  WITH RECURSIVE walk(resource_id,depth,path,strength) AS (
   SELECT e.derived_resource_id,1,ARRAY[e.source_resource_id,e.derived_resource_id],e.dependency_strength
   FROM dependency_edges e WHERE e.book_id=event_book_id AND e.source_resource_id=old_resource AND e.status='active'
   UNION ALL SELECT e.derived_resource_id,w.depth+1,w.path||e.derived_resource_id,
    CASE WHEN w.strength='hard' OR e.dependency_strength='hard' THEN 'hard' ELSE 'soft' END
   FROM walk w JOIN dependency_edges e ON e.source_resource_id=w.resource_id AND e.book_id=event_book_id AND e.status='active'
   WHERE NOT e.derived_resource_id=ANY(w.path) AND w.depth<99)
  SELECT DISTINCT ON(resource_id) * FROM walk ORDER BY resource_id,depth,CASE strength WHEN 'hard' THEN 0 ELSE 1 END,path
 LOOP
  impact_id:=gen_random_uuid(); impact_state:=CASE WHEN event_state='invalid' AND impact.strength='soft' THEN 'needs_review' ELSE event_state END;
  PERFORM kernel_store_record('dependency_invalidation_impact',event_space,impact_id,jsonb_build_object(
   'id',impact_id,'event_id',event_uuid,'resource_id',impact.resource_id,'depth',impact.depth,'propagation_path',impact.path,
   'dependency_strength',impact.strength,'impact_state',impact_state,'created_at',now()));
  PERFORM kernel_store_record('dependency_stale_reason',event_space,gen_random_uuid(),jsonb_build_object(
   'book_id',event_book_id,'resource_id',impact.resource_id,'event_id',event_uuid,'impact_id',impact_id,'state',impact_state,'reason',event_reason,'created_at',now()));
  SELECT v.values INTO state_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE t.type_key='dependency_resource_state' AND v.values->>'resource_id'=impact.resource_id::text;
  INSERT INTO dependency_events(id,book_id,resource_id,invalidation_event_id,from_state,to_state,event_kind,detail)
   VALUES(gen_random_uuid(),event_book_id,impact.resource_id,event_uuid,state_value->>'state',impact_state,'invalidated',event_reason);
  PERFORM kernel_store_record('dependency_resource_state',event_space,COALESCE((state_value->>'id')::uuid,impact.resource_id),
   COALESCE(state_value,'{}'::jsonb)||jsonb_build_object('resource_id',impact.resource_id,'book_id',event_book_id,'state',impact_state,
    'revision',COALESCE((state_value->>'revision')::integer,0)+1,'last_event_id',event_uuid,'updated_at',now()));
  SELECT COALESCE(jsonb_agg(jsonb_build_object('resourceId',s.id,'kind',s.resource_kind,'stableObjectId',s.stable_object_id,'exactVersionId',s.exact_version_id,'contentHash',s.content_hash) ORDER BY s.id),'[]'::jsonb)
   INTO upstream FROM dependency_edges e JOIN dependency_resources s ON s.id=e.source_resource_id WHERE e.derived_resource_id=impact.resource_id AND e.book_id=event_book_id AND e.status='active';
  request_uuid:=gen_random_uuid();
  PERFORM kernel_store_record('dependency_recompute_request',event_space,request_uuid,jsonb_build_object(
   'id',request_uuid,'book_id',event_book_id,'target_resource_id',impact.resource_id,'invalidation_event_id',event_uuid,
   'required_upstream_versions',upstream,'priority',(CASE WHEN impact.strength='hard' THEN 50 ELSE 0 END)-impact.depth,
   'reason',event_reason,'strategy_key','manual_review','idempotency_key',event_uuid::text||':'||impact.resource_id::text,
   'status','pending','attempt_count',0,'revision',1,'last_error','','created_at',now(),'updated_at',now()));
  PERFORM enqueue_registered_background_job('dependency_recompute_request',request_uuid,event_space,event_book_id,event_uuid,impact.resource_id);
  INSERT INTO dependency_events(id,book_id,resource_id,invalidation_event_id,from_state,to_state,event_kind,detail)
   VALUES(gen_random_uuid(),event_book_id,impact.resource_id,event_uuid,impact_state,'recompute_pending','recompute_requested',event_reason);
  PERFORM kernel_store_record('dependency_resource_state',event_space,COALESCE((state_value->>'id')::uuid,impact.resource_id),
   COALESCE(state_value,'{}'::jsonb)||jsonb_build_object('resource_id',impact.resource_id,'book_id',event_book_id,'state','recompute_pending',
    'revision',COALESCE((state_value->>'revision')::integer,0)+2,'last_event_id',event_uuid,'updated_at',now()));
 END LOOP;
 RETURN event_uuid;
END $$;
CREATE OR REPLACE FUNCTION new_design.invalidate_registered_resource(old_resource uuid,new_resource uuid,event_reason text,event_source text,event_trigger uuid,event_key text,event_state text DEFAULT 'stale') RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE target_book uuid;
BEGIN
  FOR target_book IN SELECT DISTINCT book_id FROM dependency_edges WHERE source_resource_id=old_resource AND status='active' LOOP
    PERFORM record_dependency_invalidation(gen_random_uuid(),target_book,old_resource,new_resource,event_reason,event_source,event_state,event_trigger,event_key || ':' || target_book::text);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_asset_content_object() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF (to_jsonb(NEW)-ARRAY['integrity_state','last_verified_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['integrity_state','last_verified_at']::text[]) THEN
    RAISE EXCEPTION 'asset content identity and locator are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_asset_mount_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'asset mounts are append-only' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'active' OR NEW.status<>'ended' OR NEW.ended_at IS NULL OR
     (to_jsonb(NEW)-ARRAY['status','ended_at','end_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','ended_at','end_reason']::text[]) THEN
    RAISE EXCEPTION 'asset mount may only transition from active to ended' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.bridge_asset_version_dependency() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE source_asset_id uuid;
BEGIN
  PERFORM register_dependency_resource('asset_version',NEW.asset_id,NEW.id);
  IF NEW.derived_from_version_id IS NOT NULL THEN
    SELECT asset_id INTO source_asset_id FROM asset_versions WHERE id=NEW.derived_from_version_id;
    PERFORM add_registered_dependency('asset_version',source_asset_id,NEW.derived_from_version_id,'asset_version',NEW.asset_id,NEW.id,'derived_from','hard','system',NEW.id);
  END IF;
  IF NEW.source_resource_id IS NOT NULL THEN
    INSERT INTO dependency_edges(id,space_id,book_id,source_resource_id,derived_resource_id,dependency_kind,dependency_strength,origin_kind,origin_id)
    SELECT gen_random_uuid(),asset.space_id,NEW.book_id,NEW.source_resource_id,derived.id,'generated_from','hard',CASE WHEN NEW.source_kind='ai_generated' THEN 'ai_result' ELSE 'system' END,NEW.id
    FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,asset_key text,asset_kind text,title text,status text,current_version_id uuid,revision integer,created_by text,created_at timestamptz,updated_at timestamptz,archived_at timestamptz) WHERE record_type.type_key='asset') asset JOIN dependency_resources derived ON derived.resource_kind='asset_version' AND derived.stable_object_id=NEW.asset_id AND derived.exact_version_id=NEW.id
    WHERE asset.id=NEW.asset_id
    ON CONFLICT(source_resource_id,derived_resource_id,dependency_kind) WHERE status='active' DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_embedding_chunk() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','stale_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stale_at']::text[]) THEN RAISE EXCEPTION 'embedding chunk content and anchor are immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'current' OR NEW.status NOT IN ('stale','archived') OR NEW.stale_at IS NULL THEN RAISE EXCEPTION 'invalid embedding chunk lifecycle transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_embedding_generation() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,profile_id uuid,version integer,provider_key text,model_key text,dimensions integer,distance_metric text,normalize boolean,chunker_key text,chunker_version text,max_chunk_chars integer,overlap_chars integer,allowed_source_kinds text[],content_hash text,created_by text,created_at timestamptz,connection_version_id uuid,knowledge_profile_key uuid,knowledge_profile_hash text,knowledge_profile_book_id uuid) WHERE record_type.type_key='embedding_profile_version') version JOIN embedding_profiles profile ON profile.id=version.profile_id WHERE version.id=NEW.profile_version_id AND profile.status='active') THEN RAISE EXCEPTION 'embedding generation requires an active profile' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_transfer_operation_update() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'transfer operation history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','current_step_key','progress_completed','progress_total','ready_manifest_id','revision','last_error_code','last_error_summary','started_at','completed_at','archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_step_key','progress_completed','progress_total','ready_manifest_id','revision','last_error_code','last_error_summary','started_at','completed_at','archived_at']::text[]) THEN RAISE EXCEPTION 'transfer operation frozen input is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'transfer operation revision must advance by one' USING ERRCODE='23514'; END IF;
  IF OLD.ready_manifest_id IS NOT NULL AND NEW.ready_manifest_id IS DISTINCT FROM OLD.ready_manifest_id THEN RAISE EXCEPTION 'ready transfer manifest cannot be replaced' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','failed','cancelled')) OR (OLD.status='running' AND NEW.status IN ('running','verifying','failed','cancelled')) OR (OLD.status='verifying' AND NEW.status IN ('verifying','ready','failed','cancelled','imported','restored')) OR (OLD.status IN ('ready','failed','cancelled','imported','restored') AND NEW.status='archived')) THEN RAISE EXCEPTION 'illegal transfer operation transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NOT ((NEW.execution_mode='execute' AND NEW.operation_kind IN ('full_backup','book_export','template_export','resource_export')) OR NEW.execution_mode='dry_run') THEN RAISE EXCEPTION 'only export, backup, or dry-run operations can become ready' USING ERRCODE='23514'; END IF;
  IF NEW.status='imported' AND NOT (NEW.execution_mode='apply' AND NEW.operation_kind IN ('book_import','template_import','resource_import')) THEN RAISE EXCEPTION 'only apply import can become imported' USING ERRCODE='23514'; END IF;
  IF NEW.status='restored' AND NOT (NEW.operation_kind='full_restore' AND NEW.execution_mode='apply') THEN RAISE EXCEPTION 'only apply full restore can become restored' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('ready','imported','restored') AND (NEW.ready_manifest_id IS NULL OR EXISTS(SELECT 1 FROM new_design.transfer_validations WHERE operation_id=NEW.id AND outcome IN ('failed','unavailable'))) THEN RAISE EXCEPTION 'transfer operation cannot pass a failed validation gate' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('ready','imported','restored') AND NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,operation_id uuid,source_format_version integer,source_application_version text,current_application_version text,source_schema_version text,current_schema_version text,source_migration_hash char(64),current_migration_hash char(64),extension_versions jsonb,required_capabilities jsonb,missing_capabilities jsonb,unknown_required_capabilities jsonb,outcome text,detail text,checked_at timestamptz) WHERE record_type.type_key='transfer_compatibility_snapshot') transfer_compatibility_snapshots WHERE operation_id=NEW.id AND outcome IN ('compatible','upgrade_required') AND jsonb_array_length(unknown_required_capabilities)=0) THEN RAISE EXCEPTION 'transfer operation requires a fail-closed compatibility snapshot' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NEW.execution_mode='execute' AND NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,operation_id uuid,manifest_id uuid,artifact_kind text,media_type text,storage_locator text,normalized_case_locator text,display_filename text,checksum_algorithm text,checksum char(64),byte_size bigint,entry_count integer,compressed_bytes bigint,uncompressed_bytes bigint,status text,error_code text,created_at timestamptz,ready_at timestamptz) WHERE record_type.type_key='transfer_artifact') transfer_artifacts WHERE operation_id=NEW.id AND manifest_id=NEW.ready_manifest_id AND artifact_kind='package' AND status='ready') THEN RAISE EXCEPTION 'export or backup requires a verified package artifact' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('imported','restored') AND NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,operation_id uuid,source_artifact_id uuid,source_manifest_id uuid,source_installation_hash char(64),source_operation_key text,imported_by text,created_at timestamptz) WHERE record_type.type_key='transfer_import_source') transfer_import_sources WHERE operation_id=NEW.id) THEN RAISE EXCEPTION 'import or restore requires frozen source evidence' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('failed','cancelled') AND (NEW.last_error_code='' OR NEW.last_error_summary='') THEN RAISE EXCEPTION 'failed or cancelled transfer requires sanitized error detail' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_transfer_conflict_update() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status='resolved' THEN RAISE EXCEPTION 'resolved transfer conflict is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','resolution','resolution_note','revision','resolved_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resolution','resolution_note','revision','resolved_at']::text[]) THEN RAISE EXCEPTION 'transfer conflict evidence is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 OR NEW.status<>'resolved' OR NEW.resolution IS NULL OR NEW.resolved_at IS NULL THEN RAISE EXCEPTION 'invalid transfer conflict resolution' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_transfer_operation_scope() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF NEW.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND space_id=NEW.space_id) THEN RAISE EXCEPTION 'transfer operation book and space mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.operation_kind='book_export' AND NEW.book_id IS NULL THEN RAISE EXCEPTION 'book export requires a book' USING ERRCODE='23514'; END IF;
  IF NEW.execution_mode='apply' AND NOT EXISTS(SELECT 1 FROM transfer_operations source WHERE source.id=NEW.source_operation_id AND source.status='ready' AND source.execution_mode='dry_run' AND source.operation_kind=NEW.operation_kind AND source.profile_key=NEW.profile_key AND source.source_artifact_id=NEW.source_artifact_id) THEN RAISE EXCEPTION 'apply operation requires a compatible ready dry-run source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_transfer_active_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE owning_operation uuid;
BEGIN
  IF TG_TABLE_NAME='transfer_entries' THEN SELECT operation_id INTO owning_operation FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,operation_id uuid,manifest_id uuid,artifact_kind text,media_type text,storage_locator text,normalized_case_locator text,display_filename text,checksum_algorithm text,checksum char(64),byte_size bigint,entry_count integer,compressed_bytes bigint,uncompressed_bytes bigint,status text,error_code text,created_at timestamptz,ready_at timestamptz) WHERE record_type.type_key='transfer_artifact') transfer_artifacts WHERE id=NEW.artifact_id;
  ELSE owning_operation:=NEW.operation_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM transfer_operations WHERE id=owning_operation AND status IN ('running','verifying')) THEN RAISE EXCEPTION 'transfer evidence can only be appended while the operation is active' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.bridge_transfer_operation_to_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  PERFORM enqueue_registered_background_job('backup_request',NEW.id,NEW.space_id,NEW.book_id,NULL,NULL);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_publication_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
  IF NEW.completion_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,rule_set_key text,rule_set_version integer,source_hash char(64),blocker_count integer,warning_count integer,info_count integer,stable_through_order integer,chapter_count integer,created_by text,created_at timestamptz) WHERE record_type.type_key='book_completion_snapshot') snapshot WHERE snapshot.id=NEW.completion_snapshot_id AND snapshot.book_id=NEW.book_id) THEN RAISE EXCEPTION 'completion snapshot and export manifest book mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.export_mode='formal' AND NEW.completion_snapshot_id IS NULL THEN RAISE EXCEPTION 'formal export requires a completion snapshot' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION new_design.build_embedding_generation_index(requested_generation_id uuid) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE generation_row record; profile jsonb; dims integer; operator_name text;
BEGIN
 SELECT * INTO generation_row FROM embedding_generations WHERE id=requested_generation_id FOR UPDATE;
 IF NOT FOUND OR generation_row.status NOT IN ('building','verifying') OR generation_row.index_name<>'nd_hnsw_'||replace(requested_generation_id::text,'-','') THEN RAISE EXCEPTION 'generation is not buildable' USING ERRCODE='23514'; END IF;
 SELECT v.values INTO profile FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'id'=generation_row.profile_version_id::text;
 dims:=(profile->>'dimensions')::integer;
 operator_name:=CASE profile->>'distance_metric' WHEN 'cosine' THEN 'vector_cosine_ops' WHEN 'l2' THEN 'vector_l2_ops' WHEN 'inner_product' THEN 'vector_ip_ops' END;
 IF dims IS NULL OR dims<1 OR dims>2000 OR operator_name IS NULL THEN RAISE EXCEPTION 'unsupported HNSW profile' USING ERRCODE='23514'; END IF;
 IF to_regclass('new_design.'||generation_row.index_name) IS NOT NULL THEN
  IF generation_row.status='verifying' AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relname=generation_row.index_name AND i.indrelid='new_design.embedding_vectors'::regclass AND i.indisvalid) THEN RETURN; END IF;
  RAISE EXCEPTION 'index identity already occupied' USING ERRCODE='23514';
 END IF;
 -- Dynamic DDL is limited to a validated UUID-derived index name, numeric dimensions and a fixed opclass.
 EXECUTE format('CREATE INDEX %I ON new_design.embedding_vectors USING hnsw ((embedding::public.vector(%s)) public.%I) WHERE record_kind=''index'' AND generation_id=%L::uuid AND status=''eligible''',generation_row.index_name,dims,operator_name,requested_generation_id::text);
 UPDATE embedding_generations SET status='verifying' WHERE id=requested_generation_id;
END $$;

CREATE OR REPLACE FUNCTION new_design.activate_embedding_generation(requested_generation_id uuid) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE generation_row record; profile_uuid uuid; state_value jsonb; book_space uuid; actual_count integer;
BEGIN
 SELECT * INTO generation_row FROM embedding_generations WHERE id=requested_generation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'generation missing' USING ERRCODE='23503'; END IF;
 SELECT (v.values->>'profile_id')::uuid INTO profile_uuid FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'id'=generation_row.profile_version_id::text;
 SELECT space_id INTO book_space FROM books WHERE id=generation_row.book_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('embedding-index:'||generation_row.book_id::text||':'||profile_uuid::text,0));
 SELECT v.values INTO state_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_index_state' AND v.values->>'book_id'=generation_row.book_id::text AND v.values->>'profile_id'=profile_uuid::text;
 IF generation_row.status='active' AND state_value->>'active_generation_id'=requested_generation_id::text THEN RETURN; END IF;
 SELECT count(*) INTO actual_count FROM embedding_vectors WHERE record_kind='index' AND generation_id=requested_generation_id AND status='eligible';
 IF profile_uuid IS NULL OR book_space IS NULL OR generation_row.status<>'ready' OR generation_row.coverage<1 OR generation_row.expected_vector_count<>generation_row.indexed_vector_count OR actual_count<>generation_row.indexed_vector_count OR generation_row.checksum IS NULL OR to_regclass('new_design.'||generation_row.index_name) IS NULL THEN RAISE EXCEPTION 'only fully verified generations may activate' USING ERRCODE='23514'; END IF;
 UPDATE embedding_generations SET status='retired',retired_at=now() WHERE id=(state_value->>'active_generation_id')::uuid AND id<>requested_generation_id AND status='active';
 UPDATE embedding_generations SET status='active',activated_at=now() WHERE id=requested_generation_id;
 PERFORM kernel_store_record('embedding_index_state',book_space,COALESCE((state_value->>'id')::uuid,gen_random_uuid()),
  COALESCE(state_value,'{}'::jsonb)||jsonb_build_object('book_id',generation_row.book_id,'profile_id',profile_uuid,
  'active_generation_id',requested_generation_id,'status','ready','revision',COALESCE((state_value->>'revision')::integer,0)+1,
  'last_success_at',now(),'last_error_code','','last_error_detail','','updated_at',now()));
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_native_embedding_chunk() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE source_value jsonb;
BEGIN
 SELECT v.values INTO source_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_source_snapshot' AND v.values->>'id'=NEW.source_snapshot_id::text;
 IF source_value IS NULL OR source_value->>'book_id' IS DISTINCT FROM NEW.book_id::text OR source_value->>'profile_version_id' IS DISTINCT FROM NEW.profile_version_id::text THEN RAISE EXCEPTION 'chunk source scope mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.record_kind='source' THEN
  IF NEW.id<>NEW.source_snapshot_id OR NEW.ordinal<>0 OR NEW.anchor_kind<>'whole' OR NEW.content_hash IS DISTINCT FROM (source_value->>'source_hash')::char(64) OR NEW.chunker_version IS DISTINCT FROM source_value->>'chunk_recipe_hash' THEN RAISE EXCEPTION 'source text identity mismatch' USING ERRCODE='23514'; END IF;
 ELSIF source_value->>'status'<>'current' OR NOT EXISTS(SELECT 1 FROM embedding_chunks WHERE id=NEW.source_snapshot_id AND record_kind='source' AND status='current') THEN RAISE EXCEPTION 'chunk requires exact current source text' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_native_embedding_vector() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE chunk_row record; source_value jsonb; profile jsonb; request_value jsonb; result_value jsonb; generation_row record;
BEGIN
 SELECT * INTO chunk_row FROM embedding_chunks WHERE id=NEW.chunk_id AND record_kind='chunk';
 IF NOT FOUND THEN RAISE EXCEPTION 'vector chunk missing' USING ERRCODE='23503'; END IF;
 SELECT v.values INTO source_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_source_snapshot' AND v.values->>'id'=chunk_row.source_snapshot_id::text;
 SELECT v.values INTO profile FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'id'=NEW.profile_version_id::text;
 IF profile IS NULL OR source_value IS NULL OR NEW.book_id<>chunk_row.book_id OR NEW.profile_version_id<>chunk_row.profile_version_id
 OR public.vector_dims(NEW.embedding) IS DISTINCT FROM (profile->>'dimensions')::integer
 OR NEW.content_text IS DISTINCT FROM chunk_row.chunk_text OR NEW.chunk_hash IS DISTINCT FROM chunk_row.content_hash
 OR NEW.source_kind IS DISTINCT FROM source_value->>'source_kind' OR NEW.source_stable_id::text IS DISTINCT FROM source_value->>'source_stable_id'
 OR NEW.source_version_id::text IS DISTINCT FROM source_value->>'source_version_id' OR NEW.source_revision IS DISTINCT FROM (source_value->>'source_revision')::integer
 OR NEW.source_hash IS DISTINCT FROM (source_value->>'source_hash')::char(64) THEN RAISE EXCEPTION 'vector frozen source or dimensions mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.record_kind IN ('attempt','result') THEN
  IF cardinality(NEW.response_vector) IS DISTINCT FROM (profile->>'dimensions')::integer OR array_ndims(NEW.response_vector)<>1
   OR EXISTS(SELECT 1 FROM unnest(NEW.response_vector) x WHERE x IS NULL OR x::text IN ('NaN','Infinity','-Infinity'))
   OR NEW.embedding IS DISTINCT FROM NEW.response_vector::public.vector THEN RAISE EXCEPTION 'invalid exact response vector' USING ERRCODE='22000'; END IF;
  SELECT v.values INTO request_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_request' AND v.values->>'id'=NEW.request_id::text;
  IF request_value IS NULL OR request_value->>'chunk_id'<>NEW.chunk_id::text OR request_value->>'profile_version_id'<>NEW.profile_version_id::text
   OR NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_attempt' AND v.values->>'id'=NEW.attempt_id::text AND v.values->>'request_id'=NEW.request_id::text)
   OR (NEW.record_kind='attempt' AND NEW.id<>NEW.attempt_id) OR (NEW.record_kind='result' AND NEW.id<>NEW.result_id) THEN RAISE EXCEPTION 'vector response identity mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.record_kind IN ('result','index') THEN
  SELECT v.values INTO result_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_result' AND v.values->>'id'=NEW.result_id::text;
  IF result_value IS NULL OR result_value->>'outcome'<>'applied' OR result_value->>'chunk_id'<>NEW.chunk_id::text
   OR result_value->>'profile_version_id'<>NEW.profile_version_id::text OR result_value->>'observed_source_hash' IS DISTINCT FROM NEW.source_hash::text
   OR result_value->>'observed_chunk_hash' IS DISTINCT FROM NEW.chunk_hash::text OR result_value->>'vector_hash' !~ '^[a-f0-9]{64}$'
   OR source_value->>'status'<>'current' OR chunk_row.status<>'current' THEN RAISE EXCEPTION 'vector result is not eligible' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.record_kind='index' THEN
  SELECT * INTO generation_row FROM embedding_generations WHERE id=NEW.generation_id;
  IF NOT FOUND OR generation_row.book_id<>NEW.book_id OR generation_row.profile_version_id<>NEW.profile_version_id OR generation_row.status NOT IN ('building','verifying')
   OR NOT EXISTS(SELECT 1 FROM embedding_vectors v WHERE v.id=NEW.result_id AND v.record_kind='result' AND v.embedding=NEW.embedding AND v.chunk_id=NEW.chunk_id AND v.profile_version_id=NEW.profile_version_id) THEN RAISE EXCEPTION 'index vector generation/result mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_native_embedding_vector() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR OLD.status<>'eligible' OR NEW.status NOT IN ('stale','archived') THEN RAISE EXCEPTION 'stored vector identity and response are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.bridge_native_request_card() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE kind text; payload jsonb; request_kind text; request_book uuid; request_space uuid; correlation uuid; causation uuid;
BEGIN
 IF OLD.current_version_id IS NOT NULL OR NEW.current_version_id IS NULL THEN RETURN NEW; END IF;
 SELECT type_key INTO kind FROM card_types WHERE id=NEW.card_type_id;
 request_kind:=CASE kind WHEN 'chunking_request' THEN 'embedding_chunking_request'
  WHEN 'dependency_recompute_request' THEN kind WHEN 'asset_derivation' THEN kind WHEN 'graph_projection_request' THEN kind
  WHEN 'embedding_request' THEN kind WHEN 'publication_export_request' THEN kind END;
 IF request_kind IS NULL THEN RETURN NEW; END IF;
 SELECT values INTO payload FROM card_versions WHERE id=NEW.current_version_id AND card_id=NEW.id;
 request_book:=(payload->>'book_id')::uuid; SELECT space_id INTO request_space FROM books WHERE id=request_book;
 correlation:=CASE kind WHEN 'dependency_recompute_request' THEN (payload->>'invalidation_event_id')::uuid WHEN 'graph_projection_request' THEN (payload->>'generation_id')::uuid END;
 causation:=CASE kind WHEN 'dependency_recompute_request' THEN (payload->>'target_resource_id')::uuid WHEN 'asset_derivation' THEN (payload->>'source_asset_version_id')::uuid
  WHEN 'graph_projection_request' THEN (payload->>'dependency_resource_id')::uuid WHEN 'chunking_request' THEN (payload->>'source_snapshot_id')::uuid
  WHEN 'embedding_request' THEN (payload->>'chunk_id')::uuid WHEN 'publication_export_request' THEN NULL::uuid END;
 PERFORM enqueue_registered_background_job(request_kind,(payload->>'id')::uuid,request_space,request_book,correlation,causation);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.bridge_native_physical_request() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE request_space uuid;
BEGIN
 IF TG_TABLE_NAME='ai_tasks' THEN
  IF NEW.book_id IS NOT NULL THEN PERFORM enqueue_registered_background_job('ai_task',NEW.id,NEW.space_id,NEW.book_id,NULL,NEW.source_id); END IF;
 ELSIF TG_TABLE_NAME='embedding_generations' THEN
  SELECT space_id INTO request_space FROM books WHERE id=NEW.book_id;
  PERFORM enqueue_registered_background_job('embedding_index_generation',NEW.id,request_space,NEW.book_id,NULL,NEW.profile_version_id);
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_native_job_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE job_row record; attempt_row record;
BEGIN
 SELECT * INTO job_row FROM background_jobs WHERE id=NEW.job_id FOR UPDATE;
 SELECT * INTO attempt_row FROM background_job_attempts WHERE id=NEW.attempt_id AND job_id=NEW.job_id;
 IF job_row.id IS NULL OR attempt_row.id IS NULL OR job_row.current_attempt_id IS DISTINCT FROM NEW.attempt_id
  OR job_row.fencing_token IS DISTINCT FROM NEW.fencing_token OR attempt_row.fencing_token IS DISTINCT FROM NEW.fencing_token
  OR attempt_row.lease_token_digest IS DISTINCT FROM job_row.lease_token_digest
  OR job_row.status NOT IN ('running','cancel_requested') OR job_row.lease_until<=clock_timestamp()
  OR attempt_row.status NOT IN ('running','leased') THEN RAISE EXCEPTION 'stale or expired background evidence lease' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_native_record_history() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE kind text; payload jsonb; old_payload jsonb; key_fields text[]; identity jsonb; other_card uuid; field_name text; part jsonb;
BEGIN
 SELECT type_key INTO kind FROM card_types WHERE id=NEW.card_type_id;
 IF NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 SELECT values INTO payload FROM card_versions WHERE id=NEW.current_version_id AND card_id=NEW.id;
 IF payload IS NULL THEN RAISE EXCEPTION 'domain record head missing' USING ERRCODE='23514'; END IF;
 IF OLD.current_version_id IS NOT NULL THEN
  SELECT values INTO old_payload FROM card_versions WHERE id=OLD.current_version_id;
  IF kind IN ('asset_adoption','asset_derivation_result','asset_derivation_event','asset_content_integrity_check',
   'dependency_invalidation_event','dependency_invalidation_impact','dependency_recompute_receipt','dependency_stale_acceptance',
   'embedding_profile_version','embedding_result','chunking_result','background_job_replay',
   'transfer_export_profile','transfer_compatibility_snapshot','transfer_checkpoint','transfer_import_source','transfer_restore_drill',
   'book_completion_snapshot','book_completion_check_result','book_completion_snapshot_chapter','book_lifecycle_event',
   'publication_export_manifest_chapter','book_content_history_snapshot','book_content_history_restore') THEN
   RAISE EXCEPTION 'domain record % is append-only',kind USING ERRCODE='23514';
  END IF;
  IF kind='publication_export_request' AND (old_payload->>'job_id' IS NOT NULL OR (payload-ARRAY['job_id','revision','updated_at']) IS DISTINCT FROM (old_payload-ARRAY['job_id','revision','updated_at'])) THEN RAISE EXCEPTION 'publication request only permits initial job linkage' USING ERRCODE='23514'; END IF;
 END IF;
 key_fields:=CASE kind
  WHEN 'dependency_resource_state' THEN ARRAY['resource_id'] WHEN 'dependency_invalidation_event' THEN ARRAY['book_id','idempotency_key']
  WHEN 'dependency_recompute_request' THEN ARRAY['book_id','idempotency_key'] WHEN 'graph_projection_book_state' THEN ARRAY['book_id']
  WHEN 'graph_projection_request' THEN ARRAY['book_id','idempotency_key'] WHEN 'graph_projection_source_mapping' THEN ARRAY['generation_id','graph_element_key']
  WHEN 'embedding_index_state' THEN ARRAY['book_id','profile_id'] WHEN 'embedding_request' THEN ARRAY['book_id','idempotency_key']
  WHEN 'chunking_request' THEN ARRAY['book_id','idempotency_key'] WHEN 'embedding_attempt' THEN ARRAY['request_id','attempt_number']
  WHEN 'background_job_handler' THEN ARRAY['handler_key'] WHEN 'background_job_archive_policy' THEN ARRAY['singleton']
  WHEN 'background_job_book_pause' THEN ARRAY['book_id'] WHEN 'background_job_replay' THEN ARRAY['idempotency_key']
  WHEN 'transfer_artifact' THEN ARRAY['operation_id','normalized_case_locator'] WHEN 'transfer_step' THEN ARRAY['operation_id','step_key']
  WHEN 'transfer_staging_scope' THEN ARRAY['operation_id'] WHEN 'transfer_import_source' THEN ARRAY['operation_id']
  WHEN 'transfer_restore_drill' THEN ARRAY['drill_operation_id'] WHEN 'publication_export_request' THEN ARRAY['book_id','idempotency_key']
  WHEN 'book_content_history_snapshot' THEN ARRAY['book_id','request_key'] WHEN 'book_content_history_restore' THEN ARRAY['book_id','request_key']
  WHEN 'public_title_factory_trial' THEN ARRAY['request_key'] WHEN 'public_character_trial' THEN ARRAY['request_key']
  WHEN 'creative_extraction_preview' THEN ARRAY['book_id','request_key'] END;
 IF key_fields IS NOT NULL THEN
  identity:='{}'::jsonb;
  FOREACH field_name IN ARRAY key_fields LOOP
   IF NOT payload ? field_name OR payload->field_name='null'::jsonb THEN RAISE EXCEPTION 'domain record missing identity field %',field_name USING ERRCODE='23514'; END IF;
   identity:=identity||jsonb_build_object(field_name,payload->field_name);
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('domain-identity:'||kind||':'||identity::text,0));
  SELECT c.id INTO other_card FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE t.type_key=kind AND c.id<>NEW.id AND v.values @> identity LIMIT 1;
  IF other_card IS NOT NULL THEN RAISE EXCEPTION 'duplicate domain record identity: %',kind USING ERRCODE='23505'; END IF;
 END IF;
 IF kind='creative_extraction_preview' THEN
  FOREACH field_name IN ARRAY ARRAY['original_input','input_payload','frozen_plan','run_input','output_payload'] LOOP
   IF payload->field_name IS NOT NULL AND payload->field_name<>'null'::jsonb THEN
    IF payload->field_name->>'kind' IS DISTINCT FROM 'managed_json_v1' OR payload->field_name->>'checksum' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(payload->field_name->'parts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'creative frozen content requires managed reference' USING ERRCODE='23514'; END IF;
    FOR part IN SELECT * FROM jsonb_array_elements(payload->field_name->'parts') LOOP
     IF NOT EXISTS(SELECT 1 FROM asset_content_objects a WHERE a.id=(part->>'contentObjectId')::uuid AND a.checksum::text=part->>'checksum' AND a.byte_size=(part->>'byteSize')::bigint AND a.storage_kind='managed_file' AND a.storage_provider='local' AND a.mime_type='application/json') THEN RAISE EXCEPTION 'creative frozen content reference mismatch' USING ERRCODE='23514'; END IF;
    END LOOP;
   END IF;
  END LOOP;
  IF old_payload IS NOT NULL THEN
   IF (payload-ARRAY['status','run_key','run_hash','run_input','task_id','step_id','attempt_id','output_payload','execution','failure','revision','updated_at']) IS DISTINCT FROM (old_payload-ARRAY['status','run_key','run_hash','run_input','task_id','step_id','attempt_id','output_payload','execution','failure','revision','updated_at'])
    OR (old_payload->>'run_key' IS NOT NULL AND (payload->'run_key',payload->'run_hash',payload->'run_input',payload->'task_id',payload->'step_id',payload->'attempt_id') IS DISTINCT FROM (old_payload->'run_key',old_payload->'run_hash',old_payload->'run_input',old_payload->'task_id',old_payload->'step_id',old_payload->'attempt_id'))
    OR (old_payload->'output_payload' IS NOT NULL AND old_payload->'output_payload'<>'null'::jsonb AND (payload->'output_payload',payload->'execution') IS DISTINCT FROM (old_payload->'output_payload',old_payload->'execution'))
    OR old_payload->>'status' IN ('succeeded','failed','blocked') THEN RAISE EXCEPTION 'creative freeze, original reply or terminal state immutable' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.native_guard_public_character_trial() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE  next_trial record; prior_trial record; operation text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM card_types WHERE id=NEW.card_type_id AND type_key='public_character_trial') OR NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 operation:=CASE WHEN OLD.current_version_id IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
 SELECT fields.* INTO next_trial FROM card_versions v CROSS JOIN LATERAL jsonb_to_record(v.values) fields(id uuid,request_key uuid,request_hash char(64),resource_id uuid,resource_version_id uuid,input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,request_state text,reply jsonb,execution jsonb,output jsonb,summary text,created_at timestamptz) WHERE v.id=NEW.current_version_id;
 SELECT fields.* INTO prior_trial FROM jsonb_to_record(COALESCE((SELECT values FROM card_versions WHERE id=OLD.current_version_id),'{}'::jsonb)) fields(id uuid,request_key uuid,request_hash char(64),resource_id uuid,resource_version_id uuid,input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,request_state text,reply jsonb,execution jsonb,output jsonb,summary text,created_at timestamptz);

 IF operation='DELETE' THEN RAISE EXCEPTION 'public character original reply cannot be deleted' USING ERRCODE='23514'; END IF;
 IF operation='INSERT' AND NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_character_trial_v1' AND installed AND operational) THEN RAISE EXCEPTION 'public character workshop not enabled' USING ERRCODE='23514'; END IF;
 IF operation='UPDATE' THEN
  IF (to_jsonb(next_trial)-ARRAY['status','request_state','reply','execution','output','summary']::text[]) IS DISTINCT FROM (to_jsonb(prior_trial)-ARRAY['status','request_state','reply','execution','output','summary']::text[]) THEN RAISE EXCEPTION 'public character freeze immutable' USING ERRCODE='23514'; END IF;
  IF prior_trial.reply IS NOT NULL AND (prior_trial.reply,prior_trial.execution) IS DISTINCT FROM (next_trial.reply,next_trial.execution) THEN RAISE EXCEPTION 'public character received reply immutable' USING ERRCODE='23514'; END IF;
  IF prior_trial.status<>'running' AND next_trial IS DISTINCT FROM prior_trial THEN RAISE EXCEPTION 'public character terminal request immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN card_versions version ON version.card_id=card.id
  JOIN ai_tasks task ON task.id=next_trial.id JOIN ai_task_steps step ON step.task_id=task.id JOIN ai_task_attempts attempt ON attempt.task_id=task.id AND attempt.step_id=step.id
  JOIN card_type_versions spec ON spec.id=version.type_version_id AND spec.card_type_id=type.id
  JOIN task_contract_versions contract ON contract.id=attempt.task_contract_version_id AND contract.id=task.task_contract_version_id
  JOIN prompt_recipe_versions recipe ON recipe.id=attempt.prompt_recipe_version_id AND recipe.id=contract.prompt_recipe_version_id
  JOIN context_manifests manifest ON manifest.id=attempt.context_manifest_id
  JOIN model_route_snapshots route ON route.id=attempt.model_route_snapshot_id
  WHERE card.id=next_trial.resource_id AND version.id=next_trial.resource_version_id AND type.type_key='character'
   AND card.space_id='60000000-0000-4000-8000-000000000001' AND task.space_id=card.space_id AND task.book_id IS NULL
   AND task.source_kind='public_character_trial' AND task.source_id=next_trial.id AND task.request_idempotency_key=next_trial.request_key::text AND task.request_hash=next_trial.request_hash
   AND step.id=next_trial.step_id AND step.max_attempts=1 AND step.current_attempt_id=attempt.id AND attempt.id=next_trial.attempt_id AND attempt.attempt_number=1
   AND manifest.book_id IS NULL AND manifest.public_character_scope=card.id AND route.book_id IS NULL
   AND manifest.task_contract_version_id=contract.id AND manifest.prompt_recipe_version_id=recipe.id AND manifest.model_route_snapshot_id=route.id
   AND next_trial.frozen_plan->>'contractVersionId'=contract.id::text AND next_trial.frozen_plan->>'recipeVersionId'=recipe.id::text
   AND next_trial.frozen_plan->>'manifestId'=manifest.id::text AND next_trial.frozen_plan->>'inputHash'=attempt.input_hash::text
   AND next_trial.frozen_plan->>'outputSchemaVersion'=attempt.output_schema_version AND attempt.output_schema_version=contract.output_schema_version
   AND contract.retry_policy->'maxAttempts'='1'::jsonb AND contract.retry_policy->'automaticRetry'='false'::jsonb
   AND manifest.source_set_hash::text=next_trial.source_snapshot->>'hash' AND manifest.manifest_hash::text=next_trial.frozen_plan->>'inputHash'
   AND recipe.variables_schema->'const'=next_trial.frozen_plan->'promptInput' AND contract.input_schema->'const'=next_trial.frozen_plan->'promptInput'
   AND ((next_trial.input_payload->>'kind'='dialogue' AND contract.task_group='character_dialogue' AND contract.budget_policy->>'assetId'='new_design.character.public_dialogue' AND contract.budget_policy->>'assetVersion'='v1')
    OR (next_trial.input_payload->>'kind'='portrait' AND contract.task_group='image_generation' AND contract.budget_policy->>'assetId'='new_design.character.public_portrait' AND contract.budget_policy->>'assetVersion'='v1'))
   AND next_trial.input_payload->>'requestKey'=next_trial.request_key::text AND next_trial.input_payload->>'resourceId'=card.id::text AND next_trial.input_payload->>'resourceVersionId'=version.id::text
   AND next_trial.source_snapshot->>'id'=card.id::text AND next_trial.source_snapshot->>'versionId'=version.id::text AND next_trial.source_snapshot->>'typeVersionId'=version.type_version_id::text
   AND next_trial.source_snapshot->>'title'=version.title AND next_trial.source_snapshot->>'revision'=version.revision::text
   AND next_trial.source_snapshot->'values'=version.values||COALESCE((SELECT jsonb_object_agg(definition.field_key,local.value) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE record_type.type_key='card_version_local_value') local JOIN field_definitions definition ON definition.id=local.field_definition_id WHERE local.card_version_id=version.id),'{}'::jsonb)
   AND next_trial.source_snapshot->'fields'=spec.fields||COALESCE((SELECT jsonb_agg(field.field_schema ORDER BY definition.field_key) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE record_type.type_key='card_version_local_value') local JOIN field_definitions definition ON definition.id=local.field_definition_id JOIN field_definition_versions field ON field.id=local.field_definition_version_id AND field.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)
   AND next_trial.source_snapshot->'localFields'=COALESCE((SELECT jsonb_agg(jsonb_build_object('definitionId',definition.id::text,'versionId',field.id::text,'field',field.field_schema,'value',local.value) ORDER BY definition.field_key) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE record_type.type_key='card_version_local_value') local JOIN field_definitions definition ON definition.id=local.field_definition_id JOIN field_definition_versions field ON field.id=local.field_definition_version_id AND field.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)
   AND next_trial.input_payload->>'sourceHash'=next_trial.source_snapshot->>'hash'
   AND next_trial.frozen_plan->'source'=next_trial.source_snapshot AND next_trial.frozen_plan->'input'=next_trial.input_payload
   AND ((next_trial.input_payload->>'kind'='dialogue' AND next_trial.frozen_plan->'promptInput'->'source'=next_trial.source_snapshot AND next_trial.frozen_plan->'promptInput'->>'message'=next_trial.input_payload->>'message')
    OR (next_trial.input_payload->>'kind'='portrait' AND next_trial.frozen_plan->'promptInput'->'portraitSource'=next_trial.source_snapshot AND next_trial.frozen_plan->'promptInput'->>'prompt'=next_trial.input_payload->>'prompt' AND next_trial.frozen_plan->'promptInput'->>'description'=next_trial.input_payload->>'description' AND next_trial.frozen_plan->'promptInput'->>'size'=next_trial.input_payload->>'size'))
   AND ((next_trial.input_payload->>'kind'='dialogue' AND route.managed_task_key='character_dialogue'
     AND next_trial.frozen_plan->'route'->'sourceLayers'=route.source_layers AND next_trial.frozen_plan->'route'->'primary'->>'provider'=route.provider AND next_trial.frozen_plan->'route'->'primary'->>'model'=route.model)
    OR (next_trial.input_payload->>'kind'='portrait' AND route.managed_task_key='image_generation'
     AND next_trial.input_payload->>'connectionVersionId'=route.source_layers->0->>'versionId'
     AND next_trial.frozen_plan->'connection'->>'id'=next_trial.input_payload->>'connectionVersionId'
     AND EXISTS(SELECT 1 FROM model_route_versions connection JOIN model_route_configs config ON config.id=connection.config_id WHERE connection.id::text=next_trial.input_payload->>'connectionVersionId' AND config.scope='task_group' AND config.task_group='image_generation' AND connection.provider=route.provider AND connection.model=route.model AND connection.content_hash::text=next_trial.frozen_plan->'connection'->>'connectionHash')))
   AND next_trial.frozen_plan->>'snapshotId'=route.id::text AND next_trial.frozen_plan->>'snapshotHash'=route.snapshot_hash::text
 ) THEN RAISE EXCEPTION 'public character exact source and original attempt mismatch' USING ERRCODE='23514'; END IF;
 IF next_trial.reply IS NOT NULL AND (next_trial.execution IS NULL OR next_trial.request_state<>'completed' OR NOT EXISTS(
  SELECT 1 FROM model_route_snapshots route WHERE route.id::text=next_trial.frozen_plan->>'snapshotId'
   AND next_trial.execution->>'routeSnapshotId'=route.id::text AND next_trial.execution->>'routeSnapshotHash'=route.snapshot_hash::text
   AND next_trial.execution->>'provider'=route.provider AND next_trial.execution->>'model'=route.model
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(next_trial.execution->'attempts')='array' THEN next_trial.execution->'attempts' ELSE '[]'::jsonb END) trace WHERE trace->>'status'='succeeded' AND trace->'requestSent'='true'::jsonb AND trace->'responseReceived'='true'::jsonb)
 )) THEN RAISE EXCEPTION 'public character reply requires actual frozen execution' USING ERRCODE='23514'; END IF;
 IF next_trial.status='succeeded' AND (next_trial.reply IS NULL OR next_trial.output IS NULL OR NOT EXISTS(SELECT 1 FROM ai_task_attempts WHERE id=next_trial.attempt_id AND status='succeeded')) THEN RAISE EXCEPTION 'public character success requires saved original reply' USING ERRCODE='23514'; END IF;
 IF next_trial.status='succeeded' AND next_trial.input_payload->>'kind'='dialogue' AND
  (next_trial.output IS DISTINCT FROM next_trial.reply OR next_trial.output->>'resourceId' IS DISTINCT FROM next_trial.resource_id::text OR next_trial.output->>'resourceVersionId' IS DISTINCT FROM next_trial.resource_version_id::text) THEN RAISE EXCEPTION 'public dialogue output source mismatch' USING ERRCODE='23514'; END IF;
 IF next_trial.status='succeeded' AND next_trial.input_payload->>'kind'='portrait' AND NOT EXISTS(
  SELECT 1 FROM asset_content_objects content WHERE content.id::text=next_trial.output->>'contentObjectId' AND content.storage_kind='managed_file' AND content.storage_provider='local' AND content.integrity_state='verified'
   AND content.checksum::text=next_trial.output->>'checksum' AND content.byte_size::text=next_trial.output->>'byteSize' AND content.mime_type=next_trial.output->>'mimeType'
   AND next_trial.output->>'checksum'=next_trial.reply->>'checksum' AND next_trial.output->>'byteSize'=next_trial.reply->>'byteSize' AND next_trial.output->>'mimeType'=next_trial.reply->>'mimeType'
   AND next_trial.output->>'title'=next_trial.input_payload->>'title' AND next_trial.output->>'description'=next_trial.input_payload->>'description'
 ) THEN RAISE EXCEPTION 'public portrait output content mismatch' USING ERRCODE='23514'; END IF;
 IF next_trial.status='ended_unknown'  AND next_trial.reply IS NOT NULL THEN RAISE EXCEPTION 'received reply cannot be ended as unknown' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION new_design.native_guard_public_title_trial() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE task record;step record;attempt record;contract record;manifest record; next_trial record; prior_trial record; operation text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM card_types WHERE id=NEW.card_type_id AND type_key='public_title_factory_trial') OR NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 operation:=CASE WHEN OLD.current_version_id IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
 SELECT fields.* INTO next_trial FROM card_versions v CROSS JOIN LATERAL jsonb_to_record(v.values) fields(id uuid,request_key uuid,request_hash char(64),intent_hash char(64),source_id uuid,source_version_id uuid,source_hash char(64),input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz) WHERE v.id=NEW.current_version_id;
 SELECT fields.* INTO prior_trial FROM jsonb_to_record(COALESCE((SELECT values FROM card_versions WHERE id=OLD.current_version_id),'{}'::jsonb)) fields(id uuid,request_key uuid,request_hash char(64),intent_hash char(64),source_id uuid,source_version_id uuid,source_hash char(64),input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz);

 IF operation='DELETE' THEN RAISE EXCEPTION 'original public title trial immutable' USING ERRCODE='23514'; END IF;
 IF operation='INSERT' THEN IF next_trial.status<>'running' OR next_trial.reply IS NOT NULL OR next_trial.output IS NOT NULL OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_title_factory_v1' AND installed AND operational) THEN RAISE EXCEPTION 'public title not enabled' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(next_trial)-ARRAY['status','reply','output','summary']) IS DISTINCT FROM (to_jsonb(prior_trial)-ARRAY['status','reply','output','summary']) OR prior_trial.status<>'running' OR prior_trial.reply IS NOT NULL AND next_trial.reply IS DISTINCT FROM prior_trial.reply THEN RAISE EXCEPTION 'original title input/reply immutable' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO STRICT task FROM ai_tasks WHERE id=next_trial.id;SELECT * INTO STRICT step FROM ai_task_steps WHERE id=next_trial.step_id AND task_id=next_trial.id;SELECT * INTO STRICT attempt FROM ai_task_attempts WHERE id=next_trial.attempt_id AND step_id=next_trial.step_id AND task_id=next_trial.id;
 SELECT * INTO STRICT contract FROM task_contract_versions WHERE id=task.task_contract_version_id;SELECT * INTO STRICT manifest FROM context_manifests WHERE id=attempt.context_manifest_id;
 IF NOT COALESCE(task.book_id IS NULL AND task.space_id='60000000-0000-4000-8000-000000000001' AND task.source_kind='public_title_factory' AND task.source_id=next_trial.id AND task.request_hash=next_trial.request_hash AND task.request_idempotency_key=next_trial.request_key::text AND contract.task_group='creative_extraction' AND contract.budget_policy->>'assetId'='new_design.public.title_factory' AND contract.budget_policy->>'assetVersion'='v1' AND contract.retry_policy='{"maxAttempts":1,"automaticRetry":false}'::jsonb AND contract.input_schema->'const'=next_trial.frozen_plan->'promptInput' AND contract.input_schema->'const'->'input'=next_trial.input_payload AND contract.input_schema->'const'->'source'=next_trial.source_snapshot AND next_trial.source_snapshot->>'id'=next_trial.source_id::text AND next_trial.source_snapshot->>'versionId'=next_trial.source_version_id::text AND next_trial.source_snapshot->>'hash'=next_trial.source_hash AND manifest.book_id IS NULL AND manifest.public_title_scope=next_trial.source_id AND manifest.task_contract_version_id=contract.id AND step.max_attempts=1 AND attempt.attempt_number=1 AND attempt.input_hash=next_trial.frozen_plan->>'inputHash' AND attempt.output_schema_version=next_trial.frozen_plan->>'outputSchemaVersion' AND attempt.model_route_snapshot_id=(next_trial.frozen_plan->>'snapshotId')::uuid,false) THEN RAISE EXCEPTION 'original title frozen execution mismatch' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM card_versions version JOIN cards card ON card.id=version.card_id JOIN card_types type ON type.id=card.card_type_id WHERE version.id=next_trial.source_version_id AND card.id=next_trial.source_id AND card.space_id=task.space_id AND type.type_key='public_title_brief' AND version.values=next_trial.source_snapshot->'values') OR NOT EXISTS(SELECT 1 FROM new_design.context_manifest_items entry WHERE entry.manifest_id=manifest.id AND entry.source_type='card_version' AND entry.stable_object_id=next_trial.source_id AND entry.exact_version_id=next_trial.source_version_id AND entry.transform_status='full') THEN RAISE EXCEPTION 'original title source version unavailable' USING ERRCODE='23514'; END IF;
 IF next_trial.reply IS NOT NULL AND NOT COALESCE(next_trial.reply->'output'->>'sourceId'=next_trial.source_id::text AND next_trial.reply->'output'->>'sourceVersionId'=next_trial.source_version_id::text AND next_trial.reply->'output'->>'sourceHash'=next_trial.source_hash AND next_trial.reply->'execution'->>'routeSnapshotId'=next_trial.frozen_plan->>'snapshotId' AND next_trial.reply->'execution'->>'routeSnapshotHash'=next_trial.frozen_plan->>'snapshotHash' AND jsonb_array_length(next_trial.reply->'output'->'groups')=(next_trial.input_payload->>'groupCount')::integer AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(next_trial.reply->'output'->'groups') item WHERE jsonb_array_length(item->'titles')<>(next_trial.input_payload->>'candidatesPerGroup')::integer) AND EXISTS(SELECT 1 FROM jsonb_array_elements(next_trial.reply->'execution'->'attempts') trace WHERE trace->>'status'='succeeded' AND trace->>'requestSent'='true' AND trace->>'responseReceived'='true'),false) THEN RAISE EXCEPTION 'original title reply execution mismatch' USING ERRCODE='23514'; END IF;
 IF next_trial.status='succeeded' AND (next_trial.reply IS NULL OR next_trial.output IS DISTINCT FROM next_trial.reply->'output' OR task.status<>'succeeded' OR step.status<>'succeeded' OR attempt.status<>'succeeded') THEN RAISE EXCEPTION 'original successful title requires original reply and ledger' USING ERRCODE='23514'; END IF;
 IF next_trial.status IN('failed','ended_unknown') AND (next_trial.output IS NOT NULL OR task.status<>CASE WHEN next_trial.status='failed' THEN 'failed' ELSE 'cancelled' END OR attempt.status<>CASE WHEN next_trial.status='failed' THEN 'failed' ELSE 'discarded' END) THEN RAISE EXCEPTION 'original title failure ledger mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER native_public_character_trial_guard AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.native_guard_public_character_trial();
CREATE TRIGGER native_public_title_trial_guard AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.native_guard_public_title_trial();
CREATE TRIGGER native_dependency_resources_validate BEFORE INSERT ON new_design.dependency_resources FOR EACH ROW EXECUTE FUNCTION new_design.validate_dependency_resource();
CREATE TRIGGER native_dependency_resources_immutable BEFORE UPDATE OR DELETE ON new_design.dependency_resources FOR EACH ROW EXECUTE FUNCTION new_design.guard_dependency_resource_immutable();
CREATE TRIGGER native_dependency_edges_guard BEFORE INSERT OR UPDATE OR DELETE ON new_design.dependency_edges FOR EACH ROW EXECUTE FUNCTION new_design.guard_dependency_edge();
CREATE TRIGGER native_outbox_aggregate_scope BEFORE INSERT ON new_design.outbox_aggregate_sequences FOR EACH ROW EXECUTE FUNCTION new_design.validate_outbox_scope();
CREATE TRIGGER native_outbox_event_scope BEFORE INSERT ON new_design.outbox_events FOR EACH ROW EXECUTE FUNCTION new_design.validate_outbox_scope();
CREATE TRIGGER native_outbox_aggregate_guard BEFORE UPDATE OR DELETE ON new_design.outbox_aggregate_sequences FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_aggregate_sequence();
CREATE TRIGGER native_outbox_consumer_guard BEFORE UPDATE OR DELETE ON new_design.outbox_consumers FOR EACH ROW EXECUTE FUNCTION new_design.guard_consumer_update();
CREATE TRIGGER native_outbox_inbox_guard BEFORE INSERT ON new_design.outbox_inbox_receipts FOR EACH ROW EXECUTE FUNCTION new_design.validate_outbox_inbox_receipt();
CREATE TRIGGER native_job_reference_guard BEFORE INSERT ON new_design.background_jobs FOR EACH ROW EXECUTE FUNCTION new_design.validate_background_job_reference();
CREATE TRIGGER native_job_transition_guard BEFORE UPDATE OR DELETE ON new_design.background_jobs FOR EACH ROW EXECUTE FUNCTION new_design.guard_background_job_transition();
CREATE TRIGGER native_attempt_update_guard BEFORE UPDATE OR DELETE ON new_design.background_job_attempts FOR EACH ROW EXECUTE FUNCTION new_design.guard_background_attempt_update();
CREATE TRIGGER native_job_checkpoint_lease BEFORE INSERT ON new_design.background_job_checkpoints FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_job_evidence();
CREATE TRIGGER native_job_result_lease BEFORE INSERT ON new_design.background_job_events FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_job_evidence();
CREATE TRIGGER native_content_guard BEFORE UPDATE ON new_design.asset_content_objects FOR EACH ROW EXECUTE FUNCTION new_design.guard_asset_content_object();
CREATE TRIGGER native_asset_link_guard BEFORE UPDATE OR DELETE ON new_design.asset_links FOR EACH ROW EXECUTE FUNCTION new_design.guard_asset_mount_append_only();
CREATE TRIGGER native_asset_dependency_bridge AFTER INSERT ON new_design.asset_versions FOR EACH ROW EXECUTE FUNCTION new_design.bridge_asset_version_dependency();
CREATE TRIGGER native_chunk_insert_guard BEFORE INSERT ON new_design.embedding_chunks FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_embedding_chunk();
CREATE TRIGGER native_chunk_immutable BEFORE UPDATE OR DELETE ON new_design.embedding_chunks FOR EACH ROW EXECUTE FUNCTION new_design.guard_embedding_chunk();
CREATE TRIGGER native_generation_insert_guard BEFORE INSERT ON new_design.embedding_generations FOR EACH ROW EXECUTE FUNCTION new_design.validate_embedding_generation();
CREATE TRIGGER native_vector_insert_guard BEFORE INSERT ON new_design.embedding_vectors FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_embedding_vector();
CREATE TRIGGER native_vector_immutable BEFORE UPDATE OR DELETE ON new_design.embedding_vectors FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_embedding_vector();
CREATE TRIGGER native_transfer_operation_guard BEFORE UPDATE OR DELETE ON new_design.transfer_operations FOR EACH ROW EXECUTE FUNCTION new_design.guard_transfer_operation_update();
CREATE TRIGGER native_transfer_scope_guard BEFORE INSERT ON new_design.transfer_operations FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_operation_scope();
CREATE TRIGGER native_transfer_conflict_guard BEFORE UPDATE OR DELETE ON new_design.transfer_conflicts FOR EACH ROW EXECUTE FUNCTION new_design.guard_transfer_conflict_update();
CREATE TRIGGER native_transfer_outbox_bridge AFTER INSERT ON new_design.transfer_operations FOR EACH ROW EXECUTE FUNCTION new_design.bridge_transfer_operation_to_outbox();
CREATE TRIGGER native_publication_scope BEFORE INSERT ON new_design.publication_manifests FOR EACH ROW EXECUTE FUNCTION new_design.validate_publication_manifest();
CREATE TRIGGER native_record_history_guard AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_record_history();
CREATE TRIGGER native_record_request_bridge AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_request_card();
CREATE TRIGGER native_ai_task_outbox_bridge AFTER INSERT ON new_design.ai_tasks FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_physical_request();
CREATE TRIGGER native_embedding_generation_outbox_bridge AFTER INSERT ON new_design.embedding_generations FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_physical_request();
CREATE TRIGGER native_dependency_events_immutable BEFORE UPDATE OR DELETE ON new_design.dependency_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_outbox_events_immutable BEFORE UPDATE OR DELETE ON new_design.outbox_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_outbox_inbox_receipts_immutable BEFORE UPDATE OR DELETE ON new_design.outbox_inbox_receipts FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_background_job_checkpoints_immutable BEFORE UPDATE OR DELETE ON new_design.background_job_checkpoints FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_background_job_events_immutable BEFORE UPDATE OR DELETE ON new_design.background_job_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_asset_versions_immutable BEFORE UPDATE OR DELETE ON new_design.asset_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_asset_events_immutable BEFORE UPDATE OR DELETE ON new_design.asset_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_retrieval_results_immutable BEFORE UPDATE OR DELETE ON new_design.retrieval_results FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_publication_manifests_immutable BEFORE UPDATE OR DELETE ON new_design.publication_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_publication_artifacts_immutable BEFORE UPDATE OR DELETE ON new_design.publication_artifacts FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_transfer_manifests_immutable BEFORE UPDATE OR DELETE ON new_design.transfer_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_transfer_entries_immutable BEFORE UPDATE OR DELETE ON new_design.transfer_entries FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_transfer_validations_immutable BEFORE UPDATE OR DELETE ON new_design.transfer_validations FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_transfer_id_mappings_immutable BEFORE UPDATE OR DELETE ON new_design.transfer_id_mappings FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_transfer_events_immutable BEFORE UPDATE OR DELETE ON new_design.transfer_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
CREATE TRIGGER native_transfer_manifests_active BEFORE INSERT ON new_design.transfer_manifests FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();
CREATE TRIGGER native_transfer_entries_active BEFORE INSERT ON new_design.transfer_entries FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();
CREATE TRIGGER native_transfer_validations_active BEFORE INSERT ON new_design.transfer_validations FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();
CREATE TRIGGER native_transfer_conflicts_active BEFORE INSERT ON new_design.transfer_conflicts FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();
CREATE TRIGGER native_transfer_id_mappings_active BEFORE INSERT ON new_design.transfer_id_mappings FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();

CREATE OR REPLACE FUNCTION new_design.validate_native_asset_version() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
  WHERE t.type_key='asset' AND v.values->>'id'=NEW.asset_id::text AND v.values->>'book_id'=NEW.book_id::text)
 OR (NEW.base_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_versions WHERE id=NEW.base_version_id AND asset_id=NEW.asset_id AND book_id=NEW.book_id))
 OR (NEW.derived_from_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_versions WHERE id=NEW.derived_from_version_id AND book_id=NEW.book_id))
 OR (NEW.source_resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dependency_resources WHERE id=NEW.source_resource_id AND (book_id IS NULL OR book_id=NEW.book_id))) THEN RAISE EXCEPTION 'asset exact version scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_native_asset_link() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE owner_book uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM asset_versions WHERE id=NEW.asset_version_id AND asset_id=NEW.asset_id AND book_id=NEW.book_id) THEN RAISE EXCEPTION 'asset link version scope mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.owner_kind='book' THEN
  SELECT id INTO owner_book FROM books WHERE id=NEW.owner_stable_id AND id=NEW.owner_exact_version_id;
 ELSIF NEW.owner_kind='quality_issue_evidence' THEN
  SELECT (issue.values->>'book_id')::uuid INTO owner_book
  FROM cards evidence_card JOIN card_types evidence_type ON evidence_type.id=evidence_card.card_type_id JOIN card_versions evidence ON evidence.id=evidence_card.current_version_id
  JOIN cards version_card ON true JOIN card_types version_type ON version_type.id=version_card.card_type_id JOIN card_versions version ON version.id=version_card.current_version_id
  JOIN cards issue_card ON true JOIN card_types issue_type ON issue_type.id=issue_card.card_type_id JOIN card_versions issue ON issue.id=issue_card.current_version_id
  WHERE evidence_type.type_key='quality_issue_evidence' AND evidence.values->>'id'=NEW.owner_stable_id::text AND NEW.owner_stable_id=NEW.owner_exact_version_id
   AND version_type.type_key='quality_issue_version' AND version.values->>'id'=evidence.values->>'issue_version_id'
   AND issue_type.type_key='quality_issue' AND issue.values->>'id'=version.values->>'issue_id';
 ELSE
  SELECT resolved_book_id INTO owner_book FROM resolve_dependency_resource(NEW.owner_kind,NEW.owner_stable_id,NEW.owner_exact_version_id);
  IF NEW.owner_kind='prompt_recipe_version' AND EXISTS(SELECT 1 FROM prompt_recipe_versions WHERE id=NEW.owner_exact_version_id AND recipe_id=NEW.owner_stable_id) THEN owner_book:=NEW.book_id; END IF;
  IF NEW.owner_kind='research_record_version' AND EXISTS(
   SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE t.type_key='book_research_reference' AND v.values->>'book_id'=NEW.book_id::text AND
    (v.values->>'research_version_id'=NEW.owner_exact_version_id::text OR EXISTS(
     SELECT 1 FROM cards i JOIN card_types it ON it.id=i.card_type_id JOIN card_versions iv ON iv.id=i.current_version_id
     WHERE it.type_key='research_reference_pack_item' AND iv.values->>'pack_version_id'=v.values->>'pack_version_id' AND iv.values->>'research_version_id'=NEW.owner_exact_version_id::text)))
   AND EXISTS(SELECT 1 FROM resolve_dependency_resource(NEW.owner_kind,NEW.owner_stable_id,NEW.owner_exact_version_id)) THEN owner_book:=NEW.book_id; END IF;
 END IF;
 IF owner_book IS DISTINCT FROM NEW.book_id THEN RAISE EXCEPTION 'asset link owner unavailable or cross-book' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_native_publication_artifact() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM publication_manifests manifest JOIN cards c ON true JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
 WHERE manifest.id=NEW.manifest_id AND manifest.format=NEW.format AND t.type_key='publication_export_request'
 AND v.values->>'id'=NEW.request_id::text AND v.values->>'manifest_id'=manifest.id::text AND v.values->>'book_id'=manifest.book_id::text)
 THEN RAISE EXCEPTION 'publication artifact scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_native_retrieval_vector() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE dimensions integer;
BEGIN
 IF TG_OP='UPDATE' AND OLD.query_vector IS NOT NULL AND NEW.query_vector IS DISTINCT FROM OLD.query_vector THEN RAISE EXCEPTION 'retrieval exact response immutable' USING ERRCODE='23514'; END IF;
 IF NEW.query_vector IS NULL THEN RETURN NEW; END IF;
 SELECT (v.values->>'dimensions')::integer INTO dimensions FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'id'=NEW.profile_version_id::text;
 IF dimensions IS NULL OR cardinality(NEW.query_vector)<>dimensions OR array_ndims(NEW.query_vector)<>1 OR EXISTS(SELECT 1 FROM unnest(NEW.query_vector) x WHERE x IS NULL OR x::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'retrieval reply vector is invalid' USING ERRCODE='22000'; END IF;
 IF TG_OP='UPDATE' AND OLD.query_vector IS NOT NULL AND NEW.query_vector IS DISTINCT FROM OLD.query_vector THEN RAISE EXCEPTION 'retrieval exact response immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.cascade_native_embedding_profile_archive() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE item record; next_value jsonb;
BEGIN
 IF OLD.status<>'active' OR NEW.status<>'archived' THEN RETURN NEW; END IF;
 FOR item IN SELECT c.space_id,t.type_key,v.values FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
 WHERE (t.type_key IN ('embedding_source_snapshot','embedding_request') AND EXISTS(
  SELECT 1 FROM cards p JOIN card_types pt ON pt.id=p.card_type_id JOIN card_versions pv ON pv.id=p.current_version_id WHERE pt.type_key='embedding_profile_version' AND pv.values->>'profile_id'=NEW.id::text AND pv.values->>'id'=v.values->>'profile_version_id'))
  OR (t.type_key='embedding_index_state' AND v.values->>'profile_id'=NEW.id::text)
 LOOP
  IF (item.type_key='embedding_source_snapshot' AND item.values->>'status'<>'current') OR (item.type_key='embedding_request' AND item.values->>'status' NOT IN ('pending','running','retry_scheduled','succeeded')) THEN CONTINUE; END IF;
  next_value:=item.values||jsonb_build_object('status','stale','revision',COALESCE((item.values->>'revision')::integer,0)+1,'updated_at',now());
  IF item.type_key='embedding_source_snapshot' THEN next_value:=next_value||jsonb_build_object('stale_at',now()); END IF;
  PERFORM kernel_store_record(item.type_key,item.space_id,(item.values->>'id')::uuid,next_value);
 END LOOP;
 UPDATE embedding_chunks SET status='stale',stale_at=now() WHERE status='current' AND profile_version_id IN (
  SELECT (v.values->>'id')::uuid FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'profile_id'=NEW.id::text);
 UPDATE embedding_vectors SET status='stale' WHERE record_kind='index' AND status='eligible' AND profile_version_id IN (
  SELECT (v.values->>'id')::uuid FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'profile_id'=NEW.id::text);
 UPDATE embedding_generations SET status='stale' WHERE status IN ('ready','active') AND profile_version_id IN (
  SELECT (v.values->>'id')::uuid FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'profile_id'=NEW.id::text);
 RETURN NEW;
END $$;
CREATE TRIGGER native_asset_version_scope BEFORE INSERT ON new_design.asset_versions FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_asset_version();
CREATE TRIGGER native_asset_link_scope BEFORE INSERT ON new_design.asset_links FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_asset_link();
CREATE TRIGGER native_publication_artifact_scope BEFORE INSERT ON new_design.publication_artifacts FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_publication_artifact();
CREATE TRIGGER native_retrieval_vector_scope BEFORE INSERT OR UPDATE ON new_design.retrieval_runs FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_retrieval_vector();
CREATE TRIGGER native_embedding_profile_archive AFTER UPDATE OF status ON new_design.embedding_profiles FOR EACH ROW EXECUTE FUNCTION new_design.cascade_native_embedding_profile_archive();

CREATE OR REPLACE FUNCTION new_design.validate_native_history_sources() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE kind text; value jsonb; item jsonb; owner_book uuid; snapshot_value jsonb;
BEGIN
 IF NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 SELECT type_key INTO kind FROM card_types WHERE id=NEW.card_type_id;
 IF kind NOT IN ('book_content_history_snapshot','book_content_history_restore','book_completion_snapshot_chapter','publication_export_manifest_chapter') THEN RETURN NEW; END IF;
 SELECT values INTO value FROM card_versions WHERE id=NEW.current_version_id;
 IF kind='book_content_history_snapshot' THEN
  IF NOT COALESCE(value->'payload'->>'bookId'=value->>'book_id' AND jsonb_typeof(value->'payload'->'plans')='array' AND jsonb_typeof(value->'payload'->'chapters')='array',false) THEN RAISE EXCEPTION 'history snapshot scope mismatch' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'payload'->'chapters') LOOP
   IF item ? 'content' OR NOT EXISTS(SELECT 1 FROM chapter_documents d JOIN chapter_body_versions b ON b.chapter_document_id=d.id
    WHERE d.book_id=(value->>'book_id')::uuid AND d.id=(item->>'id')::uuid AND b.id=(item->>'bodyVersionId')::uuid AND b.content_hash::text=item->>'contentHash') THEN RAISE EXCEPTION 'history requires exact physical body reference' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'payload'->'plans') LOOP
   IF NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='planning_version'
    AND v.values->>'id'=item->>'versionId' AND v.values->>'object_id'=item->>'id' AND v.values->>'book_id'=value->>'book_id' AND v.values->'content'=item->'content') THEN RAISE EXCEPTION 'history plan exact source unavailable' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSIF kind='book_content_history_restore' THEN
  SELECT v.values INTO snapshot_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='book_content_history_snapshot' AND v.values->>'id'=value->'input_payload'->>'snapshotId' AND v.values->>'book_id'=value->>'book_id';
  IF snapshot_value IS NULL OR NOT COALESCE(snapshot_value->>'source_hash'=value->'input_payload'->>'sourceHash'
   AND value->'input_payload'->>'requestKey'=value->>'request_key' AND value->'input_payload'->>'confirm'='true'
   AND value->'receipt'->>'requestKey'=value->>'request_key' AND value->'receipt'->>'bookId'=value->>'book_id'
   AND value->'receipt'->>'inputHash'=value->>'input_hash' AND value->'receipt'->'input'=value->'input_payload'
   AND value->'receipt'->>'beforeSnapshotId'=value->>'before_snapshot_id',false)
   OR NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='book_content_history_snapshot' AND v.values->>'id'=value->>'before_snapshot_id' AND v.values->>'book_id'=value->>'book_id' AND v.values->>'kind'='before_restore') THEN RAISE EXCEPTION 'history restore original receipt mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF kind='book_completion_snapshot_chapter' THEN
   SELECT (v.values->>'book_id')::uuid INTO owner_book FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='book_completion_snapshot' AND v.values->>'id'=value->>'snapshot_id';
  ELSE SELECT book_id INTO owner_book FROM publication_manifests WHERE id=(value->>'manifest_id')::uuid;
  END IF;
IF owner_book IS NULL OR NOT EXISTS(SELECT 1 FROM chapter_documents d LEFT JOIN chapter_body_versions b ON b.chapter_document_id=d.id AND b.id=(value->>'body_version_id')::uuid
   WHERE d.book_id=owner_book AND d.id=(value->>'chapter_document_id')::uuid
    AND ((kind='book_completion_snapshot_chapter' AND value->>'body_version_id' IS NULL) OR (b.id IS NOT NULL AND b.content_hash::text=value->>'body_hash')))
   OR (value->>'stable_checkpoint_id' IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
    WHERE t.type_key='chapter_stable_checkpoint' AND v.values->>'id'=value->>'stable_checkpoint_id'
     AND v.values->>'chapter_document_id'=value->>'chapter_document_id' AND v.values->>'body_version_id'=value->>'body_version_id'))
   THEN RAISE EXCEPTION 'frozen chapter manifest source mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_history_exact_sources AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_history_sources();


CREATE OR REPLACE FUNCTION new_design.bridge_native_dependency_creation() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE source_kind text; source_version uuid; source_stable uuid; owner_book uuid;
BEGIN
 IF TG_TABLE_NAME='context_manifests' THEN
  PERFORM register_dependency_resource('context_manifest',NEW.id,NEW.id);
  IF NEW.book_id IS NULL THEN RETURN NEW; END IF;
  SELECT recipe_id INTO source_stable FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
  PERFORM add_registered_dependency('prompt_recipe_version',source_stable,NEW.prompt_recipe_version_id,'context_manifest',NEW.id,NEW.id,'configured_by','hard','context_build',NEW.id);
  SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
  PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'context_manifest',NEW.id,NEW.id,'configured_by','hard','context_build',NEW.id);
 ELSIF TG_TABLE_NAME='context_manifest_items' THEN
  SELECT book_id INTO owner_book FROM context_manifests WHERE id=NEW.manifest_id;
  source_kind:=CASE NEW.source_type WHEN 'body_version' THEN 'chapter_body_version' WHEN 'text_anchor' THEN 'chapter_text_anchor'
   WHEN 'research_version' THEN 'research_record_version' WHEN 'research_pack_version' THEN 'research_reference_pack_version'
   WHEN 'retrieval_chunk' THEN 'embedding_chunk' WHEN 'story_time' THEN 'story_event_timing' WHEN 'prompt_component' THEN 'card_version' ELSE NEW.source_type END;
  source_version:=COALESCE(NEW.exact_version_id,NEW.stable_object_id);
  IF owner_book IS NULL THEN PERFORM register_dependency_resource(source_kind,NEW.stable_object_id,source_version);
  ELSE PERFORM add_registered_dependency(source_kind,NEW.stable_object_id,source_version,'context_manifest',NEW.manifest_id,NEW.manifest_id,'context_included','hard','context_build',NEW.manifest_id); END IF;
 ELSIF TG_TABLE_NAME='model_route_snapshots' THEN
  PERFORM register_dependency_resource('model_route_snapshot',NEW.id,NEW.id);
  IF NEW.book_id IS NULL OR NEW.task_contract_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
  PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'model_route_snapshot',NEW.id,NEW.id,'configured_by','hard','system',NEW.id);
 ELSIF TG_TABLE_NAME='ai_task_attempts' THEN
  IF NEW.status<>'succeeded' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  PERFORM register_dependency_resource('ai_task_attempt',NEW.task_id,NEW.id);
  SELECT book_id INTO owner_book FROM ai_tasks WHERE id=NEW.task_id;
  IF owner_book IS NULL THEN RETURN NEW; END IF;
  SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
  PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','hard','ai_result',NEW.id);
  SELECT recipe_id INTO source_stable FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
  PERFORM add_registered_dependency('prompt_recipe_version',source_stable,NEW.prompt_recipe_version_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','hard','ai_result',NEW.id);
  PERFORM add_registered_dependency('context_manifest',NEW.context_manifest_id,NEW.context_manifest_id,'ai_task_attempt',NEW.task_id,NEW.id,'context_included','hard','ai_result',NEW.id);
  PERFORM add_registered_dependency('model_route_snapshot',NEW.model_route_snapshot_id,NEW.model_route_snapshot_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','soft','ai_result',NEW.id);
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.bridge_native_body_adoption() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE previous_resource uuid; adopted_resource uuid;
BEGIN
 IF NEW.from_version_id IS NULL THEN RETURN NEW; END IF;
 previous_resource:=register_dependency_resource('chapter_body_version',NEW.chapter_document_id,NEW.from_version_id);
 adopted_resource:=register_dependency_resource('chapter_body_version',NEW.chapter_document_id,NEW.to_version_id);
 PERFORM invalidate_registered_resource(previous_resource,adopted_resource,'正文采用版本发生变化。','body_adoption',NEW.id,'body-adoption:'||NEW.id::text);
 RETURN NEW;
END $$;
CREATE TRIGGER native_context_manifest_dependencies AFTER INSERT ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_dependency_creation();
CREATE TRIGGER native_context_item_dependencies AFTER INSERT ON new_design.context_manifest_items FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_dependency_creation();
CREATE TRIGGER native_route_snapshot_dependencies AFTER INSERT ON new_design.model_route_snapshots FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_dependency_creation();
CREATE TRIGGER native_ai_attempt_dependencies AFTER UPDATE OF status ON new_design.ai_task_attempts FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_dependency_creation();
CREATE TRIGGER native_body_adoption_dependencies AFTER INSERT ON new_design.chapter_body_adoptions FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_body_adoption();

-- Frozen card receipts reference managed content as well as asset_versions.
CREATE TRIGGER native_content_no_delete BEFORE DELETE ON new_design.asset_content_objects FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();
-- End native assets/jobs domain functions.
