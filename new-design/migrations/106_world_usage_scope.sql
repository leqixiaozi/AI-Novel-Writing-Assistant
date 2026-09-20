-- Optional manual extension. Do not register with normal startup migrations.
SET search_path TO new_design,public;
CREATE TABLE world_usage_capability(contract text PRIMARY KEY CHECK(contract='world_usage_scope_v1'),operational boolean NOT NULL DEFAULT false);
INSERT INTO world_usage_capability(contract) VALUES('world_usage_scope_v1');
CREATE TABLE world_usage_candidates(
 id uuid PRIMARY KEY,book_id uuid NOT NULL REFERENCES books(id),root_card_id uuid NOT NULL REFERENCES cards(id),
 request_key uuid NOT NULL,input_hash char(64) NOT NULL,mode text NOT NULL CHECK(mode IN('manual','ai')),
 status text NOT NULL CHECK(status IN('running','review','failed','ended_unknown')),
 source_hash char(64) NOT NULL,sources jsonb NOT NULL,selection jsonb,result_payload jsonb,message text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(book_id,request_key),CHECK((status='review')=(selection IS NOT NULL))
);
CREATE INDEX world_usage_candidates_root ON world_usage_candidates(book_id,root_card_id,created_at DESC);
CREATE TABLE world_usage_adoptions(
 id uuid PRIMARY KEY,book_id uuid NOT NULL REFERENCES books(id),root_card_id uuid NOT NULL REFERENCES cards(id),
 candidate_id uuid NOT NULL UNIQUE REFERENCES world_usage_candidates(id),request_key uuid NOT NULL,
 input_hash char(64) NOT NULL,version integer NOT NULL CHECK(version>0),source_hash char(64) NOT NULL,
 sources jsonb NOT NULL,selection jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(book_id,request_key),UNIQUE(book_id,root_card_id,version)
);
CREATE INDEX world_usage_adoptions_root ON world_usage_adoptions(book_id,root_card_id,version DESC);
CREATE FUNCTION guard_world_usage_adoption() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'world usage adoption immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM world_usage_capability WHERE contract='world_usage_scope_v1' AND operational)
  OR NOT EXISTS(SELECT 1 FROM world_usage_candidates candidate WHERE candidate.id=NEW.candidate_id AND candidate.book_id=NEW.book_id AND candidate.root_card_id=NEW.root_card_id AND candidate.status='review' AND candidate.source_hash=NEW.source_hash AND candidate.sources=NEW.sources AND candidate.selection=NEW.selection)
 THEN RAISE EXCEPTION 'world usage adoption source mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_usage_adoption_guard BEFORE INSERT OR UPDATE OR DELETE ON world_usage_adoptions FOR EACH ROW EXECUTE FUNCTION guard_world_usage_adoption();
