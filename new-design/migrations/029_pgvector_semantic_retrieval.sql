SET search_path TO new_design, public;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE embedding_profiles (
  id uuid PRIMARY KEY,
  profile_key text NOT NULL UNIQUE CHECK(profile_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  name text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('semantic_retrieval','similarity','clustering')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE embedding_profile_versions (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES embedding_profiles(id),
  version integer NOT NULL CHECK(version>0),
  provider_key text NOT NULL CHECK(provider_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  model_key text NOT NULL CHECK(length(model_key) BETWEEN 1 AND 160),
  dimensions integer NOT NULL CHECK(dimensions BETWEEN 1 AND 2000),
  distance_metric text NOT NULL CHECK(distance_metric IN ('cosine','l2','inner_product')),
  normalize boolean NOT NULL DEFAULT false,
  chunker_key text NOT NULL CHECK(chunker_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  chunker_version text NOT NULL CHECK(length(chunker_version) BETWEEN 1 AND 80),
  max_chunk_chars integer NOT NULL CHECK(max_chunk_chars BETWEEN 128 AND 50000),
  overlap_chars integer NOT NULL CHECK(overlap_chars>=0 AND overlap_chars<max_chunk_chars),
  allowed_source_kinds text[] NOT NULL CHECK(cardinality(allowed_source_kinds)>0 AND allowed_source_kinds <@ ARRAY[
    'card_version','chapter_body_version','canonical_fact','knowledge_state_change','state_change','story_event_timing','story_event_relation','planning_version','research_document_version','research_record_version','research_reference_pack_version','prompt_component','ai_task_attempt','quality_issue_evidence','asset_parsed_text'
  ]::text[]),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id,version),
  UNIQUE(id,profile_id)
);
ALTER TABLE embedding_profiles ADD CONSTRAINT embedding_profiles_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES embedding_profile_versions(id,profile_id);

CREATE FUNCTION guard_embedding_profile_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'embedding profile versions are immutable; create a new version' USING ERRCODE='23514';
END $$;

CREATE TABLE semantic_retrieval_policies (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  max_top_k integer NOT NULL DEFAULT 100 CHECK(max_top_k BETWEEN 1 AND 500),
  max_candidates integer NOT NULL DEFAULT 1000 CHECK(max_candidates BETWEEN 1 AND 10000),
  max_timeout_ms integer NOT NULL DEFAULT 5000 CHECK(max_timeout_ms BETWEEN 100 AND 60000),
  max_query_chars integer NOT NULL DEFAULT 4000 CHECK(max_query_chars BETWEEN 1 AND 20000),
  default_vector_weight numeric(5,4) NOT NULL DEFAULT .7 CHECK(default_vector_weight BETWEEN 0 AND 1),
  default_fts_weight numeric(5,4) NOT NULL DEFAULT .2 CHECK(default_fts_weight BETWEEN 0 AND 1),
  default_trigram_weight numeric(5,4) NOT NULL DEFAULT .1 CHECK(default_trigram_weight BETWEEN 0 AND 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(default_vector_weight+default_fts_weight+default_trigram_weight=1)
);
INSERT INTO semantic_retrieval_policies(singleton) VALUES(true);

CREATE TABLE embedding_source_snapshots (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  dependency_source_resource_id uuid NOT NULL REFERENCES dependency_resources(id),
  source_kind text NOT NULL CHECK(source_kind IN (
    'card_version','chapter_body_version','canonical_fact','knowledge_state_change','state_change',
    'story_event_timing','story_event_relation','planning_version','research_document_version',
    'research_record_version','research_reference_pack_version','prompt_component','ai_task_attempt',
    'quality_issue_evidence','asset_parsed_text'
  )),
  source_stable_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  title text NOT NULL DEFAULT '',
  content_text text NOT NULL CHECK(length(content_text)>0),
  chunk_recipe_hash char(64) NOT NULL CHECK(chunk_recipe_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'current' CHECK(status IN ('current','stale','archived')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  stale_at timestamptz,
  UNIQUE(book_id,profile_version_id,source_kind,source_stable_id,source_version_id,source_revision,source_hash,chunk_recipe_hash),
  CHECK((status='current' AND stale_at IS NULL) OR (status<>'current' AND stale_at IS NOT NULL))
);

CREATE FUNCTION validate_embedding_source_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dependency_row dependency_resources%ROWTYPE; allowed_kinds text[]; profile_status text;
BEGIN
  SELECT * INTO dependency_row FROM dependency_resources WHERE id=NEW.dependency_source_resource_id;
  SELECT version.allowed_source_kinds,profile.status INTO allowed_kinds,profile_status FROM embedding_profile_versions version JOIN embedding_profiles profile ON profile.id=version.profile_id WHERE version.id=NEW.profile_version_id;
  IF profile_status<>'active' THEN RAISE EXCEPTION 'archived embedding profile cannot accept sources' USING ERRCODE='23514'; END IF;
  IF dependency_row.book_id IS NOT NULL AND (dependency_row.book_id IS DISTINCT FROM NEW.book_id OR dependency_row.space_id IS DISTINCT FROM NEW.space_id) THEN RAISE EXCEPTION 'embedding source must use a global resource or a dependency resource from the same book' USING ERRCODE='23514'; END IF;
  IF dependency_row.content_hash<>NEW.source_hash THEN RAISE EXCEPTION 'embedding source hash does not match dependency snapshot' USING ERRCODE='23514'; END IF;
  IF NOT NEW.source_kind=ANY(allowed_kinds) THEN RAISE EXCEPTION 'source kind is not enabled by embedding profile version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_sources_validate BEFORE INSERT ON embedding_source_snapshots FOR EACH ROW EXECUTE FUNCTION validate_embedding_source_snapshot();

CREATE TABLE chunking_requests (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_snapshot_id uuid NOT NULL REFERENCES embedding_source_snapshots(id),
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  expected_source_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','stale','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  idempotency_key text NOT NULL,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE embedding_chunks (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_snapshot_id uuid NOT NULL REFERENCES embedding_source_snapshots(id),
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  ordinal integer NOT NULL CHECK(ordinal>=0),
  anchor_kind text NOT NULL CHECK(anchor_kind IN ('whole','character_range','json_pointer','text_anchor','section')),
  anchor jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(anchor)='object'),
  chunk_text text NOT NULL CHECK(length(chunk_text)>0),
  token_estimate integer NOT NULL DEFAULT 0 CHECK(token_estimate>=0),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  chunker_version text NOT NULL,
  status text NOT NULL DEFAULT 'current' CHECK(status IN ('current','stale','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  stale_at timestamptz,
  UNIQUE(source_snapshot_id,profile_version_id,chunker_version,ordinal),
  CHECK((status='current' AND stale_at IS NULL) OR (status<>'current' AND stale_at IS NOT NULL))
);

CREATE TABLE chunking_results (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES chunking_requests(id),
  source_snapshot_id uuid NOT NULL REFERENCES embedding_source_snapshots(id),
  expected_source_hash char(64) NOT NULL,
  observed_source_hash char(64) NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('applied','rejected_stale','failed')),
  chunk_count integer NOT NULL DEFAULT 0 CHECK(chunk_count>=0),
  result_hash char(64),
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((outcome='applied' AND expected_source_hash=observed_source_hash AND result_hash IS NOT NULL) OR outcome<>'applied')
);

CREATE TABLE embedding_requests (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES embedding_chunks(id),
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  expected_source_hash char(64) NOT NULL,
  expected_chunk_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','retry_scheduled','succeeded','failed','stale','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  idempotency_key text NOT NULL,
  next_retry_at timestamptz,
  last_error_code text NOT NULL DEFAULT '',
  last_error_detail text NOT NULL DEFAULT '',
  retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE embedding_attempts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES embedding_requests(id),
  attempt_number integer NOT NULL CHECK(attempt_number>0),
  status text NOT NULL CHECK(status IN ('running','succeeded','failed','discarded')),
  provider_request_ref text,
  error_code text NOT NULL DEFAULT '',
  error_detail text NOT NULL DEFAULT '',
  retryable boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE(request_id,attempt_number)
);

CREATE TABLE embedding_results (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES embedding_requests(id),
  attempt_id uuid NOT NULL UNIQUE REFERENCES embedding_attempts(id),
  chunk_id uuid NOT NULL REFERENCES embedding_chunks(id),
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  observed_source_hash char(64) NOT NULL,
  observed_chunk_hash char(64) NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('applied','rejected_stale','failed')),
  vector_value vector,
  vector_hash char(64),
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(vector_hash IS NULL OR vector_hash ~ '^[a-f0-9]{64}$'),
  CHECK((outcome='applied' AND vector_value IS NOT NULL AND vector_hash IS NOT NULL) OR (outcome<>'applied' AND vector_value IS NULL))
);

CREATE FUNCTION validate_embedding_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_row embedding_requests%ROWTYPE; chunk_row embedding_chunks%ROWTYPE; expected_dims integer;
BEGIN
  SELECT * INTO request_row FROM embedding_requests WHERE id=NEW.request_id;
  SELECT * INTO chunk_row FROM embedding_chunks WHERE id=NEW.chunk_id;
  SELECT dimensions INTO expected_dims FROM embedding_profile_versions WHERE id=NEW.profile_version_id;
  IF NOT EXISTS(SELECT 1 FROM embedding_attempts attempt WHERE attempt.id=NEW.attempt_id AND attempt.request_id=NEW.request_id) THEN RAISE EXCEPTION 'embedding attempt does not belong to request' USING ERRCODE='23514'; END IF;
  IF request_row.chunk_id<>NEW.chunk_id OR request_row.profile_version_id<>NEW.profile_version_id THEN RAISE EXCEPTION 'embedding result does not match frozen request' USING ERRCODE='23514'; END IF;
  IF NEW.outcome='applied' AND (NEW.observed_source_hash<>request_row.expected_source_hash OR NEW.observed_chunk_hash<>request_row.expected_chunk_hash OR chunk_row.status<>'current') THEN
    RAISE EXCEPTION 'late embedding result must be recorded as rejected_stale' USING ERRCODE='23514';
  END IF;
  IF NEW.vector_value IS NOT NULL AND vector_dims(NEW.vector_value)<>expected_dims THEN RAISE EXCEPTION 'embedding dimensions do not match profile version' USING ERRCODE='22000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_results_validate BEFORE INSERT ON embedding_results FOR EACH ROW EXECUTE FUNCTION validate_embedding_result();

CREATE TABLE embedding_index_generations (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  generation integer NOT NULL CHECK(generation>0),
  status text NOT NULL DEFAULT 'building' CHECK(status IN ('building','verifying','ready','active','retired','failed','stale')),
  index_name text NOT NULL UNIQUE CHECK(index_name ~ '^nd_hnsw_[a-f0-9]{32}$' AND index_name='nd_hnsw_'||replace(id::text,'-','')),
  expected_vector_count integer NOT NULL DEFAULT 0 CHECK(expected_vector_count>=0),
  indexed_vector_count integer NOT NULL DEFAULT 0 CHECK(indexed_vector_count>=0),
  coverage numeric(8,7) NOT NULL DEFAULT 0 CHECK(coverage BETWEEN 0 AND 1),
  checksum char(64),
  error_code text NOT NULL DEFAULT '',
  error_detail text NOT NULL DEFAULT '',
  retryable boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  UNIQUE(book_id,profile_version_id,generation),
  UNIQUE(book_id,idempotency_key)
);

CREATE FUNCTION validate_embedding_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM embedding_profile_versions version JOIN embedding_profiles profile ON profile.id=version.profile_id WHERE version.id=NEW.profile_version_id AND profile.status='active') THEN RAISE EXCEPTION 'embedding generation requires an active profile' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_generations_validate BEFORE INSERT ON embedding_index_generations FOR EACH ROW EXECUTE FUNCTION validate_embedding_generation();

CREATE TABLE embedding_vectors (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL REFERENCES embedding_index_generations(id),
  result_id uuid NOT NULL REFERENCES embedding_results(id),
  chunk_id uuid NOT NULL REFERENCES embedding_chunks(id),
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  source_kind text NOT NULL,
  source_stable_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_revision integer NOT NULL,
  source_hash char(64) NOT NULL,
  chunk_hash char(64) NOT NULL,
  content_text text NOT NULL,
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple',content_text)) STORED,
  embedding vector NOT NULL,
  status text NOT NULL DEFAULT 'eligible' CHECK(status IN ('eligible','stale','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(generation_id,chunk_id)
);

CREATE FUNCTION validate_embedding_vector() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation_row embedding_index_generations%ROWTYPE; expected_dims integer; expected_metric text;
BEGIN
  SELECT * INTO generation_row FROM embedding_index_generations WHERE id=NEW.generation_id;
  SELECT dimensions,distance_metric INTO expected_dims,expected_metric FROM embedding_profile_versions WHERE id=NEW.profile_version_id;
  IF generation_row.book_id<>NEW.book_id OR generation_row.profile_version_id<>NEW.profile_version_id THEN RAISE EXCEPTION 'cross-book or mixed-profile generation is forbidden' USING ERRCODE='23514'; END IF;
  IF vector_dims(NEW.embedding)<>expected_dims THEN RAISE EXCEPTION 'mixed vector dimensions are forbidden' USING ERRCODE='22000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_vectors_validate BEFORE INSERT OR UPDATE ON embedding_vectors FOR EACH ROW EXECUTE FUNCTION validate_embedding_vector();

CREATE TABLE embedding_index_states (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES embedding_profiles(id),
  active_generation_id uuid REFERENCES embedding_index_generations(id),
  status text NOT NULL DEFAULT 'empty' CHECK(status IN ('empty','ready','degraded','stale','failed')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  last_build_at timestamptz,
  last_success_at timestamptz,
  last_error_code text NOT NULL DEFAULT '',
  last_error_detail text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(book_id,profile_id)
);

CREATE FUNCTION validate_embedding_index_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active_generation_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM embedding_index_generations generation JOIN embedding_profile_versions version ON version.id=generation.profile_version_id
    WHERE generation.id=NEW.active_generation_id AND generation.book_id=NEW.book_id AND version.profile_id=NEW.profile_id
  ) THEN RAISE EXCEPTION 'active embedding generation must belong to the same book and profile' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_index_states_validate BEFORE INSERT OR UPDATE ON embedding_index_states FOR EACH ROW EXECUTE FUNCTION validate_embedding_index_state();

CREATE TABLE embedding_stale_reasons (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK(target_kind IN ('source_snapshot','chunk','embedding_result','index_generation')),
  target_id uuid NOT NULL,
  invalidation_event_id uuid REFERENCES dependency_invalidation_events(id),
  reason_code text NOT NULL CHECK(reason_code IN ('source_changed','source_archived','profile_superseded','chunker_changed','late_receipt','dependency_invalidated','manual')),
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(target_kind,target_id,invalidation_event_id,reason_code)
);

CREATE TABLE semantic_retrieval_runs (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  caller_kind text NOT NULL CHECK(caller_kind IN ('user','ai_task','system','debug')),
  caller_id text NOT NULL DEFAULT '',
  profile_version_id uuid NOT NULL REFERENCES embedding_profile_versions(id),
  generation_id uuid NOT NULL REFERENCES embedding_index_generations(id),
  query_hash char(64) NOT NULL CHECK(query_hash ~ '^[a-f0-9]{64}$'),
  query_summary text NOT NULL DEFAULT '',
  query_ref text NOT NULL DEFAULT '',
  filter_snapshot jsonb NOT NULL CHECK(jsonb_typeof(filter_snapshot)='object'),
  source_kinds text[] NOT NULL,
  top_k integer NOT NULL CHECK(top_k BETWEEN 1 AND 500),
  candidate_limit integer NOT NULL CHECK(candidate_limit BETWEEN 1 AND 10000 AND candidate_limit>=top_k),
  similarity_threshold numeric(8,7) CHECK(similarity_threshold BETWEEN 0 AND 1),
  timeout_ms integer NOT NULL CHECK(timeout_ms BETWEEN 100 AND 60000),
  vector_weight numeric(5,4) NOT NULL CHECK(vector_weight BETWEEN 0 AND 1),
  fts_weight numeric(5,4) NOT NULL CHECK(fts_weight BETWEEN 0 AND 1),
  trigram_weight numeric(5,4) NOT NULL CHECK(trigram_weight BETWEEN 0 AND 1),
  status text NOT NULL CHECK(status IN ('running','succeeded','failed','timed_out')),
  elapsed_ms integer CHECK(elapsed_ms IS NULL OR elapsed_ms>=0),
  result_count integer NOT NULL DEFAULT 0 CHECK(result_count>=0),
  failure_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK(vector_weight+fts_weight+trigram_weight=1)
);

CREATE TABLE semantic_retrieval_results (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES semantic_retrieval_runs(id) ON DELETE CASCADE,
  rank integer NOT NULL CHECK(rank>0),
  chunk_id uuid NOT NULL REFERENCES embedding_chunks(id),
  source_kind text NOT NULL,
  source_stable_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_revision integer NOT NULL,
  source_hash char(64) NOT NULL,
  vector_score numeric(12,9) NOT NULL,
  fts_score numeric(12,9) NOT NULL,
  trigram_score numeric(12,9) NOT NULL,
  final_score numeric(12,9) NOT NULL,
  inclusion_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,rank),
  UNIQUE(run_id,chunk_id)
);

CREATE FUNCTION guard_semantic_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE FUNCTION guard_embedding_chunk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','stale_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stale_at']::text[]) THEN RAISE EXCEPTION 'embedding chunk content and anchor are immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'current' OR NEW.status NOT IN ('stale','archived') OR NEW.stale_at IS NULL THEN RAISE EXCEPTION 'invalid embedding chunk lifecycle transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION guard_embedding_source_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','stale_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stale_at']::text[]) THEN RAISE EXCEPTION 'embedding source snapshot is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'current' OR NEW.status NOT IN ('stale','archived') OR NEW.stale_at IS NULL THEN RAISE EXCEPTION 'invalid embedding source lifecycle transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_sources_immutable BEFORE UPDATE OR DELETE ON embedding_source_snapshots FOR EACH ROW EXECUTE FUNCTION guard_embedding_source_snapshot();
CREATE TRIGGER embedding_chunks_immutable BEFORE UPDATE OR DELETE ON embedding_chunks FOR EACH ROW EXECUTE FUNCTION guard_embedding_chunk();
CREATE TRIGGER embedding_results_immutable BEFORE UPDATE OR DELETE ON embedding_results FOR EACH ROW EXECUTE FUNCTION guard_semantic_append_only();
CREATE TRIGGER semantic_results_immutable BEFORE UPDATE OR DELETE ON semantic_retrieval_results FOR EACH ROW EXECUTE FUNCTION guard_semantic_append_only();
CREATE TRIGGER embedding_profile_versions_guard BEFORE UPDATE OR DELETE ON embedding_profile_versions FOR EACH ROW EXECUTE FUNCTION guard_embedding_profile_version();

CREATE FUNCTION cascade_embedding_profile_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='active' AND NEW.status='archived' THEN
    UPDATE embedding_source_snapshots source SET status='stale',stale_at=now() WHERE source.status='current' AND source.profile_version_id IN(SELECT id FROM embedding_profile_versions WHERE profile_id=NEW.id);
    UPDATE embedding_chunks chunk SET status='stale',stale_at=now() WHERE chunk.status='current' AND chunk.profile_version_id IN(SELECT id FROM embedding_profile_versions WHERE profile_id=NEW.id);
    UPDATE embedding_vectors item SET status='stale' WHERE item.status='eligible' AND item.profile_version_id IN(SELECT id FROM embedding_profile_versions WHERE profile_id=NEW.id);
    UPDATE embedding_requests request SET status='stale',updated_at=now() WHERE request.status IN ('pending','running','retry_scheduled','succeeded') AND request.profile_version_id IN(SELECT id FROM embedding_profile_versions WHERE profile_id=NEW.id);
    UPDATE embedding_index_generations generation SET status='stale' WHERE generation.status IN ('ready','active') AND generation.profile_version_id IN(SELECT id FROM embedding_profile_versions WHERE profile_id=NEW.id);
    UPDATE embedding_index_states SET status='stale',revision=revision+1,updated_at=now() WHERE profile_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_profile_archive_cascade AFTER UPDATE OF status ON embedding_profiles FOR EACH ROW EXECUTE FUNCTION cascade_embedding_profile_archive();

CREATE FUNCTION build_embedding_generation_index(requested_generation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE row_data embedding_index_generations%ROWTYPE; dims integer; metric text; opclass text; sql_text text;
BEGIN
  SELECT * INTO row_data FROM embedding_index_generations WHERE id=requested_generation_id FOR UPDATE;
  IF row_data.status NOT IN ('building','verifying') OR row_data.index_name !~ '^nd_hnsw_[a-f0-9]{32}$' THEN RAISE EXCEPTION 'generation is not buildable' USING ERRCODE='23514'; END IF;
  SELECT dimensions,distance_metric INTO dims,metric FROM embedding_profile_versions WHERE id=row_data.profile_version_id;
  opclass:=CASE metric WHEN 'cosine' THEN 'vector_cosine_ops' WHEN 'l2' THEN 'vector_l2_ops' WHEN 'inner_product' THEN 'vector_ip_ops' ELSE NULL END;
  IF opclass IS NULL THEN RAISE EXCEPTION 'unsupported vector metric' USING ERRCODE='23514'; END IF;
  sql_text:=format('CREATE INDEX %I ON new_design.embedding_vectors USING hnsw ((embedding::vector(%s)) %s) WHERE generation_id=%L::uuid AND status=''eligible''',row_data.index_name,dims,opclass,row_data.id::text);
  EXECUTE sql_text;
  UPDATE embedding_index_generations SET status='verifying' WHERE id=requested_generation_id;
END $$;

CREATE FUNCTION activate_embedding_generation(requested_generation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE row_data embedding_index_generations%ROWTYPE; profile_key uuid;
BEGIN
  SELECT * INTO row_data FROM embedding_index_generations WHERE id=requested_generation_id FOR UPDATE;
  IF row_data.status<>'ready' OR row_data.coverage<1 OR row_data.expected_vector_count<>row_data.indexed_vector_count OR row_data.checksum IS NULL THEN RAISE EXCEPTION 'only a fully verified generation may activate' USING ERRCODE='23514'; END IF;
  SELECT profile_id INTO profile_key FROM embedding_profile_versions WHERE id=row_data.profile_version_id;
  UPDATE embedding_index_generations old SET status='retired',retired_at=now() FROM embedding_index_states state
  WHERE state.book_id=row_data.book_id AND state.profile_id=profile_key AND old.id=state.active_generation_id AND old.id<>row_data.id;
  UPDATE embedding_index_generations SET status='active',activated_at=now() WHERE id=row_data.id;
  INSERT INTO embedding_index_states(book_id,profile_id,active_generation_id,status,last_success_at)
  VALUES(row_data.book_id,profile_key,row_data.id,'ready',now())
  ON CONFLICT(book_id,profile_id) DO UPDATE SET active_generation_id=excluded.active_generation_id,status='ready',revision=embedding_index_states.revision+1,last_success_at=now(),updated_at=now();
END $$;

ALTER TABLE dependency_resources DROP CONSTRAINT dependency_resources_resource_kind_check;
ALTER TABLE dependency_resources ADD CONSTRAINT dependency_resources_resource_kind_check CHECK(resource_kind IN (
  'card_type_version','template_group_version','card_version','card_relation','research_document_version','research_record_version','research_reference_pack_version',
  'chapter_body_version','chapter_text_anchor','canonical_fact','chapter_settlement','state_change','knowledge_state_change','story_event_timing','story_event_relation',
  'planning_version','prompt_recipe_version','task_contract_version','context_manifest','model_route_snapshot','ai_task_attempt','quality_audit_report','asset_version',
  'embedding_source_snapshot','embedding_chunk','embedding_result','embedding_index_generation'
));

ALTER FUNCTION resolve_dependency_resource(text,uuid,uuid) RENAME TO resolve_dependency_resource_pre029;
CREATE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE AS $$
BEGIN
  CASE requested_kind
    WHEN 'embedding_source_snapshot' THEN RETURN QUERY SELECT snapshot.space_id,snapshot.book_id,snapshot.source_hash FROM embedding_source_snapshots snapshot WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id;
    WHEN 'embedding_chunk' THEN RETURN QUERY SELECT snapshot.space_id,chunk.book_id,chunk.content_hash FROM embedding_chunks chunk JOIN embedding_source_snapshots snapshot ON snapshot.id=chunk.source_snapshot_id WHERE chunk.id=requested_stable_id AND chunk.id=requested_version_id;
    WHEN 'embedding_result' THEN RETURN QUERY SELECT snapshot.space_id,request.book_id,result.vector_hash FROM embedding_results result JOIN embedding_requests request ON request.id=result.request_id JOIN embedding_chunks chunk ON chunk.id=result.chunk_id JOIN embedding_source_snapshots snapshot ON snapshot.id=chunk.source_snapshot_id WHERE result.id=requested_stable_id AND result.id=requested_version_id AND result.outcome='applied';
    WHEN 'embedding_index_generation' THEN RETURN QUERY SELECT book.space_id,generation.book_id,generation.checksum FROM embedding_index_generations generation JOIN books book ON book.id=generation.book_id WHERE generation.id=requested_stable_id AND generation.id=requested_version_id AND generation.checksum IS NOT NULL;
    ELSE RETURN QUERY SELECT * FROM resolve_dependency_resource_pre029(requested_kind,requested_stable_id,requested_version_id);
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION validate_dependency_resource() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved record;
BEGIN
  IF NEW.resource_kind='asset_version' THEN
    SELECT asset.space_id,version.book_id,content.checksum INTO resolved
    FROM asset_versions version JOIN assets asset ON asset.id=version.asset_id JOIN asset_content_objects content ON content.id=version.content_object_id
    WHERE version.asset_id=NEW.stable_object_id AND version.id=NEW.exact_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'asset dependency resource reference does not resolve' USING ERRCODE='23503'; END IF;
    NEW.space_id:=resolved.space_id; NEW.book_id:=resolved.book_id; NEW.content_hash:=resolved.checksum;
  ELSE
    SELECT * INTO resolved FROM resolve_dependency_resource(NEW.resource_kind,NEW.stable_object_id,NEW.exact_version_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'dependency resource reference does not resolve' USING ERRCODE='23503'; END IF;
    NEW.space_id:=resolved.resolved_space_id; NEW.book_id:=resolved.resolved_book_id; NEW.content_hash:=resolved.resolved_hash;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enqueue_graph_projection_resource() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target dependency_resources%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='dependency_resources' THEN target:=NEW; ELSE SELECT * INTO target FROM dependency_resources WHERE id=NEW.resource_id; END IF;
  IF target.book_id IS NULL OR target.resource_kind NOT IN ('card_version','card_relation','canonical_fact','state_change','knowledge_state_change','story_event_timing','story_event_relation','planning_version') THEN RETURN NEW; END IF;
  INSERT INTO graph_projection_book_states(book_id,last_request_at) VALUES(target.book_id,now()) ON CONFLICT(book_id) DO UPDATE SET last_request_at=excluded.last_request_at,revision=graph_projection_book_states.revision+1,updated_at=now();
  INSERT INTO graph_projection_requests(id,book_id,request_kind,dependency_resource_id,source_kind,source_id,source_version_id,source_revision,source_hash,reason,idempotency_key)
  VALUES(gen_random_uuid(),target.book_id,CASE WHEN TG_TABLE_NAME='dependency_resources' THEN 'incremental_upsert' ELSE 'tombstone' END,target.id,target.resource_kind,target.stable_object_id,target.exact_version_id,1,target.content_hash,CASE WHEN TG_TABLE_NAME='dependency_resources' THEN '统一依赖资源登记后同步图投影。' ELSE '统一依赖资源失效后移出当前图投影。' END,CASE WHEN TG_TABLE_NAME='dependency_resources' THEN 'resource:' ELSE 'invalidation:'||NEW.event_id::text||':' END||target.id::text)
  ON CONFLICT(book_id,idempotency_key) DO NOTHING;
  RETURN NEW;
END $$;

CREATE FUNCTION bridge_embedding_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target dependency_resources%ROWTYPE;
BEGIN
  SELECT * INTO target FROM dependency_resources WHERE id=NEW.resource_id;
  IF target.resource_kind='embedding_source_snapshot' THEN
    UPDATE embedding_source_snapshots SET status='stale',stale_at=now() WHERE id=target.exact_version_id AND status='current';
    UPDATE embedding_chunks SET status='stale',stale_at=now() WHERE source_snapshot_id=target.exact_version_id AND status='current';
  ELSIF target.resource_kind='embedding_chunk' THEN
    UPDATE embedding_vectors SET status='stale' WHERE chunk_id=target.exact_version_id AND status='eligible';
    UPDATE embedding_requests SET status='stale',updated_at=now() WHERE chunk_id=target.exact_version_id AND status IN ('pending','running','retry_scheduled','succeeded');
  ELSIF target.resource_kind='embedding_result' THEN
    UPDATE embedding_vectors SET status='stale' WHERE result_id=target.exact_version_id AND status='eligible';
  ELSIF target.resource_kind='embedding_index_generation' THEN
    UPDATE embedding_index_generations SET status='stale' WHERE id=target.exact_version_id AND status IN ('ready','active');
    UPDATE embedding_index_states state SET status='stale',revision=revision+1,updated_at=now() WHERE state.active_generation_id=target.exact_version_id;
  END IF;
  IF target.resource_kind IN ('embedding_source_snapshot','embedding_chunk','embedding_result','embedding_index_generation') THEN
    INSERT INTO embedding_stale_reasons(id,book_id,target_kind,target_id,invalidation_event_id,reason_code,detail)
    VALUES(gen_random_uuid(),target.book_id,CASE target.resource_kind WHEN 'embedding_source_snapshot' THEN 'source_snapshot' WHEN 'embedding_chunk' THEN 'chunk' WHEN 'embedding_result' THEN 'embedding_result' ELSE 'index_generation' END,target.exact_version_id,NEW.event_id,'dependency_invalidated','上游依赖变化，派生语义数据等待重建。') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_invalidation_bridge AFTER INSERT ON dependency_invalidation_impacts FOR EACH ROW EXECUTE FUNCTION bridge_embedding_invalidation();

CREATE INDEX embedding_sources_book_idx ON embedding_source_snapshots(book_id,profile_version_id,status,source_kind);
CREATE INDEX embedding_chunks_source_idx ON embedding_chunks(source_snapshot_id,status,ordinal);
CREATE INDEX embedding_requests_queue_idx ON embedding_requests(book_id,status,next_retry_at,created_at);
CREATE INDEX embedding_results_chunk_idx ON embedding_results(chunk_id,profile_version_id,outcome,created_at DESC);
CREATE INDEX embedding_generations_book_idx ON embedding_index_generations(book_id,profile_version_id,generation DESC);
CREATE UNIQUE INDEX embedding_generations_active_unique ON embedding_index_generations(book_id,profile_version_id) WHERE status='active';
CREATE INDEX embedding_vectors_filter_idx ON embedding_vectors(book_id,generation_id,status,source_kind);
CREATE INDEX embedding_vectors_fts_idx ON embedding_vectors USING gin(search_document);
CREATE INDEX embedding_vectors_trgm_idx ON embedding_vectors USING gin(content_text gin_trgm_ops);
CREATE INDEX semantic_runs_book_idx ON semantic_retrieval_runs(book_id,created_at DESC,id);
CREATE INDEX semantic_results_run_idx ON semantic_retrieval_results(run_id,rank);
CREATE INDEX embedding_stale_open_idx ON embedding_stale_reasons(book_id,status,target_kind);

INSERT INTO schema_migrations(id) VALUES('029_pgvector_semantic_retrieval') ON CONFLICT(id) DO NOTHING;
