SET search_path TO new_design, public;

CREATE FUNCTION dependency_content_hash(payload text) RETURNS char(64) LANGUAGE sql IMMUTABLE AS $$
  SELECT (md5(COALESCE(payload,'')) || md5(reverse(COALESCE(payload,''))))::char(64)
$$;

CREATE TABLE dependency_resources (
  id uuid PRIMARY KEY,
  resource_kind text NOT NULL CHECK(resource_kind IN (
    'card_type_version','template_group_version','card_version','card_relation',
    'research_document_version','research_record_version','research_reference_pack_version',
    'chapter_body_version','chapter_text_anchor','canonical_fact','chapter_settlement',
    'state_change','knowledge_state_change','story_event_timing','story_event_relation',
    'planning_version','prompt_recipe_version','task_contract_version','context_manifest',
    'model_route_snapshot','ai_task_attempt','quality_audit_report'
  )),
  space_id uuid REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  stable_object_id uuid NOT NULL,
  exact_version_id uuid NOT NULL,
  content_hash char(64) NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_kind,stable_object_id,exact_version_id),
  CHECK(book_id IS NULL OR space_id IS NOT NULL)
);

CREATE FUNCTION resolve_dependency_resource(
  requested_kind text,
  requested_stable_id uuid,
  requested_version_id uuid
) RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE AS $$
BEGIN
  CASE requested_kind
    WHEN 'card_type_version' THEN
      RETURN QUERY SELECT type.space_id,book.id,dependency_content_hash(version.fields::text)
      FROM card_type_versions version JOIN card_types type ON type.id=version.card_type_id
      LEFT JOIN books book ON book.space_id=type.space_id
      WHERE type.id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'template_group_version' THEN
      RETURN QUERY SELECT NULL::uuid,NULL::uuid,dependency_content_hash(version.payload::text)
      FROM template_group_versions version WHERE version.template_id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'card_version' THEN
      RETURN QUERY SELECT card.space_id,book.id,dependency_content_hash(version.title || version.values::text || version.type_version_id::text)
      FROM card_versions version JOIN cards card ON card.id=version.card_id LEFT JOIN books book ON book.space_id=card.space_id
      WHERE card.id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'card_relation' THEN
      RETURN QUERY SELECT relation.space_id,book.id,dependency_content_hash(to_jsonb(relation)::text)
      FROM card_relations relation LEFT JOIN books book ON book.space_id=relation.space_id
      WHERE relation.id=requested_stable_id AND relation.id=requested_version_id;
    WHEN 'research_document_version' THEN
      RETURN QUERY SELECT NULL::uuid,NULL::uuid,version.content_hash::char(64)
      FROM research_document_versions version WHERE version.document_id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'research_record_version' THEN
      RETURN QUERY SELECT NULL::uuid,NULL::uuid,version.run_hash::char(64)
      FROM research_record_versions version WHERE version.record_id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'research_reference_pack_version' THEN
      RETURN QUERY SELECT NULL::uuid,NULL::uuid,dependency_content_hash(version.id::text || version.note)
      FROM research_reference_pack_versions version WHERE version.pack_id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'chapter_body_version' THEN
      RETURN QUERY SELECT book.space_id,document.book_id,version.content_hash
      FROM chapter_body_versions version JOIN chapter_documents document ON document.id=version.chapter_document_id JOIN books book ON book.id=document.book_id
      WHERE document.id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'chapter_text_anchor' THEN
      RETURN QUERY SELECT book.space_id,anchor.book_id,anchor.fragment_hash
      FROM chapter_text_anchors anchor JOIN books book ON book.id=anchor.book_id
      WHERE anchor.id=requested_stable_id AND anchor.body_version_id=requested_version_id;
    WHEN 'canonical_fact' THEN
      RETURN QUERY SELECT book.space_id,fact.book_id,fact.value_hash
      FROM canonical_facts fact JOIN books book ON book.id=fact.book_id
      WHERE fact.id=requested_stable_id AND fact.id=requested_version_id;
    WHEN 'chapter_settlement' THEN
      RETURN QUERY SELECT book.space_id,settlement.book_id,dependency_content_hash(to_jsonb(settlement)::text)
      FROM chapter_settlements settlement JOIN books book ON book.id=settlement.book_id
      WHERE settlement.chapter_document_id=requested_stable_id AND settlement.id=requested_version_id;
    WHEN 'state_change' THEN
      RETURN QUERY SELECT book.space_id,change.book_id,dependency_content_hash(to_jsonb(change)::text)
      FROM state_changes change JOIN books book ON book.id=change.book_id
      WHERE change.id=requested_stable_id AND change.id=requested_version_id;
    WHEN 'knowledge_state_change' THEN
      RETURN QUERY SELECT book.space_id,change.book_id,dependency_content_hash(to_jsonb(change)::text)
      FROM knowledge_state_changes change JOIN books book ON book.id=change.book_id
      WHERE change.proposal_id=requested_stable_id AND change.id=requested_version_id;
    WHEN 'story_event_timing' THEN
      RETURN QUERY SELECT book.space_id,timing.book_id,dependency_content_hash(to_jsonb(timing)::text)
      FROM story_event_timings timing JOIN books book ON book.id=timing.book_id
      WHERE timing.id=requested_stable_id AND timing.id=requested_version_id;
    WHEN 'story_event_relation' THEN
      RETURN QUERY SELECT book.space_id,relation.book_id,dependency_content_hash(to_jsonb(relation)::text)
      FROM story_event_relations relation JOIN books book ON book.id=relation.book_id
      WHERE relation.proposal_id=requested_stable_id AND relation.id=requested_version_id;
    WHEN 'planning_version' THEN
      RETURN QUERY SELECT book.space_id,version.book_id,version.content_hash
      FROM planning_versions version JOIN books book ON book.id=version.book_id
      WHERE version.object_id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'prompt_recipe_version' THEN
      RETURN QUERY SELECT NULL::uuid,NULL::uuid,version.content_hash
      FROM prompt_recipe_versions version WHERE version.recipe_id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'task_contract_version' THEN
      RETURN QUERY SELECT NULL::uuid,NULL::uuid,version.content_hash
      FROM task_contract_versions version WHERE version.contract_id=requested_stable_id AND version.id=requested_version_id;
    WHEN 'context_manifest' THEN
      RETURN QUERY SELECT book.space_id,manifest.book_id,manifest.manifest_hash
      FROM context_manifests manifest JOIN books book ON book.id=manifest.book_id
      WHERE manifest.id=requested_stable_id AND manifest.id=requested_version_id;
    WHEN 'model_route_snapshot' THEN
      RETURN QUERY SELECT book.space_id,snapshot.book_id,snapshot.snapshot_hash
      FROM model_route_snapshots snapshot JOIN books book ON book.id=snapshot.book_id
      WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id;
    WHEN 'ai_task_attempt' THEN
      RETURN QUERY SELECT task.space_id,task.book_id,COALESCE(attempt.result_hash,attempt.input_hash)
      FROM ai_task_attempts attempt JOIN ai_tasks task ON task.id=attempt.task_id
      WHERE attempt.task_id=requested_stable_id AND attempt.id=requested_version_id;
    WHEN 'quality_audit_report' THEN
      RETURN QUERY SELECT book.space_id,report.book_id,dependency_content_hash(report.input_hash || report.id::text)
      FROM quality_audit_reports report JOIN books book ON book.id=report.book_id
      WHERE report.id=requested_stable_id AND report.id=requested_version_id;
    ELSE
      RAISE EXCEPTION 'unsupported dependency resource kind: %',requested_kind USING ERRCODE='23514';
  END CASE;
