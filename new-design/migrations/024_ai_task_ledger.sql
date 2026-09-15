SET search_path TO new_design, public;

CREATE TABLE ai_tasks (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  source_route text NOT NULL CHECK(source_route ~ '^/'),
  source_kind text NOT NULL,
  source_id uuid,
  request_idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN -100 AND 100),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting_approval','retry_scheduled','paused','succeeded','failed','cancelled')),
  current_step_key text,
  current_checkpoint text,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(space_id,request_idempotency_key),
  UNIQUE(id,space_id)
);

CREATE FUNCTION validate_ai_task_book_space() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM new_design.books book WHERE book.id=NEW.book_id AND book.space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'AI task book and space mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_tasks_book_space_guard BEFORE INSERT OR UPDATE ON ai_tasks FOR EACH ROW EXECUTE FUNCTION validate_ai_task_book_space();

CREATE TABLE ai_task_steps (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  sort_order integer NOT NULL CHECK(sort_order>=0),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting_approval','retry_scheduled','paused','succeeded','failed','cancelled')),
  checkpoint_key text,
  current_attempt_id uuid,
  max_attempts integer NOT NULL CHECK(max_attempts>0),
  retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count>=0),
  next_retry_at timestamptz,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(task_id,step_key),
  UNIQUE(task_id,sort_order),
  UNIQUE(id,task_id)
);

CREATE TABLE ai_task_attempts (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL,
  step_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK(attempt_number>0),
  trigger_kind text NOT NULL CHECK(trigger_kind IN ('initial','technical_retry','manual_retry','recovery')),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled','discarded')),
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  prompt_recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id),
  context_manifest_id uuid NOT NULL REFERENCES context_manifests(id),
  model_route_snapshot_id uuid NOT NULL REFERENCES model_route_snapshots(id),
  input_hash char(64) NOT NULL,
  output_schema_version text NOT NULL,
  checkpoint_key text,
  lease_token_digest char(64) NOT NULL,
  provider_request_digest char(64),
  result_kind text,
  result_stable_id uuid,
  result_version_id uuid,
  result_hash char(64),
  error_category text CHECK(error_category IS NULL OR error_category IN ('timeout','rate_limit','authentication','provider_unavailable','transport','context_limit','structure_parse','content_unsatisfactory','cancelled','safety','data_integrity','unknown')),
  retry_eligibility text CHECK(retry_eligibility IS NULL OR retry_eligibility IN ('technical','manual','none')),
  error_summary text NOT NULL DEFAULT '',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(step_id,attempt_number),
  UNIQUE(id,step_id),
  FOREIGN KEY(step_id,task_id) REFERENCES ai_task_steps(id,task_id) ON DELETE CASCADE,
  CHECK((result_kind IS NULL AND result_stable_id IS NULL AND result_version_id IS NULL AND result_hash IS NULL) OR (result_kind IS NOT NULL AND result_stable_id IS NOT NULL AND result_hash IS NOT NULL)),
  CHECK((status IN ('succeeded','failed','cancelled','discarded') AND ended_at IS NOT NULL) OR (status IN ('queued','running') AND ended_at IS NULL)),
  CHECK((status='failed' AND error_category IS NOT NULL AND retry_eligibility IS NOT NULL) OR status<>'failed')
);

ALTER TABLE ai_task_steps ADD CONSTRAINT ai_task_steps_current_attempt_fk FOREIGN KEY(current_attempt_id,id) REFERENCES ai_task_attempts(id,step_id);

