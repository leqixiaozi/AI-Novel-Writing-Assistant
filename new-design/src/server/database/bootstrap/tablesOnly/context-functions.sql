-- Context-specific insert/head validation over the physical kernel and internal records.
-- Requires assets-jobs-functions.sql (exact dependency resolver); never creates compatibility relations.
SET search_path TO new_design,public;

CREATE OR REPLACE FUNCTION new_design.context_activation_rule_stats(node jsonb,depth integer DEFAULT 1)
RETURNS TABLE(max_depth integer,condition_count integer,is_valid boolean) LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE child jsonb; child_stats record; field_name text; operator_name text;
BEGIN
  IF jsonb_typeof(node) IS DISTINCT FROM 'object' OR depth IS NULL OR depth<1 OR depth>4 THEN RETURN QUERY SELECT depth,0,false; RETURN; END IF;
  IF node->>'kind'='condition' THEN
    field_name:=node->>'field'; operator_name:=node->>'operator';
    RETURN QUERY SELECT depth,1,
      COALESCE(field_name=ANY(ARRAY['task_key','task_group','content_type','tag','material_status','canonical_status','volume','chapter','scene','story_range','relation_exists','association_exists','source_type','stale','manual_switch'])
      AND operator_name=ANY(ARRAY['equals','not_equals','in','not_in','contains','exists','not_exists','gte','lte','between','enabled'])
      AND (node-ARRAY['kind','field','operator','value']::text[])='{}'::jsonb
      AND (NOT (node ? 'value') OR jsonb_typeof(node->'value') IN ('string','number','boolean','array','null'))
      AND (NOT (node ? 'value') OR jsonb_typeof(node->'value')<>'array' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(node->'value')='array' THEN node->'value' ELSE '[]'::jsonb END) AS array_item(value) WHERE jsonb_typeof(value) NOT IN ('string','number'))),false);
    RETURN;
  END IF;
  IF node->>'kind' IS DISTINCT FROM 'group' OR NOT COALESCE(node->>'operator'=ANY(ARRAY['and','or']),false) OR (node-ARRAY['kind','operator','items']::text[])<>'{}'::jsonb OR jsonb_typeof(node->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(node->'items')>20 THEN
    RETURN QUERY SELECT depth,0,false; RETURN;
  END IF;
  max_depth:=depth; condition_count:=0; is_valid:=true;
  FOR child IN SELECT value FROM jsonb_array_elements(node->'items') LOOP
    SELECT * INTO child_stats FROM context_activation_rule_stats(child,depth+1);
    max_depth:=greatest(max_depth,child_stats.max_depth); condition_count:=condition_count+child_stats.condition_count; is_valid:=is_valid AND COALESCE(child_stats.is_valid,false);
  END LOOP;
  is_valid:=is_valid AND condition_count<=40;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_public_character_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE source_value jsonb; contract_row record; recipe_row record; source_version uuid;
BEGIN
 IF NEW.public_character_scope IS NULL THEN RETURN NEW; END IF;
 IF NEW.book_id IS NOT NULL OR NEW.public_title_scope IS NOT NULL OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_character_trial_v1' AND installed AND operational) THEN RAISE EXCEPTION 'public character manifest scope/capability unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO contract_row FROM task_contract_versions WHERE id=NEW.task_contract_version_id AND status='published';
 SELECT * INTO recipe_row FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id AND status='published';
 IF contract_row.id IS NULL OR recipe_row.id IS NULL OR recipe_row.id IS DISTINCT FROM contract_row.prompt_recipe_version_id
  OR recipe_row.variables_schema->'const' IS DISTINCT FROM contract_row.input_schema->'const'
  OR recipe_row.variables_schema->'x-public-character'->>'contract' IS DISTINCT FROM 'public_character_trial_v1'
  OR recipe_row.variables_schema->'x-public-character'->>'resourceId' IS DISTINCT FROM NEW.public_character_scope::text THEN RAISE EXCEPTION 'public character exact contract mismatch' USING ERRCODE='23514'; END IF;
 IF contract_row.task_group NOT IN ('character_dialogue','image_generation') THEN
  IF contract_row.task_group IS DISTINCT FROM 'form_assist'
   OR recipe_row.variables_schema->'x-image-preparation'->>'contract' IS DISTINCT FROM 'image_prompt_preparation_v1'
   OR contract_row.budget_policy->>'assetId' IS DISTINCT FROM 'new_design.image.prompt_preparation'
   OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='image_prompt_preparation_v1' AND installed AND operational)
   THEN RAISE EXCEPTION 'public character contract task group unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 source_value:=CASE WHEN contract_row.task_group='form_assist' THEN recipe_row.variables_schema->'const'->'source'->'data'->'profile'
  ELSE COALESCE(recipe_row.variables_schema->'const'->'source',recipe_row.variables_schema->'const'->'portraitSource') END;
 source_version:=(source_value->>'versionId')::uuid;
 IF source_value IS NULL OR source_value->>'id' IS DISTINCT FROM NEW.public_character_scope::text OR NOT EXISTS(
  SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN card_versions version ON version.card_id=card.id
  WHERE card.id=NEW.public_character_scope AND card.space_id='60000000-0000-4000-8000-000000000001'
   AND type.type_key='character' AND NOT type.is_internal AND type.status='published' AND card.status='active' AND version.id=source_version
   AND version.type_version_id::text=source_value->>'typeVersionId' AND version.revision=(source_value->>'revision')::integer AND version.title=source_value->>'title')
 THEN RAISE EXCEPTION 'public character exact source unavailable' USING ERRCODE='23514'; END IF;
 IF NEW.source_set_hash IS DISTINCT FROM (CASE WHEN contract_row.task_group='form_assist' THEN recipe_row.variables_schema->'const'->'source'->>'hash' ELSE source_value->>'hash' END)::char(64)
 THEN RAISE EXCEPTION 'public character frozen source hash mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_public_title_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF NEW.public_title_scope IS NULL THEN RETURN NEW; END IF;
 IF NEW.book_id IS NOT NULL OR NEW.public_character_scope IS NOT NULL OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_title_factory_v1' AND installed AND operational)
 OR NOT EXISTS(
  SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN card_versions source ON source.id=card.current_version_id AND source.card_id=card.id
  JOIN task_contract_versions contract ON contract.id=NEW.task_contract_version_id JOIN prompt_recipe_versions recipe ON recipe.id=NEW.prompt_recipe_version_id AND recipe.id=contract.prompt_recipe_version_id
  WHERE card.id=NEW.public_title_scope AND card.space_id='60000000-0000-4000-8000-000000000001' AND card.status='active' AND type.type_key='public_title_brief' AND NOT type.is_internal AND type.status='published'
  AND contract.status='published' AND recipe.status='published' AND contract.task_group='creative_extraction' AND contract.budget_policy->>'assetId'='new_design.public.title_factory' AND contract.budget_policy->>'assetVersion'='v1'
  AND contract.input_schema->'const'=recipe.variables_schema->'const' AND contract.input_schema->'const'->>'contract'='public_title_factory_v1'
  AND contract.input_schema->'const'->'source'->>'id'=card.id::text AND contract.input_schema->'const'->'source'->>'versionId'=source.id::text AND contract.input_schema->'const'->'source'->'values'=source.values
  AND NEW.source_set_hash=contract.input_schema->'const'->'source'->>'hash')
 THEN RAISE EXCEPTION 'public title requires original public source and independent exact contract' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION new_design.validate_native_context_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE preview jsonb; route record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM task_contract_versions contract JOIN prompt_recipe_versions recipe ON recipe.id=contract.prompt_recipe_version_id
  WHERE contract.id=NEW.task_contract_version_id AND recipe.id=NEW.prompt_recipe_version_id
  AND (NEW.task_group IS NULL OR contract.task_group=NEW.task_group)) THEN RAISE EXCEPTION 'context manifest contract/recipe mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.model_route_snapshot_id IS NOT NULL THEN
  SELECT * INTO route FROM model_route_snapshots WHERE id=NEW.model_route_snapshot_id;
  IF NOT FOUND OR (route.book_id IS NOT NULL AND route.book_id IS DISTINCT FROM NEW.book_id)
   OR (route.task_contract_version_id IS NOT NULL AND route.task_contract_version_id IS DISTINCT FROM NEW.task_contract_version_id)
   OR (NEW.book_id IS NULL AND route.book_id IS NOT NULL) THEN RAISE EXCEPTION 'context manifest frozen model scope mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.preview_id IS NOT NULL THEN
  SELECT v.values INTO preview FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_preview' AND v.values->>'id'=NEW.preview_id::text;
  IF preview IS NULL OR preview->>'book_id' IS DISTINCT FROM NEW.book_id::text
   OR preview->>'task_contract_version_id' IS DISTINCT FROM NEW.task_contract_version_id::text OR preview->>'prompt_recipe_version_id' IS DISTINCT FROM NEW.prompt_recipe_version_id::text
   OR preview->>'source_set_hash' IS DISTINCT FROM NEW.source_set_hash::text OR preview->>'status'<>'complete'
   OR preview->>'volume_id' IS DISTINCT FROM NEW.volume_id::text OR preview->>'chapter_id' IS DISTINCT FROM NEW.chapter_id::text
   OR preview->>'scene_id' IS DISTINCT FROM NEW.scene_id::text OR preview->'decision_summary' IS DISTINCT FROM NEW.decision_summary
   THEN RAISE EXCEPTION 'context manifest must freeze its original complete preview' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER native_public_character_manifest_guard BEFORE INSERT ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_public_character_manifest();
