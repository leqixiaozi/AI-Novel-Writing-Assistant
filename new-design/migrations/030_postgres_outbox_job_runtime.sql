SET search_path TO new_design, public;

CREATE TABLE outbox_event_topics (
  topic text NOT NULL CHECK(topic ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  event_version integer NOT NULL CHECK(event_version>0),
  description text NOT NULL,
  payload_contract jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload_contract)='object'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(topic,event_version)
);

CREATE TABLE background_job_handlers (
  handler_key text PRIMARY KEY CHECK(handler_key ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  job_kind text NOT NULL UNIQUE CHECK(job_kind ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  topic text NOT NULL,
  event_version integer NOT NULL,
  specialized_request_kind text NOT NULL UNIQUE CHECK(specialized_request_kind IN ('dependency_recompute_request','asset_derivation','graph_projection_request','embedding_chunking_request','embedding_request','embedding_index_generation','ai_task','backup_request')),
  default_max_attempts integer NOT NULL CHECK(default_max_attempts BETWEEN 1 AND 20),
  default_lease_ms integer NOT NULL CHECK(default_lease_ms BETWEEN 1000 AND 3600000),
  backoff_base_ms integer NOT NULL CHECK(backoff_base_ms BETWEEN 100 AND 3600000),
  backoff_cap_ms integer NOT NULL CHECK(backoff_cap_ms BETWEEN backoff_base_ms AND 86400000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(topic,event_version) REFERENCES outbox_event_topics(topic,event_version)
);

CREATE TABLE outbox_consumers (
  consumer_key text PRIMARY KEY CHECK(consumer_key ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  handler_key text NOT NULL REFERENCES background_job_handlers(handler_key),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','disabled')),
  max_concurrency integer NOT NULL DEFAULT 1 CHECK(max_concurrency BETWEEN 1 AND 64),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  pause_reason text NOT NULL DEFAULT '' CHECK(length(pause_reason)<=1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_aggregate_sequences (
  space_id uuid REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  aggregate_kind text NOT NULL CHECK(aggregate_kind ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  aggregate_id uuid NOT NULL,
  last_sequence bigint NOT NULL CHECK(last_sequence>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(aggregate_kind,aggregate_id),
  CHECK(book_id IS NULL OR space_id IS NOT NULL)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  space_id uuid REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  topic text NOT NULL,
  event_version integer NOT NULL,
  aggregate_kind text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_sequence bigint NOT NULL CHECK(aggregate_sequence>0),
  ordering_key text NOT NULL CHECK(length(ordering_key) BETWEEN 1 AND 240),
  producer_kind text NOT NULL CHECK(producer_kind IN ('domain_store','migration_bridge','system','operator')),
  producer_idempotency_key text NOT NULL CHECK(length(producer_idempotency_key) BETWEEN 8 AND 240),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=32768),
  payload_hash char(64) NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  correlation_id uuid,
  causation_id uuid,
  trace_id text NOT NULL DEFAULT '' CHECK(length(trace_id)<=240),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(topic,event_version) REFERENCES outbox_event_topics(topic,event_version),
  FOREIGN KEY(aggregate_kind,aggregate_id) REFERENCES outbox_aggregate_sequences(aggregate_kind,aggregate_id),
  UNIQUE(aggregate_kind,aggregate_id,aggregate_sequence),
  UNIQUE(topic,producer_idempotency_key),
  CHECK(book_id IS NULL OR space_id IS NOT NULL),
  CHECK(NOT (payload ?| ARRAY['body','contentText','chunkText','vector','embedding','binary','prompt','credential','secret','apiKey','password']))
);

CREATE TABLE background_jobs (
  id uuid PRIMARY KEY,
  outbox_event_id uuid NOT NULL REFERENCES outbox_events(id),
  space_id uuid REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  handler_key text NOT NULL REFERENCES background_job_handlers(handler_key),
  job_kind text NOT NULL,
  specialized_request_kind text NOT NULL,
  specialized_request_id uuid NOT NULL,
  execution_generation integer NOT NULL DEFAULT 1 CHECK(execution_generation>0),
  ordering_key text NOT NULL CHECK(length(ordering_key) BETWEEN 1 AND 240),
  aggregate_sequence bigint NOT NULL CHECK(aggregate_sequence>0),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','running','succeeded','failed','retry_scheduled','cancel_requested','cancelled','dead_letter','archived')),
  priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN -100 AND 100),
  max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 20),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND max_attempts),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 160),
  lease_until timestamptz,
  heartbeat_at timestamptz,
  lease_token_digest char(64),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
  current_attempt_id uuid,
  checkpoint_key text,
  last_error_kind text CHECK(last_error_kind IS NULL OR last_error_kind IN ('technical','business_rejected','rejected_stale','cancelled')),
  last_error_code text NOT NULL DEFAULT '' CHECK(length(last_error_code)<=120),
  last_error_summary text NOT NULL DEFAULT '' CHECK(length(last_error_summary)<=2000),
  result_idempotency_key text,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  archived_at timestamptz,
  UNIQUE(outbox_event_id,handler_key,execution_generation),
  UNIQUE(handler_key,specialized_request_kind,specialized_request_id,execution_generation),
  UNIQUE(id,outbox_event_id),
  CHECK((status IN ('leased','running','cancel_requested') AND lease_owner IS NOT NULL AND lease_until IS NOT NULL AND lease_token_digest IS NOT NULL) OR (status NOT IN ('leased','running','cancel_requested') AND lease_owner IS NULL AND lease_until IS NULL AND lease_token_digest IS NULL)),
  CHECK((status IN ('succeeded','failed','cancelled','dead_letter','archived') AND completed_at IS NOT NULL) OR status NOT IN ('succeeded','failed','cancelled','dead_letter','archived')),
  CHECK((status='archived' AND archived_at IS NOT NULL) OR (status<>'archived' AND archived_at IS NULL))
);

CREATE TABLE background_job_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES background_jobs(id),
  attempt_number integer NOT NULL CHECK(attempt_number>0),
  fencing_token bigint NOT NULL CHECK(fencing_token>0),
  lease_token_digest char(64) NOT NULL CHECK(lease_token_digest ~ '^[a-f0-9]{64}$'),
  owner text NOT NULL CHECK(length(owner) BETWEEN 1 AND 160),
  consumer_key text NOT NULL REFERENCES outbox_consumers(consumer_key),
  trigger_kind text NOT NULL CHECK(trigger_kind IN ('initial','technical_retry','manual_retry','worker_release','lease_recovery','dead_letter_replay')),
  status text NOT NULL DEFAULT 'leased' CHECK(status IN ('leased','running','succeeded','failed','cancelled','released','lease_expired','rejected_stale')),
  started_at timestamptz,
  heartbeat_at timestamptz,
  ended_at timestamptz,
  error_kind text CHECK(error_kind IS NULL OR error_kind IN ('technical','business_rejected','rejected_stale','cancelled')),
  error_code text NOT NULL DEFAULT '' CHECK(length(error_code)<=120),
  error_summary text NOT NULL DEFAULT '' CHECK(length(error_summary)<=2000),
  retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,attempt_number),
  UNIQUE(job_id,fencing_token),
  UNIQUE(id,job_id),
  UNIQUE(id,job_id,fencing_token),
  CHECK((status IN ('succeeded','failed','cancelled','released','lease_expired','rejected_stale') AND ended_at IS NOT NULL) OR (status IN ('leased','running') AND ended_at IS NULL))
);
ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_current_attempt_fk FOREIGN KEY(current_attempt_id,id,fencing_token) REFERENCES background_job_attempts(id,job_id,fencing_token);

CREATE TABLE background_job_checkpoints (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES background_jobs(id),
  attempt_id uuid NOT NULL,
  fencing_token bigint NOT NULL,
  checkpoint_key text NOT NULL CHECK(length(checkpoint_key) BETWEEN 1 AND 240),
  checkpoint_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(checkpoint_data)='object' AND octet_length(checkpoint_data::text)<=16384),
  checkpoint_hash char(64) NOT NULL CHECK(checkpoint_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(attempt_id,job_id,fencing_token) REFERENCES background_job_attempts(id,job_id,fencing_token),
  UNIQUE(job_id,attempt_id,checkpoint_key,checkpoint_hash),
  CHECK(NOT (checkpoint_data ?| ARRAY['body','contentText','chunkText','vector','embedding','binary','prompt','credential','secret','apiKey','password']))
);

CREATE TABLE background_job_results (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES background_jobs(id),
  attempt_id uuid NOT NULL,
  fencing_token bigint NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('applied','business_rejected','rejected_stale','cancelled')),
  specialized_result_kind text,
  specialized_result_id uuid,
  result_hash char(64),
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(result_metadata)='object' AND octet_length(result_metadata::text)<=16384),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(attempt_id,job_id,fencing_token) REFERENCES background_job_attempts(id,job_id,fencing_token),
  UNIQUE(id,job_id),
  UNIQUE(job_id,idempotency_key),
  CHECK((outcome='applied' AND specialized_result_kind IS NOT NULL AND specialized_result_id IS NOT NULL AND result_hash IS NOT NULL) OR outcome<>'applied'),
  CHECK(result_hash IS NULL OR result_hash ~ '^[a-f0-9]{64}$'),
  CHECK(NOT (result_metadata ?| ARRAY['body','contentText','chunkText','vector','embedding','binary','prompt','credential','secret','apiKey','password']))
);