END $$;

CREATE FUNCTION validate_dependency_resource() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved record;
BEGIN
  SELECT * INTO resolved FROM resolve_dependency_resource(NEW.resource_kind,NEW.stable_object_id,NEW.exact_version_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'dependency resource reference does not resolve' USING ERRCODE='23503'; END IF;
  NEW.space_id:=resolved.resolved_space_id;
  NEW.book_id:=resolved.resolved_book_id;
  NEW.content_hash:=resolved.resolved_hash;
  RETURN NEW;
END $$;
CREATE TRIGGER dependency_resources_validate BEFORE INSERT ON dependency_resources FOR EACH ROW EXECUTE FUNCTION validate_dependency_resource();

CREATE FUNCTION guard_dependency_resource_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'dependency resource registry is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER dependency_resources_immutable BEFORE UPDATE OR DELETE ON dependency_resources FOR EACH ROW EXECUTE FUNCTION guard_dependency_resource_immutable();

CREATE FUNCTION register_dependency_resource(kind text,stable_id uuid,version_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
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

CREATE TABLE dependency_conflicts (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  conflict_kind text NOT NULL CHECK(conflict_kind IN ('cycle','cross_book','invalid_reference')),
  source_resource_id uuid REFERENCES dependency_resources(id),
  derived_resource_id uuid REFERENCES dependency_resources(id),
  dependency_kind text,
  detected_path uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'needs_review' CHECK(status IN ('needs_review','resolved','dismissed')),
  detail text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text NOT NULL DEFAULT '',
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE dependency_edges (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  derived_resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  dependency_kind text NOT NULL CHECK(dependency_kind IN ('generated_from','planned_from','validated_against','evidenced_by','context_included','configured_by','settled_from','audited_from','derived_from')),
  dependency_strength text NOT NULL CHECK(dependency_strength IN ('hard','soft')),
  origin_kind text NOT NULL CHECK(origin_kind IN ('adoption','confirmation','settlement','contract_publication','context_build','ai_result','audit','manual','import','system')),
  origin_id uuid,
  idempotency_key text,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text NOT NULL DEFAULT '',
  CHECK(source_resource_id<>derived_resource_id),
  CHECK((status='active' AND ended_at IS NULL) OR (status='ended' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX dependency_edges_active_unique ON dependency_edges(source_resource_id,derived_resource_id,dependency_kind) WHERE status='active';
CREATE UNIQUE INDEX dependency_edges_idempotency_unique ON dependency_edges(book_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX dependency_edges_upstream_idx ON dependency_edges(book_id,derived_resource_id,status,created_at DESC);
CREATE INDEX dependency_edges_downstream_idx ON dependency_edges(book_id,source_resource_id,status,created_at DESC);

CREATE FUNCTION guard_dependency_edge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row dependency_resources%ROWTYPE; derived_row dependency_resources%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dependency edges are append-only' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'active' OR NEW.status<>'ended' OR NEW.ended_at IS NULL OR
       (to_jsonb(NEW)-ARRAY['status','ended_at','end_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','ended_at','end_reason']::text[]) THEN
      RAISE EXCEPTION 'dependency edge may only transition from active to ended' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
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
CREATE TRIGGER dependency_edges_guard BEFORE INSERT OR UPDATE OR DELETE ON dependency_edges FOR EACH ROW EXECUTE FUNCTION guard_dependency_edge();

CREATE FUNCTION add_registered_dependency(
  source_kind text,source_stable_id uuid,source_version_id uuid,
  derived_kind text,derived_stable_id uuid,derived_version_id uuid,
  edge_kind text,edge_strength text,edge_origin text,edge_origin_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE source_id uuid; derived_id uuid; derived_row dependency_resources%ROWTYPE; edge_id uuid;
BEGIN
  source_id:=register_dependency_resource(source_kind,source_stable_id,source_version_id);
  derived_id:=register_dependency_resource(derived_kind,derived_stable_id,derived_version_id);
  SELECT * INTO derived_row FROM dependency_resources WHERE id=derived_id;
  SELECT id INTO edge_id FROM dependency_edges WHERE source_resource_id=source_id AND derived_resource_id=derived_id AND dependency_kind=edge_kind AND status='active';
  IF edge_id IS NOT NULL THEN RETURN edge_id; END IF;
  edge_id:=gen_random_uuid();
  INSERT INTO dependency_edges(id,space_id,book_id,source_resource_id,derived_resource_id,dependency_kind,dependency_strength,origin_kind,origin_id)
  VALUES(edge_id,derived_row.space_id,derived_row.book_id,source_id,derived_id,edge_kind,edge_strength,edge_origin,edge_origin_id);
  RETURN edge_id;
END $$;

CREATE FUNCTION bridge_dependency_creation() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER dependency_context_manifest_bridge AFTER INSERT ON context_manifests FOR EACH ROW EXECUTE FUNCTION bridge_dependency_creation();
CREATE TRIGGER dependency_context_entry_bridge AFTER INSERT ON context_manifest_entries FOR EACH ROW EXECUTE FUNCTION bridge_dependency_creation();
CREATE TRIGGER dependency_model_snapshot_bridge AFTER INSERT ON model_route_snapshots FOR EACH ROW EXECUTE FUNCTION bridge_dependency_creation();
CREATE TRIGGER dependency_ai_result_bridge AFTER UPDATE OF status ON ai_task_attempts FOR EACH ROW EXECUTE FUNCTION bridge_dependency_creation();
CREATE TRIGGER dependency_quality_report_bridge AFTER INSERT ON quality_audit_reports FOR EACH ROW EXECUTE FUNCTION bridge_dependency_creation();
CREATE TRIGGER dependency_quality_body_bridge AFTER INSERT ON quality_report_body_versions FOR EACH ROW EXECUTE FUNCTION bridge_dependency_creation();
CREATE TRIGGER dependency_quality_plan_bridge AFTER INSERT ON quality_report_planning_versions FOR EACH ROW EXECUTE FUNCTION bridge_dependency_creation();
CREATE TRIGGER dependency_quality_fact_bridge AFTER INSERT ON quality_report_facts FOR EACH ROW EXECUTE FUNCTION bridge_dependency_creation();

CREATE TABLE dependency_change_previews (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  book_change_set_id uuid REFERENCES book_change_sets(id),
  old_resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  new_resource_id uuid REFERENCES dependency_resources(id),
  reason text NOT NULL,
  impact_snapshot jsonb NOT NULL CHECK(jsonb_typeof(impact_snapshot)='array'),
  snapshot_hash char(64) NOT NULL,
  idempotency_key text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE dependency_invalidation_events (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  old_resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  new_resource_id uuid REFERENCES dependency_resources(id),
  change_preview_id uuid REFERENCES dependency_change_previews(id),
  book_change_set_id uuid REFERENCES book_change_sets(id),
  reason text NOT NULL,
  trigger_source text NOT NULL CHECK(trigger_source IN ('body_adoption','planning_adoption','fact_review','settlement','knowledge_review','story_time_review','story_relation_review','contract_publication','quality_stale','manual','system')),
  requested_state text NOT NULL CHECK(requested_state IN ('stale','invalid','needs_review')),
  trigger_id uuid,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE dependency_invalidation_impacts (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES dependency_invalidation_events(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  depth integer NOT NULL CHECK(depth>0 AND depth<=100),
  propagation_path uuid[] NOT NULL CHECK(cardinality(propagation_path)>=2),
  dependency_strength text NOT NULL CHECK(dependency_strength IN ('hard','soft')),
  impact_state text NOT NULL CHECK(impact_state IN ('stale','invalid','needs_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,resource_id)
);

CREATE TABLE dependency_stale_reasons (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  event_id uuid NOT NULL REFERENCES dependency_invalidation_events(id),
  impact_id uuid NOT NULL REFERENCES dependency_invalidation_impacts(id),
  state text NOT NULL CHECK(state IN ('stale','invalid','needs_review')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_kind text CHECK(resolution_kind IS NULL OR resolution_kind IN ('recomputed','accepted_stale','superseded')),
  resolution_receipt_id uuid,
  UNIQUE(event_id,resource_id),
  CHECK((resolved_at IS NULL AND resolution_kind IS NULL) OR (resolved_at IS NOT NULL AND resolution_kind IS NOT NULL))
);
CREATE INDEX dependency_stale_current_idx ON dependency_stale_reasons(book_id,resource_id,created_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE dependency_resource_states (
  resource_id uuid PRIMARY KEY REFERENCES dependency_resources(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  state text NOT NULL CHECK(state IN ('fresh','stale','invalid','needs_review','recompute_pending','recomputing','recomputed','accepted_stale')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  last_event_id uuid REFERENCES dependency_invalidation_events(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dependency_state_events (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  invalidation_event_id uuid REFERENCES dependency_invalidation_events(id),
  from_state text,
  to_state text NOT NULL CHECK(to_state IN ('fresh','stale','invalid','needs_review','recompute_pending','recomputing','recomputed','accepted_stale')),
  event_kind text NOT NULL CHECK(event_kind IN ('invalidated','recompute_requested','recompute_started','recompute_completed','recompute_rejected','accepted_stale')),
  actor text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dependency_recompute_requests (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  target_resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  invalidation_event_id uuid NOT NULL REFERENCES dependency_invalidation_events(id),
  required_upstream_versions jsonb NOT NULL CHECK(jsonb_typeof(required_upstream_versions)='array'),
  priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN -100 AND 100),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','recomputing','completed','failed','superseded','cancelled')),
  reason text NOT NULL,
  strategy_key text NOT NULL,
  task_contract_version_id uuid REFERENCES task_contract_versions(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(book_id,idempotency_key)
);
CREATE INDEX dependency_recompute_queue_idx ON dependency_recompute_requests(book_id,status,priority DESC,created_at,id);

CREATE TABLE dependency_recompute_receipts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES dependency_recompute_requests(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  input_dependency_snapshot jsonb NOT NULL CHECK(jsonb_typeof(input_dependency_snapshot)='array'),
  input_snapshot_hash char(64) NOT NULL,
  output_resource_id uuid REFERENCES dependency_resources(id),
  output_version_id uuid,
  output_hash char(64),
  outcome text NOT NULL CHECK(outcome IN ('applied','rejected_stale','failed')),
  detail text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key),
  CHECK((outcome='applied' AND output_resource_id IS NOT NULL AND output_version_id IS NOT NULL AND output_hash IS NOT NULL) OR outcome<>'applied')
);

ALTER TABLE dependency_stale_reasons ADD CONSTRAINT dependency_stale_reasons_receipt_fk
  FOREIGN KEY(resolution_receipt_id) REFERENCES dependency_recompute_receipts(id);

CREATE TABLE dependency_stale_acceptances (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  invalidation_event_id uuid NOT NULL REFERENCES dependency_invalidation_events(id),
  risk_summary text NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE FUNCTION guard_dependency_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'dependency history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER dependency_previews_immutable BEFORE UPDATE OR DELETE ON dependency_change_previews FOR EACH ROW EXECUTE FUNCTION guard_dependency_ledger_append_only();
CREATE TRIGGER dependency_invalidations_immutable BEFORE UPDATE OR DELETE ON dependency_invalidation_events FOR EACH ROW EXECUTE FUNCTION guard_dependency_ledger_append_only();
CREATE TRIGGER dependency_impacts_immutable BEFORE UPDATE OR DELETE ON dependency_invalidation_impacts FOR EACH ROW EXECUTE FUNCTION guard_dependency_ledger_append_only();
CREATE TRIGGER dependency_state_events_immutable BEFORE UPDATE OR DELETE ON dependency_state_events FOR EACH ROW EXECUTE FUNCTION guard_dependency_ledger_append_only();
CREATE TRIGGER dependency_receipts_immutable BEFORE UPDATE OR DELETE ON dependency_recompute_receipts FOR EACH ROW EXECUTE FUNCTION guard_dependency_ledger_append_only();
CREATE TRIGGER dependency_acceptances_immutable BEFORE UPDATE OR DELETE ON dependency_stale_acceptances FOR EACH ROW EXECUTE FUNCTION guard_dependency_ledger_append_only();

CREATE FUNCTION record_dependency_invalidation(
  event_uuid uuid,event_book_id uuid,old_resource uuid,new_resource uuid,event_reason text,event_source text,
  event_state text,event_trigger_id uuid,event_idempotency_key text,preview_id uuid DEFAULT NULL,change_set_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE event_space_id uuid; existing_id uuid; old_book_id uuid; new_book_id uuid;
BEGIN
  SELECT id INTO existing_id FROM dependency_invalidation_events WHERE book_id=event_book_id AND idempotency_key=event_idempotency_key;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;
  SELECT space_id INTO event_space_id FROM books WHERE id=event_book_id;
  IF event_space_id IS NULL THEN RAISE EXCEPTION 'book not found for invalidation' USING ERRCODE='23503'; END IF;
  SELECT book_id INTO old_book_id FROM dependency_resources WHERE id=old_resource;
  IF NOT FOUND OR (old_book_id IS NOT NULL AND old_book_id IS DISTINCT FROM event_book_id) THEN
    RAISE EXCEPTION 'old dependency resource does not belong to invalidation book' USING ERRCODE='23514';
  END IF;
  IF new_resource IS NOT NULL THEN
    SELECT book_id INTO new_book_id FROM dependency_resources WHERE id=new_resource;
    IF NOT FOUND OR (new_book_id IS NOT NULL AND new_book_id IS DISTINCT FROM event_book_id) THEN
      RAISE EXCEPTION 'new dependency resource does not belong to invalidation book' USING ERRCODE='23514';
    END IF;
  END IF;
  INSERT INTO dependency_invalidation_events(id,space_id,book_id,old_resource_id,new_resource_id,change_preview_id,book_change_set_id,reason,trigger_source,requested_state,trigger_id,idempotency_key)
  VALUES(event_uuid,event_space_id,event_book_id,old_resource,new_resource,preview_id,change_set_id,event_reason,event_source,event_state,event_trigger_id,event_idempotency_key);

  WITH RECURSIVE walk(resource_id,depth,path,strength) AS (
    SELECT edge.derived_resource_id,1,ARRAY[edge.source_resource_id,edge.derived_resource_id],edge.dependency_strength
    FROM dependency_edges edge WHERE edge.book_id=event_book_id AND edge.source_resource_id=old_resource AND edge.status='active'
    UNION ALL
    SELECT edge.derived_resource_id,walk.depth+1,walk.path||edge.derived_resource_id,
      CASE WHEN walk.strength='hard' OR edge.dependency_strength='hard' THEN 'hard' ELSE 'soft' END
    FROM walk JOIN dependency_edges edge ON edge.source_resource_id=walk.resource_id AND edge.book_id=event_book_id AND edge.status='active'
    WHERE NOT edge.derived_resource_id=ANY(walk.path) AND walk.depth<99
  ), ranked AS (
    SELECT DISTINCT ON(resource_id) resource_id,depth,path,strength FROM walk ORDER BY resource_id,depth
  )
  INSERT INTO dependency_invalidation_impacts(id,event_id,resource_id,depth,propagation_path,dependency_strength,impact_state)
  SELECT gen_random_uuid(),event_uuid,resource_id,depth,path,strength,
    CASE WHEN event_state='invalid' AND strength='soft' THEN 'needs_review' ELSE event_state END
  FROM ranked;

  INSERT INTO dependency_stale_reasons(id,book_id,resource_id,event_id,impact_id,state,reason)
  SELECT gen_random_uuid(),event_book_id,impact.resource_id,event_uuid,impact.id,impact.impact_state,event_reason
  FROM dependency_invalidation_impacts impact WHERE impact.event_id=event_uuid;

  INSERT INTO dependency_state_events(id,book_id,resource_id,invalidation_event_id,from_state,to_state,event_kind,detail)
  SELECT gen_random_uuid(),event_book_id,impact.resource_id,event_uuid,state.state,impact.impact_state,'invalidated',event_reason
  FROM dependency_invalidation_impacts impact LEFT JOIN dependency_resource_states state ON state.resource_id=impact.resource_id
  WHERE impact.event_id=event_uuid;

  INSERT INTO dependency_resource_states(resource_id,book_id,state,last_event_id)
  SELECT impact.resource_id,event_book_id,impact.impact_state,event_uuid FROM dependency_invalidation_impacts impact WHERE impact.event_id=event_uuid
  ON CONFLICT(resource_id) DO UPDATE SET state=excluded.state,last_event_id=excluded.last_event_id,revision=dependency_resource_states.revision+1,updated_at=now();

  INSERT INTO dependency_recompute_requests(id,book_id,target_resource_id,invalidation_event_id,required_upstream_versions,priority,reason,strategy_key,idempotency_key)
  SELECT gen_random_uuid(),event_book_id,impact.resource_id,event_uuid,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('resourceId',source.id,'kind',source.resource_kind,'stableObjectId',source.stable_object_id,'exactVersionId',source.exact_version_id,'contentHash',source.content_hash) ORDER BY source.id)
      FROM dependency_edges edge JOIN dependency_resources source ON source.id=edge.source_resource_id
      WHERE edge.derived_resource_id=impact.resource_id AND edge.book_id=event_book_id AND edge.status='active'),'[]'::jsonb),
    CASE WHEN impact.dependency_strength='hard' THEN 50 ELSE 0 END-impact.depth,event_reason,'manual_review',event_uuid::text || ':' || impact.resource_id::text
  FROM dependency_invalidation_impacts impact WHERE impact.event_id=event_uuid;

  INSERT INTO dependency_state_events(id,book_id,resource_id,invalidation_event_id,from_state,to_state,event_kind,detail)
  SELECT gen_random_uuid(),event_book_id,impact.resource_id,event_uuid,impact.impact_state,'recompute_pending','recompute_requested',event_reason
  FROM dependency_invalidation_impacts impact WHERE impact.event_id=event_uuid;
  UPDATE dependency_resource_states SET state='recompute_pending',revision=revision+1,updated_at=now()
  WHERE resource_id IN (SELECT resource_id FROM dependency_invalidation_impacts WHERE event_id=event_uuid);
  RETURN event_uuid;
END $$;

CREATE FUNCTION invalidate_registered_resource(old_resource uuid,new_resource uuid,event_reason text,event_source text,event_trigger uuid,event_key text,event_state text DEFAULT 'stale') RETURNS void LANGUAGE plpgsql AS $$
DECLARE target_book uuid;
BEGIN
  FOR target_book IN SELECT DISTINCT book_id FROM dependency_edges WHERE source_resource_id=old_resource AND status='active' LOOP
    PERFORM record_dependency_invalidation(gen_random_uuid(),target_book,old_resource,new_resource,event_reason,event_source,event_state,event_trigger,event_key || ':' || target_book::text);
  END LOOP;
END $$;

CREATE FUNCTION bridge_dependency_change_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_resource uuid; new_resource uuid; stable_id uuid; confirmed_id uuid;
BEGIN
  IF TG_TABLE_NAME='chapter_body_adoptions' THEN
    IF NEW.from_version_id IS NULL THEN RETURN NEW; END IF;
    old_resource:=register_dependency_resource('chapter_body_version',NEW.chapter_document_id,NEW.from_version_id);
    new_resource:=register_dependency_resource('chapter_body_version',NEW.chapter_document_id,NEW.to_version_id);
    PERFORM invalidate_registered_resource(old_resource,new_resource,'正文采用版本发生变化。','body_adoption',NEW.id,'body-adoption:'||NEW.id::text);
  ELSIF TG_TABLE_NAME='planning_adoptions' THEN
    IF NEW.from_version_id IS NULL THEN RETURN NEW; END IF;
    old_resource:=register_dependency_resource('planning_version',NEW.object_id,NEW.from_version_id);
    new_resource:=register_dependency_resource('planning_version',NEW.object_id,NEW.to_version_id);
    PERFORM invalidate_registered_resource(old_resource,new_resource,'规划采用版本发生变化。','planning_adoption',NEW.id,'planning-adoption:'||NEW.id::text);
  ELSIF TG_TABLE_NAME='canonical_fact_review_actions' AND NEW.action IN ('confirm','supersede','mark_stale') THEN
    old_resource:=register_dependency_resource('canonical_fact',NEW.fact_id,NEW.fact_id);
    PERFORM invalidate_registered_resource(old_resource,old_resource,'正典事实状态发生变化：'||NEW.action,'fact_review',NEW.id,'fact-review:'||NEW.id::text,CASE WHEN NEW.action='mark_stale' THEN 'invalid' ELSE 'stale' END);
  ELSIF TG_TABLE_NAME='chapter_settlements' AND TG_OP='INSERT' THEN
    SELECT id INTO confirmed_id FROM chapter_settlements WHERE chapter_document_id=NEW.chapter_document_id AND id<>NEW.id ORDER BY committed_at DESC,id DESC LIMIT 1;
    new_resource:=register_dependency_resource('chapter_settlement',NEW.chapter_document_id,NEW.id);
    IF confirmed_id IS NOT NULL THEN
      old_resource:=register_dependency_resource('chapter_settlement',NEW.chapter_document_id,confirmed_id);
      PERFORM invalidate_registered_resource(old_resource,new_resource,'章节重新结算并采用了新的结算版本。','settlement',NEW.id,'settlement-replace:'||NEW.id::text);
    END IF;
  ELSIF TG_TABLE_NAME='chapter_settlements' AND TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    old_resource:=register_dependency_resource('chapter_settlement',NEW.chapter_document_id,NEW.id);
    PERFORM invalidate_registered_resource(old_resource,old_resource,'章节结算状态发生变化：'||NEW.status,'settlement',NEW.id,'settlement-state:'||NEW.id::text||':'||NEW.status,CASE WHEN NEW.status IN ('reverted','superseded') THEN 'invalid' ELSE 'stale' END);
  ELSIF TG_TABLE_NAME='knowledge_state_review_actions' AND NEW.action IN ('confirm','invalidate') THEN
    SELECT confirmed_change_id INTO confirmed_id FROM knowledge_state_proposals WHERE id=NEW.proposal_id;
    IF confirmed_id IS NOT NULL THEN
      old_resource:=register_dependency_resource('knowledge_state_change',NEW.proposal_id,confirmed_id);
      PERFORM invalidate_registered_resource(old_resource,old_resource,'知情状态发生变化：'||NEW.action,'knowledge_review',NEW.id,'knowledge-review:'||NEW.id::text,CASE WHEN NEW.action='invalidate' THEN 'invalid' ELSE 'stale' END);
    END IF;
  ELSIF TG_TABLE_NAME='story_time_review_actions' AND NEW.action IN ('confirm','mark_stale','invalidate') THEN
    SELECT confirmed_timing_id INTO confirmed_id FROM story_time_proposals WHERE id=NEW.proposal_id;
    IF confirmed_id IS NOT NULL THEN
      old_resource:=register_dependency_resource('story_event_timing',confirmed_id,confirmed_id);
      PERFORM invalidate_registered_resource(old_resource,old_resource,'故事时间状态发生变化：'||NEW.action,'story_time_review',NEW.id,'story-time-review:'||NEW.id::text,CASE WHEN NEW.action='invalidate' THEN 'invalid' WHEN NEW.action='mark_stale' THEN 'needs_review' ELSE 'stale' END);
    END IF;
  ELSIF TG_TABLE_NAME='story_relation_review_actions' AND NEW.action IN ('confirm','mark_stale','invalidate') THEN
    SELECT confirmed_relation_id INTO confirmed_id FROM story_relation_proposals WHERE id=NEW.proposal_id;
    IF confirmed_id IS NOT NULL THEN
      SELECT proposal_id INTO stable_id FROM story_event_relations WHERE id=confirmed_id;
      old_resource:=register_dependency_resource('story_event_relation',stable_id,confirmed_id);
      PERFORM invalidate_registered_resource(old_resource,old_resource,'故事因果关系状态发生变化：'||NEW.action,'story_relation_review',NEW.id,'story-relation-review:'||NEW.id::text,CASE WHEN NEW.action='invalidate' THEN 'invalid' WHEN NEW.action='mark_stale' THEN 'needs_review' ELSE 'stale' END);
    END IF;
  ELSIF TG_TABLE_NAME='ai_contract_publications' THEN
    IF NEW.from_version_id IS NULL OR NEW.entity_kind='model_route' THEN RETURN NEW; END IF;
    old_resource:=register_dependency_resource(CASE NEW.entity_kind WHEN 'prompt_recipe' THEN 'prompt_recipe_version' ELSE 'task_contract_version' END,NEW.entity_id,NEW.from_version_id);
    new_resource:=register_dependency_resource(CASE NEW.entity_kind WHEN 'prompt_recipe' THEN 'prompt_recipe_version' ELSE 'task_contract_version' END,NEW.entity_id,NEW.to_version_id);
    PERFORM invalidate_registered_resource(old_resource,new_resource,'AI 执行合同发布版本发生变化。','contract_publication',NEW.id,'contract-publication:'||NEW.id::text,'needs_review');
  ELSIF TG_TABLE_NAME='quality_audit_reports' AND OLD.stale_at IS NULL AND NEW.stale_at IS NOT NULL THEN
    old_resource:=register_dependency_resource('quality_audit_report',NEW.id,NEW.id);
    PERFORM invalidate_registered_resource(old_resource,old_resource,NEW.stale_reason,'quality_stale',NEW.id,'quality-stale:'||NEW.id::text,'stale');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER dependency_body_adoption_bridge AFTER INSERT ON chapter_body_adoptions FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();
CREATE TRIGGER dependency_planning_adoption_bridge AFTER INSERT ON planning_adoptions FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();
CREATE TRIGGER dependency_fact_review_bridge AFTER INSERT ON canonical_fact_review_actions FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();
CREATE TRIGGER dependency_settlement_bridge AFTER INSERT OR UPDATE OF status ON chapter_settlements FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();
CREATE TRIGGER dependency_knowledge_review_bridge AFTER INSERT ON knowledge_state_review_actions FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();
CREATE TRIGGER dependency_story_time_review_bridge AFTER INSERT ON story_time_review_actions FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();
CREATE TRIGGER dependency_story_relation_review_bridge AFTER INSERT ON story_relation_review_actions FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();
CREATE TRIGGER dependency_contract_publication_bridge AFTER INSERT ON ai_contract_publications FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();
CREATE TRIGGER dependency_quality_stale_bridge AFTER UPDATE OF stale_at ON quality_audit_reports FOR EACH ROW EXECUTE FUNCTION bridge_dependency_change_events();

DO $$
DECLARE item record; mapped_kind text; mapped_version uuid; stable_id uuid;
BEGIN
  FOR item IN SELECT * FROM context_manifests LOOP
    SELECT recipe_id INTO stable_id FROM prompt_recipe_versions WHERE id=item.prompt_recipe_version_id;
    PERFORM add_registered_dependency('prompt_recipe_version',stable_id,item.prompt_recipe_version_id,'context_manifest',item.id,item.id,'configured_by','hard','context_build',item.id);
    SELECT contract_id INTO stable_id FROM task_contract_versions WHERE id=item.task_contract_version_id;
    PERFORM add_registered_dependency('task_contract_version',stable_id,item.task_contract_version_id,'context_manifest',item.id,item.id,'configured_by','hard','context_build',item.id);
  END LOOP;
  FOR item IN SELECT * FROM context_manifest_entries LOOP
    mapped_kind:=CASE item.source_type WHEN 'body_version' THEN 'chapter_body_version' WHEN 'text_anchor' THEN 'chapter_text_anchor' WHEN 'research_version' THEN 'research_record_version' WHEN 'story_time' THEN 'story_event_timing' WHEN 'prompt_component' THEN 'card_version' ELSE item.source_type END;
    mapped_version:=COALESCE(item.exact_version_id,item.stable_object_id);
    PERFORM add_registered_dependency(mapped_kind,item.stable_object_id,mapped_version,'context_manifest',item.manifest_id,item.manifest_id,'context_included','hard','context_build',item.manifest_id);
  END LOOP;
  FOR item IN SELECT * FROM model_route_snapshots LOOP
    SELECT contract_id INTO stable_id FROM task_contract_versions WHERE id=item.task_contract_version_id;
    PERFORM add_registered_dependency('task_contract_version',stable_id,item.task_contract_version_id,'model_route_snapshot',item.id,item.id,'configured_by','hard','system',item.id);
  END LOOP;
  FOR item IN SELECT * FROM ai_task_attempts WHERE status='succeeded' LOOP
    SELECT contract_id INTO stable_id FROM task_contract_versions WHERE id=item.task_contract_version_id;
    PERFORM add_registered_dependency('task_contract_version',stable_id,item.task_contract_version_id,'ai_task_attempt',item.task_id,item.id,'configured_by','hard','ai_result',item.id);
    SELECT recipe_id INTO stable_id FROM prompt_recipe_versions WHERE id=item.prompt_recipe_version_id;
    PERFORM add_registered_dependency('prompt_recipe_version',stable_id,item.prompt_recipe_version_id,'ai_task_attempt',item.task_id,item.id,'configured_by','hard','ai_result',item.id);
    PERFORM add_registered_dependency('context_manifest',item.context_manifest_id,item.context_manifest_id,'ai_task_attempt',item.task_id,item.id,'context_included','hard','ai_result',item.id);
    PERFORM add_registered_dependency('model_route_snapshot',item.model_route_snapshot_id,item.model_route_snapshot_id,'ai_task_attempt',item.task_id,item.id,'configured_by','soft','ai_result',item.id);
  END LOOP;
  FOR item IN SELECT * FROM quality_audit_reports LOOP
    PERFORM add_registered_dependency('context_manifest',item.context_manifest_id,item.context_manifest_id,'quality_audit_report',item.id,item.id,'audited_from','hard','audit',item.id);
    PERFORM add_registered_dependency('ai_task_attempt',item.task_id,item.attempt_id,'quality_audit_report',item.id,item.id,'generated_from','hard','audit',item.id);
  END LOOP;
  FOR item IN SELECT * FROM quality_report_body_versions LOOP
    PERFORM add_registered_dependency('chapter_body_version',item.chapter_document_id,item.body_version_id,'quality_audit_report',item.report_id,item.report_id,'audited_from','hard','audit',item.report_id);
  END LOOP;
  FOR item IN SELECT * FROM quality_report_planning_versions LOOP
    PERFORM add_registered_dependency('planning_version',item.planning_object_id,item.planning_version_id,'quality_audit_report',item.report_id,item.report_id,'audited_from','hard','audit',item.report_id);
  END LOOP;
  FOR item IN SELECT * FROM quality_report_facts LOOP
    PERFORM add_registered_dependency('canonical_fact',item.fact_id,item.fact_id,'quality_audit_report',item.report_id,item.report_id,'audited_from','hard','audit',item.report_id);
  END LOOP;
END $$;

INSERT INTO schema_migrations(id) VALUES('026_dependency_invalidation_ledger') ON CONFLICT(id) DO NOTHING;