CREATE TRIGGER native_public_title_manifest_guard BEFORE INSERT ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_public_title_manifest();
CREATE TRIGGER native_context_manifest_scope_guard BEFORE INSERT ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_context_manifest();

CREATE OR REPLACE FUNCTION new_design.context_dependency_kind(source_type text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
 SELECT CASE source_type WHEN 'body_version' THEN 'chapter_body_version' WHEN 'text_anchor' THEN 'chapter_text_anchor'
  WHEN 'research_version' THEN 'research_record_version' WHEN 'research_pack_version' THEN 'research_reference_pack_version'
  WHEN 'story_time' THEN 'story_event_timing' WHEN 'prompt_component' THEN 'card_version'
  WHEN 'retrieval_chunk' THEN 'embedding_chunk' ELSE source_type END
$$;

CREATE OR REPLACE FUNCTION new_design.validate_context_selector_config(payload jsonb) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE selector record;
BEGIN
 SELECT * INTO selector FROM jsonb_to_record(payload) fields(selector_kind text,source_type text,stable_object_id uuid,exact_version_id uuid,selector_config jsonb);
 IF NOT COALESCE(selector.selector_kind IN ('explicit_source','card_type','tag','smart_view','relation','story_range','research_pack','prompt_component','retrieval_trace')
  AND selector.source_type IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version','prompt_component','retrieval_chunk','asset_version','entity_initial_state')
  AND jsonb_typeof(selector.selector_config)='object',false) THEN RAISE EXCEPTION 'invalid typed context selector' USING ERRCODE='23514'; END IF;

  IF selector.selector_kind IN ('explicit_source','prompt_component') AND (selector.stable_object_id IS NULL OR selector.exact_version_id IS NULL) THEN RAISE EXCEPTION 'explicit selector requires an exact source version' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind NOT IN ('explicit_source','prompt_component') AND (selector.stable_object_id IS NOT NULL OR selector.exact_version_id IS NOT NULL) THEN RAISE EXCEPTION 'dynamic selector cannot pin an unrelated source identity' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='explicit_source' AND selector.source_type NOT IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version','asset_version','entity_initial_state') THEN RAISE EXCEPTION 'unsupported explicit source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='prompt_component' AND selector.source_type<>'prompt_component' THEN RAISE EXCEPTION 'prompt component selector requires prompt_component source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind IN ('card_type','tag','smart_view','relation') AND selector.source_type<>'card_version' THEN RAISE EXCEPTION 'card selector requires card_version source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='story_range' AND selector.source_type NOT IN ('card_version','story_time') THEN RAISE EXCEPTION 'story range selector has an unsupported source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='research_pack' AND selector.source_type NOT IN ('research_version','research_pack_version') THEN RAISE EXCEPTION 'research pack selector has an unsupported source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='retrieval_trace' AND selector.source_type<>'retrieval_chunk' THEN RAISE EXCEPTION 'retrieval selector requires retrieval_chunk source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind IN ('explicit_source','prompt_component') AND selector.selector_config<>'{}'::jsonb THEN RAISE EXCEPTION 'explicit selector config must be empty' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='card_type' AND (NOT (selector.selector_config ? 'typeKey') OR (selector.selector_config-ARRAY['typeKey']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'card type selector requires only typeKey' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='tag' AND (NOT (selector.selector_config ? 'tagId') OR (selector.selector_config-ARRAY['tagId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'tag selector requires only tagId' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='smart_view' AND (NOT (selector.selector_config ? 'smartViewId') OR (selector.selector_config-ARRAY['smartViewId','limit']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'smart view selector requires smartViewId and optional limit' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='relation' AND (NOT (selector.selector_config ? 'relationTypeId') OR (selector.selector_config-ARRAY['relationTypeId','anchorCardId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'relation selector requires relationTypeId and optional anchorCardId' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='story_range' AND (NOT (selector.selector_config ?& ARRAY['start','end']) OR (selector.selector_config-ARRAY['start','end']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'story range selector requires start and end' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='research_pack' AND (NOT (selector.selector_config ? 'packVersionId') OR (selector.selector_config-ARRAY['packVersionId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'research pack selector requires only packVersionId' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='retrieval_trace' AND (NOT (selector.selector_config ? 'retrievalRunId') OR (selector.selector_config-ARRAY['retrievalRunId','limit']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'retrieval selector requires an existing trace and optional limit; fake retrieval is forbidden' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(selector.selector_config) AS item(key_name) WHERE key_name ~* '(sql|jsonpath|cypher|javascript|script|prompt)') THEN RAISE EXCEPTION 'selector contains a forbidden executable expression' USING ERRCODE='23514'; END IF;
  RETURN;

END $$;

CREATE OR REPLACE FUNCTION new_design.validate_context_exact_source(source_type text,stable_id uuid,exact_id uuid,target_book uuid,expected_hash text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE resolved record; allowed boolean;
BEGIN
 SELECT * INTO resolved FROM resolve_dependency_resource(context_dependency_kind(source_type),stable_id,COALESCE(exact_id,stable_id));
 IF NOT FOUND OR (resolved.resolved_book_id IS NOT NULL AND resolved.resolved_book_id IS DISTINCT FROM target_book)
  OR (expected_hash IS NOT NULL AND expected_hash IS DISTINCT FROM resolved.resolved_hash::text) THEN RAISE EXCEPTION 'context exact source missing, cross-book or hash mismatch' USING ERRCODE='23514'; END IF;
 IF source_type IN ('card_version','prompt_component') AND NOT EXISTS(
  SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.card_id=c.id
  WHERE c.id=stable_id AND v.id=exact_id AND NOT t.is_internal AND (source_type<>'prompt_component' OR t.type_key='prompt_component'))
 THEN RAISE EXCEPTION 'context source must be an author material version' USING ERRCODE='23514'; END IF;
 IF target_book IS NOT NULL AND source_type IN ('research_version','research_pack_version','research_document_version') THEN
  SELECT EXISTS(
   SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE t.type_key='book_research_reference' AND v.values->>'book_id'=target_book::text AND (
    (source_type='research_pack_version' AND v.values->>'pack_version_id'=exact_id::text)
    OR (source_type='research_version' AND (v.values->>'research_version_id'=exact_id::text OR EXISTS(
     SELECT 1 FROM cards p JOIN card_types pt ON pt.id=p.card_type_id JOIN card_versions pv ON pv.id=p.current_version_id
     WHERE pt.type_key='research_reference_pack_item' AND pv.values->>'pack_version_id'=v.values->>'pack_version_id' AND pv.values->>'research_version_id'=exact_id::text)))
    OR (source_type='research_document_version' AND EXISTS(
     SELECT 1 FROM cards rc JOIN card_types rt ON rt.id=rc.card_type_id JOIN card_versions rv ON rv.id=rc.current_version_id
     JOIN cards vc ON true JOIN card_types vt ON vt.id=vc.card_type_id JOIN card_versions vv ON vv.id=vc.current_version_id
     WHERE rt.type_key='research_record' AND rv.values->>'source_document_version_id'=exact_id::text AND vt.type_key='research_record_version'
      AND vv.values->>'record_id'=rv.values->>'id' AND (v.values->>'research_version_id'=vv.values->>'id' OR EXISTS(
       SELECT 1 FROM cards p JOIN card_types pt ON pt.id=p.card_type_id JOIN card_versions pv ON pv.id=p.current_version_id
       WHERE pt.type_key='research_reference_pack_item' AND pv.values->>'pack_version_id'=v.values->>'pack_version_id' AND pv.values->>'research_version_id'=vv.values->>'id'))))))
  INTO allowed;
  IF NOT allowed THEN RAISE EXCEPTION 'research context source not adopted by this book' USING ERRCODE='23514'; END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION new_design.guard_native_context_record() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE kind text; payload jsonb; previous jsonb; binding jsonb; version_value jsonb; preview jsonb; manifest record;
 stats record; field_name text; fields text[]; identity jsonb; owner_book uuid; owner_space uuid; source_type text; item jsonb; target_id uuid;
BEGIN
 SELECT type_key INTO kind FROM card_types WHERE id=NEW.card_type_id;
 IF kind NOT IN ('context_binding','context_binding_version','context_binding_selector','context_binding_adoption','context_preview',
  'context_preview_binding_version','context_preview_decision','context_management_event','context_manifest_slot','context_manifest_exclusion','context_manifest_retrieval_trace',
  'ai_run_preview','ai_run_prompt_section','ai_run_submission') OR NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 SELECT values INTO payload FROM card_versions WHERE id=NEW.current_version_id AND card_id=NEW.id;
 IF payload IS NULL THEN RAISE EXCEPTION 'context head missing' USING ERRCODE='23514'; END IF;
 IF OLD.current_version_id IS NOT NULL THEN
  SELECT values INTO previous FROM card_versions WHERE id=OLD.current_version_id;
  IF kind NOT IN ('context_binding','context_preview','ai_run_preview') THEN RAISE EXCEPTION 'context evidence % is immutable',kind USING ERRCODE='23514'; END IF;
  IF kind='context_preview' AND NOT COALESCE(previous->>'status' IN ('complete','invalid') AND payload->>'status'='stale'
   AND payload->>'stale_at' IS NOT NULL AND (payload-ARRAY['status','stale_at','stale_reason','revision','updated_at'])=(previous-ARRAY['status','stale_at','stale_reason','revision','updated_at']),false)
   THEN RAISE EXCEPTION 'context preview may only become stale' USING ERRCODE='23514'; END IF;
  IF kind='ai_run_preview' AND NOT COALESCE((payload-ARRAY['status','revision','updated_at'])=(previous-ARRAY['status','revision','updated_at'])
   AND (payload->>'revision')::integer=(previous->>'revision')::integer+1
   AND ((previous->>'status'='ready' AND payload->>'status' IN ('stale','submitted')) OR (previous->>'status'='blocked' AND payload->>'status'='stale')),false)
   THEN RAISE EXCEPTION 'AI run frozen preview or transition mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 fields:=CASE kind
  WHEN 'context_binding' THEN ARRAY['scope_kind','scope_ref','book_id','binding_key'] WHEN 'context_binding_version' THEN ARRAY['binding_id','version']
  WHEN 'context_binding_selector' THEN ARRAY['binding_version_id','sort_order'] WHEN 'context_binding_adoption' THEN ARRAY['binding_id','idempotency_key']
  WHEN 'context_preview_binding_version' THEN ARRAY['preview_id','binding_version_id'] WHEN 'context_preview_decision' THEN ARRAY['preview_id','sort_order']
  WHEN 'context_management_event' THEN ARRAY['idempotency_key'] WHEN 'context_manifest_slot' THEN ARRAY['manifest_id','slot_key']
  WHEN 'context_manifest_exclusion' THEN ARRAY['slot_id','sort_order'] WHEN 'context_manifest_retrieval_trace' THEN ARRAY['manifest_id','retrieval_run_id']
  WHEN 'ai_run_preview' THEN ARRAY['space_id','idempotency_key'] WHEN 'ai_run_prompt_section' THEN ARRAY['preview_id','sort_order']
  WHEN 'ai_run_submission' THEN ARRAY['preview_id'] END;
 IF fields IS NOT NULL THEN
  identity:='{}'::jsonb; FOREACH field_name IN ARRAY fields LOOP identity:=identity||jsonb_build_object(field_name,payload->field_name); END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('context-identity:'||kind||':'||identity::text,0));
  IF EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE c.id<>NEW.id AND t.type_key=kind AND v.values @> identity) THEN RAISE EXCEPTION 'duplicate context identity %',kind USING ERRCODE='23505'; END IF;
 END IF;
 IF kind='context_binding' THEN
  owner_book:=(payload->>'book_id')::uuid; owner_space:=(payload->>'space_id')::uuid;
  IF NOT COALESCE(payload->>'scope_kind' IN ('system','public','task_group','task_node','book','volume','chapter','scene','one_time')
   AND payload->>'binding_key' ~ '^[a-z][a-z0-9_.-]{1,99}$' AND length(btrim(payload->>'name')) BETWEEN 1 AND 160
   AND payload->>'status' IN ('active','archived') AND (payload->>'revision')::integer>0
   AND ((payload->>'scope_kind' IN ('system','public','task_group','task_node') AND owner_book IS NULL) OR (payload->>'scope_kind' IN ('book','volume','chapter','scene','one_time') AND owner_book IS NOT NULL))
   AND ((payload->>'scope_kind' IN ('system','task_group','task_node') AND owner_space IS NULL) OR (payload->>'scope_kind' IN ('public','book','volume','chapter','scene','one_time') AND owner_space IS NOT NULL))
   AND ((payload->>'scope_kind' IN ('system','public','book') AND payload->>'scope_ref' IS NULL) OR (payload->>'scope_kind' NOT IN ('system','public','book') AND length(btrim(payload->>'scope_ref'))>0)),false) THEN RAISE EXCEPTION 'context binding scope shape mismatch' USING ERRCODE='23514'; END IF;
  IF owner_book IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=owner_book AND space_id=owner_space) THEN RAISE EXCEPTION 'context binding book/space mismatch' USING ERRCODE='23514'; END IF;
  IF payload->>'scope_kind'='public' AND (NOT EXISTS(SELECT 1 FROM card_spaces WHERE id=owner_space) OR EXISTS(SELECT 1 FROM books WHERE space_id=owner_space)) THEN RAISE EXCEPTION 'public binding must use a public space' USING ERRCODE='23514'; END IF;
  IF payload->>'scope_kind' IN ('volume','chapter','scene') AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id WHERE c.id=(payload->>'scope_ref')::uuid AND c.space_id=owner_space AND t.type_key=payload->>'scope_kind' AND NOT t.is_internal) THEN RAISE EXCEPTION 'context binding local scope mismatch' USING ERRCODE='23514'; END IF;
  FOREACH field_name IN ARRAY ARRAY['current_version_id','adopted_version_id'] LOOP
   IF payload->>field_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>field_name AND v.values->>'binding_id'=payload->>'id') THEN RAISE EXCEPTION 'context binding head/version mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF previous IS NOT NULL THEN
   IF (payload-ARRAY['name','description','status','revision','current_version_id','adopted_version_id','updated_by','updated_at']) IS DISTINCT FROM (previous-ARRAY['name','description','status','revision','current_version_id','adopted_version_id','updated_by','updated_at'])
    OR previous->>'status'='archived'
    OR NOT ((payload->>'revision')::integer=(previous->>'revision')::integer+1 OR
     (previous->>'current_version_id' IS NULL AND previous->>'adopted_version_id' IS NULL AND payload->>'revision'=previous->>'revision'))
    THEN RAISE EXCEPTION 'context binding identity/revision is immutable' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF kind='context_binding_version' THEN
  SELECT v.values INTO binding FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding' AND v.values->>'id'=payload->>'binding_id';
  SELECT * INTO stats FROM context_activation_rule_stats(payload->'activation_rule');
  IF binding IS NULL OR NOT COALESCE(stats.is_valid AND stats.max_depth<=4 AND stats.condition_count<=40
   AND (payload->>'version')::integer>0 AND payload->>'inheritance_mode' IN ('inherit','override','exclude')
   AND payload->>'slot_key' ~ '^[a-z][a-z0-9_.-]{1,99}$' AND (payload->>'priority')::integer BETWEEN -10000 AND 10000
   AND payload->>'content_role' IN ('required','reference') AND (payload->>'token_budget')::integer BETWEEN 0 AND 1000000
   AND payload->>'trim_strategy' IN ('none','lowest_priority','largest_first') AND payload->>'dedupe_strategy' IN ('exact_version','stable_source')
   AND payload->>'status' IN ('draft','adopted','superseded','archived') AND payload->>'content_hash' ~ '^[a-f0-9]{64}$'
   AND (payload->>'content_role'='reference' OR payload->>'trim_strategy'='none'),false) THEN RAISE EXCEPTION 'invalid context binding version or activation rule' USING ERRCODE='23514'; END IF;
  IF payload->>'base_version_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>'base_version_id' AND v.values->>'binding_id'=payload->>'binding_id' AND v.values->>'id'<>payload->>'id') THEN RAISE EXCEPTION 'context version base belongs to another binding' USING ERRCODE='23514'; END IF;
 ELSIF kind='context_binding_selector' THEN
  PERFORM validate_context_selector_config(payload);
  SELECT v.values INTO version_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>'binding_version_id';
  SELECT v.values INTO binding FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding' AND v.values->>'id'=version_value->>'binding_id';
  IF binding IS NULL OR NOT COALESCE((payload->>'sort_order')::integer>=0,false) THEN RAISE EXCEPTION 'selector owner/order unavailable' USING ERRCODE='23514'; END IF;
  IF payload->>'selector_kind' IN ('explicit_source','prompt_component') THEN PERFORM validate_context_exact_source(payload->>'source_type',(payload->>'stable_object_id')::uuid,(payload->>'exact_version_id')::uuid,(binding->>'book_id')::uuid); END IF;
  IF payload->'selector_config' ? 'limit' AND NOT COALESCE(jsonb_typeof(payload->'selector_config'->'limit')='number' AND (payload->'selector_config'->>'limit')::integer BETWEEN 1 AND 500,false) THEN RAISE EXCEPTION 'selector limit out of range' USING ERRCODE='23514'; END IF;
  IF payload->>'selector_kind'='retrieval_trace' AND NOT EXISTS(SELECT 1 FROM retrieval_runs WHERE id=(payload->'selector_config'->>'retrievalRunId')::uuid AND book_id=(binding->>'book_id')::uuid AND status='succeeded') THEN RAISE EXCEPTION 'retrieval selector requires genuine same-book result' USING ERRCODE='23514'; END IF;
  IF payload->>'selector_kind'='relation' AND NOT EXISTS(SELECT 1 FROM relation_types WHERE id=(payload->'selector_config'->>'relationTypeId')::uuid AND (owner_space_id IS NULL OR owner_space_id=(binding->>'space_id')::uuid)) THEN RAISE EXCEPTION 'relation selector scope mismatch' USING ERRCODE='23514'; END IF;
  IF payload->>'selector_kind'='story_range' AND NOT COALESCE(jsonb_typeof(payload->'selector_config'->'start')='number' AND jsonb_typeof(payload->'selector_config'->'end')='number' AND (payload->'selector_config'->>'start')::numeric<=(payload->'selector_config'->>'end')::numeric,false) THEN RAISE EXCEPTION 'story range selector bounds mismatch' USING ERRCODE='23514'; END IF;
 ELSIF kind='context_binding_adoption' THEN
  SELECT v.values INTO binding FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding' AND v.values->>'id'=payload->>'binding_id';
  IF binding IS NULL OR NOT COALESCE(payload->>'action' IN ('adopt','readopt','rollback','archive')
   AND (payload->>'binding_revision')::integer>0 AND (payload->>'expected_revision')::integer>0
   AND payload->>'binding_revision'=binding->>'revision'
   AND ((payload->>'action'='archive' AND payload->>'to_version_id' IS NULL AND binding->>'status'='archived')
    OR (payload->>'action'<>'archive' AND payload->>'to_version_id'=binding->>'adopted_version_id')),false) THEN RAISE EXCEPTION 'binding adoption must describe explicit original head transition' USING ERRCODE='23514'; END IF;
  FOREACH field_name IN ARRAY ARRAY['from_version_id','to_version_id'] LOOP
   IF payload->>field_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>field_name AND v.values->>'binding_id'=payload->>'binding_id') THEN RAISE EXCEPTION 'binding adoption exact version mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSIF kind='context_preview' THEN
  IF NOT EXISTS(SELECT 1 FROM books b JOIN task_contract_versions contract ON contract.id=(payload->>'task_contract_version_id')::uuid
   JOIN prompt_recipe_versions recipe ON recipe.id=contract.prompt_recipe_version_id
   WHERE b.id=(payload->>'book_id')::uuid AND recipe.id=(payload->>'prompt_recipe_version_id')::uuid AND contract.task_group=payload->>'task_group')
   OR NOT COALESCE(payload->>'status' IN ('complete','invalid','stale','timed_out') AND (payload->>'total_budget')::integer BETWEEN 1 AND 1000000
    AND (payload->>'timeout_ms')::integer BETWEEN 100 AND 10000 AND payload->>'source_set_hash' ~ '^[a-f0-9]{64}$'
    AND ((payload->>'status'='stale')=(payload->>'stale_at' IS NOT NULL)),false) THEN RAISE EXCEPTION 'context preview contract or budget mismatch' USING ERRCODE='23514'; END IF;
 ELSIF kind IN ('context_preview_binding_version','context_preview_decision') THEN
  SELECT v.values INTO preview FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_preview' AND v.values->>'id'=payload->>'preview_id';
  IF preview IS NULL THEN RAISE EXCEPTION 'context decision preview missing' USING ERRCODE='23514'; END IF;
  IF payload->>'binding_version_id' IS NOT NULL THEN
   SELECT v.values INTO version_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>'binding_version_id';
   SELECT v.values INTO binding FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding' AND v.values->>'id'=version_value->>'binding_id';
   IF binding IS NULL OR (binding->>'book_id' IS NOT NULL AND binding->>'book_id' IS DISTINCT FROM preview->>'book_id')
    OR (kind='context_preview_binding_version' AND (payload->>'binding_id' IS DISTINCT FROM binding->>'id' OR payload->>'inheritance_mode' IS DISTINCT FROM version_value->>'inheritance_mode')) THEN RAISE EXCEPTION 'context preview binding source mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF kind='context_preview_decision' THEN
   IF NOT COALESCE(payload->>'decision' IN ('included','excluded','deduped','trimmed') AND payload->>'source_hash' ~ '^[a-f0-9]{64}$'
    AND (payload->>'source_revision')::integer>0 AND (payload->>'token_estimate')::integer>=0 AND (payload->>'sort_order')::integer>=0,false) THEN RAISE EXCEPTION 'invalid context source decision' USING ERRCODE='23514'; END IF;
   IF payload->>'decision'='included' THEN PERFORM validate_context_exact_source(payload->>'source_type',(payload->>'stable_object_id')::uuid,(payload->>'exact_version_id')::uuid,(preview->>'book_id')::uuid,payload->>'source_hash'); END IF;
   IF payload->>'retrieval_run_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM retrieval_runs r JOIN retrieval_results result ON result.run_id=r.id WHERE r.id=(payload->>'retrieval_run_id')::uuid AND r.book_id=(preview->>'book_id')::uuid AND result.rank=(payload->>'retrieval_rank')::integer AND result.source_stable_id=(payload->>'stable_object_id')::uuid AND result.source_version_id=(payload->>'exact_version_id')::uuid AND result.source_hash::text=payload->>'source_hash') THEN RAISE EXCEPTION 'context decision retrieval evidence mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF kind IN ('context_manifest_slot','context_manifest_exclusion','context_manifest_retrieval_trace') THEN
  SELECT * INTO manifest FROM context_manifests WHERE id=(payload->>'manifest_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'context child manifest missing' USING ERRCODE='23514'; END IF;
  IF kind='context_manifest_slot' AND NOT COALESCE(length(payload->>'slot_key')>0 AND (payload->>'sort_order')::integer>=0 AND jsonb_typeof(payload->'required')='boolean' AND (payload->>'token_budget' IS NULL OR (payload->>'token_budget')::integer>=0),false) THEN RAISE EXCEPTION 'context slot shape mismatch' USING ERRCODE='23514'; END IF;
  IF kind='context_manifest_exclusion' AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_manifest_slot' AND v.values->>'id'=payload->>'slot_id' AND v.values->>'manifest_id'=payload->>'manifest_id') THEN RAISE EXCEPTION 'context exclusion slot mismatch' USING ERRCODE='23514'; END IF;
  IF kind='context_manifest_retrieval_trace' AND NOT EXISTS(SELECT 1 FROM retrieval_runs r WHERE r.id=(payload->>'retrieval_run_id')::uuid AND r.book_id=manifest.book_id AND r.generation_id=(payload->>'generation_id')::uuid AND r.profile_version_id=(payload->>'profile_version_id')::uuid AND r.result_count=(payload->>'returned_source_count')::integer AND dependency_content_hash(r.query_hash||r.id::text||r.result_count::text)=payload->>'trace_hash') THEN RAISE EXCEPTION 'context retrieval trace is not exact' USING ERRCODE='23514'; END IF;
 ELSIF kind='ai_run_preview' THEN
  SELECT v.values INTO preview FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_preview' AND v.values->>'id'=payload->>'context_preview_id';
  IF preview IS NULL OR NOT EXISTS(SELECT 1 FROM books b JOIN context_manifests m ON m.book_id=b.id JOIN model_route_snapshots r ON r.id=m.model_route_snapshot_id
   WHERE b.id=(payload->>'book_id')::uuid AND b.space_id=(payload->>'space_id')::uuid AND m.id=(payload->>'context_manifest_id')::uuid
   AND r.id=(payload->>'model_route_snapshot_id')::uuid AND m.task_contract_version_id=(payload->>'task_contract_version_id')::uuid
   AND m.prompt_recipe_version_id=(payload->>'prompt_recipe_version_id')::uuid AND preview->>'book_id'=b.id::text
   AND preview->>'task_contract_version_id'=payload->>'task_contract_version_id' AND preview->>'prompt_recipe_version_id'=payload->>'prompt_recipe_version_id')
   THEN RAISE EXCEPTION 'run preview frozen context/model mismatch' USING ERRCODE='23514'; END IF;
 ELSIF kind IN ('ai_run_prompt_section','ai_run_submission') THEN
  SELECT v.values INTO preview FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='ai_run_preview' AND v.values->>'id'=payload->>'preview_id';
  IF preview IS NULL THEN RAISE EXCEPTION 'run evidence preview missing' USING ERRCODE='23514'; END IF;
  IF kind='ai_run_prompt_section' AND NOT COALESCE(payload->>'section_kind' IN ('instruction','formal_data','reference','output_contract') AND jsonb_typeof(payload->'source_refs')='array' AND payload->>'content_hash' ~ '^[a-f0-9]{64}$' AND (payload->>'token_estimate')::integer>=0 AND (payload->>'sort_order')::integer>=0,false) THEN RAISE EXCEPTION 'run section shape mismatch' USING ERRCODE='23514'; END IF;
  IF kind='ai_run_prompt_section' THEN
   FOR item IN SELECT * FROM jsonb_array_elements(payload->'source_refs') LOOP
    IF item->>'kind'='output_contract' THEN
     IF NOT EXISTS(SELECT 1 FROM task_contract_versions WHERE id=(preview->>'task_contract_version_id')::uuid AND output_schema_version=item->>'version' AND output_schema=item->'schema') THEN RAISE EXCEPTION 'run output contract section mismatch' USING ERRCODE='23514'; END IF;
    ELSIF item->>'kind'='prompt_component' AND item ? 'cardId' THEN
     IF NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
      WHERE t.type_key='prompt_recipe_slot_component' AND v.values->>'recipe_version_id'=preview->>'prompt_recipe_version_id'
      AND v.values->>'component_card_id'=item->>'cardId' AND v.values->>'component_version_id'=item->>'versionId') THEN RAISE EXCEPTION 'run prompt section exact component missing' USING ERRCODE='23514'; END IF;
    ELSE
     IF NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
      WHERE t.type_key='context_preview_decision' AND v.values->>'preview_id'=preview->>'context_preview_id' AND v.values->>'decision'='included'
       AND v.values->>'source_type'=item->>'kind' AND v.values->>'stable_object_id'=item->>'stableObjectId'
       AND v.values->>'exact_version_id'=item->>'exactVersionId' AND v.values->>'slot_key'=payload->>'slot_key')
      THEN RAISE EXCEPTION 'run data section differs from original context decision' USING ERRCODE='23514'; END IF;
    END IF;
   END LOOP;
  END IF;
  IF kind='ai_run_submission' THEN
   IF NOT EXISTS(SELECT 1 FROM ai_tasks task WHERE task.id=(payload->>'ai_task_id')::uuid AND task.book_id=(preview->>'book_id')::uuid AND task.space_id=(preview->>'space_id')::uuid AND task.task_contract_version_id=(preview->>'task_contract_version_id')::uuid)
    OR NOT COALESCE((payload->>'submitted_revision')::integer>0,false) THEN RAISE EXCEPTION 'run submission exact task mismatch' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE c.id<>NEW.id AND t.type_key=kind AND (v.values->>'ai_task_id'=payload->>'ai_task_id' OR v.values->>'idempotency_key'=payload->>'idempotency_key')) THEN RAISE EXCEPTION 'run submission identity reused' USING ERRCODE='23505'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_context_record_guard AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_context_record();