CREATE TABLE outbox_inbox_receipts (
  id uuid PRIMARY KEY,
  consumer_key text NOT NULL REFERENCES outbox_consumers(consumer_key),
  event_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('succeeded','business_rejected','rejected_stale','cancelled')),
  result_id uuid,
  event_payload_hash char(64) NOT NULL CHECK(event_payload_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(consumer_key,event_id),
  FOREIGN KEY(job_id,event_id) REFERENCES background_jobs(id,outbox_event_id),
  FOREIGN KEY(attempt_id,job_id) REFERENCES background_job_attempts(id,job_id),
  FOREIGN KEY(result_id,job_id) REFERENCES background_job_results(id,job_id)
);

CREATE TABLE background_job_replays (
  id uuid PRIMARY KEY,
  source_job_id uuid NOT NULL REFERENCES background_jobs(id),
  replay_job_id uuid NOT NULL UNIQUE REFERENCES background_jobs(id),
  source_status text NOT NULL CHECK(source_status IN ('failed','dead_letter','cancelled')),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  requested_by text NOT NULL CHECK(length(requested_by) BETWEEN 1 AND 160),
  idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 8 AND 240),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE background_job_book_pauses (
  book_id uuid PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('paused','active')),
  reason text NOT NULL DEFAULT '' CHECK(length(reason)<=1000),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by text NOT NULL DEFAULT '' CHECK(length(updated_by)<=160),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE background_job_archive_policies (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  terminal_retention_days integer NOT NULL DEFAULT 90 CHECK(terminal_retention_days BETWEEN 7 AND 3650),
  dead_letter_retention_days integer NOT NULL DEFAULT 365 CHECK(dead_letter_retention_days BETWEEN terminal_retention_days AND 3650),
  archive_batch_limit integer NOT NULL DEFAULT 500 CHECK(archive_batch_limit BETWEEN 1 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO background_job_archive_policies(singleton) VALUES(true);

CREATE FUNCTION outbox_payload_is_reference_only(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry record; item jsonb;
BEGIN
  IF jsonb_typeof(value)='object' THEN
    FOR entry IN SELECT key,val FROM jsonb_each(value) pair(key,val) LOOP
      IF lower(entry.key) IN ('body','contenttext','chunktext','vector','embedding','binary','prompt','credential','secret','clientsecret','apikey','privatekey','password','token','accesstoken','refreshtoken','authorization') THEN RETURN false; END IF;
      IF NOT outbox_payload_is_reference_only(entry.val) THEN RETURN false; END IF;
    END LOOP;
  ELSIF jsonb_typeof(value)='array' THEN
    FOR item IN SELECT array_item FROM jsonb_array_elements(value) AS items(array_item) LOOP IF NOT outbox_payload_is_reference_only(item) THEN RETURN false; END IF; END LOOP;
  END IF;
  RETURN true;
END $$;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_reference_payload_check CHECK(outbox_payload_is_reference_only(payload));
ALTER TABLE background_job_checkpoints ADD CONSTRAINT background_job_checkpoints_reference_payload_check CHECK(outbox_payload_is_reference_only(checkpoint_data));
ALTER TABLE background_job_results ADD CONSTRAINT background_job_results_reference_payload_check CHECK(outbox_payload_is_reference_only(result_metadata));

CREATE FUNCTION validate_outbox_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.space_id IS NULL THEN RAISE EXCEPTION 'outbox runtime record requires a space' USING ERRCODE='23514'; END IF;
  IF NEW.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND space_id=NEW.space_id) THEN RAISE EXCEPTION 'outbox runtime book and space mismatch' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='outbox_events' AND NOT EXISTS(SELECT 1 FROM outbox_aggregate_sequences aggregate_row WHERE aggregate_row.aggregate_kind=NEW.aggregate_kind AND aggregate_row.aggregate_id=NEW.aggregate_id AND aggregate_row.space_id=NEW.space_id AND aggregate_row.book_id IS NOT DISTINCT FROM NEW.book_id AND aggregate_row.last_sequence>=(to_jsonb(NEW)->>'aggregate_sequence')::bigint) THEN RAISE EXCEPTION 'outbox event aggregate sequence mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_aggregate_sequences_scope_guard BEFORE INSERT ON outbox_aggregate_sequences FOR EACH ROW EXECUTE FUNCTION validate_outbox_scope();
CREATE TRIGGER outbox_events_scope_guard BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION validate_outbox_scope();

CREATE FUNCTION guard_outbox_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER outbox_events_append_only BEFORE UPDATE OR DELETE ON outbox_events FOR EACH ROW EXECUTE FUNCTION guard_outbox_append_only();
CREATE TRIGGER job_checkpoints_append_only BEFORE UPDATE OR DELETE ON background_job_checkpoints FOR EACH ROW EXECUTE FUNCTION guard_outbox_append_only();
CREATE TRIGGER job_results_append_only BEFORE UPDATE OR DELETE ON background_job_results FOR EACH ROW EXECUTE FUNCTION guard_outbox_append_only();
CREATE TRIGGER inbox_receipts_append_only BEFORE UPDATE OR DELETE ON outbox_inbox_receipts FOR EACH ROW EXECUTE FUNCTION guard_outbox_append_only();
CREATE TRIGGER job_replays_append_only BEFORE UPDATE OR DELETE ON background_job_replays FOR EACH ROW EXECUTE FUNCTION guard_outbox_append_only();

CREATE FUNCTION validate_outbox_inbox_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_hash char(64); job_handler text; consumer_handler text; stored_outcome text;
BEGIN
  SELECT event.payload_hash,job.handler_key INTO expected_hash,job_handler FROM background_jobs job JOIN outbox_events event ON event.id=job.outbox_event_id WHERE job.id=NEW.job_id AND event.id=NEW.event_id;
  SELECT handler_key INTO consumer_handler FROM outbox_consumers WHERE consumer_key=NEW.consumer_key;
  IF expected_hash IS NULL OR expected_hash IS DISTINCT FROM NEW.event_payload_hash OR job_handler IS DISTINCT FROM consumer_handler THEN RAISE EXCEPTION 'inbox receipt does not match event or consumer handler' USING ERRCODE='23514'; END IF;
  IF NEW.result_id IS NULL THEN
    IF NEW.outcome<>'cancelled' THEN RAISE EXCEPTION 'non-cancelled inbox receipt requires a result' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT outcome INTO stored_outcome FROM background_job_results WHERE id=NEW.result_id AND job_id=NEW.job_id;
    IF (CASE stored_outcome WHEN 'applied' THEN 'succeeded' ELSE stored_outcome END) IS DISTINCT FROM NEW.outcome THEN RAISE EXCEPTION 'inbox receipt outcome does not match result' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_inbox_receipts_validate BEFORE INSERT ON outbox_inbox_receipts FOR EACH ROW EXECUTE FUNCTION validate_outbox_inbox_receipt();

CREATE FUNCTION guard_runtime_registry_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'runtime registry cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status']::text[]) THEN RAISE EXCEPTION 'runtime registry identity and policy are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_topics_registry_guard BEFORE UPDATE OR DELETE ON outbox_event_topics FOR EACH ROW EXECUTE FUNCTION guard_runtime_registry_update();
CREATE TRIGGER background_handlers_registry_guard BEFORE UPDATE OR DELETE ON background_job_handlers FOR EACH ROW EXECUTE FUNCTION guard_runtime_registry_update();