CREATE TABLE ai_task_state_events (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  step_id uuid REFERENCES ai_task_steps(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES ai_task_attempts(id) ON DELETE CASCADE,
  entity_kind text NOT NULL CHECK(entity_kind IN ('task','step','attempt')),
  from_status text,
  to_status text NOT NULL,
  checkpoint_key text,
  reason_code text NOT NULL,
  reason_detail text NOT NULL DEFAULT '',
  actor_kind text NOT NULL CHECK(actor_kind IN ('user','worker','system','policy')),
  actor text NOT NULL DEFAULT '',
  entity_revision integer CHECK(entity_revision IS NULL OR entity_revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((entity_kind='task' AND step_id IS NULL AND attempt_id IS NULL) OR (entity_kind='step' AND step_id IS NOT NULL AND attempt_id IS NULL) OR (entity_kind='attempt' AND step_id IS NOT NULL AND attempt_id IS NOT NULL))
);

CREATE TABLE ai_approval_requests (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  step_id uuid REFERENCES ai_task_steps(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES ai_task_attempts(id) ON DELETE CASCADE,
  request_version integer NOT NULL CHECK(request_version>0),
  scope_kind text NOT NULL CHECK(scope_kind IN ('task','step','attempt','result_candidate')),
  scope_id uuid NOT NULL,
  reason_code text NOT NULL,
  reason_detail text NOT NULL,
  request_hash char(64) NOT NULL,
  requested_by_kind text NOT NULL CHECK(requested_by_kind IN ('worker','system','policy','user')),
  requested_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id,scope_kind,scope_id,request_version)
);

CREATE TABLE ai_approval_decisions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES ai_approval_requests(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK(decision IN ('approved','rejected','changes_requested','expired')),
  decided_by_kind text NOT NULL CHECK(decided_by_kind IN ('user','system','policy')),
  decided_by text NOT NULL,
  policy_version text,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_attempt_usage (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES ai_task_steps(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE REFERENCES ai_task_attempts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens bigint CHECK(input_tokens IS NULL OR input_tokens>=0),
  output_tokens bigint CHECK(output_tokens IS NULL OR output_tokens>=0),
  cached_input_tokens bigint CHECK(cached_input_tokens IS NULL OR cached_input_tokens>=0),
  duration_ms bigint CHECK(duration_ms IS NULL OR duration_ms>=0),
  estimated_cost numeric(18,8) CHECK(estimated_cost IS NULL OR estimated_cost>=0),
  currency text,
  fallback_count integer NOT NULL DEFAULT 0 CHECK(fallback_count>=0),
  budget_decision text NOT NULL CHECK(budget_decision IN ('unknown','within_budget','exceeded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((estimated_cost IS NULL AND currency IS NULL) OR (estimated_cost IS NOT NULL AND currency IS NOT NULL))
);

CREATE FUNCTION guard_ai_task_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','current_step_key','current_checkpoint','revision','updated_at','completed_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_step_key','current_checkpoint','revision','updated_at','completed_at']::text[]) THEN
    RAISE EXCEPTION 'AI task identity and frozen contract are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'AI task revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','paused','cancelled')) OR
          (OLD.status='running' AND NEW.status IN ('running','waiting_approval','retry_scheduled','paused','succeeded','failed','cancelled')) OR
          (OLD.status='waiting_approval' AND NEW.status IN ('running','paused','failed','cancelled')) OR
          (OLD.status='retry_scheduled' AND NEW.status IN ('running','paused','failed','cancelled')) OR
          (OLD.status='paused' AND NEW.status IN ('running','failed','cancelled'))) THEN
    RAISE EXCEPTION 'illegal AI task status transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_tasks_transition_guard BEFORE UPDATE ON ai_tasks FOR EACH ROW EXECUTE FUNCTION guard_ai_task_transition();

CREATE FUNCTION guard_ai_step_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','checkpoint_key','current_attempt_id','retry_count','next_retry_at','lease_owner','lease_token','lease_expires_at','heartbeat_at','revision','updated_at','completed_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','checkpoint_key','current_attempt_id','retry_count','next_retry_at','lease_owner','lease_token','lease_expires_at','heartbeat_at','revision','updated_at','completed_at']::text[]) THEN
    RAISE EXCEPTION 'AI step definition is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'AI step revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','paused','cancelled')) OR
          (OLD.status='running' AND NEW.status IN ('running','waiting_approval','retry_scheduled','paused','succeeded','failed','cancelled')) OR
          (OLD.status='waiting_approval' AND NEW.status IN ('running','paused','failed','cancelled')) OR
          (OLD.status='retry_scheduled' AND NEW.status IN ('running','paused','failed','cancelled')) OR
          (OLD.status='paused' AND NEW.status IN ('running','failed','cancelled'))) THEN
    RAISE EXCEPTION 'illegal AI step status transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_task_steps_transition_guard BEFORE UPDATE ON ai_task_steps FOR EACH ROW EXECUTE FUNCTION guard_ai_step_transition();

CREATE FUNCTION guard_ai_attempt_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('succeeded','failed','cancelled','discarded') THEN RAISE EXCEPTION 'finished AI attempt is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','provider_request_digest','result_kind','result_stable_id','result_version_id','result_hash','error_category','retry_eligibility','error_summary','started_at','ended_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','provider_request_digest','result_kind','result_stable_id','result_version_id','result_hash','error_category','retry_eligibility','error_summary','started_at','ended_at']::text[]) THEN
    RAISE EXCEPTION 'AI attempt frozen inputs are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','cancelled')) OR (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled','discarded'))) THEN
    RAISE EXCEPTION 'illegal AI attempt status transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_task_attempts_update_guard BEFORE UPDATE OR DELETE ON ai_task_attempts FOR EACH ROW EXECUTE FUNCTION guard_ai_attempt_update();

CREATE FUNCTION guard_ai_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AI ledger rows are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER ai_task_state_events_append_only BEFORE UPDATE OR DELETE ON ai_task_state_events FOR EACH ROW EXECUTE FUNCTION guard_ai_ledger_append_only();
CREATE TRIGGER ai_approval_requests_append_only BEFORE UPDATE OR DELETE ON ai_approval_requests FOR EACH ROW EXECUTE FUNCTION guard_ai_ledger_append_only();
CREATE TRIGGER ai_approval_decisions_append_only BEFORE UPDATE OR DELETE ON ai_approval_decisions FOR EACH ROW EXECUTE FUNCTION guard_ai_ledger_append_only();
CREATE TRIGGER ai_attempt_usage_append_only BEFORE UPDATE OR DELETE ON ai_attempt_usage FOR EACH ROW EXECUTE FUNCTION guard_ai_ledger_append_only();

CREATE INDEX ai_tasks_book_status_idx ON ai_tasks(book_id,status,created_at DESC,id);
CREATE INDEX ai_tasks_space_status_idx ON ai_tasks(space_id,status,created_at DESC,id);
CREATE INDEX ai_task_steps_recovery_idx ON ai_task_steps(status,lease_expires_at) WHERE status='running';
CREATE INDEX ai_task_attempts_failure_idx ON ai_task_attempts(error_category,ended_at DESC) WHERE status='failed';
CREATE INDEX ai_approval_requests_task_idx ON ai_approval_requests(task_id,created_at DESC);
CREATE INDEX ai_attempt_usage_task_idx ON ai_attempt_usage(task_id,created_at DESC);
