-- Independent world generation sessions. Candidates never become public worlds without an explicit publication command.
SET search_path TO new_design, public;

INSERT INTO relation_types(id,relation_key,name,description,direction,source_type_keys,target_type_keys,scope,properties_schema)
VALUES('11600000-0000-4000-8000-000000000001','world_sample_relation','世界样本关系','世界生成候选明确发布时保留的势力、地点及世界对象关系。','directed',ARRAY['world_overview','organization','location'],ARRAY['world_overview','organization','location'],'system','[{"key":"relation","name":"关系","type":"short_text","required":true},{"key":"tension","name":"张力","type":"long_text","required":true}]'::jsonb)
ON CONFLICT(owner_space_id,relation_key) DO NOTHING;

ALTER TABLE model_route_snapshots DROP CONSTRAINT model_route_snapshots_managed_scope_check;
ALTER TABLE model_route_snapshots ADD CONSTRAINT model_route_snapshots_managed_scope_check CHECK (
  (book_id IS NOT NULL AND task_contract_version_id IS NOT NULL AND managed_task_key IS NULL) OR
  (book_id IS NULL AND task_contract_version_id IS NULL AND managed_task_key IS NOT NULL AND managed_task_key IN (
    'directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate','chapter_settlement',
    'chapter_generation','quality_audit','world_consistency','creative_extraction','character_dialogue','creative_hub','world_generation'
  ))
);

CREATE TABLE world_generation_sessions (
 id uuid PRIMARY KEY,
 create_request_key uuid NOT NULL UNIQUE,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 blueprint jsonb NOT NULL CHECK(jsonb_typeof(blueprint)='object'),
 frozen_references jsonb NOT NULL CHECK(jsonb_typeof(frozen_references)='array'),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','published','failed','result_unknown')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 failure text,
 published_candidate_id uuid,
 public_root_card_id uuid REFERENCES cards(id),
 published_package_id uuid REFERENCES world_package_versions(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE world_generation_candidates (
 id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES world_generation_sessions(id),version integer NOT NULL CHECK(version>0),
 request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),source text NOT NULL CHECK(source IN ('manual','ai')),
 based_on_candidate_id uuid REFERENCES world_generation_candidates(id),candidate jsonb NOT NULL CHECK(jsonb_typeof(candidate)='object'),
 prompt_snapshot jsonb CHECK(prompt_snapshot IS NULL OR jsonb_typeof(prompt_snapshot)='object'),model_snapshot jsonb CHECK(model_snapshot IS NULL OR jsonb_typeof(model_snapshot)='object'),used_tokens integer CHECK(used_tokens IS NULL OR used_tokens>=0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(session_id,version),UNIQUE(session_id,id)
);
ALTER TABLE world_generation_sessions ADD CONSTRAINT world_generation_published_candidate_fk FOREIGN KEY(id,published_candidate_id) REFERENCES world_generation_candidates(session_id,id);
CREATE TABLE world_generation_publications (
 id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES world_generation_sessions(id),candidate_id uuid NOT NULL,request_key uuid NOT NULL UNIQUE,input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(session_id,candidate_id) REFERENCES world_generation_candidates(session_id,id)
);
CREATE INDEX world_generation_sessions_recent ON world_generation_sessions(updated_at DESC,id DESC);
CREATE INDEX world_generation_candidates_recent ON world_generation_candidates(session_id,version DESC);

CREATE FUNCTION guard_world_generation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'world generation candidates and publication receipts are immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER world_generation_candidates_immutable BEFORE UPDATE OR DELETE ON world_generation_candidates FOR EACH ROW EXECUTE FUNCTION guard_world_generation_immutable();
CREATE TRIGGER world_generation_publications_immutable BEFORE UPDATE OR DELETE ON world_generation_publications FOR EACH ROW EXECUTE FUNCTION guard_world_generation_immutable();
CREATE FUNCTION guard_world_generation_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' OR NEW.create_request_key IS DISTINCT FROM OLD.create_request_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.blueprint IS DISTINCT FROM OLD.blueprint OR NEW.frozen_references IS DISTINCT FROM OLD.frozen_references OR NEW.source_hash IS DISTINCT FROM OLD.source_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'world generation source identity is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER world_generation_session_identity BEFORE UPDATE OR DELETE ON world_generation_sessions FOR EACH ROW EXECUTE FUNCTION guard_world_generation_session_identity();