CREATE FUNCTION guard_background_book_pause() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'book pause state cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','reason','revision','updated_by','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reason','revision','updated_by','updated_at']::text[]) THEN RAISE EXCEPTION 'book pause identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'book pause revision must advance by one' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER background_book_pauses_guard BEFORE UPDATE OR DELETE ON background_job_book_pauses FOR EACH ROW EXECUTE FUNCTION guard_background_book_pause();

CREATE FUNCTION guard_outbox_aggregate_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'outbox aggregate sequence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['last_sequence','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['last_sequence','updated_at']::text[]) OR NEW.last_sequence<=OLD.last_sequence THEN RAISE EXCEPTION 'outbox aggregate sequence can only advance' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_aggregate_sequences_guard BEFORE UPDATE OR DELETE ON outbox_aggregate_sequences FOR EACH ROW EXECUTE FUNCTION guard_outbox_aggregate_sequence();

CREATE FUNCTION guard_consumer_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'consumer registration cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','revision','pause_reason','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','pause_reason','updated_at']::text[]) THEN RAISE EXCEPTION 'consumer registration is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'consumer revision must advance by one' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_consumers_update_guard BEFORE UPDATE OR DELETE ON outbox_consumers FOR EACH ROW EXECUTE FUNCTION guard_consumer_update();

