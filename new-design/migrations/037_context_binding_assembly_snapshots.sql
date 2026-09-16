SET search_path TO new_design, public;

CREATE TABLE context_bindings (
  id uuid PRIMARY KEY,
  space_id uuid REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  binding_key text NOT NULL CHECK(binding_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  scope_kind text NOT NULL CHECK(scope_kind IN ('system','public','task_group','task_node','book','volume','chapter','scene','one_time')),
  scope_ref text,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  adopted_version_id uuid,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((scope_kind IN ('system','public','task_group','task_node') AND book_id IS NULL) OR (scope_kind IN ('book','volume','chapter','scene','one_time') AND book_id IS NOT NULL)),
  CHECK((scope_kind IN ('public','book','volume','chapter','scene','one_time') AND space_id IS NOT NULL) OR (scope_kind IN ('system','task_group','task_node') AND space_id IS NULL)),
  CHECK((scope_kind IN ('system','public','book') AND scope_ref IS NULL) OR (scope_kind NOT IN ('system','public','book') AND length(btrim(scope_ref))>0)),
  UNIQUE NULLS NOT DISTINCT(scope_kind,scope_ref,book_id,binding_key)
);

CREATE TABLE context_binding_versions (
  id uuid PRIMARY KEY,
  binding_id uuid NOT NULL REFERENCES context_bindings(id),
  version integer NOT NULL CHECK(version>0),
  base_version_id uuid,
  inheritance_mode text NOT NULL CHECK(inheritance_mode IN ('inherit','override','exclude')),
  activation_rule jsonb NOT NULL DEFAULT '{"kind":"group","operator":"and","items":[]}'::jsonb CHECK(jsonb_typeof(activation_rule)='object'),
  slot_key text NOT NULL CHECK(slot_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  priority integer NOT NULL CHECK(priority BETWEEN -10000 AND 10000),
  content_role text NOT NULL CHECK(content_role IN ('required','reference')),
  token_budget integer NOT NULL CHECK(token_budget BETWEEN 0 AND 1000000),
  trim_strategy text NOT NULL CHECK(trim_strategy IN ('none','lowest_priority','largest_first')),
  dedupe_strategy text NOT NULL CHECK(dedupe_strategy IN ('exact_version','stable_source')),
  status text NOT NULL CHECK(status IN ('draft','adopted','superseded','archived')),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(binding_id,version),
  UNIQUE(id,binding_id),
  FOREIGN KEY(base_version_id,binding_id) REFERENCES context_binding_versions(id,binding_id),
  CHECK(content_role='reference' OR trim_strategy='none')
);
ALTER TABLE context_bindings ADD CONSTRAINT context_bindings_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES context_binding_versions(id,binding_id);
ALTER TABLE context_bindings ADD CONSTRAINT context_bindings_adopted_version_fk FOREIGN KEY(adopted_version_id,id) REFERENCES context_binding_versions(id,binding_id);

CREATE TABLE context_binding_selectors (
  id uuid PRIMARY KEY,
  binding_version_id uuid NOT NULL REFERENCES context_binding_versions(id),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  selector_kind text NOT NULL CHECK(selector_kind IN ('explicit_source','card_type','tag','smart_view','relation','story_range','research_pack','prompt_component','retrieval_trace')),
  source_type text NOT NULL CHECK(source_type IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version','prompt_component','retrieval_chunk')),
  stable_object_id uuid,
  exact_version_id uuid,
  selector_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(selector_config)='object'),
  UNIQUE(binding_version_id,sort_order)
);

CREATE TABLE context_binding_adoptions (
  id uuid PRIMARY KEY,
  binding_id uuid NOT NULL REFERENCES context_bindings(id),
  from_version_id uuid,
  to_version_id uuid,
  action text NOT NULL CHECK(action IN ('adopt','readopt','rollback','archive')),
  binding_revision integer NOT NULL CHECK(binding_revision>0),
  expected_revision integer NOT NULL CHECK(expected_revision>0),
  idempotency_key text NOT NULL,
  actor text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(binding_id,idempotency_key),
  CHECK((action='archive' AND to_version_id IS NULL) OR (action<>'archive' AND to_version_id IS NOT NULL))
);
ALTER TABLE context_binding_adoptions ADD CONSTRAINT context_binding_adoptions_from_version_fk FOREIGN KEY(from_version_id,binding_id) REFERENCES context_binding_versions(id,binding_id);
ALTER TABLE context_binding_adoptions ADD CONSTRAINT context_binding_adoptions_to_version_fk FOREIGN KEY(to_version_id,binding_id) REFERENCES context_binding_versions(id,binding_id);

CREATE TABLE context_previews (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  prompt_recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id),
  volume_id uuid,
  chapter_id uuid,
  scene_id uuid,
  task_node_key text NOT NULL,
  task_group text NOT NULL,
  one_time_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(one_time_overrides)='object'),
  status text NOT NULL CHECK(status IN ('complete','invalid','stale','timed_out')),
  total_budget integer NOT NULL CHECK(total_budget BETWEEN 1 AND 1000000),
  required_tokens integer NOT NULL DEFAULT 0 CHECK(required_tokens>=0),
  reference_tokens integer NOT NULL DEFAULT 0 CHECK(reference_tokens>=0),
  included_tokens integer NOT NULL DEFAULT 0 CHECK(included_tokens>=0),
  remaining_tokens integer NOT NULL DEFAULT 0,
  candidate_count integer NOT NULL DEFAULT 0 CHECK(candidate_count>=0),
  included_count integer NOT NULL DEFAULT 0 CHECK(included_count>=0),
  decision_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(decision_summary)='object'),
  source_set_hash char(64) NOT NULL CHECK(source_set_hash ~ '^[a-f0-9]{64}$'),
  timeout_ms integer NOT NULL CHECK(timeout_ms BETWEEN 100 AND 10000),
  stale_at timestamptz,
  stale_reason text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='stale')=(stale_at IS NOT NULL))
);

