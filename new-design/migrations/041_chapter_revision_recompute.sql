SET search_path TO new_design, public;

CREATE TABLE chapter_revision_previews (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chapter_adoption_sessions(id),
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  old_body_version_id uuid NOT NULL,
  new_body_version_id uuid NOT NULL,
  old_settlement_id uuid NOT NULL REFERENCES chapter_settlements(id),
  old_checkpoint_id uuid NOT NULL REFERENCES chapter_stable_checkpoints(id),
  restart_checkpoint_id uuid REFERENCES chapter_stable_checkpoints(id),
  expected_document_revision integer NOT NULL CHECK(expected_document_revision>0),
  dependency_generation jsonb NOT NULL CHECK(jsonb_typeof(dependency_generation)='array'),
  body_diff_summary jsonb NOT NULL CHECK(jsonb_typeof(body_diff_summary)='object'),
  impact_summary jsonb NOT NULL CHECK(jsonb_typeof(impact_summary)='object'),
  snapshot_hash char(64) NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','consumed','expired','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(old_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  FOREIGN KEY(new_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  UNIQUE(book_id,idempotency_key)
);

CREATE UNIQUE INDEX chapter_revision_previews_ready_session_uidx
  ON chapter_revision_previews(session_id) WHERE status='ready';

CREATE TABLE chapter_revision_impacts (
  id uuid PRIMARY KEY,
  preview_id uuid NOT NULL REFERENCES chapter_revision_previews(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK(sequence>0),
  category text NOT NULL CHECK(category IN ('fact','knowledge','character_state','relationship','prop','event','foreshadow','later_body','planning','context','quality','ai_run','graph_index','semantic_index','other')),
  target_kind text NOT NULL CHECK(length(target_kind) BETWEEN 1 AND 120),
  target_id uuid NOT NULL,
  target_version_id uuid,
  target_chapter_document_id uuid REFERENCES chapter_documents(id),
  target_chapter_order integer CHECK(target_chapter_order IS NULL OR target_chapter_order>0),
  source_mode text NOT NULL CHECK(source_mode IN ('exclusive','shared','manual_correction','manual_locked','derived_cache','downstream_body')),
  risk_level text NOT NULL CHECK(risk_level IN ('low','medium','high','critical')),
  reason_chain jsonb NOT NULL CHECK(jsonb_typeof(reason_chain)='array' AND jsonb_array_length(reason_chain)>0),
  recommended_action text NOT NULL CHECK(recommended_action IN ('auto_recompute','review_manually','mark_stale','keep_manual_correction','defer')),
  allowed_actions text[] NOT NULL CHECK(cardinality(allowed_actions)>0 AND allowed_actions <@ ARRAY['auto_recompute','review_manually','mark_stale','keep_manual_correction','defer']::text[]),
  active_source_count integer NOT NULL DEFAULT 1 CHECK(active_source_count>=0),
  manual_protected boolean NOT NULL DEFAULT false,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(preview_id,sequence),
  UNIQUE(preview_id,target_kind,target_id,target_version_id)
);

CREATE TABLE chapter_revision_plans (
  id uuid PRIMARY KEY,
  preview_id uuid NOT NULL UNIQUE REFERENCES chapter_revision_previews(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  expected_preview_revision integer NOT NULL CHECK(expected_preview_revision>0),
  expected_document_revision integer NOT NULL CHECK(expected_document_revision>0),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','executing','completed','partially_failed','failed','cancelled')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(summary)='object'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  created_by text NOT NULL DEFAULT '',
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE chapter_revision_plan_items (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES chapter_revision_plans(id) ON DELETE CASCADE,
  impact_id uuid NOT NULL REFERENCES chapter_revision_impacts(id),
  selected_action text NOT NULL CHECK(selected_action IN ('auto_recompute','review_manually','mark_stale','keep_manual_correction','defer')),
  decision_source text NOT NULL CHECK(decision_source IN ('default','user')),
  note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  decided_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,impact_id)
);

CREATE TABLE chapter_revision_executions (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL UNIQUE REFERENCES chapter_revision_plans(id),
  preview_id uuid NOT NULL UNIQUE REFERENCES chapter_revision_previews(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  old_body_version_id uuid NOT NULL,
  new_body_version_id uuid NOT NULL,
  old_checkpoint_id uuid NOT NULL REFERENCES chapter_stable_checkpoints(id),
  restart_checkpoint_id uuid REFERENCES chapter_stable_checkpoints(id),
  adoption_id uuid NOT NULL UNIQUE REFERENCES chapter_body_adoptions(id),
  invalidation_event_id uuid REFERENCES dependency_invalidation_events(id),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','awaiting_review','partially_failed','stable','failed','cancelled','dead_letter')),
  current_step integer NOT NULL DEFAULT 0 CHECK(current_step>=0),
  total_steps integer NOT NULL DEFAULT 0 CHECK(total_steps>=0),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  actor text NOT NULL DEFAULT '',
  error_summary text NOT NULL DEFAULT '' CHECK(length(error_summary)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY(old_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  FOREIGN KEY(new_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE chapter_revision_recompute_steps (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES chapter_revision_executions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK(sequence>0),
  predecessor_step_id uuid REFERENCES chapter_revision_recompute_steps(id),
  impact_id uuid REFERENCES chapter_revision_impacts(id),
  chapter_document_id uuid REFERENCES chapter_documents(id),
  chapter_order integer CHECK(chapter_order IS NULL OR chapter_order>0),
  step_kind text NOT NULL CHECK(step_kind IN ('invalidate_source','recompute_chapter','review_body','rebuild_graph','rebuild_semantic')),
  selected_action text NOT NULL CHECK(selected_action IN ('auto_recompute','review_manually','mark_stale','keep_manual_correction','defer')),
  dependency_request_id uuid REFERENCES dependency_recompute_requests(id),
  background_job_id uuid REFERENCES background_jobs(id),
  status text NOT NULL DEFAULT 'blocked' CHECK(status IN ('blocked','queued','running','candidate_ready','review_required','succeeded','failed','cancelled','dead_letter','skipped')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(result)='object'),
  error_summary text NOT NULL DEFAULT '' CHECK(length(error_summary)<=2000),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(execution_id,sequence),
  UNIQUE(execution_id,idempotency_key)
);

CREATE TABLE chapter_revision_review_flags (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES chapter_revision_executions(id) ON DELETE CASCADE,
  changed_chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id),
  target_chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id),
  target_body_version_id uuid REFERENCES chapter_body_versions(id),
  impact_id uuid REFERENCES chapter_revision_impacts(id),
  status text NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','in_review','resolved','retained','cancelled')),
  reason text NOT NULL,
  source_route text NOT NULL,
  manual_protected boolean NOT NULL DEFAULT false,
  resolution_note text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(execution_id,target_chapter_document_id)
);

CREATE TABLE chapter_revision_protection_marks (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK(length(target_kind) BETWEEN 1 AND 120),
  target_id uuid NOT NULL,
  protection_kind text NOT NULL CHECK(protection_kind IN ('manual_correction','manual_lock')),
  source_execution_id uuid REFERENCES chapter_revision_executions(id),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,target_kind,target_id,protection_kind)
);

CREATE TABLE chapter_revision_events (
  id uuid PRIMARY KEY,
  preview_id uuid REFERENCES chapter_revision_previews(id),
  plan_id uuid REFERENCES chapter_revision_plans(id),
  execution_id uuid REFERENCES chapter_revision_executions(id),
  event_kind text NOT NULL CHECK(event_kind IN ('preview_created','preview_expired','plan_saved','execution_confirmed','source_invalidated','recompute_queued','step_updated','review_resolved','execution_failed','execution_completed')),
  actor text NOT NULL DEFAULT '',
  idempotency_key text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(preview_id,plan_id,execution_id)>=1)
);

CREATE UNIQUE INDEX chapter_revision_events_idempotency_unique ON chapter_revision_events(COALESCE(execution_id,plan_id,preview_id),idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX chapter_revision_impacts_preview_idx ON chapter_revision_impacts(preview_id,category,risk_level,sequence);
CREATE INDEX chapter_revision_executions_book_idx ON chapter_revision_executions(book_id,status,updated_at DESC,id);
CREATE INDEX chapter_revision_steps_execution_idx ON chapter_revision_recompute_steps(execution_id,status,sequence);
CREATE INDEX chapter_revision_review_flags_book_idx ON chapter_revision_review_flags(book_id,status,target_chapter_document_id,updated_at DESC);

CREATE FUNCTION guard_chapter_revision_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'chapter revision audit rows are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER chapter_revision_impacts_guard BEFORE UPDATE OR DELETE ON chapter_revision_impacts FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_append_only();
CREATE TRIGGER chapter_revision_events_guard BEFORE UPDATE OR DELETE ON chapter_revision_events FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_append_only();
CREATE TRIGGER chapter_revision_protection_marks_guard BEFORE UPDATE OR DELETE ON chapter_revision_protection_marks FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_append_only();

CREATE FUNCTION validate_chapter_revision_preview_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row record;
BEGIN
  SELECT session.book_id,session.chapter_document_id,session.prior_body_version_id,session.body_version_id,
         checkpoint.settlement_id checkpoint_settlement_id
  INTO source_row FROM chapter_adoption_sessions session
  JOIN chapter_stable_checkpoints checkpoint ON checkpoint.id=NEW.old_checkpoint_id
  WHERE session.id=NEW.session_id;
  IF NOT FOUND OR ROW(NEW.book_id,NEW.chapter_document_id,NEW.old_body_version_id,NEW.new_body_version_id,NEW.old_settlement_id)
    IS DISTINCT FROM ROW(source_row.book_id,source_row.chapter_document_id,source_row.prior_body_version_id,source_row.body_version_id,source_row.checkpoint_settlement_id)
  THEN RAISE EXCEPTION 'chapter revision preview sources do not match adoption session and checkpoint' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_previews_insert_guard BEFORE INSERT ON chapter_revision_previews FOR EACH ROW EXECUTE FUNCTION validate_chapter_revision_preview_insert();

CREATE FUNCTION guard_chapter_revision_preview_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter revision preview cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','revision','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at']::text[]) THEN RAISE EXCEPTION 'chapter revision preview snapshot is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 OR OLD.status<>'ready' OR NEW.status NOT IN ('consumed','expired','cancelled') THEN RAISE EXCEPTION 'invalid chapter revision preview transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_previews_update_guard BEFORE UPDATE OR DELETE ON chapter_revision_previews FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_preview_update();

CREATE FUNCTION guard_chapter_revision_plan_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter revision plan cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','summary','revision','confirmed_by','confirmed_at','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','summary','revision','confirmed_by','confirmed_at','updated_at']::text[]) THEN RAISE EXCEPTION 'chapter revision plan identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'chapter revision plan revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='draft' AND NEW.status IN ('draft','confirmed','cancelled')) OR (OLD.status='confirmed' AND NEW.status IN ('executing','cancelled')) OR (OLD.status='executing' AND NEW.status IN ('completed','partially_failed','failed','cancelled'))) THEN RAISE EXCEPTION 'invalid chapter revision plan transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_plans_update_guard BEFORE UPDATE OR DELETE ON chapter_revision_plans FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_plan_update();

CREATE FUNCTION validate_chapter_revision_plan_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE preview chapter_revision_previews%ROWTYPE;
BEGIN
  SELECT * INTO preview FROM chapter_revision_previews WHERE id=NEW.preview_id;
  IF NOT FOUND OR NEW.book_id<>preview.book_id OR NEW.expected_preview_revision<>preview.revision OR NEW.expected_document_revision<>preview.expected_document_revision THEN RAISE EXCEPTION 'chapter revision plan does not match frozen preview' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_plans_insert_guard BEFORE INSERT ON chapter_revision_plans FOR EACH ROW EXECUTE FUNCTION validate_chapter_revision_plan_insert();

CREATE FUNCTION guard_chapter_revision_plan_item_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE impact chapter_revision_impacts%ROWTYPE; plan_preview uuid;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter revision plan item cannot be deleted' USING ERRCODE='23514'; END IF;
  SELECT * INTO impact FROM chapter_revision_impacts WHERE id=NEW.impact_id;
  SELECT preview_id INTO plan_preview FROM chapter_revision_plans WHERE id=NEW.plan_id;
  IF NOT FOUND OR impact.preview_id IS DISTINCT FROM plan_preview THEN RAISE EXCEPTION 'chapter revision plan item impact belongs to another preview' USING ERRCODE='23514'; END IF;
  IF NOT NEW.selected_action=ANY(impact.allowed_actions) THEN RAISE EXCEPTION 'selected action is not allowed for impact' USING ERRCODE='23514'; END IF;
  IF impact.risk_level IN ('high','critical') AND NEW.selected_action='defer' THEN RAISE EXCEPTION 'high risk impact cannot be deferred' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.impact_id IS DISTINCT FROM OLD.impact_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'invalid chapter revision plan item update' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_plan_items_guard BEFORE INSERT OR UPDATE OR DELETE ON chapter_revision_plan_items FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_plan_item_update();

CREATE FUNCTION guard_chapter_revision_execution_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter revision execution cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','current_step','total_steps','revision','error_summary','updated_at','completed_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_step','total_steps','revision','error_summary','updated_at','completed_at']::text[]) THEN RAISE EXCEPTION 'chapter revision execution identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'chapter revision execution revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','failed','cancelled')) OR (OLD.status='running' AND NEW.status IN ('running','awaiting_review','partially_failed','stable','failed','cancelled','dead_letter')) OR (OLD.status='awaiting_review' AND NEW.status IN ('running','partially_failed','stable','failed','cancelled')) OR (OLD.status='partially_failed' AND NEW.status IN ('running','awaiting_review','stable','failed','cancelled')) OR (OLD.status='failed' AND NEW.status IN ('running','awaiting_review','stable','cancelled')) OR OLD.status=NEW.status) THEN RAISE EXCEPTION 'invalid chapter revision execution transition' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('stable','cancelled','dead_letter') THEN RAISE EXCEPTION 'terminal chapter revision execution is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_executions_update_guard BEFORE UPDATE OR DELETE ON chapter_revision_executions FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_execution_update();

CREATE FUNCTION validate_chapter_revision_execution_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row record;
BEGIN
  SELECT plan.preview_id,plan.book_id,preview.chapter_document_id,preview.old_body_version_id,preview.new_body_version_id,preview.old_checkpoint_id,preview.restart_checkpoint_id
  INTO source_row FROM chapter_revision_plans plan JOIN chapter_revision_previews preview ON preview.id=plan.preview_id WHERE plan.id=NEW.plan_id;
  IF NOT FOUND OR ROW(NEW.preview_id,NEW.book_id,NEW.chapter_document_id,NEW.old_body_version_id,NEW.new_body_version_id,NEW.old_checkpoint_id,NEW.restart_checkpoint_id)
    IS DISTINCT FROM ROW(source_row.preview_id,source_row.book_id,source_row.chapter_document_id,source_row.old_body_version_id,source_row.new_body_version_id,source_row.old_checkpoint_id,source_row.restart_checkpoint_id)
  THEN RAISE EXCEPTION 'chapter revision execution does not match plan and preview' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_executions_insert_guard BEFORE INSERT ON chapter_revision_executions FOR EACH ROW EXECUTE FUNCTION validate_chapter_revision_execution_insert();

CREATE FUNCTION guard_chapter_revision_step_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter revision step cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['dependency_request_id','background_job_id','status','result','error_summary','updated_at','completed_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['dependency_request_id','background_job_id','status','result','error_summary','updated_at','completed_at']::text[]) THEN RAISE EXCEPTION 'chapter revision step identity is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_steps_update_guard BEFORE UPDATE OR DELETE ON chapter_revision_recompute_steps FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_step_update();

CREATE FUNCTION guard_chapter_revision_review_flag_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter revision review flag cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','resolution_note','revision','updated_at','resolved_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resolution_note','revision','updated_at','resolved_at']::text[]) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'invalid chapter revision review flag update' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_review_flags_update_guard BEFORE UPDATE OR DELETE ON chapter_revision_review_flags FOR EACH ROW EXECUTE FUNCTION guard_chapter_revision_review_flag_update();

CREATE FUNCTION validate_chapter_revision_review_flag_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution_row chapter_revision_executions%ROWTYPE; impact_preview uuid; body_document uuid; execution_found boolean;
BEGIN
  SELECT * INTO execution_row FROM chapter_revision_executions WHERE id=NEW.execution_id;
  execution_found:=FOUND;
  IF NEW.impact_id IS NOT NULL THEN SELECT preview_id INTO impact_preview FROM chapter_revision_impacts WHERE id=NEW.impact_id; END IF;
  IF NEW.target_body_version_id IS NOT NULL THEN SELECT chapter_document_id INTO body_document FROM chapter_body_versions WHERE id=NEW.target_body_version_id; END IF;
  IF NOT execution_found OR NEW.book_id<>execution_row.book_id OR NEW.changed_chapter_document_id<>execution_row.chapter_document_id OR (NEW.impact_id IS NOT NULL AND impact_preview IS DISTINCT FROM execution_row.preview_id) OR (NEW.target_body_version_id IS NOT NULL AND body_document IS DISTINCT FROM NEW.target_chapter_document_id) THEN RAISE EXCEPTION 'chapter revision review flag sources do not match execution' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_review_flags_insert_guard BEFORE INSERT ON chapter_revision_review_flags FOR EACH ROW EXECUTE FUNCTION validate_chapter_revision_review_flag_insert();

CREATE OR REPLACE FUNCTION guard_chapter_adoption_session_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.book_id,NEW.chapter_document_id,NEW.body_version_id,NEW.preparation_id,NEW.prior_body_version_id,
         NEW.policy_version_id,NEW.planning_object_id,NEW.planning_version_id,NEW.context_manifest_id,
         NEW.dependency_hash,NEW.adoption_kind,NEW.idempotency_key,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.book_id,OLD.chapter_document_id,OLD.body_version_id,OLD.preparation_id,OLD.prior_body_version_id,
         OLD.policy_version_id,OLD.planning_object_id,OLD.planning_version_id,OLD.context_manifest_id,
         OLD.dependency_hash,OLD.adoption_kind,OLD.idempotency_key,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'adoption session frozen references are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'adoption session revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='reviewing' AND NEW.status IN ('adopted_pending_proposals','impact_review_required','cancelled','failed')) OR
    (OLD.status='impact_review_required' AND NEW.status IN ('adopted_pending_proposals','cancelled','failed')) OR
    (OLD.status='adopted_pending_proposals' AND NEW.status IN ('pending_review','settling','failed')) OR
    (OLD.status='pending_review' AND NEW.status IN ('partially_confirmed','settling','failed')) OR
    (OLD.status='partially_confirmed' AND NEW.status IN ('pending_review','settling','failed')) OR
    (OLD.status='settling' AND NEW.status IN ('stable','failed')) OR
    (OLD.status='failed' AND NEW.status IN ('pending_review','settling','cancelled')) OR
    (OLD.status=NEW.status)
  ) THEN RAISE EXCEPTION 'invalid adoption session status transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('stable','cancelled') THEN RAISE EXCEPTION 'terminal adoption session is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='stable' AND (NEW.adoption_id IS NULL OR NEW.settlement_id IS NULL) THEN RAISE EXCEPTION 'stable adoption session requires adoption and settlement' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION reconcile_chapter_revision_after_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution_row chapter_revision_executions%ROWTYPE; pending_count integer;
BEGIN
  SELECT * INTO execution_row FROM chapter_revision_executions
  WHERE chapter_document_id=NEW.chapter_document_id AND new_body_version_id=NEW.body_version_id
    AND status IN ('queued','running','awaiting_review','partially_failed','failed')
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT count(*) INTO pending_count FROM chapter_revision_review_flags WHERE execution_id=execution_row.id AND status IN ('pending_review','in_review');
  UPDATE chapter_revision_executions SET status=CASE WHEN pending_count=0 THEN 'stable' ELSE 'awaiting_review' END,current_step=total_steps,revision=revision+1,error_summary='',updated_at=now(),completed_at=CASE WHEN pending_count=0 THEN now() ELSE NULL END WHERE id=execution_row.id;
  IF pending_count=0 THEN UPDATE chapter_revision_plans SET status='completed',revision=revision+1,updated_at=now() WHERE id=execution_row.plan_id AND status='executing'; END IF;
  INSERT INTO chapter_revision_events(id,preview_id,plan_id,execution_id,event_kind,actor,detail)
  VALUES(gen_random_uuid(),execution_row.preview_id,execution_row.plan_id,execution_row.id,CASE WHEN pending_count=0 THEN 'execution_completed' ELSE 'step_updated' END,'system',jsonb_build_object('stableCheckpointId',NEW.id,'pendingReviewCount',pending_count));
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_checkpoint_reconcile AFTER INSERT ON chapter_stable_checkpoints FOR EACH ROW EXECUTE FUNCTION reconcile_chapter_revision_after_checkpoint();

CREATE FUNCTION reconcile_chapter_revision_after_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution_row chapter_revision_executions%ROWTYPE; pending_count integer; stable_exists boolean;
BEGIN
  IF NEW.status NOT IN ('resolved','retained','cancelled') THEN RETURN NEW; END IF;
  SELECT * INTO execution_row FROM chapter_revision_executions WHERE id=NEW.execution_id FOR UPDATE;
  SELECT count(*) INTO pending_count FROM chapter_revision_review_flags WHERE execution_id=NEW.execution_id AND status IN ('pending_review','in_review');
  SELECT EXISTS(SELECT 1 FROM chapter_stable_checkpoints WHERE chapter_document_id=execution_row.chapter_document_id AND body_version_id=execution_row.new_body_version_id AND status='stable') INTO stable_exists;
  IF pending_count=0 AND stable_exists AND execution_row.status NOT IN ('stable','cancelled','dead_letter') THEN
    UPDATE chapter_revision_executions SET status='stable',current_step=total_steps,revision=revision+1,error_summary='',updated_at=now(),completed_at=now() WHERE id=execution_row.id;
    UPDATE chapter_revision_plans SET status='completed',revision=revision+1,updated_at=now() WHERE id=execution_row.plan_id AND status='executing';
    INSERT INTO chapter_revision_events(id,preview_id,plan_id,execution_id,event_kind,actor,detail) VALUES(gen_random_uuid(),execution_row.preview_id,execution_row.plan_id,execution_row.id,'execution_completed','system',jsonb_build_object('reviewFlagId',NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_revision_review_reconcile AFTER UPDATE OF status ON chapter_revision_review_flags FOR EACH ROW EXECUTE FUNCTION reconcile_chapter_revision_after_review();

INSERT INTO schema_migrations(id) VALUES('041_chapter_revision_recompute') ON CONFLICT(id) DO NOTHING;