CREATE FUNCTION guard_background_job_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'background job history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','attempt_count','next_run_at','lease_owner','lease_until','heartbeat_at','lease_token_digest','fencing_token','current_attempt_id','checkpoint_key','last_error_kind','last_error_code','last_error_summary','result_idempotency_key','revision','updated_at','completed_at','archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','next_run_at','lease_owner','lease_until','heartbeat_at','lease_token_digest','fencing_token','current_attempt_id','checkpoint_key','last_error_kind','last_error_code','last_error_summary','result_idempotency_key','revision','updated_at','completed_at','archived_at']::text[]) THEN RAISE EXCEPTION 'background job frozen identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'background job revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('leased','cancelled','dead_letter')) OR (OLD.status='leased' AND NEW.status IN ('running','queued','retry_scheduled','cancel_requested','cancelled','dead_letter')) OR (OLD.status='running' AND NEW.status IN ('running','queued','succeeded','failed','retry_scheduled','cancel_requested','cancelled','dead_letter')) OR (OLD.status='retry_scheduled' AND NEW.status IN ('leased','cancelled','dead_letter')) OR (OLD.status='cancel_requested' AND NEW.status='cancelled') OR (OLD.status='failed' AND NEW.status IN ('queued','archived')) OR (OLD.status IN ('succeeded','cancelled','dead_letter') AND NEW.status='archived')) THEN RAISE EXCEPTION 'illegal background job status transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER background_jobs_transition_guard BEFORE UPDATE OR DELETE ON background_jobs FOR EACH ROW EXECUTE FUNCTION guard_background_job_transition();

