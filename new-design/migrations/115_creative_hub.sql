-- Independent read-only Creative Hub conversations and frozen diagnostic receipts.
SET search_path TO new_design, public;

ALTER TABLE model_route_snapshots DROP CONSTRAINT model_route_snapshots_managed_scope_check;
ALTER TABLE model_route_snapshots ADD CONSTRAINT model_route_snapshots_managed_scope_check CHECK (
  (book_id IS NOT NULL AND task_contract_version_id IS NOT NULL AND managed_task_key IS NULL) OR
  (book_id IS NULL AND task_contract_version_id IS NULL AND managed_task_key IS NOT NULL AND managed_task_key IN (
    'directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate',
    'chapter_settlement','chapter_generation','quality_audit','world_consistency','creative_extraction','character_dialogue','creative_hub'
  ))
);

CREATE TABLE creative_hub_threads (
 id uuid PRIMARY KEY,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
 binding jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(binding)='object'),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creative_hub_threads_recent ON creative_hub_threads(status,updated_at DESC,id DESC);

CREATE TABLE creative_hub_turns (
 id uuid PRIMARY KEY,
 thread_id uuid NOT NULL REFERENCES creative_hub_threads(id),
 request_key uuid NOT NULL,
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 question text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 4000),
 frozen_state jsonb NOT NULL CHECK (jsonb_typeof(frozen_state)='object'),
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','result_unknown')),
 result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
 failure text,
 prompt_snapshot jsonb CHECK (prompt_snapshot IS NULL OR jsonb_typeof(prompt_snapshot)='object'),
 model_snapshot jsonb CHECK (model_snapshot IS NULL OR jsonb_typeof(model_snapshot)='object'),
 used_tokens integer CHECK (used_tokens IS NULL OR used_tokens>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(thread_id,request_key)
);
CREATE INDEX creative_hub_turns_thread_recent ON creative_hub_turns(thread_id,created_at DESC,id DESC);

CREATE FUNCTION guard_creative_hub_thread_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'creative hub threads are archived, never deleted' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER creative_hub_threads_no_delete BEFORE DELETE ON creative_hub_threads FOR EACH ROW EXECUTE FUNCTION guard_creative_hub_thread_delete();

CREATE FUNCTION guard_creative_hub_turn_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.request_key IS DISTINCT FROM OLD.request_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.question IS DISTINCT FROM OLD.question
    OR NEW.frozen_state IS DISTINCT FROM OLD.frozen_state OR NEW.created_at IS DISTINCT FROM OLD.created_at
 THEN RAISE EXCEPTION 'creative hub original turn evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER creative_hub_turn_identity_immutable BEFORE UPDATE OR DELETE ON creative_hub_turns FOR EACH ROW EXECUTE FUNCTION guard_creative_hub_turn_identity();