CREATE TABLE context_preview_binding_versions (
  preview_id uuid NOT NULL REFERENCES context_previews(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL REFERENCES context_bindings(id),
  binding_version_id uuid NOT NULL REFERENCES context_binding_versions(id),
  layer_rank integer NOT NULL CHECK(layer_rank BETWEEN 1 AND 100),
  layer_label text NOT NULL,
  inheritance_mode text NOT NULL CHECK(inheritance_mode IN ('inherit','override','exclude')),
  PRIMARY KEY(preview_id,binding_version_id)
);
ALTER TABLE context_preview_binding_versions ADD CONSTRAINT context_preview_binding_version_owner_fk FOREIGN KEY(binding_version_id,binding_id) REFERENCES context_binding_versions(id,binding_id);

CREATE TABLE context_preview_decisions (
  id uuid PRIMARY KEY,
  preview_id uuid NOT NULL REFERENCES context_previews(id) ON DELETE CASCADE,
  binding_version_id uuid REFERENCES context_binding_versions(id),
  slot_key text NOT NULL,
  source_type text NOT NULL CHECK(source_type IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version','prompt_component','retrieval_chunk')),
  stable_object_id uuid NOT NULL,
  exact_version_id uuid NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  source_label text NOT NULL,
  content_role text NOT NULL CHECK(content_role IN ('required','reference')),
  priority integer NOT NULL,
  token_estimate integer NOT NULL CHECK(token_estimate>=0),
  decision text NOT NULL CHECK(decision IN ('included','excluded','deduped','trimmed')),
  reason_code text NOT NULL CHECK(reason_code IN ('rule_match','manual_include','rule_inactive','scope_excluded','duplicate','binding_budget','total_budget','required_over_budget','source_unavailable','source_stale')),
  reason_detail text NOT NULL,
  layer_rank integer NOT NULL CHECK(layer_rank BETWEEN 1 AND 100),
  layer_label text NOT NULL,
  retrieval_run_id uuid REFERENCES semantic_retrieval_runs(id),
  retrieval_rank integer CHECK(retrieval_rank IS NULL OR retrieval_rank>0),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  UNIQUE(preview_id,sort_order)
);

CREATE TABLE context_binding_conflicts (
  id uuid PRIMARY KEY,
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  binding_id uuid REFERENCES context_bindings(id),
  conflict_kind text NOT NULL CHECK(conflict_kind IN ('revision','scope','required_budget','source_ownership','rule_invalid')),
  local_revision integer,
  server_revision integer,
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE context_management_events (
  id uuid PRIMARY KEY,
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  subject_kind text NOT NULL CHECK(subject_kind IN ('binding','binding_version','preview','manifest')),
  subject_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('create','revise','adopt','rollback','archive','preview','finalize','mark_stale')),
  expected_revision integer,
  result_version_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  idempotency_key text NOT NULL,
  actor text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_kind,subject_id,idempotency_key)
);

CREATE FUNCTION context_activation_rule_stats(node jsonb,depth integer DEFAULT 1)
RETURNS TABLE(max_depth integer,condition_count integer,is_valid boolean) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE child jsonb; child_stats record; field_name text; operator_name text;
BEGIN
  IF jsonb_typeof(node)<>'object' OR depth>4 THEN RETURN QUERY SELECT depth,0,false; RETURN; END IF;
  IF node->>'kind'='condition' THEN
    field_name:=node->>'field'; operator_name:=node->>'operator';
    RETURN QUERY SELECT depth,1,
      field_name=ANY(ARRAY['task_key','task_group','content_type','tag','material_status','canonical_status','volume','chapter','scene','story_range','relation_exists','association_exists','source_type','stale','manual_switch'])
      AND operator_name=ANY(ARRAY['equals','not_equals','in','not_in','contains','exists','not_exists','gte','lte','between','enabled'])
      AND (node-ARRAY['kind','field','operator','value']::text[])='{}'::jsonb
      AND (NOT (node ? 'value') OR jsonb_typeof(node->'value') IN ('string','number','boolean','array','null'))
      AND (NOT (node ? 'value') OR jsonb_typeof(node->'value')<>'array' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(node->'value') AS array_item(value) WHERE jsonb_typeof(value) NOT IN ('string','number')));
    RETURN;
  END IF;
  IF node->>'kind'<>'group' OR NOT (node->>'operator'=ANY(ARRAY['and','or'])) OR (node-ARRAY['kind','operator','items']::text[])<>'{}'::jsonb OR jsonb_typeof(node->'items')<>'array' OR jsonb_array_length(node->'items')>20 THEN
    RETURN QUERY SELECT depth,0,false; RETURN;
  END IF;
  max_depth:=depth; condition_count:=0; is_valid:=true;
  FOR child IN SELECT value FROM jsonb_array_elements(node->'items') LOOP
    SELECT * INTO child_stats FROM context_activation_rule_stats(child,depth+1);
    max_depth:=greatest(max_depth,child_stats.max_depth); condition_count:=condition_count+child_stats.condition_count; is_valid:=is_valid AND child_stats.is_valid;
  END LOOP;
  is_valid:=is_valid AND condition_count<=40;
  RETURN NEXT;