CREATE OR REPLACE FUNCTION new_design.validate_native_context_item() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE manifest record; slot jsonb; decision jsonb;
BEGIN
 SELECT * INTO manifest FROM context_manifests WHERE id=NEW.manifest_id;
 SELECT v.values INTO slot FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_manifest_slot' AND v.values->>'id'=NEW.slot_id::text;
 IF manifest.id IS NULL OR slot IS NULL OR slot->>'manifest_id' IS DISTINCT FROM NEW.manifest_id::text THEN RAISE EXCEPTION 'manifest item slot scope mismatch' USING ERRCODE='23514'; END IF;
 PERFORM validate_context_exact_source(NEW.source_type,NEW.stable_object_id,NEW.exact_version_id,manifest.book_id,
  CASE WHEN NEW.source_type IN ('body_version','text_anchor','planning_version','canonical_fact','research_version','research_document_version','asset_version','entity_initial_state') THEN NEW.content_hash::text ELSE NULL END);
 IF manifest.book_id IS NULL AND (NEW.source_type<>'card_version' OR NEW.stable_object_id IS DISTINCT FROM COALESCE(manifest.public_character_scope,manifest.public_title_scope)) THEN RAISE EXCEPTION 'public manifest item outside original source' USING ERRCODE='23514'; END IF;
 IF NEW.preview_decision_id IS NOT NULL THEN
  SELECT v.values INTO decision FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_preview_decision' AND v.values->>'id'=NEW.preview_decision_id::text;
  IF decision IS NULL OR decision->>'preview_id' IS DISTINCT FROM manifest.preview_id::text OR decision->>'decision'<>'included'
   OR decision->>'source_type' IS DISTINCT FROM NEW.source_type OR decision->>'stable_object_id' IS DISTINCT FROM NEW.stable_object_id::text
   OR decision->>'exact_version_id' IS DISTINCT FROM NEW.exact_version_id::text OR decision->>'source_hash' IS DISTINCT FROM NEW.content_hash::text
   OR decision->>'binding_version_id' IS DISTINCT FROM NEW.binding_version_id::text OR decision->>'slot_key' IS DISTINCT FROM slot->>'slot_key'
   OR decision->>'content_role' IS DISTINCT FROM NEW.content_role THEN RAISE EXCEPTION 'manifest item differs from frozen decision' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.binding_version_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
  JOIN cards bc ON true JOIN card_types bt ON bt.id=bc.card_type_id JOIN card_versions bv ON bv.id=bc.current_version_id
  WHERE t.type_key='context_binding_version' AND v.values->>'id'=NEW.binding_version_id::text AND bt.type_key='context_binding'
   AND bv.values->>'id'=v.values->>'binding_id' AND (bv.values->>'book_id' IS NULL OR bv.values->>'book_id'=manifest.book_id::text))
  THEN RAISE EXCEPTION 'manifest binding version scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_context_item_scope BEFORE INSERT ON new_design.context_manifest_items FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_context_item();

