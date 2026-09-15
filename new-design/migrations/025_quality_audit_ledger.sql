SET search_path TO new_design, public;

CREATE TABLE quality_audit_reports (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK(scope_kind IN ('book','chapter','body','planning','fact','composite')),
  scope_id uuid,
  task_id uuid NOT NULL REFERENCES ai_tasks(id),
  step_id uuid NOT NULL REFERENCES ai_task_steps(id),
  attempt_id uuid NOT NULL UNIQUE REFERENCES ai_task_attempts(id),
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  prompt_recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id),
  context_manifest_id uuid NOT NULL REFERENCES context_manifests(id),
  model_route_snapshot_id uuid NOT NULL REFERENCES model_route_snapshots(id),
  rule_set_key text NOT NULL,
  rule_set_version text NOT NULL,
  input_hash char(64) NOT NULL,
  policy_mode text NOT NULL CHECK(policy_mode IN ('completion_first','quality_first')),
  policy_decision text NOT NULL CHECK(policy_decision IN ('continue','record_quality_debt','pause_for_manual','replan_required','no_usable_body','runtime_safety_failure')),
  execution_effect text NOT NULL CHECK(execution_effect IN ('continue','quality_debt','pause_for_manual','global_stop')),
  summary text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  stale_at timestamptz,
  stale_reason text NOT NULL DEFAULT '',
  UNIQUE(book_id,idempotency_key),
  FOREIGN KEY(step_id,task_id) REFERENCES ai_task_steps(id,task_id),
  FOREIGN KEY(attempt_id,step_id) REFERENCES ai_task_attempts(id,step_id),
  CHECK((policy_decision='continue' AND execution_effect='continue') OR
        (policy_decision='record_quality_debt' AND execution_effect='quality_debt') OR
        (policy_decision='pause_for_manual' AND policy_mode='quality_first' AND execution_effect='pause_for_manual') OR
        (policy_decision IN ('replan_required','no_usable_body','runtime_safety_failure') AND execution_effect='global_stop'))
);