END $$;

CREATE FUNCTION guard_context_binding_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stats record;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'context binding versions are immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO stats FROM context_activation_rule_stats(NEW.activation_rule);
  IF NOT stats.is_valid OR stats.max_depth>4 OR stats.condition_count>40 THEN RAISE EXCEPTION 'activation rule exceeds the safe typed rule contract' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER context_binding_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON context_binding_versions FOR EACH ROW EXECUTE FUNCTION guard_context_binding_version();

CREATE FUNCTION guard_context_selector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'context binding selectors are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind IN ('explicit_source','prompt_component') AND (NEW.stable_object_id IS NULL OR NEW.exact_version_id IS NULL) THEN RAISE EXCEPTION 'explicit selector requires an exact source version' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind NOT IN ('explicit_source','prompt_component') AND (NEW.stable_object_id IS NOT NULL OR NEW.exact_version_id IS NOT NULL) THEN RAISE EXCEPTION 'dynamic selector cannot pin an unrelated source identity' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='explicit_source' AND NEW.source_type NOT IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version') THEN RAISE EXCEPTION 'unsupported explicit source type' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='prompt_component' AND NEW.source_type<>'prompt_component' THEN RAISE EXCEPTION 'prompt component selector requires prompt_component source type' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind IN ('card_type','tag','smart_view','relation') AND NEW.source_type<>'card_version' THEN RAISE EXCEPTION 'card selector requires card_version source type' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='story_range' AND NEW.source_type NOT IN ('card_version','story_time') THEN RAISE EXCEPTION 'story range selector has an unsupported source type' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='research_pack' AND NEW.source_type NOT IN ('research_version','research_pack_version') THEN RAISE EXCEPTION 'research pack selector has an unsupported source type' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='retrieval_trace' AND NEW.source_type<>'retrieval_chunk' THEN RAISE EXCEPTION 'retrieval selector requires retrieval_chunk source type' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind IN ('explicit_source','prompt_component') AND NEW.selector_config<>'{}'::jsonb THEN RAISE EXCEPTION 'explicit selector config must be empty' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='card_type' AND (NOT (NEW.selector_config ? 'typeKey') OR (NEW.selector_config-ARRAY['typeKey']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'card type selector requires only typeKey' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='tag' AND (NOT (NEW.selector_config ? 'tagId') OR (NEW.selector_config-ARRAY['tagId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'tag selector requires only tagId' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='smart_view' AND (NOT (NEW.selector_config ? 'smartViewId') OR (NEW.selector_config-ARRAY['smartViewId','limit']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'smart view selector requires smartViewId and optional limit' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='relation' AND (NOT (NEW.selector_config ? 'relationTypeId') OR (NEW.selector_config-ARRAY['relationTypeId','anchorCardId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'relation selector requires relationTypeId and optional anchorCardId' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='story_range' AND (NOT (NEW.selector_config ?& ARRAY['start','end']) OR (NEW.selector_config-ARRAY['start','end']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'story range selector requires start and end' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='research_pack' AND (NOT (NEW.selector_config ? 'packVersionId') OR (NEW.selector_config-ARRAY['packVersionId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'research pack selector requires only packVersionId' USING ERRCODE='23514'; END IF;
  IF NEW.selector_kind='retrieval_trace' AND (NOT (NEW.selector_config ? 'retrievalRunId') OR (NEW.selector_config-ARRAY['retrievalRunId','limit']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'retrieval selector requires an existing trace and optional limit; fake retrieval is forbidden' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.selector_config) AS item(key_name) WHERE key_name ~* '(sql|jsonpath|cypher|javascript|script|prompt)') THEN RAISE EXCEPTION 'selector contains a forbidden executable expression' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER context_binding_selectors_guard BEFORE INSERT OR UPDATE OR DELETE ON context_binding_selectors FOR EACH ROW EXECUTE FUNCTION guard_context_selector();

CREATE FUNCTION guard_context_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'context history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER context_bindings_no_delete BEFORE DELETE ON context_bindings FOR EACH ROW EXECUTE FUNCTION guard_context_append_only();
CREATE TRIGGER context_binding_adoptions_immutable BEFORE UPDATE OR DELETE ON context_binding_adoptions FOR EACH ROW EXECUTE FUNCTION guard_context_append_only();
CREATE TRIGGER context_preview_decisions_immutable BEFORE UPDATE OR DELETE ON context_preview_decisions FOR EACH ROW EXECUTE FUNCTION guard_context_append_only();
CREATE TRIGGER context_preview_bindings_immutable BEFORE UPDATE OR DELETE ON context_preview_binding_versions FOR EACH ROW EXECUTE FUNCTION guard_context_append_only();
CREATE TRIGGER context_management_events_immutable BEFORE UPDATE OR DELETE ON context_management_events FOR EACH ROW EXECUTE FUNCTION guard_context_append_only();
CREATE UNIQUE INDEX context_management_events_idempotency_unique ON context_management_events(idempotency_key);

CREATE FUNCTION guard_context_preview() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'context previews are immutable; stale them instead' USING ERRCODE='23514'; END IF;
  IF OLD.status NOT IN ('complete','invalid') OR NEW.status<>'stale' OR NEW.stale_at IS NULL OR
     (to_jsonb(NEW)-ARRAY['status','stale_at','stale_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stale_at','stale_reason']::text[]) THEN
    RAISE EXCEPTION 'context preview may only transition to stale' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER context_previews_guard BEFORE UPDATE OR DELETE ON context_previews FOR EACH ROW EXECUTE FUNCTION guard_context_preview();

ALTER TABLE context_manifests DROP CONSTRAINT context_manifests_status_check;
ALTER TABLE context_manifests ADD CONSTRAINT context_manifests_status_check CHECK(status IN ('complete','invalid','finalized'));
ALTER TABLE context_manifests
  ADD COLUMN preview_id uuid REFERENCES context_previews(id),
  ADD COLUMN volume_id uuid,
  ADD COLUMN chapter_id uuid,
  ADD COLUMN scene_id uuid,
  ADD COLUMN task_group text,
  ADD COLUMN model_route_snapshot_id uuid REFERENCES model_route_snapshots(id),
  ADD COLUMN source_set_hash char(64),
  ADD COLUMN decision_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(decision_summary)='object'),
  ADD COLUMN finalized_at timestamptz;
ALTER TABLE context_manifests ADD CONSTRAINT context_manifests_finalized_shape CHECK(status<>'finalized' OR (preview_id IS NOT NULL AND model_route_snapshot_id IS NOT NULL AND source_set_hash IS NOT NULL AND finalized_at IS NOT NULL));

CREATE FUNCTION guard_finalized_context_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_manifest_id uuid; target_status text;
BEGIN
  IF TG_TABLE_NAME='context_manifests' THEN
    IF OLD.status='finalized' THEN RAISE EXCEPTION 'finalized context manifests are immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  target_manifest_id:=OLD.manifest_id;
  SELECT status INTO target_status FROM context_manifests WHERE id=target_manifest_id;
  IF target_status='finalized' THEN RAISE EXCEPTION 'finalized context manifest children are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER context_manifests_finalized_immutable BEFORE UPDATE OR DELETE ON context_manifests FOR EACH ROW EXECUTE FUNCTION guard_finalized_context_snapshot();
CREATE TRIGGER context_manifest_slots_finalized_immutable BEFORE UPDATE OR DELETE ON context_manifest_slots FOR EACH ROW EXECUTE FUNCTION guard_finalized_context_snapshot();
CREATE TRIGGER context_manifest_entries_finalized_immutable BEFORE UPDATE OR DELETE ON context_manifest_entries FOR EACH ROW EXECUTE FUNCTION guard_finalized_context_snapshot();
CREATE TRIGGER context_manifest_exclusions_finalized_immutable BEFORE UPDATE OR DELETE ON context_manifest_exclusions FOR EACH ROW EXECUTE FUNCTION guard_finalized_context_snapshot();

ALTER TABLE context_manifest_entries DROP CONSTRAINT context_manifest_entries_source_type_check;
ALTER TABLE context_manifest_entries ADD CONSTRAINT context_manifest_entries_source_type_check CHECK(source_type IN ('card_version','card_relation','body_version','text_anchor','planning_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','research_version','research_pack_version','prompt_component','retrieval_chunk'));
ALTER TABLE context_manifest_entries
  ADD COLUMN binding_version_id uuid REFERENCES context_binding_versions(id),
  ADD COLUMN preview_decision_id uuid REFERENCES context_preview_decisions(id),
  ADD COLUMN source_revision integer,
  ADD COLUMN content_role text CHECK(content_role IN ('required','reference')),
  ADD COLUMN layer_label text NOT NULL DEFAULT '';

CREATE TABLE context_manifest_retrieval_traces (
  manifest_id uuid NOT NULL REFERENCES context_manifests(id),
  retrieval_run_id uuid NOT NULL REFERENCES semantic_retrieval_runs(id),
  generation_id uuid NOT NULL REFERENCES embedding_index_generations(id),
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  returned_source_count integer NOT NULL CHECK(returned_source_count>=0),
  trace_hash char(64) NOT NULL CHECK(trace_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(manifest_id,retrieval_run_id)
);
CREATE TRIGGER context_manifest_retrieval_immutable BEFORE UPDATE OR DELETE ON context_manifest_retrieval_traces FOR EACH ROW EXECUTE FUNCTION guard_context_append_only();

ALTER TABLE dependency_resources DROP CONSTRAINT dependency_resources_resource_kind_check;
ALTER TABLE dependency_resources ADD CONSTRAINT dependency_resources_resource_kind_check CHECK(resource_kind IN (
  'card_type_version','template_group_version','card_version','card_relation','card_mount','tag_version','tag_membership','material_group_version','group_membership','smart_view_version',
  'research_document_version','research_record_version','research_reference_pack_version','chapter_body_version','chapter_text_anchor','canonical_fact','chapter_settlement','state_change','knowledge_state_change','story_event_timing','story_event_relation','planning_version',
  'prompt_recipe_version','task_contract_version','context_binding_version','context_preview','context_manifest','semantic_retrieval_run','model_route_snapshot','ai_task_attempt','quality_audit_report','asset_version','embedding_source_snapshot','embedding_chunk','embedding_result','embedding_index_generation'
));

ALTER FUNCTION resolve_dependency_resource(text,uuid,uuid) RENAME TO resolve_dependency_resource_pre037;
CREATE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF requested_kind='context_binding_version' THEN
    RETURN QUERY SELECT binding.space_id,binding.book_id,version.content_hash FROM context_bindings binding JOIN context_binding_versions version ON version.binding_id=binding.id WHERE binding.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='context_preview' THEN
    RETURN QUERY SELECT book.space_id,preview.book_id,preview.source_set_hash FROM context_previews preview JOIN books book ON book.id=preview.book_id WHERE preview.id=requested_stable_id AND preview.id=requested_version_id;
  ELSIF requested_kind='semantic_retrieval_run' THEN
    RETURN QUERY SELECT book.space_id,run.book_id,dependency_content_hash(run.query_hash||run.id::text||run.result_count::text) FROM semantic_retrieval_runs run JOIN books book ON book.id=run.book_id WHERE run.id=requested_stable_id AND run.id=requested_version_id;
  ELSE RETURN QUERY SELECT * FROM resolve_dependency_resource_pre037(requested_kind,requested_stable_id,requested_version_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION bridge_dependency_creation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_kind text; source_version uuid; source_stable uuid; derived_stable uuid;
BEGIN
  IF TG_TABLE_NAME='context_manifests' THEN
    SELECT recipe_id INTO source_stable FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
    PERFORM add_registered_dependency('prompt_recipe_version',source_stable,NEW.prompt_recipe_version_id,'context_manifest',NEW.id,NEW.id,'configured_by','hard','context_build',NEW.id);
    SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
    PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'context_manifest',NEW.id,NEW.id,'configured_by','hard','context_build',NEW.id);
  ELSIF TG_TABLE_NAME='context_manifest_entries' THEN
    SELECT id INTO derived_stable FROM context_manifests WHERE id=NEW.manifest_id;
    source_kind:=CASE NEW.source_type
      WHEN 'body_version' THEN 'chapter_body_version'
      WHEN 'text_anchor' THEN 'chapter_text_anchor'
      WHEN 'research_version' THEN 'research_record_version'
      WHEN 'research_pack_version' THEN 'research_reference_pack_version'
      WHEN 'story_time' THEN 'story_event_timing'
      WHEN 'prompt_component' THEN 'card_version'
      ELSE NEW.source_type
    END;
    source_version:=COALESCE(NEW.exact_version_id,NEW.stable_object_id);
    PERFORM add_registered_dependency(source_kind,NEW.stable_object_id,source_version,'context_manifest',derived_stable,derived_stable,'context_included','hard','context_build',NEW.manifest_id);
  ELSIF TG_TABLE_NAME='model_route_snapshots' THEN
    SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
    PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'model_route_snapshot',NEW.id,NEW.id,'configured_by','hard','system',NEW.id);
  ELSIF TG_TABLE_NAME='ai_task_attempts' AND NEW.status='succeeded' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
    PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','hard','ai_result',NEW.id);
    SELECT recipe_id INTO source_stable FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
    PERFORM add_registered_dependency('prompt_recipe_version',source_stable,NEW.prompt_recipe_version_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','hard','ai_result',NEW.id);
    PERFORM add_registered_dependency('context_manifest',NEW.context_manifest_id,NEW.context_manifest_id,'ai_task_attempt',NEW.task_id,NEW.id,'context_included','hard','ai_result',NEW.id);
    PERFORM add_registered_dependency('model_route_snapshot',NEW.model_route_snapshot_id,NEW.model_route_snapshot_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','soft','ai_result',NEW.id);
  ELSIF TG_TABLE_NAME='quality_audit_reports' THEN
    PERFORM add_registered_dependency('context_manifest',NEW.context_manifest_id,NEW.context_manifest_id,'quality_audit_report',NEW.id,NEW.id,'audited_from','hard','audit',NEW.id);
    PERFORM add_registered_dependency('ai_task_attempt',NEW.task_id,NEW.attempt_id,'quality_audit_report',NEW.id,NEW.id,'generated_from','hard','audit',NEW.id);
  ELSIF TG_TABLE_NAME='quality_report_body_versions' THEN
    PERFORM add_registered_dependency('chapter_body_version',NEW.chapter_document_id,NEW.body_version_id,'quality_audit_report',NEW.report_id,NEW.report_id,'audited_from','hard','audit',NEW.report_id);
  ELSIF TG_TABLE_NAME='quality_report_planning_versions' THEN
    PERFORM add_registered_dependency('planning_version',NEW.planning_object_id,NEW.planning_version_id,'quality_audit_report',NEW.report_id,NEW.report_id,'audited_from','hard','audit',NEW.report_id);
  ELSIF TG_TABLE_NAME='quality_report_facts' THEN
    PERFORM add_registered_dependency('canonical_fact',NEW.fact_id,NEW.fact_id,'quality_audit_report',NEW.report_id,NEW.report_id,'audited_from','hard','audit',NEW.report_id);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION mark_context_preview_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE context_previews preview SET status='stale',stale_at=now(),stale_reason='装配所引用的规则或来源版本发生变化，请重新预览。'
  FROM dependency_resources resource
  WHERE resource.id=NEW.resource_id AND resource.resource_kind='context_preview' AND preview.id=resource.stable_object_id AND preview.status IN ('complete','invalid');
  RETURN NEW;
END $$;
CREATE TRIGGER context_preview_invalidation_bridge AFTER INSERT ON dependency_invalidation_impacts FOR EACH ROW EXECUTE FUNCTION mark_context_preview_stale();

CREATE INDEX context_bindings_scope_idx ON context_bindings(book_id,scope_kind,scope_ref,status,updated_at DESC);
CREATE INDEX context_binding_versions_binding_idx ON context_binding_versions(binding_id,version DESC);
CREATE INDEX context_previews_book_idx ON context_previews(book_id,created_at DESC,id DESC);
CREATE INDEX context_preview_decisions_preview_idx ON context_preview_decisions(preview_id,decision,slot_key,priority DESC);
CREATE INDEX context_manifests_snapshot_idx ON context_manifests(book_id,finalized_at DESC,id DESC) WHERE status='finalized';

COMMENT ON TABLE context_bindings IS 'Stable scoped context rule identities. Immutable versions decide candidate eligibility; they never copy source content.';
COMMENT ON TABLE context_previews IS 'Auditable assembly previews. Rules are selection standards; decisions record included, excluded, deduped and trimmed exact source versions.';
COMMENT ON TABLE context_manifests IS 'A finalized manifest is the immutable itemized receipt of exact source versions used by one future AI run.';
COMMENT ON TABLE context_manifest_retrieval_traces IS 'Existing semantic retrieval traces are candidate evidence only; no retrieval result is fabricated during context assembly.';

INSERT INTO schema_migrations(id) VALUES('037_context_binding_assembly_snapshots') ON CONFLICT(id) DO NOTHING;
