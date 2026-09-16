SET search_path TO new_design, public;
-- Original model versions remain the only connection/configuration facts.
ALTER TABLE embedding_profile_versions ADD COLUMN connection_version_id uuid REFERENCES model_route_versions(id);
ALTER TABLE embedding_profile_versions ADD COLUMN knowledge_profile_key uuid, ADD COLUMN knowledge_profile_hash char(64), ADD COLUMN knowledge_profile_book_id uuid REFERENCES books(id);
CREATE UNIQUE INDEX knowledge_profile_original_key ON embedding_profile_versions(knowledge_profile_key) WHERE knowledge_profile_key IS NOT NULL;
ALTER TABLE chunking_requests ADD COLUMN knowledge_index_key uuid,
 ADD COLUMN knowledge_index_hash char(64), ADD COLUMN knowledge_index_plan jsonb;
CREATE UNIQUE INDEX knowledge_index_request_key ON chunking_requests(book_id,knowledge_index_key) WHERE knowledge_index_key IS NOT NULL;
ALTER TABLE embedding_requests ADD COLUMN embedding_freeze jsonb,
 ADD COLUMN embedding_execution_key uuid, ADD COLUMN embedding_lease_expires_at timestamptz,
 ADD COLUMN embedding_model_state text NOT NULL DEFAULT 'not_sent' CHECK(embedding_model_state IN ('not_sent','sent_unknown','completed'));
CREATE UNIQUE INDEX knowledge_embedding_execution_key ON embedding_requests(book_id,embedding_execution_key) WHERE embedding_execution_key IS NOT NULL;
ALTER TABLE embedding_attempts ADD COLUMN embedding_reply jsonb, ADD COLUMN embedding_reply_hash char(64), ADD COLUMN embedding_execution jsonb;
ALTER TABLE semantic_retrieval_runs ADD COLUMN embedding_request_key uuid,
 ADD COLUMN embedding_freeze jsonb, ADD COLUMN embedding_lease_expires_at timestamptz,
 ADD COLUMN embedding_model_state text NOT NULL DEFAULT 'not_sent' CHECK(embedding_model_state IN ('not_sent','sent_unknown','completed')),
 ADD COLUMN embedding_reply jsonb, ADD COLUMN embedding_reply_hash char(64), ADD COLUMN embedding_execution jsonb;
CREATE UNIQUE INDEX knowledge_semantic_request_key ON semantic_retrieval_runs(book_id,embedding_request_key) WHERE embedding_request_key IS NOT NULL;
ALTER TABLE embedding_index_generations ADD COLUMN knowledge_build_hash char(64) CHECK(knowledge_build_hash ~ '^[a-f0-9]{64}$');
CREATE FUNCTION guard_knowledge_build_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.knowledge_build_hash IS NOT NULL AND NEW.knowledge_build_hash IS DISTINCT FROM OLD.knowledge_build_hash THEN RAISE EXCEPTION 'immutable knowledge build receipt' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER knowledge_build_receipt BEFORE UPDATE ON embedding_index_generations FOR EACH ROW EXECUTE FUNCTION guard_knowledge_build_receipt();