CREATE FUNCTION guard_background_attempt_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('succeeded','failed','cancelled','released','lease_expired','rejected_stale') THEN RAISE EXCEPTION 'finished job attempt is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','started_at','heartbeat_at','ended_at','error_kind','error_code','error_summary','retryable']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','started_at','heartbeat_at','ended_at','error_kind','error_code','error_summary','retryable']::text[]) THEN RAISE EXCEPTION 'job attempt lease identity is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='leased' AND NEW.status IN ('running','cancelled','released','lease_expired')) OR (OLD.status='running' AND NEW.status IN ('running','succeeded','failed','cancelled','released','lease_expired','rejected_stale'))) THEN RAISE EXCEPTION 'illegal job attempt transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER background_job_attempts_update_guard BEFORE UPDATE OR DELETE ON background_job_attempts FOR EACH ROW EXECUTE FUNCTION guard_background_attempt_update();

CREATE FUNCTION validate_background_job_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_handler background_job_handlers%ROWTYPE; event_row outbox_events%ROWTYPE; resolved_book uuid; resolved_space uuid;
BEGIN
  SELECT * INTO expected_handler FROM background_job_handlers WHERE handler_key=NEW.handler_key AND job_kind=NEW.job_kind AND specialized_request_kind=NEW.specialized_request_kind AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'job handler or specialized request kind is not registered' USING ERRCODE='23514'; END IF;
  SELECT * INTO event_row FROM outbox_events WHERE id=NEW.outbox_event_id;
  IF NOT FOUND OR event_row.topic IS DISTINCT FROM expected_handler.topic OR event_row.event_version IS DISTINCT FROM expected_handler.event_version OR event_row.space_id IS DISTINCT FROM NEW.space_id OR event_row.book_id IS DISTINCT FROM NEW.book_id OR event_row.ordering_key IS DISTINCT FROM NEW.ordering_key OR event_row.aggregate_sequence IS DISTINCT FROM NEW.aggregate_sequence OR event_row.payload->>'specializedRequestKind' IS DISTINCT FROM NEW.specialized_request_kind OR event_row.payload->>'specializedRequestId' IS DISTINCT FROM NEW.specialized_request_id::text THEN RAISE EXCEPTION 'job and outbox event identity mismatch' USING ERRCODE='23514'; END IF;
  CASE NEW.specialized_request_kind
    WHEN 'dependency_recompute_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM dependency_recompute_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'asset_derivation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM asset_derivations request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'graph_projection_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM graph_projection_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_chunking_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM chunking_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM embedding_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_index_generation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM embedding_index_generations request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'ai_task' THEN SELECT request.book_id,request.space_id INTO resolved_book,resolved_space FROM ai_tasks request WHERE request.id=NEW.specialized_request_id;
    WHEN 'backup_request' THEN RAISE EXCEPTION 'backup request handler is reserved until its specialized ledger exists' USING ERRCODE='23514';
  END CASE;
  IF resolved_space IS NULL OR resolved_book IS DISTINCT FROM NEW.book_id OR resolved_space IS DISTINCT FROM NEW.space_id THEN RAISE EXCEPTION 'job specialized request does not resolve in the same scope' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER background_jobs_reference_guard BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION validate_background_job_reference();

INSERT INTO outbox_event_topics(topic,event_version,description,payload_contract) VALUES
('dependency.recompute.requested',1,'统一依赖重算请求已登记。','{"referenceOnly":true}'::jsonb),
('asset.derivation.requested',1,'附件派生请求已登记。','{"referenceOnly":true}'::jsonb),
('graph.projection.requested',1,'AGE 图投影请求已登记。','{"referenceOnly":true}'::jsonb),
('embedding.chunking.requested',1,'语义分块请求已登记。','{"referenceOnly":true}'::jsonb),
('embedding.generation.requested',1,'嵌入请求已登记。','{"referenceOnly":true}'::jsonb),
('embedding.index.requested',1,'向量索引世代请求已登记。','{"referenceOnly":true}'::jsonb),
('ai.task.requested',1,'AI 任务已登记，由 024 保存业务语义。','{"referenceOnly":true}'::jsonb),
('backup.requested',1,'备份请求主题预留。','{"referenceOnly":true}'::jsonb);