CREATE OR REPLACE FUNCTION new_design.guard_native_professional_action() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE receipt_row record; resource_kind text; resource_id jsonb;
BEGIN
 IF NEW.action_key<>'professional.resource.command' THEN RETURN NEW; END IF;
 SELECT * INTO receipt_row FROM jsonb_to_record(NEW.payload) fields(request_key text,input_hash text,operation text,resource_card_id uuid,resource_version_id uuid,book_id uuid,preview_id uuid,issue_id uuid,preference boolean,feedback_effect text,feedback_note text);
 IF NOT COALESCE(length(receipt_row.request_key) BETWEEN 8 AND 160 AND receipt_row.input_hash ~ '^[a-f0-9]{64}$'
  AND receipt_row.operation IN ('create','edit','archive','favorite','adopt_title','install','rule_settings','feedback')
  AND NEW.request_key='professional-resource:'||receipt_row.request_key AND NEW.input_hash=receipt_row.input_hash
  AND NEW.receipt->>'requestKey'=receipt_row.request_key AND NEW.receipt->>'operation'=receipt_row.operation
  AND jsonb_typeof(NEW.receipt->'resourceIds')='array',false) THEN RAISE EXCEPTION 'professional action receipt identity mismatch' USING ERRCODE='23514'; END IF;
 IF receipt_row.resource_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_versions WHERE id=receipt_row.resource_version_id AND card_id=receipt_row.resource_card_id) THEN RAISE EXCEPTION 'professional exact resource version mismatch' USING ERRCODE='23514'; END IF;
 IF receipt_row.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=receipt_row.book_id) THEN RAISE EXCEPTION 'professional target book missing' USING ERRCODE='23514'; END IF;
 FOR resource_id IN SELECT * FROM jsonb_array_elements(NEW.receipt->'resourceIds') LOOP
  SELECT t.type_key INTO resource_kind FROM cards c JOIN card_types t ON t.id=c.card_type_id WHERE c.id=(resource_id#>>'{}')::uuid AND c.space_id='60000000-0000-4000-8000-000000000001' AND NOT t.is_internal;
  IF resource_kind IS NULL OR resource_kind NOT IN ('title_candidate','writing_config','quality_rule','genre_strategy','progression_mode','character') THEN RAISE EXCEPTION 'professional original public resource missing' USING ERRCODE='23514'; END IF;
  IF resource_kind='character' AND (receipt_row.operation NOT IN ('create','edit','archive','favorite') OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_character_profile_v1' AND installed AND operational)) THEN RAISE EXCEPTION 'public character profile command unavailable' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NOT (NEW.receipt->'resourceIds' @> jsonb_build_array(NEW.card_id::text)) OR (receipt_row.resource_card_id IS NOT NULL AND NOT NEW.receipt->'resourceIds' @> jsonb_build_array(receipt_row.resource_card_id::text)) THEN RAISE EXCEPTION 'professional action owner/source mismatch' USING ERRCODE='23514'; END IF;
 IF receipt_row.operation='favorite' AND (receipt_row.resource_card_id IS NULL OR receipt_row.preference IS NULL) THEN RAISE EXCEPTION 'favorite requires explicit preference' USING ERRCODE='23514'; END IF;
 IF receipt_row.operation='feedback' THEN
  IF receipt_row.resource_card_id IS NULL OR receipt_row.resource_version_id IS NULL OR (receipt_row.preview_id IS NULL)=(receipt_row.issue_id IS NULL)
   OR NOT COALESCE(receipt_row.feedback_effect IN ('helpful','neutral','harmful') AND length(receipt_row.feedback_note) BETWEEN 1 AND 2000,false) THEN RAISE EXCEPTION 'feedback requires exact source and one genuine outcome' USING ERRCODE='23514'; END IF;
  IF receipt_row.issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='quality_issue' AND v.values->>'id'=receipt_row.issue_id::text) THEN RAISE EXCEPTION 'feedback issue missing' USING ERRCODE='23514'; END IF;
  IF receipt_row.preview_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   JOIN cards sc ON true JOIN card_types st ON st.id=sc.card_type_id JOIN card_versions sv ON sv.id=sc.current_version_id
   JOIN ai_tasks task ON task.id=(sv.values->>'ai_task_id')::uuid JOIN ai_task_steps step ON step.task_id=task.id AND step.step_key='execute_prompt_composition_debug'
   JOIN ai_task_attempts attempt ON attempt.id=step.current_attempt_id AND attempt.status='succeeded' AND attempt.debug_result IS NOT NULL
   WHERE t.type_key='ai_run_preview' AND v.values->>'id'=receipt_row.preview_id::text AND v.values->>'source_kind'='prompt_composition_debug'
    AND st.type_key='ai_run_submission' AND sv.values->>'preview_id'=v.values->>'id')
   THEN RAISE EXCEPTION 'feedback requires saved original successful debug result' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_professional_action_source BEFORE INSERT ON new_design.card_version_actions FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_professional_action();

CREATE OR REPLACE FUNCTION new_design.guard_native_context_delete() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM card_types WHERE id=OLD.card_type_id AND type_key IN ('context_binding','context_binding_version','context_binding_selector','context_binding_adoption','context_preview','context_preview_binding_version','context_preview_decision','context_management_event','context_manifest_slot','context_manifest_exclusion','context_manifest_retrieval_trace','ai_run_preview','ai_run_prompt_section','ai_run_submission')) THEN RAISE EXCEPTION 'context history cannot be deleted' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER native_context_no_delete BEFORE DELETE ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_context_delete();

-- End native context guards.