CREATE TABLE quality_report_body_versions (
  report_id uuid NOT NULL REFERENCES quality_audit_reports(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id),
  body_version_id uuid NOT NULL,
  PRIMARY KEY(report_id,body_version_id),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE TABLE quality_report_planning_versions (
  report_id uuid NOT NULL REFERENCES quality_audit_reports(id) ON DELETE CASCADE,
  planning_object_id uuid NOT NULL REFERENCES planning_objects(id),
  planning_version_id uuid NOT NULL,
  PRIMARY KEY(report_id,planning_version_id),
  FOREIGN KEY(planning_version_id,planning_object_id) REFERENCES planning_versions(id,object_id)
);

CREATE TABLE quality_report_facts (
  report_id uuid NOT NULL REFERENCES quality_audit_reports(id) ON DELETE CASCADE,
  fact_id uuid NOT NULL REFERENCES canonical_facts(id),
  PRIMARY KEY(report_id,fact_id)
);

CREATE TABLE quality_issues (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES quality_audit_reports(id) ON DELETE CASCADE,
  stable_key text NOT NULL,
  current_version_id uuid,
  current_status text NOT NULL DEFAULT 'open' CHECK(current_status IN ('open','acknowledged','dismissed','fix_proposed','fixed','verified','stale','superseded')),
  is_quality_debt boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(report_id,stable_key),
  UNIQUE(id,book_id)
);

CREATE TABLE quality_issue_versions (
  id uuid PRIMARY KEY,
  issue_id uuid NOT NULL REFERENCES quality_issues(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),
  base_version_id uuid,
  category_key text NOT NULL CHECK(category_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  severity text NOT NULL CHECK(severity IN ('info','low','medium','high','critical')),
  confidence numeric(5,4) CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  title text NOT NULL,
  description text NOT NULL,
  detection_source text NOT NULL CHECK(detection_source IN ('ai','rule','manual','import','system')),
  impact_scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(impact_scope)='object'),
  suggested_action text NOT NULL DEFAULT '',
  target_value jsonb,
  observed_value jsonb,
  scale_version text,
  interpretation text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(issue_id,version),
  UNIQUE(id,issue_id),
  FOREIGN KEY(base_version_id,issue_id) REFERENCES quality_issue_versions(id,issue_id)
);

ALTER TABLE quality_issues ADD CONSTRAINT quality_issues_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES quality_issue_versions(id,issue_id);

CREATE TABLE quality_issue_evidence (
  id uuid PRIMARY KEY,
  issue_version_id uuid NOT NULL REFERENCES quality_issue_versions(id) ON DELETE CASCADE,
  evidence_kind text NOT NULL CHECK(evidence_kind IN ('text_anchor','canonical_fact','state_change','story_time','story_relation','planning_version','rule','observation')),
  text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  fact_id uuid REFERENCES canonical_facts(id),
  state_change_id uuid REFERENCES state_changes(id),
  story_timing_id uuid REFERENCES story_event_timings(id),
  story_relation_id uuid REFERENCES story_event_relations(id),
  planning_version_id uuid REFERENCES planning_versions(id),
  rule_key text,
  rule_version text,
  note text NOT NULL,
  is_unverified_observation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((evidence_kind='text_anchor' AND text_anchor_id IS NOT NULL AND num_nonnulls(fact_id,state_change_id,story_timing_id,story_relation_id,planning_version_id)=0) OR
        (evidence_kind='canonical_fact' AND fact_id IS NOT NULL AND num_nonnulls(text_anchor_id,state_change_id,story_timing_id,story_relation_id,planning_version_id)=0) OR
        (evidence_kind='state_change' AND state_change_id IS NOT NULL AND num_nonnulls(text_anchor_id,fact_id,story_timing_id,story_relation_id,planning_version_id)=0) OR
        (evidence_kind='story_time' AND story_timing_id IS NOT NULL AND num_nonnulls(text_anchor_id,fact_id,state_change_id,story_relation_id,planning_version_id)=0) OR
        (evidence_kind='story_relation' AND story_relation_id IS NOT NULL AND num_nonnulls(text_anchor_id,fact_id,state_change_id,story_timing_id,planning_version_id)=0) OR
        (evidence_kind='planning_version' AND planning_version_id IS NOT NULL AND num_nonnulls(text_anchor_id,fact_id,state_change_id,story_timing_id,story_relation_id)=0) OR
        (evidence_kind='rule' AND rule_key IS NOT NULL AND rule_version IS NOT NULL AND num_nonnulls(text_anchor_id,fact_id,state_change_id,story_timing_id,story_relation_id,planning_version_id)=0) OR
        (evidence_kind='observation' AND is_unverified_observation AND num_nonnulls(text_anchor_id,fact_id,state_change_id,story_timing_id,story_relation_id,planning_version_id)=0))
);

CREATE TABLE quality_issue_events (
  id uuid PRIMARY KEY,
  issue_id uuid NOT NULL REFERENCES quality_issues(id) ON DELETE CASCADE,
  issue_version_id uuid REFERENCES quality_issue_versions(id),
  from_status text,
  to_status text NOT NULL CHECK(to_status IN ('open','acknowledged','dismissed','fix_proposed','fixed','verified','stale','superseded')),
  action text NOT NULL,
  actor_kind text NOT NULL CHECK(actor_kind IN ('user','ai','system','policy')),
  actor text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  issue_revision integer NOT NULL CHECK(issue_revision>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quality_fix_candidates (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL REFERENCES quality_issues(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','rejected','applied','superseded','stale')),
  current_version_id uuid,
  accepted_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,book_id)
);

CREATE TABLE quality_fix_candidate_versions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES quality_fix_candidates(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),
  base_version_id uuid,
  target_chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id),
  target_body_version_id uuid NOT NULL,
  target_anchor_id uuid REFERENCES chapter_text_anchors(id),
  patch jsonb NOT NULL CHECK(jsonb_typeof(patch)='object'),
  content_hash char(64) NOT NULL,
  source text NOT NULL CHECK(source IN ('ai','user')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id,version),
  UNIQUE(id,candidate_id),
  FOREIGN KEY(base_version_id,candidate_id) REFERENCES quality_fix_candidate_versions(id,candidate_id),
  FOREIGN KEY(target_body_version_id,target_chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

ALTER TABLE quality_fix_candidates ADD CONSTRAINT quality_fix_candidates_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES quality_fix_candidate_versions(id,candidate_id);
ALTER TABLE quality_fix_candidates ADD CONSTRAINT quality_fix_candidates_accepted_version_fk FOREIGN KEY(accepted_version_id,id) REFERENCES quality_fix_candidate_versions(id,candidate_id);

CREATE TABLE quality_fix_candidate_events (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES quality_fix_candidates(id) ON DELETE CASCADE,
  candidate_version_id uuid REFERENCES quality_fix_candidate_versions(id),
  from_status text,
  to_status text NOT NULL,
  action text NOT NULL CHECK(action IN ('propose','revise','accept','reject','apply','mark_stale','supersede')),
  actor text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  candidate_revision integer NOT NULL CHECK(candidate_revision>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quality_fix_adoptions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL UNIQUE REFERENCES quality_fix_candidates(id),
  candidate_version_id uuid NOT NULL REFERENCES quality_fix_candidate_versions(id),
  chapter_body_adoption_id uuid NOT NULL UNIQUE REFERENCES chapter_body_adoptions(id),
  adopted_body_version_id uuid NOT NULL REFERENCES chapter_body_versions(id),
  idempotency_key text NOT NULL UNIQUE,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quality_rechecks (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL REFERENCES quality_issues(id),
  fix_candidate_id uuid REFERENCES quality_fix_candidates(id),
  source_report_id uuid NOT NULL REFERENCES quality_audit_reports(id),
  recheck_report_id uuid NOT NULL UNIQUE REFERENCES quality_audit_reports(id),
  checked_body_version_id uuid NOT NULL REFERENCES chapter_body_versions(id),
  outcome text NOT NULL CHECK(outcome IN ('supports_verified','still_present','inconclusive')),
  evidence_summary text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale')),
  idempotency_key text NOT NULL UNIQUE,
  request_hash char(64) NOT NULL,
  actor text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  stale_at timestamptz,
  stale_reason text NOT NULL DEFAULT ''
);

CREATE FUNCTION guard_quality_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'quality evidence ledger rows are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER quality_issue_versions_append_only BEFORE UPDATE OR DELETE ON quality_issue_versions FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE TRIGGER quality_report_body_versions_append_only BEFORE UPDATE OR DELETE ON quality_report_body_versions FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE TRIGGER quality_report_planning_versions_append_only BEFORE UPDATE OR DELETE ON quality_report_planning_versions FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE TRIGGER quality_report_facts_append_only BEFORE UPDATE OR DELETE ON quality_report_facts FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE TRIGGER quality_issue_evidence_append_only BEFORE UPDATE OR DELETE ON quality_issue_evidence FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE TRIGGER quality_issue_events_append_only BEFORE UPDATE OR DELETE ON quality_issue_events FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE TRIGGER quality_fix_versions_append_only BEFORE UPDATE OR DELETE ON quality_fix_candidate_versions FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE TRIGGER quality_fix_events_append_only BEFORE UPDATE OR DELETE ON quality_fix_candidate_events FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE TRIGGER quality_fix_adoptions_append_only BEFORE UPDATE OR DELETE ON quality_fix_adoptions FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
CREATE FUNCTION guard_quality_recheck_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','stale_at','stale_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stale_at','stale_reason']::text[]) OR OLD.status<>'active' OR NEW.status<>'stale' OR NEW.stale_at IS NULL THEN
    RAISE EXCEPTION 'quality recheck is append-only except first stale mark' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quality_rechecks_append_only BEFORE UPDATE OR DELETE ON quality_rechecks FOR EACH ROW EXECUTE FUNCTION guard_quality_recheck_update();

CREATE FUNCTION guard_quality_report_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'formed quality report is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['stale_at','stale_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['stale_at','stale_reason']::text[]) OR OLD.stale_at IS NOT NULL OR NEW.stale_at IS NULL THEN
    RAISE EXCEPTION 'formed quality report is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quality_reports_immutable BEFORE UPDATE OR DELETE ON quality_audit_reports FOR EACH ROW EXECUTE FUNCTION guard_quality_report_update();

CREATE FUNCTION stale_quality_report(target_report uuid, reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE changed record; old_status text; new_revision integer;
BEGIN
  UPDATE new_design.quality_audit_reports SET stale_at=now(),stale_reason=reason WHERE id=target_report AND stale_at IS NULL;
  FOR changed IN SELECT id,current_version_id,current_status,revision FROM new_design.quality_issues WHERE report_id=target_report AND current_status NOT IN ('stale','superseded') FOR UPDATE LOOP
    old_status:=changed.current_status;
    UPDATE new_design.quality_issues SET current_status='stale',revision=revision+1,updated_at=now() WHERE id=changed.id RETURNING revision INTO new_revision;
    INSERT INTO new_design.quality_issue_events(id,issue_id,issue_version_id,from_status,to_status,action,actor_kind,actor,reason,issue_revision)
    VALUES(gen_random_uuid(),changed.id,changed.current_version_id,old_status,'stale','dependency_invalidated','system','system',reason,new_revision);
  END LOOP;
  FOR changed IN SELECT recheck.id,recheck.issue_id,issue.current_version_id,issue.current_status,issue.revision FROM new_design.quality_rechecks recheck JOIN new_design.quality_issues issue ON issue.id=recheck.issue_id WHERE recheck.recheck_report_id=target_report AND recheck.status='active' FOR UPDATE OF recheck,issue LOOP
    IF changed.current_status NOT IN ('stale','superseded') THEN
      old_status:=changed.current_status;
      UPDATE new_design.quality_issues SET current_status='stale',revision=revision+1,updated_at=now() WHERE id=changed.issue_id RETURNING revision INTO new_revision;
      INSERT INTO new_design.quality_issue_events(id,issue_id,issue_version_id,from_status,to_status,action,actor_kind,actor,reason,issue_revision) VALUES(gen_random_uuid(),changed.issue_id,changed.current_version_id,old_status,'stale','recheck_dependency_invalidated','system','system',reason,new_revision);
    END IF;
  END LOOP;
  UPDATE new_design.quality_rechecks SET status='stale',stale_at=now(),stale_reason=reason WHERE recheck_report_id=target_report AND status='active';
END $$;

CREATE FUNCTION stale_quality_on_body_switch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
  IF NEW.adopted_version_id IS DISTINCT FROM OLD.adopted_version_id THEN
    FOR item IN SELECT DISTINCT binding.report_id FROM new_design.quality_report_body_versions binding WHERE binding.chapter_document_id=NEW.id AND binding.body_version_id IS DISTINCT FROM NEW.adopted_version_id LOOP
      PERFORM new_design.stale_quality_report(item.report_id,'章节正文已采用其他版本。');
    END LOOP;
    UPDATE new_design.quality_rechecks SET status='stale',stale_at=now(),stale_reason='章节正文已采用其他版本。' WHERE checked_body_version_id IS DISTINCT FROM NEW.adopted_version_id AND checked_body_version_id IN (SELECT id FROM new_design.chapter_body_versions WHERE chapter_document_id=NEW.id) AND status='active';
    FOR item IN UPDATE new_design.quality_fix_candidates candidate SET status='stale',revision=revision+1,updated_at=now() WHERE status='proposed' AND EXISTS(SELECT 1 FROM new_design.quality_fix_candidate_versions version WHERE version.id=candidate.current_version_id AND version.target_chapter_document_id=NEW.id AND version.target_body_version_id IS DISTINCT FROM NEW.adopted_version_id) RETURNING id,current_version_id,revision LOOP
      INSERT INTO new_design.quality_fix_candidate_events(id,candidate_id,candidate_version_id,from_status,to_status,action,actor,reason,candidate_revision) VALUES(gen_random_uuid(),item.id,item.current_version_id,'proposed','stale','mark_stale','system','目标正文已切换。',item.revision);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quality_body_switch_guard AFTER UPDATE OF adopted_version_id ON chapter_documents FOR EACH ROW EXECUTE FUNCTION stale_quality_on_body_switch();

CREATE FUNCTION stale_quality_on_plan_switch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
  IF NEW.adopted_version_id IS DISTINCT FROM OLD.adopted_version_id THEN
    FOR item IN SELECT DISTINCT binding.report_id FROM new_design.quality_report_planning_versions binding WHERE binding.planning_object_id=NEW.id AND binding.planning_version_id IS DISTINCT FROM NEW.adopted_version_id LOOP
      PERFORM new_design.stale_quality_report(item.report_id,'规划对象已采用其他版本。');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quality_plan_switch_guard AFTER UPDATE OF adopted_version_id ON planning_objects FOR EACH ROW EXECUTE FUNCTION stale_quality_on_plan_switch();

CREATE FUNCTION stale_quality_on_plan_version_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
  IF (NEW.stale_at IS NOT NULL AND OLD.stale_at IS NULL) OR (NEW.status IN ('rejected','superseded') AND NEW.status IS DISTINCT FROM OLD.status) THEN
    FOR item IN SELECT report_id FROM new_design.quality_report_planning_versions WHERE planning_version_id=NEW.id LOOP
      PERFORM new_design.stale_quality_report(item.report_id,'引用的规划版本已失效。');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quality_plan_version_change_guard AFTER UPDATE OF stale_at,status ON planning_versions FOR EACH ROW EXECUTE FUNCTION stale_quality_on_plan_version_change();

CREATE FUNCTION stale_quality_on_fact_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
  IF NEW.status IN ('rejected','superseded','stale') AND NEW.status IS DISTINCT FROM OLD.status THEN
    FOR item IN SELECT report_id FROM new_design.quality_report_facts WHERE fact_id=NEW.id LOOP
      PERFORM new_design.stale_quality_report(item.report_id,'引用的事实已失效。');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quality_fact_change_guard AFTER UPDATE OF status ON canonical_facts FOR EACH ROW EXECUTE FUNCTION stale_quality_on_fact_change();

CREATE INDEX quality_reports_book_idx ON quality_audit_reports(book_id,created_at DESC,id DESC);
CREATE INDEX quality_reports_stale_idx ON quality_audit_reports(book_id,stale_at) WHERE stale_at IS NOT NULL;
CREATE INDEX quality_issues_filter_idx ON quality_issues(book_id,current_status,is_quality_debt,created_at DESC,id DESC);
CREATE INDEX quality_issue_versions_category_idx ON quality_issue_versions(category_key,severity);
CREATE INDEX quality_issue_evidence_issue_idx ON quality_issue_evidence(issue_version_id,created_at,id);
CREATE INDEX quality_fix_candidates_issue_idx ON quality_fix_candidates(issue_id,created_at,id);
CREATE INDEX quality_rechecks_issue_idx ON quality_rechecks(issue_id,created_at,id);