INSERT INTO background_job_handlers(handler_key,job_kind,topic,event_version,specialized_request_kind,default_max_attempts,default_lease_ms,backoff_base_ms,backoff_cap_ms,status) VALUES
('dependency.recompute','dependency.recompute','dependency.recompute.requested',1,'dependency_recompute_request',5,120000,1000,300000,'active'),
('asset.derive','asset.derive','asset.derivation.requested',1,'asset_derivation',5,300000,2000,600000,'active'),
('graph.project','graph.project','graph.projection.requested',1,'graph_projection_request',5,120000,1000,300000,'active'),
('embedding.chunk','embedding.chunk','embedding.chunking.requested',1,'embedding_chunking_request',5,120000,1000,300000,'active'),
('embedding.generate','embedding.generate','embedding.generation.requested',1,'embedding_request',8,120000,2000,900000,'active'),
('embedding.index','embedding.index','embedding.index.requested',1,'embedding_index_generation',3,1800000,5000,1800000,'active'),
('ai.task','ai.task','ai.task.requested',1,'ai_task',5,120000,1000,300000,'active'),
('backup.run','backup.run','backup.requested',1,'backup_request',3,3600000,10000,3600000,'disabled');

INSERT INTO outbox_consumers(consumer_key,handler_key,max_concurrency) SELECT 'runtime.'||replace(handler_key,'.','-'),handler_key,CASE handler_key WHEN 'embedding.generate' THEN 4 ELSE 1 END FROM background_job_handlers WHERE status='active';