CREATE FUNCTION validate_knowledge_embedding_freeze(frozen jsonb,profile_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE profile embedding_profile_versions%ROWTYPE; connection model_route_versions%ROWTYPE; config model_route_configs%ROWTYPE;
BEGIN
 IF jsonb_typeof(frozen) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid embedding freeze' USING ERRCODE='23514'; END IF;
 SELECT * INTO profile FROM embedding_profile_versions WHERE id=profile_id;
 SELECT * INTO connection FROM model_route_versions WHERE id=(frozen->>'connectionVersionId')::uuid;
 SELECT * INTO config FROM model_route_configs WHERE id=connection.config_id;
 IF profile.id IS NULL OR connection.id IS NULL OR profile.connection_version_id IS DISTINCT FROM connection.id
 OR config.scope IS DISTINCT FROM 'task_group' OR config.task_group IS DISTINCT FROM 'knowledge_embedding' OR config.task_key IS NOT NULL
 OR connection.status NOT IN ('published','superseded') OR connection.required_capabilities IS DISTINCT FROM ARRAY['embedding']::text[]
 OR profile.provider_key IS DISTINCT FROM connection.provider OR profile.model_key IS DISTINCT FROM connection.model
 OR frozen->>'profileVersionId' IS DISTINCT FROM profile.id::text OR frozen->>'profileHash' IS DISTINCT FROM profile.content_hash::text
 OR frozen->>'connectionHash' IS DISTINCT FROM connection.content_hash::text OR frozen->>'provider' IS DISTINCT FROM connection.provider
 OR frozen->>'model' IS DISTINCT FROM connection.model OR (frozen->>'dimensions')::integer IS DISTINCT FROM profile.dimensions
 OR coalesce(frozen->>'inputHash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'embedding freeze does not resolve exact configuration' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION guard_knowledge_embedding_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen jsonb; chunk embedding_chunks%ROWTYPE; source embedding_source_snapshots%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='embedding_profile_versions' THEN
  IF NEW.connection_version_id IS NOT NULL THEN
   PERFORM validate_knowledge_embedding_freeze(jsonb_build_object('connectionVersionId',NEW.connection_version_id,'connectionHash',(SELECT content_hash FROM model_route_versions WHERE id=NEW.connection_version_id),'profileVersionId',NEW.id,'profileHash',NEW.content_hash,'provider',NEW.provider_key,'model',NEW.model_key,'dimensions',NEW.dimensions,'inputHash',NEW.content_hash),NEW.id);
  END IF;
 ELSIF TG_TABLE_NAME='chunking_requests' THEN
  IF NEW.knowledge_index_key IS NOT NULL AND (NEW.knowledge_index_hash IS NULL OR jsonb_typeof(NEW.knowledge_index_plan) IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'incomplete index receipt' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.knowledge_index_key IS NOT NULL AND (NEW.knowledge_index_key IS DISTINCT FROM OLD.knowledge_index_key OR NEW.knowledge_index_hash IS DISTINCT FROM OLD.knowledge_index_hash OR NEW.knowledge_index_plan IS DISTINCT FROM OLD.knowledge_index_plan) THEN RAISE EXCEPTION 'immutable index receipt' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='embedding_attempts' THEN
  SELECT embedding_freeze INTO frozen FROM embedding_requests WHERE id=NEW.request_id;
  IF TG_OP='INSERT' AND frozen IS NOT NULL AND NEW.attempt_number<>1 THEN RAISE EXCEPTION 'controlled embedding cannot be sent twice' USING ERRCODE='23514'; END IF;
  IF NEW.embedding_reply IS NOT NULL THEN
   SELECT embedding_freeze INTO frozen FROM embedding_requests WHERE id=NEW.request_id;
   IF frozen IS NULL OR NEW.embedding_reply->>'provider' IS DISTINCT FROM frozen->>'provider' OR NEW.embedding_reply->>'model' IS DISTINCT FROM frozen->>'model'
   OR jsonb_array_length(NEW.embedding_reply->'vector') IS DISTINCT FROM (frozen->>'dimensions')::integer OR NEW.embedding_reply->>'responseReceived' IS DISTINCT FROM 'true'
   THEN RAISE EXCEPTION 'embedding reply does not match original attempt' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.embedding_reply IS NOT NULL AND (NEW.embedding_reply_hash IS NULL OR jsonb_typeof(NEW.embedding_reply) IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'incomplete embedding reply' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.embedding_reply IS NOT NULL AND (NEW.embedding_reply IS DISTINCT FROM OLD.embedding_reply OR NEW.embedding_reply_hash IS DISTINCT FROM OLD.embedding_reply_hash) THEN RAISE EXCEPTION 'immutable embedding reply' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.embedding_freeze IS NOT NULL THEN PERFORM validate_knowledge_embedding_freeze(NEW.embedding_freeze,NEW.profile_version_id); END IF;
  IF TG_OP='UPDATE' AND OLD.embedding_freeze IS NOT NULL AND NEW.embedding_freeze IS DISTINCT FROM OLD.embedding_freeze THEN RAISE EXCEPTION 'immutable embedding input' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.embedding_lease_expires_at IS NOT NULL AND NEW.embedding_lease_expires_at IS DISTINCT FROM OLD.embedding_lease_expires_at THEN RAISE EXCEPTION 'immutable embedding lease' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='embedding_requests' THEN
   IF NEW.embedding_freeze IS NOT NULL THEN
    SELECT * INTO chunk FROM embedding_chunks WHERE id=NEW.chunk_id; SELECT * INTO source FROM embedding_source_snapshots WHERE id=chunk.source_snapshot_id;
    IF (NEW.embedding_freeze->>'bookId')::uuid IS DISTINCT FROM NEW.book_id OR (NEW.embedding_freeze->>'requestId')::uuid IS DISTINCT FROM NEW.id
    OR (NEW.embedding_freeze->>'chunkId')::uuid IS DISTINCT FROM NEW.chunk_id OR (NEW.embedding_freeze->>'sourceSnapshotId')::uuid IS DISTINCT FROM source.id
    OR (NEW.embedding_freeze->>'sourceStableId')::uuid IS DISTINCT FROM source.source_stable_id OR (NEW.embedding_freeze->>'sourceVersionId')::uuid IS DISTINCT FROM source.source_version_id
    OR NEW.embedding_freeze->>'sourceHash' IS DISTINCT FROM NEW.expected_source_hash::text OR NEW.embedding_freeze->>'chunkHash' IS DISTINCT FROM NEW.expected_chunk_hash::text
    THEN RAISE EXCEPTION 'embedding freeze does not match original source identity' USING ERRCODE='23514'; END IF;
   END IF;
   IF NEW.embedding_freeze IS NOT NULL AND NEW.status='running' AND NEW.embedding_execution_key IS NULL THEN RAISE EXCEPTION 'controlled embedding requires original execution receipt' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND OLD.embedding_execution_key IS NOT NULL AND NEW.embedding_execution_key IS DISTINCT FROM OLD.embedding_execution_key THEN RAISE EXCEPTION 'immutable embedding execution key' USING ERRCODE='23514'; END IF;
  ELSE
   IF TG_OP='UPDATE' AND OLD.embedding_reply IS NOT NULL AND (NEW.embedding_reply IS DISTINCT FROM OLD.embedding_reply OR NEW.embedding_reply_hash IS DISTINCT FROM OLD.embedding_reply_hash) THEN RAISE EXCEPTION 'immutable query reply' USING ERRCODE='23514'; END IF;
   IF NEW.embedding_reply IS NOT NULL AND (NEW.embedding_reply_hash IS NULL OR jsonb_typeof(NEW.embedding_reply) IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'incomplete query reply' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
-- AFTER INSERT sees the newly inserted immutable profile; no historical version is updated.
CREATE TRIGGER knowledge_profile_connection AFTER INSERT ON embedding_profile_versions FOR EACH ROW EXECUTE FUNCTION guard_knowledge_embedding_execution();
CREATE TRIGGER knowledge_chunking_receipt BEFORE INSERT OR UPDATE ON chunking_requests FOR EACH ROW EXECUTE FUNCTION guard_knowledge_embedding_execution();
CREATE TRIGGER knowledge_embedding_request BEFORE INSERT OR UPDATE ON embedding_requests FOR EACH ROW EXECUTE FUNCTION guard_knowledge_embedding_execution();
CREATE TRIGGER knowledge_embedding_reply BEFORE INSERT OR UPDATE ON embedding_attempts FOR EACH ROW EXECUTE FUNCTION guard_knowledge_embedding_execution();
CREATE TRIGGER knowledge_query_execution BEFORE INSERT OR UPDATE ON semantic_retrieval_runs FOR EACH ROW EXECUTE FUNCTION guard_knowledge_embedding_execution();
CREATE FUNCTION guard_knowledge_embedding_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen jsonb; reply jsonb;
BEGIN
 SELECT request.embedding_freeze,attempt.embedding_reply INTO frozen,reply FROM embedding_requests request JOIN embedding_attempts attempt ON attempt.request_id=request.id AND attempt.id=NEW.attempt_id WHERE request.id=NEW.request_id;
 IF frozen IS NOT NULL AND NEW.outcome='applied' AND (reply IS NULL OR NEW.vector_value IS DISTINCT FROM (reply->'vector')::text::vector) THEN RAISE EXCEPTION 'controlled result must equal retained original vector' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER knowledge_embedding_result BEFORE INSERT ON embedding_results FOR EACH ROW EXECUTE FUNCTION guard_knowledge_embedding_result();