CREATE FUNCTION reserve_outbox_aggregate_sequence(requested_space_id uuid,requested_book_id uuid,requested_kind text,requested_id uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE sequence_value bigint;
BEGIN
  INSERT INTO outbox_aggregate_sequences(space_id,book_id,aggregate_kind,aggregate_id,last_sequence) VALUES(requested_space_id,requested_book_id,requested_kind,requested_id,1)
  ON CONFLICT(aggregate_kind,aggregate_id) DO UPDATE SET last_sequence=outbox_aggregate_sequences.last_sequence+1,updated_at=now()
  RETURNING last_sequence INTO sequence_value;
  RETURN sequence_value;
END $$;

CREATE FUNCTION enqueue_registered_background_job(request_kind text,request_id uuid,request_space_id uuid,request_book_id uuid,requested_correlation_id uuid,requested_causation_id uuid,requested_producer_kind text DEFAULT 'domain_store') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE handler background_job_handlers%ROWTYPE; event_id uuid; job_id uuid; sequence_value bigint; payload_value jsonb; ordering_value text; priority_value integer:=0;
BEGIN
  SELECT * INTO handler FROM background_job_handlers WHERE specialized_request_kind=request_kind AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'no active handler registered for %',request_kind USING ERRCODE='23514'; END IF;
  IF requested_producer_kind NOT IN ('domain_store','migration_bridge') THEN RAISE EXCEPTION 'invalid specialized request producer kind' USING ERRCODE='23514'; END IF;
  IF request_kind='dependency_recompute_request' THEN SELECT priority INTO priority_value FROM dependency_recompute_requests WHERE id=request_id;
  ELSIF request_kind='ai_task' THEN SELECT priority INTO priority_value FROM ai_tasks WHERE id=request_id;
  END IF;
  ordering_value:=COALESCE('book:'||request_book_id::text||':handler:'||handler.handler_key,'space:'||request_space_id::text||':handler:'||handler.handler_key);
  payload_value:=jsonb_build_object('specializedRequestKind',request_kind,'specializedRequestId',request_id,'bookId',request_book_id);
  SELECT id,aggregate_sequence,ordering_key INTO event_id,sequence_value,ordering_value FROM outbox_events WHERE topic=handler.topic AND producer_idempotency_key='request:'||request_kind||':'||request_id::text;
  IF event_id IS NULL THEN
    sequence_value:=reserve_outbox_aggregate_sequence(request_space_id,request_book_id,CASE WHEN request_book_id IS NULL THEN 'space_runtime' ELSE 'book_runtime' END,COALESCE(request_book_id,request_space_id));
    event_id:=gen_random_uuid();
    INSERT INTO outbox_events(id,space_id,book_id,topic,event_version,aggregate_kind,aggregate_id,aggregate_sequence,ordering_key,producer_kind,producer_idempotency_key,payload,payload_hash,correlation_id,causation_id)
    VALUES(event_id,request_space_id,request_book_id,handler.topic,handler.event_version,CASE WHEN request_book_id IS NULL THEN 'space_runtime' ELSE 'book_runtime' END,COALESCE(request_book_id,request_space_id),sequence_value,ordering_value,requested_producer_kind,'request:'||request_kind||':'||request_id::text,payload_value,dependency_content_hash(payload_value::text),requested_correlation_id,requested_causation_id);
  END IF;
  SELECT id INTO job_id FROM background_jobs WHERE handler_key=handler.handler_key AND specialized_request_kind=request_kind AND specialized_request_id=request_id AND execution_generation=1;
  IF job_id IS NULL THEN
    job_id:=gen_random_uuid();
    INSERT INTO background_jobs(id,outbox_event_id,space_id,book_id,handler_key,job_kind,specialized_request_kind,specialized_request_id,ordering_key,aggregate_sequence,priority,max_attempts)
    VALUES(job_id,event_id,request_space_id,request_book_id,handler.handler_key,handler.job_kind,request_kind,request_id,ordering_value,sequence_value,priority_value,handler.default_max_attempts);
  END IF;
  RETURN job_id;
END $$;

CREATE FUNCTION bridge_specialized_request_to_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_kind text; request_book uuid; request_space uuid; correlation uuid; causation uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'dependency_recompute_requests' THEN request_kind:='dependency_recompute_request'; request_book:=NEW.book_id; correlation:=NEW.invalidation_event_id; causation:=NEW.target_resource_id;
    WHEN 'asset_derivations' THEN request_kind:='asset_derivation'; request_book:=NEW.book_id; causation:=NEW.source_asset_version_id;
    WHEN 'graph_projection_requests' THEN request_kind:='graph_projection_request'; request_book:=NEW.book_id; correlation:=NEW.generation_id; causation:=NEW.dependency_resource_id;
    WHEN 'chunking_requests' THEN request_kind:='embedding_chunking_request'; request_book:=NEW.book_id; causation:=NEW.source_snapshot_id;
    WHEN 'embedding_requests' THEN request_kind:='embedding_request'; request_book:=NEW.book_id; causation:=NEW.chunk_id;
    WHEN 'embedding_index_generations' THEN request_kind:='embedding_index_generation'; request_book:=NEW.book_id; causation:=NEW.profile_version_id;
    WHEN 'ai_tasks' THEN request_kind:='ai_task'; request_book:=NEW.book_id; request_space:=NEW.space_id; causation:=NEW.source_id;
  END CASE;
  IF request_space IS NULL THEN SELECT space_id INTO request_space FROM books WHERE id=request_book; END IF;
  PERFORM enqueue_registered_background_job(request_kind,NEW.id,request_space,request_book,correlation,causation);
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_dependency_recompute_bridge AFTER INSERT ON dependency_recompute_requests FOR EACH ROW EXECUTE FUNCTION bridge_specialized_request_to_outbox();
CREATE TRIGGER outbox_asset_derivation_bridge AFTER INSERT ON asset_derivations FOR EACH ROW EXECUTE FUNCTION bridge_specialized_request_to_outbox();
CREATE TRIGGER outbox_graph_projection_bridge AFTER INSERT ON graph_projection_requests FOR EACH ROW EXECUTE FUNCTION bridge_specialized_request_to_outbox();
CREATE TRIGGER outbox_chunking_bridge AFTER INSERT ON chunking_requests FOR EACH ROW EXECUTE FUNCTION bridge_specialized_request_to_outbox();
CREATE TRIGGER outbox_embedding_bridge AFTER INSERT ON embedding_requests FOR EACH ROW EXECUTE FUNCTION bridge_specialized_request_to_outbox();
CREATE TRIGGER outbox_embedding_index_bridge AFTER INSERT ON embedding_index_generations FOR EACH ROW EXECUTE FUNCTION bridge_specialized_request_to_outbox();
CREATE TRIGGER outbox_ai_task_bridge AFTER INSERT ON ai_tasks FOR EACH ROW WHEN(NEW.book_id IS NOT NULL) EXECUTE FUNCTION bridge_specialized_request_to_outbox();

DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT request.id,request.book_id,book.space_id,request.invalidation_event_id correlation_id,request.target_resource_id causation_id FROM dependency_recompute_requests request JOIN books book ON book.id=request.book_id WHERE request.status IN ('pending','recomputing') LOOP PERFORM enqueue_registered_background_job('dependency_recompute_request',item.id,item.space_id,item.book_id,item.correlation_id,item.causation_id,'migration_bridge'); END LOOP;
  FOR item IN SELECT request.id,request.book_id,book.space_id,NULL::uuid correlation_id,request.source_asset_version_id causation_id FROM asset_derivations request JOIN books book ON book.id=request.book_id WHERE request.status IN ('pending','processing','rebuild_pending') LOOP PERFORM enqueue_registered_background_job('asset_derivation',item.id,item.space_id,item.book_id,item.correlation_id,item.causation_id,'migration_bridge'); END LOOP;
  FOR item IN SELECT request.id,request.book_id,book.space_id,request.generation_id correlation_id,request.dependency_resource_id causation_id FROM graph_projection_requests request JOIN books book ON book.id=request.book_id WHERE request.status IN ('pending','processing') LOOP PERFORM enqueue_registered_background_job('graph_projection_request',item.id,item.space_id,item.book_id,item.correlation_id,item.causation_id,'migration_bridge'); END LOOP;
  FOR item IN SELECT request.id,request.book_id,book.space_id,NULL::uuid correlation_id,request.source_snapshot_id causation_id FROM chunking_requests request JOIN books book ON book.id=request.book_id WHERE request.status IN ('pending','running') LOOP PERFORM enqueue_registered_background_job('embedding_chunking_request',item.id,item.space_id,item.book_id,item.correlation_id,item.causation_id,'migration_bridge'); END LOOP;
  FOR item IN SELECT request.id,request.book_id,book.space_id,NULL::uuid correlation_id,request.chunk_id causation_id FROM embedding_requests request JOIN books book ON book.id=request.book_id WHERE request.status IN ('pending','running','retry_scheduled') LOOP PERFORM enqueue_registered_background_job('embedding_request',item.id,item.space_id,item.book_id,item.correlation_id,item.causation_id,'migration_bridge'); END LOOP;
  FOR item IN SELECT request.id,request.book_id,book.space_id,NULL::uuid correlation_id,request.profile_version_id causation_id FROM embedding_index_generations request JOIN books book ON book.id=request.book_id WHERE request.status IN ('building','verifying') LOOP PERFORM enqueue_registered_background_job('embedding_index_generation',item.id,item.space_id,item.book_id,item.correlation_id,item.causation_id,'migration_bridge'); END LOOP;
  FOR item IN SELECT request.id,request.book_id,request.space_id,NULL::uuid correlation_id,request.source_id causation_id FROM ai_tasks request WHERE request.book_id IS NOT NULL AND request.status IN ('queued','running','retry_scheduled') LOOP PERFORM enqueue_registered_background_job('ai_task',item.id,item.space_id,item.book_id,item.correlation_id,item.causation_id,'migration_bridge'); END LOOP;
END $$;

CREATE FUNCTION archive_terminal_background_jobs() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE affected integer; policy background_job_archive_policies%ROWTYPE;
BEGIN
  SELECT * INTO policy FROM background_job_archive_policies WHERE singleton;
  WITH candidates AS (
    SELECT id FROM background_jobs WHERE ((status IN ('succeeded','failed','cancelled') AND completed_at<now()-make_interval(days=>policy.terminal_retention_days)) OR (status='dead_letter' AND completed_at<now()-make_interval(days=>policy.dead_letter_retention_days)))
    ORDER BY completed_at,id FOR UPDATE SKIP LOCKED LIMIT policy.archive_batch_limit
  ) UPDATE background_jobs job SET status='archived',revision=revision+1,updated_at=now(),archived_at=now() FROM candidates WHERE job.id=candidates.id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END $$;

CREATE INDEX outbox_events_topic_order_idx ON outbox_events(topic,recorded_at,id);
CREATE INDEX outbox_events_aggregate_idx ON outbox_events(aggregate_kind,aggregate_id,aggregate_sequence);
CREATE INDEX background_jobs_claim_idx ON background_jobs(handler_key,status,priority DESC,next_run_at,created_at,id) WHERE status IN ('queued','retry_scheduled');
CREATE INDEX background_jobs_book_idx ON background_jobs(book_id,status,created_at DESC,id);
CREATE INDEX background_jobs_lease_idx ON background_jobs(status,lease_until) WHERE status IN ('leased','running','cancel_requested');
CREATE INDEX background_jobs_order_idx ON background_jobs(ordering_key,aggregate_sequence,status);
CREATE INDEX background_job_attempts_job_idx ON background_job_attempts(job_id,attempt_number DESC);
CREATE INDEX background_job_attempts_owner_idx ON background_job_attempts(owner,status,heartbeat_at);
CREATE INDEX outbox_inbox_consumer_idx ON outbox_inbox_receipts(consumer_key,received_at DESC,id);
CREATE INDEX background_job_replays_source_idx ON background_job_replays(source_job_id,created_at DESC);

INSERT INTO schema_migrations(id) VALUES('030_postgres_outbox_job_runtime') ON CONFLICT(id) DO NOTHING;
