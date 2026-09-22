--
-- PostgreSQL database dump
--

\restrict G9toatltgRhx3O9KmGJsgMyYrR6vFq3jHGQt1aPUw4aCNj7sL1phXBomDVb0AJ5

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: new_design; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA new_design;


--
-- Name: new_design_projection; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA new_design_projection;


--
-- Name: activate_embedding_generation(uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.activate_embedding_generation(requested_generation_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE generation_row record; profile_uuid uuid; state_value jsonb; book_space uuid; actual_count integer;
BEGIN
 SELECT * INTO generation_row FROM embedding_generations WHERE id=requested_generation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'generation missing' USING ERRCODE='23503'; END IF;
 SELECT (v.values->>'profile_id')::uuid INTO profile_uuid FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'id'=generation_row.profile_version_id::text;
 SELECT space_id INTO book_space FROM books WHERE id=generation_row.book_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('embedding-index:'||generation_row.book_id::text||':'||profile_uuid::text,0));
 SELECT v.values INTO state_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_index_state' AND v.values->>'book_id'=generation_row.book_id::text AND v.values->>'profile_id'=profile_uuid::text;
 IF generation_row.status='active' AND state_value->>'active_generation_id'=requested_generation_id::text THEN RETURN; END IF;
 SELECT count(*) INTO actual_count FROM embedding_vectors WHERE record_kind='index' AND generation_id=requested_generation_id AND status='eligible';
 IF profile_uuid IS NULL OR book_space IS NULL OR generation_row.status<>'ready' OR generation_row.coverage<1 OR generation_row.expected_vector_count<>generation_row.indexed_vector_count OR actual_count<>generation_row.indexed_vector_count OR generation_row.checksum IS NULL OR to_regclass('new_design.'||generation_row.index_name) IS NULL THEN RAISE EXCEPTION 'only fully verified generations may activate' USING ERRCODE='23514'; END IF;
 UPDATE embedding_generations SET status='retired',retired_at=now() WHERE id=(state_value->>'active_generation_id')::uuid AND id<>requested_generation_id AND status='active';
 UPDATE embedding_generations SET status='active',activated_at=now() WHERE id=requested_generation_id;
 PERFORM kernel_store_record('embedding_index_state',book_space,COALESCE((state_value->>'id')::uuid,gen_random_uuid()),
  COALESCE(state_value,'{}'::jsonb)||jsonb_build_object('book_id',generation_row.book_id,'profile_id',profile_uuid,
  'active_generation_id',requested_generation_id,'status','ready','revision',COALESCE((state_value->>'revision')::integer,0)+1,
  'last_success_at',now(),'last_error_code','','last_error_detail','','updated_at',now()));
END $$;


--
-- Name: add_registered_dependency(text, uuid, uuid, text, uuid, uuid, text, text, text, uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.add_registered_dependency(source_kind text, source_stable_id uuid, source_version_id uuid, derived_kind text, derived_stable_id uuid, derived_version_id uuid, edge_kind text, edge_strength text, edge_origin text, edge_origin_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE source_id uuid; derived_id uuid; derived_row record; edge_id uuid;
BEGIN
  source_id:=register_dependency_resource(source_kind,source_stable_id,source_version_id);
  derived_id:=register_dependency_resource(derived_kind,derived_stable_id,derived_version_id);
  SELECT * INTO derived_row FROM dependency_resources WHERE id=derived_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('dependency-edges:'||derived_row.book_id::text,0));
  SELECT id INTO edge_id FROM dependency_edges WHERE source_resource_id=source_id AND derived_resource_id=derived_id AND dependency_kind=edge_kind AND status='active';
  IF edge_id IS NOT NULL THEN RETURN edge_id; END IF;
  edge_id:=gen_random_uuid();
  INSERT INTO dependency_edges(id,space_id,book_id,source_resource_id,derived_resource_id,dependency_kind,dependency_strength,origin_kind,origin_id)
  VALUES(edge_id,derived_row.space_id,derived_row.book_id,source_id,derived_id,edge_kind,edge_strength,edge_origin,edge_origin_id);
  RETURN edge_id;
END $$;


--
-- Name: archive_terminal_background_jobs(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.archive_terminal_background_jobs() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE affected integer; policy record;
BEGIN
  SELECT fields.* INTO STRICT policy FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
 CROSS JOIN LATERAL jsonb_to_record(v.values) fields(singleton boolean,terminal_retention_days integer,dead_letter_retention_days integer,archive_batch_limit integer)
 WHERE t.type_key='background_job_archive_policy' AND fields.singleton;
 IF policy.terminal_retention_days NOT BETWEEN 7 AND 3650 OR policy.dead_letter_retention_days NOT BETWEEN policy.terminal_retention_days AND 3650 OR policy.archive_batch_limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid background archive policy' USING ERRCODE='23514'; END IF;
  WITH candidates AS (
    SELECT id FROM background_jobs WHERE ((status IN ('succeeded','failed','cancelled') AND completed_at<now()-make_interval(days=>policy.terminal_retention_days)) OR (status='dead_letter' AND completed_at<now()-make_interval(days=>policy.dead_letter_retention_days)))
    ORDER BY completed_at,id FOR UPDATE SKIP LOCKED LIMIT policy.archive_batch_limit
  ) UPDATE background_jobs job SET status='archived',revision=revision+1,updated_at=now(),archived_at=now() FROM candidates WHERE job.id=candidates.id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END $$;


--
-- Name: assert_chapter_settlement_ai_payload(jsonb, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_chapter_settlement_ai_payload(previous jsonb, next jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
BEGIN
 SELECT * INTO NEW FROM jsonb_to_record(next) AS data(id uuid,session_id uuid,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);
 SELECT * INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,session_id uuid,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter extraction receipts cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.frozen_plan,NEW.frozen_input_hash,NEW.expected_session_revision) IS DISTINCT FROM ROW(OLD.frozen_plan,OLD.frozen_input_hash,OLD.expected_session_revision) THEN
      RAISE EXCEPTION 'chapter extraction input is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.generated_output IS NOT NULL AND ROW(NEW.generated_output,NEW.generated_execution) IS DISTINCT FROM ROW(OLD.generated_output,OLD.generated_execution) THEN
      RAISE EXCEPTION 'chapter extraction model result is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.frozen_plan IS NOT NULL AND OLD.ai_task_id IS DISTINCT FROM NEW.ai_task_id THEN RAISE EXCEPTION 'chapter extraction task is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.generated_execution IS NOT NULL AND NEW.generated_execution IS DISTINCT FROM OLD.generated_execution THEN RAISE EXCEPTION 'chapter extraction execution trace is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status='succeeded' AND (NEW.status<>OLD.status OR NEW.failure IS DISTINCT FROM OLD.failure) THEN RAISE EXCEPTION 'saved extraction import is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.frozen_plan IS NOT NULL AND OLD.status IN ('stale','cancelled') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'ended extraction is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.frozen_plan IS NOT NULL AND (NEW.frozen_input_hash IS NULL OR NEW.expected_session_revision IS NULL OR NEW.ai_task_id IS NULL OR COALESCE(NEW.frozen_plan->>'assetId','') NOT IN ('new_design.chapter.settlement_candidates','new_design.character.resource_backfill','new_design.character.stable_resource_supplement','new_design.character.stable_resource_correction') OR NEW.frozen_plan->>'assetVersion' IS DISTINCT FROM 'v1' OR
    NEW.frozen_plan->'input'->>'sessionId' IS DISTINCT FROM NEW.session_id::text OR NEW.frozen_plan->'input'->>'bodyVersionId' IS DISTINCT FROM NEW.body_version_id::text OR
    NOT EXISTS(SELECT 1 FROM new_design.ai_tasks task JOIN new_design.task_contract_versions contract ON contract.id=task.task_contract_version_id JOIN new_design.task_contracts config ON config.id=contract.contract_id WHERE task.id=NEW.ai_task_id AND task.source_kind='chapter_settlement_extraction' AND task.source_id=NEW.id AND task.book_id=NEW.book_id AND contract.id=NEW.task_contract_version_id AND contract.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND contract.task_group='chapter_settlement' AND config.task_key='chapter_settlement_'||NEW.session_id::text
      AND contract.budget_policy->>'assetId'=NEW.frozen_plan->>'assetId' AND contract.budget_policy->>'assetVersion'=NEW.frozen_plan->>'assetVersion'
      AND EXISTS(SELECT 1 FROM new_design.prompt_recipe_versions recipe WHERE recipe.id=NEW.prompt_recipe_version_id AND recipe.variables_schema->'const'=NEW.frozen_plan->'input'))) THEN
    RAISE EXCEPTION 'chapter extraction controlled provenance is incomplete' USING ERRCODE='23514';
  END IF;

  IF NEW.frozen_plan->>'assetId' IN ('new_design.character.resource_backfill','new_design.character.stable_resource_supplement','new_design.character.stable_resource_correction') AND (
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope') IS DISTINCT FROM 'object' OR
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope'->'resources') IS DISTINCT FROM 'array' OR
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope'->'anchors') IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION 'resource backfill requires its frozen scope' USING ERRCODE='23514'; END IF;
  -- Validate live sources only for a new claim. Saved receipts remain readable and finishable
  -- after legitimate future edits; every frozen input and model result remains immutable.
  IF TG_OP='INSERT' AND NEW.frozen_plan->>'assetId' IN ('new_design.character.resource_backfill','new_design.character.stable_resource_supplement','new_design.character.stable_resource_correction') THEN
    IF NOT EXISTS(
      SELECT 1 FROM new_design.books book
      JOIN new_design.cards actor ON actor.space_id=book.space_id
      JOIN new_design.card_types type ON type.id=actor.card_type_id AND type.type_key='character' AND type.status='published'
      JOIN new_design.chapter_documents document ON document.book_id=book.id AND document.adopted_version_id=NEW.body_version_id AND document.status='active'
      JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      WHERE book.id=NEW.book_id AND book.status='active' AND actor.status='active'
        AND actor.id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterId'
        AND actor.current_version_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterVersionId'
        AND actor.revision=(NEW.frozen_plan->'input'->'resourceScope'->>'characterRevision')::integer
        AND body.content=NEW.frozen_plan->'input'->>'bodyContent'
        AND body.content_hash=NEW.frozen_plan->'input'->>'bodyContentHash'
    ) OR jsonb_array_length(NEW.frozen_plan->'input'->'resourceScope'->'resources')=0 OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(NEW.frozen_plan->'input'->'resourceScope'->'resources') reference
      WHERE NOT EXISTS(
        SELECT 1 FROM new_design.card_relations relation JOIN new_design.books book ON book.space_id=relation.space_id AND book.id=NEW.book_id
        JOIN new_design.cards resource ON resource.id=relation.target_card_id AND resource.space_id=book.space_id AND resource.status='active'
        JOIN new_design.card_types type ON type.id=resource.card_type_id AND type.type_key='prop' AND type.status='published'
        JOIN new_design.card_relation_versions version ON version.id=relation.current_version_id AND version.card_relation_id=relation.id
        WHERE relation.status='active' AND relation.id::text=reference->>'relationId' AND version.id::text=reference->>'relationVersionId'
          AND relation.source_card_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterId'
          AND relation.relation_type_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'relationTypeId'
          AND resource.id::text=reference->>'id' AND resource.current_version_id::text=reference->>'versionId'
          AND version.revision=relation.revision AND version.status=relation.status AND version.properties=relation.properties
      )
    ) OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(NEW.frozen_plan->'input'->'resourceScope'->'anchors') reference
      WHERE NOT EXISTS(
        SELECT 1 FROM new_design.text_anchors anchor WHERE anchor.id::text=reference->>'id' AND anchor.book_id=NEW.book_id
          AND anchor.body_version_id=NEW.body_version_id AND anchor.status='active'
          AND anchor.subject_card_id::text=reference->>'subjectCardId'
          AND anchor.start_offset=(reference->>'start')::integer AND anchor.end_offset=(reference->>'end')::integer
          AND anchor.excerpt=reference->>'excerpt'
      )
    ) THEN RAISE EXCEPTION 'resource backfill requires exact adopted body and book sources' USING ERRCODE='23514'; END IF;
  END IF;

  IF NEW.generated_output IS NOT NULL AND (NEW.frozen_plan IS NULL OR NEW.generated_execution IS NULL) THEN RAISE EXCEPTION 'chapter extraction model result needs controlled provenance' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.generated_output IS NULL AND NEW.generated_output IS NOT NULL AND (OLD.status<>'running' OR NEW.status<>'running' OR
    NOT EXISTS(SELECT 1 FROM new_design.ai_task_attempts attempt WHERE attempt.task_id=NEW.ai_task_id AND attempt.status='running' AND attempt.input_hash=NEW.frozen_input_hash AND attempt.task_contract_version_id=NEW.task_contract_version_id AND attempt.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND attempt.context_manifest_id=NEW.context_manifest_id AND attempt.model_route_snapshot_id=NEW.model_route_snapshot_id)) THEN
    RAISE EXCEPTION 'chapter model output requires its running frozen attempt' USING ERRCODE='23514';
  END IF;
  RETURN;
END;
$$;


--
-- Name: assert_character_author_influence(jsonb, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_character_author_influence(previous jsonb, next jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE original record; material new_design.card_versions%ROWTYPE;
NEW record; OLD record; TG_OP text:=CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
BEGIN
 SELECT * INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,card_id uuid,source_hash char(64),draft jsonb,target_start integer,target_end integer,status text,revision integer,guidance_card_id uuid,guidance_version_id uuid,created_at timestamptz,updated_at timestamptz);
 SELECT * INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,card_id uuid,source_hash char(64),draft jsonb,target_start integer,target_end integer,status text,revision integer,guidance_card_id uuid,guidance_version_id uuid,created_at timestamptz,updated_at timestamptz);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'original influence candidate immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT original FROM (SELECT data.id,data.book_id,data.card_id,data.request_key,data.request_hash,version.values->'input_payload' AS input_payload,version.values->'source_snapshot' AS source_snapshot,version.values->'frozen_plan' AS frozen_plan,data.step_id,data.attempt_id,data.status,data.reply,data.output,data.summary,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character_author_trial' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,card_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz) WHERE card.status='active') AS character_author_trials WHERE id=NEW.id;
 IF original.status<>'succeeded' OR original.book_id<>NEW.book_id OR original.card_id<>NEW.card_id OR original.source_snapshot->>'hash'<>NEW.source_hash OR original.output->'influenceDraft' IS DISTINCT FROM NEW.draft OR jsonb_typeof(NEW.draft)<>'object' THEN RAISE EXCEPTION 'influence must preserve exact original structured reply' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.revision<>1 OR NEW.guidance_card_id IS NOT NULL THEN RAISE EXCEPTION 'influence begins as unadopted candidate' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','revision','target_start','target_end','guidance_card_id','guidance_version_id','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','target_start','target_end','guidance_card_id','guidance_version_id','updated_at']) OR NEW.revision<>OLD.revision+1 OR OLD.status IN('expired','superseded','dismissed') OR OLD.guidance_card_id IS NOT NULL AND (NEW.guidance_card_id IS DISTINCT FROM OLD.guidance_card_id OR NEW.guidance_version_id IS DISTINCT FROM OLD.guidance_version_id OR NEW.target_start<>OLD.target_start OR NEW.target_end<>OLD.target_end) THEN RAISE EXCEPTION 'original influence provenance and terminal state immutable' USING ERRCODE='23514'; END IF;
  IF NOT (OLD.status='draft' AND NEW.status IN('active','dismissed','expired') OR OLD.status='active' AND NEW.status IN('dismissed','superseded','expired')) THEN RAISE EXCEPTION 'influence transition rejected' USING ERRCODE='23514'; END IF;
  IF NEW.status='active' THEN
   IF NOT EXISTS(SELECT 1 FROM (SELECT 'character_author_influence_v1'::text contract,operational AND installed operational FROM new_design.system_capabilities WHERE capability_key='character_author_influence_v1') AS character_author_influence_capability WHERE operational) OR NOT EXISTS(SELECT 1 FROM new_design.cards person JOIN new_design.books book ON book.space_id=person.space_id WHERE person.id=NEW.card_id AND book.id=NEW.book_id AND person.status='active' AND book.status='active') THEN RAISE EXCEPTION 'influence activation not enabled for this book person' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.guidance_version_id IS NOT NULL THEN
  SELECT * INTO STRICT material FROM new_design.card_versions WHERE id=NEW.guidance_version_id AND card_id=NEW.guidance_card_id;
  IF (NOT EXISTS(SELECT 1 FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.books book ON book.space_id=card.space_id WHERE card.id=material.card_id AND book.id=NEW.book_id AND type.type_key='character_author_guidance') OR material.author_book_id IS DISTINCT FROM NEW.book_id OR material.values->>'content_kind'<>'author_selected_creative_guidance' OR material.values->>'source_trial_id'<>NEW.id::text OR material.values->>'character_id'<>NEW.card_id::text OR material.values->>'source_hash'<>NEW.source_hash OR NULLIF(material.values->>'draft_json','')::jsonb IS DISTINCT FROM NEW.draft OR material.values->>'target_start'<>NEW.target_start::text OR material.values->>'target_end'<>NEW.target_end::text) IS DISTINCT FROM false THEN RAISE EXCEPTION 'influence must use original exact author material version' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='active' AND NEW.guidance_version_id IS NULL THEN RAISE EXCEPTION 'activated influence lacks author material version' USING ERRCODE='23514'; END IF;
 RETURN;
END;
$$;


--
-- Name: assert_character_author_influence_decision(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_character_author_influence_decision(next jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE
NEW record; OLD record; TG_OP text:='INSERT';
BEGIN
 SELECT * INTO NEW FROM jsonb_to_record(next) AS data(request_key uuid,book_id uuid,card_id uuid,candidate_id uuid,input_hash char(64),input_payload jsonb,receipt jsonb,created_at timestamptz);

 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'original influence decisions immutable' USING ERRCODE='23514'; END IF;
 IF (NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.card_id,data.source_hash,version.values->'draft' AS draft,data.target_start,data.target_end,data.status,data.revision,data.guidance_card_id,data.guidance_version_id,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character_author_influence_candidate' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,card_id uuid,source_hash char(64),draft jsonb,target_start integer,target_end integer,status text,revision integer,guidance_card_id uuid,guidance_version_id uuid,created_at timestamptz,updated_at timestamptz) WHERE card.status='active') candidate WHERE candidate.id=NEW.candidate_id AND candidate.book_id=NEW.book_id AND candidate.card_id=NEW.card_id AND candidate.source_hash=NEW.input_payload->>'sourceHash' AND candidate.revision=(NEW.input_payload->>'expectedRevision')::integer+1 AND candidate.target_start=(NEW.input_payload->>'targetStart')::integer AND candidate.target_end=(NEW.input_payload->>'targetEnd')::integer AND candidate.status=CASE WHEN NEW.input_payload->>'action'='activate' THEN 'active' WHEN NEW.input_payload->>'action' IN('dismiss','revoke') THEN 'dismissed' ELSE NULL END AND candidate.revision=(NEW.receipt->'candidate'->>'revision')::integer) OR NEW.input_payload->>'requestKey'<>NEW.request_key::text OR NEW.input_payload->>'candidateId'<>NEW.candidate_id::text OR NEW.input_payload->>'bookId'<>NEW.book_id::text OR NEW.input_payload->>'cardId'<>NEW.card_id::text OR NEW.receipt->>'requestKey'<>NEW.request_key::text OR NEW.receipt->>'inputHash'<>NEW.input_hash OR NEW.receipt->'candidate'->>'id'<>NEW.candidate_id::text OR NEW.receipt->'candidate'->>'bookId'<>NEW.book_id::text OR NEW.receipt->'candidate'->>'cardId'<>NEW.card_id::text) IS DISTINCT FROM false THEN RAISE EXCEPTION 'influence decision scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN;
END;
$$;


--
-- Name: assert_character_author_trial(jsonb, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_character_author_trial(previous jsonb, next jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE task new_design.ai_tasks%ROWTYPE; step new_design.ai_task_steps%ROWTYPE; attempt new_design.ai_task_attempts%ROWTYPE; contract new_design.task_contract_versions%ROWTYPE; recipe new_design.prompt_recipe_versions%ROWTYPE; manifest new_design.context_manifests%ROWTYPE; route new_design.model_route_snapshots%ROWTYPE; source jsonb; actual jsonb; item jsonb; cutoff_order integer; versions jsonb; expected_count integer:=0;
NEW record; OLD record; TG_OP text:=CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
BEGIN
 SELECT * INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,card_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz);
 SELECT * INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,card_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'character author original evidence immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','reply','output','summary']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reply','output','summary']) OR OLD.status<>'running' AND NEW IS DISTINCT FROM OLD OR OLD.reply IS NOT NULL AND NEW.reply IS DISTINCT FROM OLD.reply THEN RAISE EXCEPTION 'character author input and reply immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM (SELECT 'character_author_v1'::text contract,operational AND installed operational FROM new_design.system_capabilities WHERE capability_key='character_author_v1') capability WHERE capability.contract='character_author_v1' AND capability.operational) OR NEW.status<>'running' OR NEW.reply IS NOT NULL OR NEW.output IS NOT NULL THEN RAISE EXCEPTION 'character author trials not enabled' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO STRICT task FROM new_design.ai_tasks WHERE id=NEW.id AND book_id=NEW.book_id;
 SELECT * INTO STRICT step FROM new_design.ai_task_steps WHERE id=NEW.step_id AND task_id=NEW.id AND current_attempt_id=NEW.attempt_id;
 SELECT * INTO STRICT attempt FROM new_design.ai_task_attempts WHERE id=NEW.attempt_id AND task_id=NEW.id AND step_id=NEW.step_id;
 SELECT * INTO STRICT contract FROM new_design.task_contract_versions WHERE id=attempt.task_contract_version_id;
 SELECT * INTO STRICT recipe FROM new_design.prompt_recipe_versions WHERE id=attempt.prompt_recipe_version_id;
 SELECT * INTO STRICT manifest FROM new_design.context_manifests WHERE id=attempt.context_manifest_id;
 SELECT * INTO STRICT route FROM new_design.model_route_snapshots WHERE id=attempt.model_route_snapshot_id;
 source:=NEW.source_snapshot;
 IF NOT COALESCE(task.source_kind='character_author' AND task.source_id=NEW.id AND task.request_idempotency_key=NEW.request_key::text AND task.request_hash=NEW.request_hash AND task.task_contract_version_id=contract.id AND step.step_key='character_author' AND step.max_attempts=1 AND attempt.attempt_number=1 AND attempt.input_hash=NEW.frozen_plan->>'inputHash' AND attempt.output_schema_version=NEW.frozen_plan->>'outputSchemaVersion' AND contract.status='published' AND contract.task_group='character_dialogue' AND contract.budget_policy->>'assetId'='new_design.character.author_conversation' AND contract.retry_policy='{"maxAttempts":1,"automaticRetry":false}'::jsonb AND recipe.status='published' AND recipe.id=contract.prompt_recipe_version_id AND recipe.variables_schema->'const'=contract.input_schema->'const' AND contract.input_schema->'const'=NEW.frozen_plan->'promptInput' AND NEW.frozen_plan->'promptInput'->>'contract'='character_author_v1' AND NEW.frozen_plan->'promptInput'->'input'=NEW.input_payload AND NEW.frozen_plan->'promptInput'->'source'=source AND manifest.book_id=NEW.book_id AND manifest.task_contract_version_id=contract.id AND manifest.prompt_recipe_version_id=recipe.id AND manifest.model_route_snapshot_id=route.id AND manifest.source_set_hash=source->>'hash' AND route.snapshot_hash=NEW.frozen_plan->>'snapshotHash' AND route.retry_policy->>'maxRetries'='0' AND NEW.frozen_plan->'route'->'fallbacks'='[]'::jsonb AND NEW.input_payload->>'requestKey'=NEW.request_key::text AND NEW.input_payload->>'bookId'=NEW.book_id::text AND NEW.input_payload->>'cardId'=NEW.card_id::text AND NEW.input_payload->>'sourceHash'=source->>'hash' AND source->>'bookId'=NEW.book_id::text AND source->>'cardId'=NEW.card_id::text AND source->'cutoffBodyVersionId'=NEW.input_payload->'cutoffBodyVersionId',false) THEN RAISE EXCEPTION 'character author frozen contract mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF task.status<>'running' OR step.status<>'running' OR attempt.status<>'running' OR NEW.input_payload->>'kind' NOT IN ('conversation','scene_analysis') OR jsonb_typeof(NEW.input_payload->'historyKeys')<>'array' THEN RAISE EXCEPTION 'character author original claim mismatch' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('id',id,'name',name,'description',description,'revision',revision) INTO actual FROM new_design.books WHERE id=NEW.book_id AND status='active';
  IF actual IS NULL OR actual IS DISTINCT FROM source->'data'->'book' THEN RAISE EXCEPTION 'character author book source mismatch' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('requestKey',prior.request_key,'kind',prior.input_payload->>'kind','message',prior.input_payload->>'message','output',prior.output) ORDER BY prior.created_at,prior.id),'[]'::jsonb),COALESCE(jsonb_agg(prior.request_key ORDER BY prior.created_at,prior.id),'[]'::jsonb) INTO actual,versions FROM (SELECT data.id,data.book_id,data.card_id,data.request_key,data.request_hash,version.values->'input_payload' AS input_payload,version.values->'source_snapshot' AS source_snapshot,version.values->'frozen_plan' AS frozen_plan,data.step_id,data.attempt_id,data.status,data.reply,data.output,data.summary,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character_author_trial' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,card_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz) WHERE card.status='active') prior WHERE prior.book_id=NEW.book_id AND prior.card_id=NEW.card_id AND prior.status='succeeded' AND prior.source_snapshot->>'hash'=source->>'hash';
  IF jsonb_array_length(versions)>100 OR versions IS DISTINCT FROM NEW.input_payload->'historyKeys' OR actual IS DISTINCT FROM NEW.frozen_plan->'promptInput'->'history' THEN RAISE EXCEPTION 'character author causal history mismatch' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('id',card.id,'versionId',version.id,'title',version.title,'typeVersionId',version.type_version_id,'values',version.values,'fields',spec.fields,'localFields',COALESCE((SELECT jsonb_agg(jsonb_build_object('definitionId',definition.id,'versionId',local_spec.id,'field',local_spec.field_schema,'value',local.value) ORDER BY definition.field_key) FROM (SELECT data.card_version_id,data.field_definition_id,data.field_definition_version_id,version.values->'value' AS value,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='card_version_local_value' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE card.status='active') local JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id JOIN new_design.field_definition_versions local_spec ON local_spec.id=local.field_definition_version_id AND local_spec.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)) INTO actual FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id AND book.id=NEW.book_id AND book.status='active' JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id JOIN new_design.card_type_versions spec ON spec.id=version.type_version_id AND spec.card_type_id=type.id WHERE card.id=NEW.card_id AND card.status='active';
  IF actual IS NULL OR actual IS DISTINCT FROM source->'data'->'profile' THEN RAISE EXCEPTION 'character author profile source mismatch' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',relation.id,'versionId',version.id,'revision',version.revision,'properties',version.properties,'type',jsonb_build_object('id',type.id,'name',type.name,'direction',type.direction,'fields',type.properties_schema,'updatedAt',to_char(type.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'sourceId',endpoint_source.card_id,'sourceVersionId',endpoint_source.id,'sourceTitle',endpoint_source.title,'targetId',endpoint_target.card_id,'targetVersionId',endpoint_target.id,'targetTitle',endpoint_target.title) ORDER BY relation.id),'[]'::jsonb) INTO actual FROM new_design.card_relations relation JOIN new_design.books book ON book.space_id=relation.space_id AND book.id=NEW.book_id JOIN new_design.relation_types type ON type.id=relation.relation_type_id AND type.status='published' JOIN new_design.card_relation_versions version ON version.id=relation.current_version_id AND version.card_relation_id=relation.id AND version.status='active' JOIN new_design.card_versions endpoint_source ON endpoint_source.id=version.source_card_version_id AND endpoint_source.card_id=relation.source_card_id JOIN new_design.card_versions endpoint_target ON endpoint_target.id=version.target_card_version_id AND endpoint_target.card_id=relation.target_card_id WHERE relation.status='active' AND (relation.source_card_id=NEW.card_id OR relation.target_card_id=NEW.card_id);
  IF actual IS DISTINCT FROM source->'data'->'relations' OR jsonb_array_length(actual)>200 OR EXISTS(SELECT 1 FROM new_design.card_relations relation JOIN new_design.books book ON book.space_id=relation.space_id AND book.id=NEW.book_id WHERE relation.status='active' AND (relation.source_card_id=NEW.card_id OR relation.target_card_id=NEW.card_id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual) AS relation_items(relation_item) WHERE relation_items.relation_item->>'id'=relation.id::text)) THEN RAISE EXCEPTION 'character author complete current setting relations mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.input_payload->>'cutoffBodyVersionId' IS NULL THEN
   IF jsonb_array_length(source->'data'->'chapters')<>0 OR EXISTS(SELECT 1 FROM new_design.chapter_documents WHERE book_id=NEW.book_id AND status='active' AND adopted_version_id IS NOT NULL) THEN RAISE EXCEPTION 'character author must select occurred chapter range' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT document.logical_order INTO STRICT cutoff_order FROM new_design.chapter_documents document JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL WHERE document.book_id=NEW.book_id AND document.status='active' AND body.id=(NEW.input_payload->>'cutoffBodyVersionId')::uuid;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('documentId',document.id,'bodyVersionId',body.id,'title',document.title,'order',document.logical_order,'content',body.content,'contentHash',body.content_hash) ORDER BY document.logical_order,document.id),'[]'::jsonb) INTO actual FROM new_design.chapter_documents document JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL WHERE document.book_id=NEW.book_id AND document.status='active' AND document.logical_order<=cutoff_order;
   IF actual IS DISTINCT FROM source->'data'->'chapters' THEN RAISE EXCEPTION 'character author occurred body versions mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('stableId',initial.id,'versionId',version.id,'subjectKind',initial.subject_kind,'subjectId',initial.subject_id,'fieldKey',initial.state_key,'value',version.value_json,'kind','initial') ORDER BY initial.subject_kind,initial.subject_id,initial.state_key),'[]'::jsonb) INTO actual FROM (SELECT data.id,data.book_id,data.subject_kind,data.subject_id,data.state_key,data.current_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='entity_initial_state' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,subject_kind text,subject_id uuid,state_key text,current_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active') initial JOIN (SELECT data.id,data.initial_state_id,data.version,version.values->'value_json' AS value_json,data.value_hash,data.source_fact_id,data.actor,data.note,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='entity_initial_state_version' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,initial_state_id uuid,version integer,value_json jsonb,value_hash char(64),source_fact_id uuid,actor text,note text,created_at timestamptz) WHERE card.status='active') version ON version.id=initial.current_version_id AND version.initial_state_id=initial.id WHERE initial.book_id=NEW.book_id AND ((initial.subject_kind='card' AND initial.subject_id=NEW.card_id) OR (initial.subject_kind='relation' AND EXISTS(SELECT 1 FROM jsonb_array_elements(source->'data'->'relations') relation WHERE relation->>'id'=initial.subject_id::text)));
  SELECT actual||COALESCE(jsonb_agg(jsonb_build_object('stableId',change.id,'versionId',change.id,'subjectKind',change.subject_kind,'subjectId',change.subject_id,'fieldKey',change.state_key,'value',change.after_json,'chapterOrder',document.logical_order,'sequence',change.sequence::text,'kind','change') ORDER BY document.logical_order,change.sequence,change.id),'[]'::jsonb) INTO actual FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_change' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active') change JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id WHERE change.book_id=NEW.book_id AND ((change.subject_kind='card' AND change.subject_id=NEW.card_id) OR (change.subject_kind='relation' AND EXISTS(SELECT 1 FROM jsonb_array_elements(source->'data'->'relations') relation WHERE relation->>'id'=change.subject_id::text))) AND change.status='active' AND document.logical_order<=cutoff_order;
  IF actual IS DISTINCT FROM source->'data'->'states' THEN RAISE EXCEPTION 'character author complete state sources mismatch' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('versionId',change.id,'stableId',change.proposal_id,'claimId',change.claim_id,'stance',change.stance,'predicate',claim.predicate,'value',claim.value_json,'chapterOrder',document.logical_order) ORDER BY document.logical_order,change.id),'[]'::jsonb) INTO actual FROM (SELECT data.id,data.sequence,data.book_id,data.proposal_id,data.proposal_version_id,data.claim_id,data.holder_kind,data.holder_key,data.holder_card_id,data.stance,data.confidence,data.effective_story_order,data.effective_narrative_order,data.status,data.confirmed_by,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='knowledge_state_change' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,proposal_id uuid,proposal_version_id uuid,claim_id uuid,holder_kind text,holder_key text,holder_card_id uuid,stance text,confidence numeric,effective_story_order numeric,effective_narrative_order numeric,status text,confirmed_by text,created_at timestamptz) WHERE card.status='active') change JOIN (SELECT data.id,data.book_id,data.claim_id,data.holder_kind,data.holder_key,data.holder_card_id,data.current_version_id,data.source,data.status,data.confirmed_change_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='knowledge_state_proposal' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,claim_id uuid,holder_kind text,holder_key text,holder_card_id uuid,current_version_id uuid,source text,status text,confirmed_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active') proposal ON proposal.id=change.proposal_id AND proposal.book_id=change.book_id AND proposal.status='confirmed' AND proposal.confirmed_change_id=change.id JOIN (SELECT data.id,data.proposal_id,data.version,data.stance,data.confidence,data.acquisition_method,data.source_character_card_id,data.source_event_card_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.effective_story_order,data.effective_narrative_order,data.reason,data.editor,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='knowledge_state_proposal_version' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,proposal_id uuid,version integer,stance text,confidence numeric,acquisition_method text,source_character_card_id uuid,source_event_card_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,effective_story_order numeric,effective_narrative_order numeric,reason text,editor text,created_at timestamptz) WHERE card.status='active') version ON version.id=change.proposal_version_id AND version.proposal_id=proposal.id JOIN (SELECT data.id,data.book_id,data.subject_card_id,data.predicate,data.value_kind,version.values->'value_json' AS value_json,data.object_card_id,data.value_hash,data.truth_fact_id,data.created_by,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='epistemic_claim' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,subject_card_id uuid,predicate text,value_kind text,value_json jsonb,object_card_id uuid,value_hash char(64),truth_fact_id uuid,created_by text,created_at timestamptz) WHERE card.status='active') claim ON claim.id=change.claim_id AND claim.book_id=change.book_id JOIN new_design.chapter_documents document ON document.id=version.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=version.body_version_id WHERE change.book_id=NEW.book_id AND change.holder_card_id=NEW.card_id AND change.holder_kind='character' AND change.status='active' AND document.logical_order<=cutoff_order;
  IF actual IS DISTINCT FROM source->'data'->'knowledge' THEN RAISE EXCEPTION 'character author complete confirmed knowledge mismatch' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(version_id ORDER BY first_order),'[]'::jsonb) INTO versions FROM (SELECT version_id,min(ord) first_order FROM jsonb_array_elements_text(jsonb_build_array(source->'data'->'profile'->'versionId',source->'data'->'profile'->'typeVersionId')||(SELECT COALESCE(jsonb_agg(local->'versionId' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(source->'data'->'profile'->'localFields') WITH ORDINALITY AS locals(local,ord))||(SELECT COALESCE(jsonb_agg(versions.version_id ORDER BY ord,versions.local_order),'[]'::jsonb) FROM jsonb_array_elements(source->'data'->'relations') WITH ORDINALITY AS relations(relation,ord) CROSS JOIN LATERAL (VALUES (relation->'versionId',0),(relation->'sourceVersionId',1),(relation->'targetVersionId',2)) AS versions(version_id,local_order))||(SELECT COALESCE(jsonb_agg(chapter->'bodyVersionId' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(source->'data'->'chapters') WITH ORDINALITY AS chapters(chapter,ord))||(SELECT COALESCE(jsonb_agg(state->'versionId' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(source->'data'->'states') WITH ORDINALITY AS states(state,ord))||(SELECT COALESCE(jsonb_agg(knowledge->'versionId' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(source->'data'->'knowledge') WITH ORDINALITY AS knowledge_sources(knowledge,ord))) WITH ORDINALITY AS cited(version_id,ord) GROUP BY version_id) deduplicated;
  IF versions IS DISTINCT FROM source->'versionIds' THEN RAISE EXCEPTION 'character author exact citation set mismatch' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT DISTINCT expected.item FROM (SELECT jsonb_build_object('kind','card_version','sourceType','card_version','stableId',NEW.card_id,'versionId',source->'data'->'profile'->>'versionId') AS item UNION ALL SELECT jsonb_build_object('kind','card_relation','sourceType','card_relation','stableId',relation->>'id','versionId',relation->>'versionId') FROM jsonb_array_elements(source->'data'->'relations') relation UNION ALL SELECT jsonb_build_object('kind','card_version','sourceType','card_version','stableId',relation->>'sourceId','versionId',relation->>'sourceVersionId') FROM jsonb_array_elements(source->'data'->'relations') relation UNION ALL SELECT jsonb_build_object('kind','card_version','sourceType','card_version','stableId',relation->>'targetId','versionId',relation->>'targetVersionId') FROM jsonb_array_elements(source->'data'->'relations') relation UNION ALL SELECT jsonb_build_object('kind','chapter_body_version','sourceType','body_version','stableId',chapter->>'documentId','versionId',chapter->>'bodyVersionId') FROM jsonb_array_elements(source->'data'->'chapters') chapter UNION ALL SELECT jsonb_build_object('kind',CASE WHEN state->>'kind'='initial' THEN 'entity_initial_state' ELSE 'state_change' END,'sourceType',CASE WHEN state->>'kind'='initial' THEN 'entity_initial_state' ELSE 'state_change' END,'stableId',state->>'stableId','versionId',state->>'versionId') FROM jsonb_array_elements(source->'data'->'states') state UNION ALL SELECT jsonb_build_object('kind','knowledge_state_change','sourceType','knowledge_state_change','stableId',knowledge->>'stableId','versionId',knowledge->>'versionId') FROM jsonb_array_elements(source->'data'->'knowledge') knowledge) expected LOOP
   expected_count:=expected_count+1;
   IF NOT EXISTS(SELECT 1 FROM new_design.context_manifest_items entry CROSS JOIN LATERAL resolve_dependency_resource(item->>'kind',(item->>'stableId')::uuid,(item->>'versionId')::uuid) resolved WHERE entry.manifest_id=manifest.id AND entry.source_type=item->>'sourceType' AND entry.stable_object_id=(item->>'stableId')::uuid AND entry.exact_version_id=(item->>'versionId')::uuid AND entry.content_role='required' AND entry.transform_status='full' AND entry.content_hash=resolved.resolved_hash AND resolved.resolved_book_id=NEW.book_id) THEN RAISE EXCEPTION 'character author manifest exact source missing' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM new_design.context_manifest_items WHERE manifest_id=manifest.id)<>expected_count THEN RAISE EXCEPTION 'character author unexpected manifest source' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.reply IS NOT NULL AND NOT COALESCE(NEW.reply->'output'->>'bookId'=NEW.book_id::text AND NEW.reply->'output'->>'cardId'=NEW.card_id::text AND NEW.reply->'output'->>'sourceHash'=source->>'hash' AND NEW.reply->'execution'->>'routeSnapshotId'=route.id::text AND NEW.reply->'execution'->>'routeSnapshotHash'=route.snapshot_hash AND NEW.reply->'execution'->>'provider'=route.provider AND NEW.reply->'execution'->>'model'=route.model AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reply->'execution'->'attempts') trace WHERE trace->>'status'='succeeded' AND trace->>'requestSent'='true' AND trace->>'responseReceived'='true'),false) THEN RAISE EXCEPTION 'character author reply original execution mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.reply IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.reply->'output'->'sourceVersionIds') AS cited(version_id) WHERE NOT ((source->'versionIds') ? cited.version_id)) THEN RAISE EXCEPTION 'character author reply cites foreign version' USING ERRCODE='23514'; END IF;
 IF NEW.status='running' AND (NEW.output IS NOT NULL OR task.status<>'running' OR step.status<>'running' OR attempt.status<>'running') THEN RAISE EXCEPTION 'character author running ledger mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('succeeded','stale') AND (NEW.reply IS NULL OR NEW.output IS DISTINCT FROM NEW.reply->'output' OR task.status<>'succeeded' OR step.status<>'succeeded' OR attempt.status<>'succeeded') OR NEW.status='failed' AND (NEW.output IS NOT NULL OR task.status<>'failed' OR step.status<>'failed' OR attempt.status<>'failed') OR NEW.status='ended_unknown' AND (NEW.reply IS NOT NULL OR NEW.output IS NOT NULL OR task.status<>'cancelled' OR step.status<>'cancelled' OR attempt.status<>'discarded') THEN RAISE EXCEPTION 'character author terminal ledger mismatch' USING ERRCODE='23514'; END IF;
 RETURN;
END;
$$;


--
-- Name: assert_character_dialogue_round(jsonb, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_character_dialogue_round(previous jsonb, next jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE
NEW record; OLD record; TG_OP text:=CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
BEGIN
 SELECT * INTO NEW FROM jsonb_to_record(next) AS data(id uuid,session_id uuid,book_id uuid,round_number integer,request_key uuid,request_hash char(64),input_payload jsonb,input_hash char(64),frozen_plan jsonb,ai_task_id uuid,step_id uuid,attempt_id uuid,status text,model_request_state text,generated_output jsonb,generated_execution jsonb,failure jsonb,created_at timestamptz);
 SELECT * INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,session_id uuid,book_id uuid,round_number integer,request_key uuid,request_hash char(64),input_payload jsonb,input_hash char(64),frozen_plan jsonb,ai_task_id uuid,step_id uuid,attempt_id uuid,status text,model_request_state text,generated_output jsonb,generated_execution jsonb,failure jsonb,created_at timestamptz);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dialogue original reply cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(OLD)-ARRAY['status','model_request_state','generated_output','generated_execution','failure']::text[]) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','model_request_state','generated_output','generated_execution','failure']::text[]) THEN RAISE EXCEPTION 'dialogue original freeze immutable' USING ERRCODE='23514'; END IF;
  IF OLD.generated_output IS NOT NULL AND (OLD.generated_output,OLD.generated_execution) IS DISTINCT FROM(NEW.generated_output,NEW.generated_execution) THEN RAISE EXCEPTION 'dialogue original saved reply immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'running' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'dialogue terminal round immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM new_design.ai_tasks task JOIN new_design.ai_task_steps step ON step.task_id=task.id JOIN new_design.ai_task_attempts attempt ON attempt.task_id=task.id AND attempt.step_id=step.id JOIN new_design.task_contract_versions contract ON contract.id=attempt.task_contract_version_id JOIN (SELECT data.id,data.book_id,data.request_key,data.request_hash,version.values->'input_payload' AS input_payload,version.values->'frozen_sources' AS frozen_sources,data.revision,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character_dialogue_session' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,frozen_sources jsonb,revision integer,created_at timestamptz) WHERE card.status='active') session ON session.id=NEW.session_id AND session.book_id=NEW.book_id WHERE task.id=NEW.ai_task_id AND task.book_id=NEW.book_id AND task.source_kind='character_dialogue' AND task.source_id=NEW.id AND step.id=NEW.step_id AND step.max_attempts=1 AND step.current_attempt_id=attempt.id AND attempt.id=NEW.attempt_id AND attempt.attempt_number=1 AND attempt.input_hash=NEW.input_hash AND attempt.output_schema_version=contract.output_schema_version AND NEW.frozen_plan->>'sourceHash'=session.frozen_sources->>'hash' AND NEW.input_payload->>'requestKey'=NEW.request_key::text AND NEW.input_payload->>'sourceHash'=session.frozen_sources->>'hash' AND NEW.frozen_plan->'input'->'actor'->>'cardId'=NEW.input_payload->>'actorCardId' AND NEW.frozen_plan->'input'->>'sessionId'=session.id::text AND NEW.frozen_plan->'input'->>'roundId'=NEW.id::text) THEN RAISE EXCEPTION 'dialogue true original attempt and source mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.generated_output IS NOT NULL AND (NEW.generated_execution IS NULL OR jsonb_typeof(NEW.generated_output)<>'object' OR jsonb_typeof(NEW.generated_execution)<>'object' OR NEW.model_request_state<>'completed' OR NEW.generated_execution->>'routeSnapshotId' IS DISTINCT FROM NEW.frozen_plan->>'snapshotId' OR NEW.generated_execution->>'routeSnapshotHash' IS DISTINCT FROM NEW.frozen_plan->>'snapshotHash' OR NEW.generated_execution->>'provider' IS DISTINCT FROM NEW.frozen_plan->'route'->'primary'->>'provider' OR NEW.generated_execution->>'model' IS DISTINCT FROM NEW.frozen_plan->'route'->'primary'->>'model' OR NEW.generated_output->>'actorCardId' IS DISTINCT FROM NEW.input_payload->>'actorCardId' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.generated_execution->'attempts','[]'::jsonb)) execution WHERE execution->>'status'='succeeded' AND execution->>'requestSent'='true' AND execution->>'responseReceived'='true')) THEN RAISE EXCEPTION 'dialogue saved reply requires true received execution' USING ERRCODE='23514'; END IF;
 IF NEW.status='succeeded' AND (NEW.generated_output IS NULL OR NOT EXISTS(SELECT 1 FROM new_design.ai_task_attempts WHERE id=NEW.attempt_id AND status='succeeded')) THEN RAISE EXCEPTION 'dialogue success requires original saved reply and completed attempt' USING ERRCODE='23514'; END IF;
 IF NEW.status='ended_unknown' AND NEW.generated_output IS NOT NULL THEN RAISE EXCEPTION 'saved dialogue reply cannot be unknown' USING ERRCODE='23514'; END IF;RETURN;
END;
$$;


--
-- Name: assert_character_dialogue_selection(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_character_dialogue_selection(next jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE original_round record; original_version record; saved_version record; appended jsonb; selected_count integer; NEW record; OLD record; TG_OP text:='INSERT';
BEGIN
 SELECT * INTO NEW FROM jsonb_to_record(next) AS data(id uuid,session_id uuid,book_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,round_id uuid,planning_object_id uuid,planning_version_id uuid,created_at timestamptz);

 IF NEW.input_payload->>'requestKey' IS DISTINCT FROM NEW.request_key::text OR NEW.input_payload->>'planningObjectId' IS DISTINCT FROM NEW.planning_object_id::text OR jsonb_typeof(NEW.input_payload->'actionKeys') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'dialogue original action input required' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.session_id,data.book_id,data.round_number,data.request_key,data.request_hash,version.values->'input_payload' AS input_payload,data.input_hash,version.values->'frozen_plan' AS frozen_plan,data.ai_task_id,data.step_id,data.attempt_id,data.status,data.model_request_state,data.generated_output,data.generated_execution,data.failure,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character_dialogue_round' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,session_id uuid,book_id uuid,round_number integer,request_key uuid,request_hash char(64),input_payload jsonb,input_hash char(64),frozen_plan jsonb,ai_task_id uuid,step_id uuid,attempt_id uuid,status text,model_request_state text,generated_output jsonb,generated_execution jsonb,failure jsonb,created_at timestamptz) WHERE card.status='active') round JOIN (SELECT data.id,data.book_id,data.request_key,data.request_hash,version.values->'input_payload' AS input_payload,version.values->'frozen_sources' AS frozen_sources,data.revision,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character_dialogue_session' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,frozen_sources jsonb,revision integer,created_at timestamptz) WHERE card.status='active') session ON session.id=round.session_id AND session.book_id=round.book_id JOIN (SELECT data.id,data.object_id,data.book_id,data.version,data.base_version_id,data.based_on_parent_version_id,data.source,data.status,version.values->'content' AS content,data.content_hash,data.source_body_version_id,data.created_by,data.stale_at,data.stale_reason,data.created_at,data.execution_mode FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_version' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE card.status='active') version ON version.id=NEW.planning_version_id AND version.object_id=NEW.planning_object_id AND version.book_id=NEW.book_id JOIN (SELECT data.id,data.book_id,data.object_id,data.version_id,data.action,data.expected_revision,data.result_revision,data.request_hash,data.idempotency_key,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_operation_event' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,object_id uuid,version_id uuid,action text,expected_revision integer,result_revision integer,request_hash char(64),idempotency_key text,actor text,created_at timestamptz) WHERE card.status='active') event ON event.version_id=version.id AND event.object_id=version.object_id AND event.book_id=version.book_id WHERE round.id=NEW.round_id AND round.session_id=NEW.session_id AND round.book_id=NEW.book_id AND round.status='succeeded' AND round.generated_output IS NOT NULL AND version.source='user' AND version.status IN('draft','proposed') AND event.action='revise' AND event.idempotency_key=NEW.request_key::text AND event.expected_revision::text=NEW.input_payload->>'expectedPlanningRevision' AND NEW.input_payload->>'roundId'=round.id::text AND NEW.input_payload->>'sourceHash'=session.frozen_sources->>'hash') THEN RAISE EXCEPTION 'dialogue selected actions require original successful round and real planning candidate' USING ERRCODE='23514'; END IF;
 SELECT * INTO original_round FROM (SELECT data.id,data.session_id,data.book_id,data.round_number,data.request_key,data.request_hash,version.values->'input_payload' AS input_payload,data.input_hash,version.values->'frozen_plan' AS frozen_plan,data.ai_task_id,data.step_id,data.attempt_id,data.status,data.model_request_state,data.generated_output,data.generated_execution,data.failure,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character_dialogue_round' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,session_id uuid,book_id uuid,round_number integer,request_key uuid,request_hash char(64),input_payload jsonb,input_hash char(64),frozen_plan jsonb,ai_task_id uuid,step_id uuid,attempt_id uuid,status text,model_request_state text,generated_output jsonb,generated_execution jsonb,failure jsonb,created_at timestamptz) WHERE card.status='active') AS character_dialogue_rounds WHERE id=NEW.round_id;
 SELECT * INTO saved_version FROM (SELECT data.id,data.object_id,data.book_id,data.version,data.base_version_id,data.based_on_parent_version_id,data.source,data.status,version.values->'content' AS content,data.content_hash,data.source_body_version_id,data.created_by,data.stale_at,data.stale_reason,data.created_at,data.execution_mode FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_version' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE card.status='active') AS planning_versions WHERE id=NEW.planning_version_id;
 SELECT * INTO original_version FROM (SELECT data.id,data.object_id,data.book_id,data.version,data.base_version_id,data.based_on_parent_version_id,data.source,data.status,version.values->'content' AS content,data.content_hash,data.source_body_version_id,data.created_by,data.stale_at,data.stale_reason,data.created_at,data.execution_mode FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_version' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE card.status='active') AS planning_versions WHERE id=saved_version.base_version_id AND id::text=NEW.input_payload->>'planningVersionId' AND object_id=NEW.planning_object_id AND book_id=NEW.book_id;
 selected_count:=jsonb_array_length(NEW.input_payload->'actionKeys');
 IF original_version.id IS NULL OR selected_count NOT BETWEEN 1 AND 20 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(NEW.input_payload->'actionKeys'))<>selected_count THEN RAISE EXCEPTION 'dialogue original planning basis or selected keys invalid' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(action->'constraint' ORDER BY selected.ordinality) INTO appended FROM jsonb_array_elements_text(NEW.input_payload->'actionKeys') WITH ORDINALITY selected(key,ordinality) JOIN LATERAL jsonb_array_elements(original_round.generated_output->'actions') action ON action->>'key'=selected.key;
 IF appended IS NULL OR jsonb_array_length(appended)<>selected_count OR jsonb_typeof(original_version.content->'constraints') IS DISTINCT FROM 'array' OR (saved_version.content-'constraints') IS DISTINCT FROM (original_version.content-'constraints') OR saved_version.content->'constraints' IS DISTINCT FROM ((original_version.content->'constraints')||appended) OR saved_version.execution_mode IS DISTINCT FROM original_version.execution_mode OR saved_version.based_on_parent_version_id IS DISTINCT FROM original_version.based_on_parent_version_id OR saved_version.source_body_version_id IS NOT NULL THEN RAISE EXCEPTION 'dialogue may only append exact selected constraints to original planning draft' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(saved_version.content->'constraints')>100 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(appended))<>selected_count OR EXISTS(SELECT 1 FROM jsonb_array_elements(appended) chosen JOIN jsonb_array_elements(original_version.content->'constraints') prior ON chosen.value=prior.value) THEN RAISE EXCEPTION 'dialogue duplicate or excessive new constraints prohibited' USING ERRCODE='23514'; END IF;
 IF (SELECT COALESCE(jsonb_agg(jsonb_build_array(reference_role,card_id,card_version_id,action_key,note,sort_order) ORDER BY reference_role,card_id,action_key),'[]'::jsonb) FROM (SELECT data.id,data.planning_version_id,data.planning_object_id,data.book_id,data.reference_role,data.card_id,data.card_version_id,data.action_key,data.note,data.sort_order,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_version_reference' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,planning_version_id uuid,planning_object_id uuid,book_id uuid,reference_role text,card_id uuid,card_version_id uuid,action_key text,note text,sort_order integer,created_at timestamptz) WHERE card.status='active') AS planning_version_references WHERE planning_version_id=saved_version.id) IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(jsonb_build_array(reference_role,card_id,card_version_id,action_key,note,sort_order) ORDER BY reference_role,card_id,action_key),'[]'::jsonb) FROM (SELECT data.id,data.planning_version_id,data.planning_object_id,data.book_id,data.reference_role,data.card_id,data.card_version_id,data.action_key,data.note,data.sort_order,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='planning_version_reference' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,planning_version_id uuid,planning_object_id uuid,book_id uuid,reference_role text,card_id uuid,card_version_id uuid,action_key text,note text,sort_order integer,created_at timestamptz) WHERE card.status='active') AS planning_version_references WHERE planning_version_id=original_version.id) THEN RAISE EXCEPTION 'dialogue selected constraints cannot replace original planning references' USING ERRCODE='23514'; END IF;RETURN;
END;
$$;


--
-- Name: assert_character_dialogue_session(jsonb, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_character_dialogue_session(previous jsonb, next jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE
NEW record; OLD record; TG_OP text:=CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
BEGIN
 SELECT * INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,frozen_sources jsonb,revision integer,created_at timestamptz);
 SELECT * INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,request_key uuid,request_hash char(64),input_payload jsonb,frozen_sources jsonb,revision integer,created_at timestamptz);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dialogue sandbox history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(OLD)-'revision') IS DISTINCT FROM (to_jsonb(NEW)-'revision') OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'dialogue sources and original input immutable' USING ERRCODE='23514'; END IF;
 IF NEW.frozen_sources->>'bookId' IS DISTINCT FROM NEW.book_id::text OR NEW.input_payload->>'requestKey' IS DISTINCT FROM NEW.request_key::text OR NEW.frozen_sources->>'hash' IS DISTINCT FROM NEW.input_payload->>'sourceHash' OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active') checkpoint JOIN new_design.chapter_documents document ON document.id=checkpoint.chapter_document_id AND document.book_id=checkpoint.book_id WHERE checkpoint.id::text=NEW.input_payload->>'checkpointId' AND checkpoint.book_id=NEW.book_id AND checkpoint.body_version_id::text=NEW.frozen_sources->'checkpoint'->>'bodyVersionId') THEN RAISE EXCEPTION 'dialogue cutoff source identity mismatch' USING ERRCODE='23514'; END IF;RETURN;
END;
$$;


--
-- Name: assert_resource_correction_candidate_source(uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_resource_correction_candidate_source(source_session_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE saved record; origin record; child record;
  issue record; base record;
  source jsonb; correction jsonb; actual_prefix jsonb; related jsonb; field jsonb; prefix_order integer;
BEGIN
 SELECT * INTO STRICT saved FROM (SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='resource_supplement_correction_origin' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz) WHERE card.status='active') AS resource_supplement_correction_origins WHERE session_id=source_session_id;
  -- stable_resource_correction_start_v1: creation only; no candidate or resolution permission.
  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_resource_supplement' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active') AS chapter_resource_supplements WHERE session_id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO child FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_adoption_session' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active') AS chapter_adoption_sessions WHERE id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO issue FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active') AS resource_supplement_integrity_issues WHERE issue_id=saved.issue_id AND book_id=saved.book_id;
  SELECT * INTO base FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active') AS chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=saved.book_id AND status='stable';
  source:=origin.source_snapshot; correction:=source->'correction';
  IF origin.session_id IS NULL OR child.id IS NULL OR issue.issue_id IS NULL OR base.id IS NULL
    OR child.status NOT IN ('adopted_pending_proposals','pending_review','partially_confirmed','failed') OR child.adoption_kind IS DISTINCT FROM 'resource_supplement'
    OR base.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR base.body_version_id IS DISTINCT FROM issue.body_version_id
    OR child.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR child.body_version_id IS DISTINCT FROM issue.body_version_id
    OR NOT EXISTS(SELECT 1 FROM new_design.books WHERE id=saved.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM new_design.chapter_documents WHERE id=issue.chapter_document_id AND book_id=saved.book_id AND status='active' AND adopted_version_id=issue.body_version_id)
    OR EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz) WHERE card.status='active') AS resource_supplement_integrity_resolutions WHERE issue_id=saved.issue_id)
    OR EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_adoption_session' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active') AS chapter_adoption_sessions WHERE chapter_document_id=issue.chapter_document_id AND id<>child.id
      AND status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed'))
    OR source->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1'
    OR origin.original_receipt->>'contract' IS DISTINCT FROM 'stable_resource_correction_start_v1'
    OR origin.full_input->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR origin.original_receipt->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR source->'input' IS DISTINCT FROM jsonb_build_object('issueId',saved.issue_id,'resourceScope',origin.full_input->'resourceScope')
    OR saved.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract','stable_resource_correction_start_v1','bookId',saved.book_id,'input',origin.full_input)
    OR encode(sha256(convert_to(saved.canonical_input,'UTF8')),'hex') IS DISTINCT FROM origin.input_hash::text
    OR saved.canonical_source::jsonb IS DISTINCT FROM source-'sourceHash'
    OR encode(sha256(convert_to(saved.canonical_source,'UTF8')),'hex') IS DISTINCT FROM origin.source_hash::text
    OR correction->>'contract' IS DISTINCT FROM 'resource_supplement_correction_basis_v1'
    OR correction->>'bookId' IS DISTINCT FROM saved.book_id::text OR correction->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR correction->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR correction->>'chapterDocumentId' IS DISTINCT FROM issue.chapter_document_id::text
    OR correction->>'bodyVersionId' IS DISTINCT FROM issue.body_version_id::text
    OR correction->>'subjectKind' IS DISTINCT FROM issue.subject_kind OR correction->>'subjectId' IS DISTINCT FROM issue.subject_id::text
    OR correction->>'stateKey' IS DISTINCT FROM issue.state_key
    OR correction->'issue' IS DISTINCT FROM to_jsonb(issue)||jsonb_build_object('current_checkpoint',to_jsonb(base))
    OR correction->'chapterEndBasis' IS DISTINCT FROM source->'basis'
    OR correction->'originalRecordedBefore' IS DISTINCT FROM issue.impact->'recordedBefore'
    OR correction->'originalRecordedAfter' IS DISTINCT FROM issue.impact->'recordedAfter'
    OR origin.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||saved.book_id||'/writing?chapterDocument='||issue.chapter_document_id||'&session='||saved.session_id||'&resourceIssue='||saved.issue_id
    THEN RAISE EXCEPTION 'correction original input, issue or current body mismatch' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('change',to_jsonb(change),'proposal',to_jsonb(proposal),'settlement',to_jsonb(settlement),
    'anchor',to_jsonb(anchor),'document',to_jsonb(document),'body',to_jsonb(body),'checkpoint',to_jsonb(checkpoint),
    'checkpoint_commit',to_jsonb(checkpoint_commit),'checkpoint_session',to_jsonb(checkpoint_session)),document.logical_order
    INTO actual_prefix,prefix_order FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_change' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active') change
    JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='state_change_proposal' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active') proposal ON proposal.id=change.proposal_id
    LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
    LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
    LEFT JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active') checkpoint ON checkpoint.book_id=change.book_id AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
    LEFT JOIN new_design.chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_adoption_session' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active') checkpoint_session ON checkpoint_session.id=checkpoint.session_id
    WHERE change.book_id=saved.book_id AND change.subject_kind=issue.subject_kind AND change.subject_id=issue.subject_id AND change.state_key=issue.state_key AND change.status='active'
      AND document.logical_order<base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<base.chapter_order
    ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
  IF actual_prefix IS NULL OR correction->'prefixSource' IS DISTINCT FROM actual_prefix
    OR correction->'beforeValue' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'proposal'->>'status' IS DISTINCT FROM 'confirmed'
    OR actual_prefix->'proposal'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'proposal'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'proposal'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'proposal'->>'subject_kind' IS DISTINCT FROM issue.subject_kind
    OR actual_prefix->'proposal'->>'subject_id' IS DISTINCT FROM issue.subject_id::text
    OR actual_prefix->'proposal'->>'state_key' IS DISTINCT FROM issue.state_key
    OR actual_prefix->'proposal'->>'confirmed_state_change_id' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR actual_prefix->'proposal'->'before_json' IS DISTINCT FROM actual_prefix->'change'->'before_json'
    OR actual_prefix->'proposal'->'after_json' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'settlement'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'settlement'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'settlement'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'settlement'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'body'->'archived_at' IS DISTINCT FROM 'null'::jsonb
    OR encode(sha256(convert_to(actual_prefix->'body'->>'content','UTF8')),'hex') IS DISTINCT FROM actual_prefix->'body'->>'content_hash'
    OR actual_prefix->'checkpoint_commit'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'checkpoint_commit'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'checkpoint_commit'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_commit'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'status' IS DISTINCT FROM 'stable'
    OR actual_prefix->'checkpoint_session'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'checkpoint_session'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_session'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'settlement_id' IS DISTINCT FROM actual_prefix->'checkpoint_commit'->>'id'
    OR NOT coalesce((actual_prefix->'checkpoint'->'summary'->'confirmed'->'states') ? (actual_prefix->'change'->>'id'),false)
    OR (SELECT count(*) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
      IS DISTINCT FROM (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
    OR actual_prefix->'change'->'text_anchor_id'<>'null'::jsonb AND (actual_prefix->'anchor'->>'status' IS DISTINCT FROM 'active'
      OR actual_prefix->'anchor'->>'book_id' IS DISTINCT FROM saved.book_id::text
      OR actual_prefix->'anchor'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
      OR actual_prefix->'anchor'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id')
    OR EXISTS(SELECT 1 FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active') earlier JOIN new_design.chapter_documents document ON document.id=earlier.chapter_document_id
      WHERE earlier.book_id=saved.book_id AND earlier.subject_kind=issue.subject_kind AND earlier.subject_id=issue.subject_id AND document.logical_order<=prefix_order
        AND NOT EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz) WHERE card.status='active') AS resource_supplement_integrity_resolutions WHERE issue_id=earlier.issue_id))
    THEN RAISE EXCEPTION 'correction must retain the actual valid latest chapter-before proof' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(actual) ORDER BY document.logical_order,actual.issue_id),'[]'::jsonb) INTO related
    FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active') actual JOIN new_design.chapter_documents document ON document.id=actual.chapter_document_id AND document.book_id=actual.book_id
    WHERE actual.book_id=saved.book_id AND document.logical_order<=base.chapter_order AND NOT EXISTS(
      SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz) WHERE card.status='active') AS resource_supplement_integrity_resolutions WHERE issue_id=actual.issue_id)
    AND ((actual.subject_kind='card' AND (origin.full_input->'resourceScope'->'resourceIds') ? actual.subject_id::text)
      OR (actual.subject_kind='relation' AND (origin.full_input->'resourceScope'->'relationIds') ? actual.subject_id::text));
  IF related IS DISTINCT FROM source->'relatedIssues' OR NOT related @> jsonb_build_array(to_jsonb(issue))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(related) item WHERE item->>'chapter_document_id' IS DISTINCT FROM issue.chapter_document_id::text
      OR item->>'body_version_id' IS DISTINCT FROM issue.body_version_id::text OR item->>'subject_kind' IS DISTINCT FROM issue.subject_kind
      OR item->>'subject_id' IS DISTINCT FROM issue.subject_id::text OR item->>'state_key' IS DISTINCT FROM issue.state_key)
    OR origin.original_receipt->'relatedIssueIds' IS DISTINCT FROM (SELECT jsonb_agg(item->'issue_id') FROM jsonb_array_elements(related) item)
    THEN RAISE EXCEPTION 'correction must retain every selected actual related issue' USING ERRCODE='23514'; END IF;
  SELECT item INTO field FROM jsonb_array_elements(source->'catalog'->'subjects') subject,
    jsonb_array_elements(subject->'fields') item WHERE subject->>'subjectKind'=issue.subject_kind AND subject->>'id'=issue.subject_id::text AND item->>'key'=issue.state_key;
  IF field IS NULL OR field->'baseline'->'known' IS DISTINCT FROM 'true'::jsonb OR field->'baseline'->'stale' IS DISTINCT FROM 'false'::jsonb
    OR field->'baseline'->'value' IS DISTINCT FROM correction->'beforeValue'
    OR field->'baseline'->>'sourceKind' IS DISTINCT FROM 'state_change'
    OR field->'baseline'->>'sourceId' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.expected_document_revision,data.planning_object_id,data.planning_version_id,data.planning_content_hash,data.context_manifest_id,version.values->'dependency_snapshot' AS dependency_snapshot,data.dependency_hash,data.status,data.idempotency_key,data.created_by,data.created_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_adoption_preparation' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,expected_document_revision integer,planning_object_id uuid,planning_version_id uuid,planning_content_hash char(64),context_manifest_id uuid,dependency_snapshot jsonb,dependency_hash char(64),status text,idempotency_key text,created_by text,created_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active') AS chapter_adoption_preparations WHERE id=child.preparation_id AND dependency_snapshot->>'correctionIssueId'=issue.issue_id::text
      AND dependency_snapshot->'correctionIssueIds'=origin.original_receipt->'relatedIssueIds' AND dependency_snapshot->>'correctionSourceHash'=correction->>'sourceHash')
    THEN RAISE EXCEPTION 'correction editor baseline must remain bound to actual chapter-before evidence' USING ERRCODE='23514'; END IF;
  RETURN;
END;
$$;


--
-- Name: assert_resource_correction_claim(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_resource_correction_claim(claim_input jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE claim record; origin record; saved record; expected_catalog jsonb; subjects jsonb;
BEGIN
 SELECT data.id,data.session_id,data.book_id,data.body_version_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.ai_task_id,data.status,data.request_hash,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.frozen_plan,data.frozen_input_hash,data.expected_session_revision,data.generated_output,data.generated_execution,data.failure INTO claim FROM jsonb_to_record(claim_input) AS data(id uuid,session_id uuid,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);

  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=claim.session_id AND book_id=claim.book_id;
  SELECT * INTO saved FROM (SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_correction_origin')) resource_supplement_correction_origins WHERE session_id=claim.session_id AND book_id=claim.book_id;
  IF saved.session_id IS NULL THEN RAISE EXCEPTION 'corrective claim original proof missing' USING ERRCODE='23514'; END IF;
  PERFORM assert_resource_correction_candidate_source(saved.session_id);
  SELECT jsonb_agg(jsonb_set(subject,'{fields}',(SELECT jsonb_agg(field) FROM jsonb_array_elements(subject->'fields') field
    WHERE field->>'key'=origin.source_snapshot#>>'{correction,stateKey}'))) INTO subjects
    FROM jsonb_array_elements(origin.source_snapshot#>'{catalog,subjects}') subject
    WHERE subject->>'subjectKind'=origin.source_snapshot#>>'{correction,subjectKind}' AND subject->>'id'=origin.source_snapshot#>>'{correction,subjectId}';
  expected_catalog:=jsonb_set(jsonb_set(jsonb_set(origin.source_snapshot->'catalog','{subjects}',subjects),'{sessionId}',to_jsonb(claim.session_id::text)),
    '{sessionRevision}',to_jsonb(claim.expected_session_revision));
  IF claim.frozen_plan->>'assetId' IS DISTINCT FROM 'new_design.character.stable_resource_correction' OR claim.frozen_plan->>'assetVersion' IS DISTINCT FROM 'v1'
    OR claim.frozen_plan#>'{input,stableCorrection,source}' IS DISTINCT FROM origin.source_snapshot
    OR claim.frozen_plan#>'{input,stableCorrection,sessionRevision}' IS DISTINCT FROM to_jsonb(claim.expected_session_revision)
    OR claim.frozen_plan#>'{input,stableSupplement}' IS NOT NULL
    OR claim.frozen_plan#>'{input,catalog}' IS DISTINCT FROM expected_catalog
    OR claim.frozen_plan#>'{input,resourceScope}' IS DISTINCT FROM origin.source_snapshot->'resourceScope'
    OR claim.frozen_plan#>'{input,bodyContent}' IS DISTINCT FROM origin.source_snapshot#>'{basis,bodyContent}'
    OR claim.frozen_plan#>'{input,expectedChanges}' IS DISTINCT FROM '[]'::jsonb
    OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=claim.session_id AND book_id=claim.book_id AND revision=claim.expected_session_revision AND body_version_id=claim.body_version_id)
    THEN RAISE EXCEPTION 'corrective claim must freeze its exact full source and sole issue field' USING ERRCODE='23514'; END IF;
END
$$;


--
-- Name: assert_resource_correction_formal_source(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_resource_correction_formal_source(saved_input jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE saved record; origin record; child record;
  issue record; base record;
  source jsonb; correction jsonb; actual_prefix jsonb; related jsonb; field jsonb; prefix_order integer;
BEGIN
 SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at INTO saved FROM jsonb_to_record(saved_input) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz);

  -- stable_resource_correction_start_v1: creation only; no candidate or resolution permission.
  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO child FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO issue FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) resource_supplement_integrity_issues WHERE issue_id=saved.issue_id AND book_id=saved.book_id;
  SELECT * INTO base FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=saved.book_id AND status='superseded';
  source:=origin.source_snapshot; correction:=source->'correction';
  IF origin.session_id IS NULL OR child.id IS NULL OR issue.issue_id IS NULL OR base.id IS NULL
    OR child.status IS DISTINCT FROM 'stable' OR child.adoption_kind IS DISTINCT FROM 'resource_supplement'
    OR base.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR base.body_version_id IS DISTINCT FROM issue.body_version_id
    OR child.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR child.body_version_id IS DISTINCT FROM issue.body_version_id
    OR NOT EXISTS(SELECT 1 FROM new_design.books WHERE id=saved.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM new_design.chapter_documents WHERE id=issue.chapter_document_id AND book_id=saved.book_id AND status='active' AND adopted_version_id=issue.body_version_id)
    OR EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE issue_id=saved.issue_id AND correction_checkpoint_id NOT IN (SELECT id FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE session_id=child.id AND settlement_id=child.settlement_id AND status='stable'))
    OR EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE chapter_document_id=issue.chapter_document_id AND id<>child.id
      AND status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed'))
    OR source->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1'
    OR origin.original_receipt->>'contract' IS DISTINCT FROM 'stable_resource_correction_start_v1'
    OR origin.full_input->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR origin.original_receipt->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR source->'input' IS DISTINCT FROM jsonb_build_object('issueId',saved.issue_id,'resourceScope',origin.full_input->'resourceScope')
    OR saved.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract','stable_resource_correction_start_v1','bookId',saved.book_id,'input',origin.full_input)
    OR encode(sha256(convert_to(saved.canonical_input,'UTF8')),'hex') IS DISTINCT FROM origin.input_hash::text
    OR saved.canonical_source::jsonb IS DISTINCT FROM source-'sourceHash'
    OR encode(sha256(convert_to(saved.canonical_source,'UTF8')),'hex') IS DISTINCT FROM origin.source_hash::text
    OR correction->>'contract' IS DISTINCT FROM 'resource_supplement_correction_basis_v1'
    OR correction->>'bookId' IS DISTINCT FROM saved.book_id::text OR correction->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR correction->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR correction->>'chapterDocumentId' IS DISTINCT FROM issue.chapter_document_id::text
    OR correction->>'bodyVersionId' IS DISTINCT FROM issue.body_version_id::text
    OR correction->>'subjectKind' IS DISTINCT FROM issue.subject_kind OR correction->>'subjectId' IS DISTINCT FROM issue.subject_id::text
    OR correction->>'stateKey' IS DISTINCT FROM issue.state_key
    OR correction->'issue' IS DISTINCT FROM to_jsonb(issue)||jsonb_build_object('current_checkpoint',to_jsonb(base)||jsonb_build_object('status','stable'))
    OR correction->'chapterEndBasis' IS DISTINCT FROM source->'basis'
    OR correction->'originalRecordedBefore' IS DISTINCT FROM issue.impact->'recordedBefore'
    OR correction->'originalRecordedAfter' IS DISTINCT FROM issue.impact->'recordedAfter'
    OR origin.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||saved.book_id||'/writing?chapterDocument='||issue.chapter_document_id||'&session='||saved.session_id||'&resourceIssue='||saved.issue_id
    THEN RAISE EXCEPTION 'correction original input, issue or current body mismatch' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('change',to_jsonb(change),'proposal',to_jsonb(proposal),'settlement',to_jsonb(settlement),
    'anchor',to_jsonb(anchor),'document',to_jsonb(document),'body',to_jsonb(body),'checkpoint',to_jsonb(checkpoint),
    'checkpoint_commit',to_jsonb(checkpoint_commit),'checkpoint_session',to_jsonb(checkpoint_session)),document.logical_order
    INTO actual_prefix,prefix_order FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change
    JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) proposal ON proposal.id=change.proposal_id
    LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
    LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
    LEFT JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) checkpoint ON checkpoint.book_id=change.book_id AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
    LEFT JOIN new_design.chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) checkpoint_session ON checkpoint_session.id=checkpoint.session_id
    WHERE change.book_id=saved.book_id AND change.subject_kind=issue.subject_kind AND change.subject_id=issue.subject_id AND change.state_key=issue.state_key AND change.status='active'
      AND document.logical_order<base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<base.chapter_order
    ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
  IF actual_prefix IS NULL OR correction->'prefixSource' IS DISTINCT FROM actual_prefix
    OR correction->'beforeValue' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'proposal'->>'status' IS DISTINCT FROM 'confirmed'
    OR actual_prefix->'proposal'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'proposal'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'proposal'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'proposal'->>'subject_kind' IS DISTINCT FROM issue.subject_kind
    OR actual_prefix->'proposal'->>'subject_id' IS DISTINCT FROM issue.subject_id::text
    OR actual_prefix->'proposal'->>'state_key' IS DISTINCT FROM issue.state_key
    OR actual_prefix->'proposal'->>'confirmed_state_change_id' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR actual_prefix->'proposal'->'before_json' IS DISTINCT FROM actual_prefix->'change'->'before_json'
    OR actual_prefix->'proposal'->'after_json' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'settlement'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'settlement'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'settlement'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'settlement'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'body'->'archived_at' IS DISTINCT FROM 'null'::jsonb
    OR encode(sha256(convert_to(actual_prefix->'body'->>'content','UTF8')),'hex') IS DISTINCT FROM actual_prefix->'body'->>'content_hash'
    OR actual_prefix->'checkpoint_commit'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'checkpoint_commit'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'checkpoint_commit'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_commit'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'status' IS DISTINCT FROM 'stable'
    OR actual_prefix->'checkpoint_session'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'checkpoint_session'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_session'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'settlement_id' IS DISTINCT FROM actual_prefix->'checkpoint_commit'->>'id'
    OR NOT coalesce((actual_prefix->'checkpoint'->'summary'->'confirmed'->'states') ? (actual_prefix->'change'->>'id'),false)
    OR (SELECT count(*) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
      IS DISTINCT FROM (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
    OR actual_prefix->'change'->'text_anchor_id'<>'null'::jsonb AND (actual_prefix->'anchor'->>'status' IS DISTINCT FROM 'active'
      OR actual_prefix->'anchor'->>'book_id' IS DISTINCT FROM saved.book_id::text
      OR actual_prefix->'anchor'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
      OR actual_prefix->'anchor'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id')
    OR EXISTS(SELECT 1 FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) earlier JOIN new_design.chapter_documents document ON document.id=earlier.chapter_document_id
      WHERE earlier.book_id=saved.book_id AND earlier.subject_kind=issue.subject_kind AND earlier.subject_id=issue.subject_id AND document.logical_order<=prefix_order
        AND NOT EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE issue_id=earlier.issue_id))
    THEN RAISE EXCEPTION 'correction must retain the actual valid latest chapter-before proof' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(actual) ORDER BY document.logical_order,actual.issue_id),'[]'::jsonb) INTO related
    FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) actual JOIN new_design.chapter_documents document ON document.id=actual.chapter_document_id AND document.book_id=actual.book_id
    WHERE actual.book_id=saved.book_id AND document.logical_order<=base.chapter_order AND NOT EXISTS(
      SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE issue_id=actual.issue_id AND correction_checkpoint_id NOT IN (SELECT id FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE session_id=child.id AND settlement_id=child.settlement_id AND status='stable'))
    AND ((actual.subject_kind='card' AND (origin.full_input->'resourceScope'->'resourceIds') ? actual.subject_id::text)
      OR (actual.subject_kind='relation' AND (origin.full_input->'resourceScope'->'relationIds') ? actual.subject_id::text));
  IF related IS DISTINCT FROM source->'relatedIssues' OR NOT related @> jsonb_build_array(to_jsonb(issue))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(related) item WHERE item->>'chapter_document_id' IS DISTINCT FROM issue.chapter_document_id::text
      OR item->>'body_version_id' IS DISTINCT FROM issue.body_version_id::text OR item->>'subject_kind' IS DISTINCT FROM issue.subject_kind
      OR item->>'subject_id' IS DISTINCT FROM issue.subject_id::text OR item->>'state_key' IS DISTINCT FROM issue.state_key)
    OR origin.original_receipt->'relatedIssueIds' IS DISTINCT FROM (SELECT jsonb_agg(item->'issue_id') FROM jsonb_array_elements(related) item)
    THEN RAISE EXCEPTION 'correction must retain every selected actual related issue' USING ERRCODE='23514'; END IF;
  SELECT item INTO field FROM jsonb_array_elements(source->'catalog'->'subjects') subject,
    jsonb_array_elements(subject->'fields') item WHERE subject->>'subjectKind'=issue.subject_kind AND subject->>'id'=issue.subject_id::text AND item->>'key'=issue.state_key;
  IF field IS NULL OR field->'baseline'->'known' IS DISTINCT FROM 'true'::jsonb OR field->'baseline'->'stale' IS DISTINCT FROM 'false'::jsonb
    OR field->'baseline'->'value' IS DISTINCT FROM correction->'beforeValue'
    OR field->'baseline'->>'sourceKind' IS DISTINCT FROM 'state_change'
    OR field->'baseline'->>'sourceId' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.expected_document_revision,data.planning_object_id,data.planning_version_id,data.planning_content_hash,data.context_manifest_id,version.values->'dependency_snapshot' AS dependency_snapshot,data.dependency_hash,data.status,data.idempotency_key,data.created_by,data.created_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,expected_document_revision integer,planning_object_id uuid,planning_version_id uuid,planning_content_hash char(64),context_manifest_id uuid,dependency_snapshot jsonb,dependency_hash char(64),status text,idempotency_key text,created_by text,created_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_preparation')) chapter_adoption_preparations WHERE id=child.preparation_id AND dependency_snapshot->>'correctionIssueId'=issue.issue_id::text
      AND dependency_snapshot->'correctionIssueIds'=origin.original_receipt->'relatedIssueIds' AND dependency_snapshot->>'correctionSourceHash'=correction->>'sourceHash')
    THEN RAISE EXCEPTION 'correction editor baseline must remain bound to actual chapter-before evidence' USING ERRCODE='23514'; END IF;
  RETURN;
END
$$;


--
-- Name: assert_resource_correction_resolution_source(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_resource_correction_resolution_source(saved_input jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE saved record; origin record; checkpoint record;
  issue record; journal record; review record;
  change record; proposal record; anchor record;
  body record; settlement record; expected jsonb; formal_input jsonb;
BEGIN
 SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,saved_input->'full_proof' AS full_proof,data.proof_hash,saved_input->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof INTO saved FROM jsonb_to_record(saved_input) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text);

  SELECT * INTO checkpoint FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=saved.correction_checkpoint_id AND book_id=saved.book_id AND status='stable';
  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=checkpoint.session_id AND book_id=saved.book_id;
  SELECT * INTO issue FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) resource_supplement_integrity_issues WHERE issue_id=saved.issue_id AND book_id=saved.book_id;
  SELECT * INTO journal FROM (SELECT data.settlement_id,data.book_id,data.review_id,data.checkpoint_id,version.values->'merged_write' AS merged_write,data.merged_hash,data.canonical_merged,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(settlement_id uuid,book_id uuid,review_id uuid,checkpoint_id uuid,merged_write jsonb,merged_hash char(64),canonical_merged text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_journal')) resource_supplement_integrity_journals WHERE checkpoint_id=checkpoint.id AND book_id=saved.book_id AND settlement_id=checkpoint.settlement_id;
  SELECT * INTO review FROM (SELECT data.review_id,data.book_id,data.session_id,data.request_key,data.session_revision,version.values->'full_input' AS full_input,data.input_hash,data.canonical_input,version.values->'impact_snapshot' AS impact_snapshot,data.impact_hash,data.canonical_impact,version.values->'original_receipt' AS original_receipt,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(review_id uuid,book_id uuid,session_id uuid,request_key uuid,session_revision integer,full_input jsonb,input_hash char(64),canonical_input text,impact_snapshot jsonb,impact_hash char(64),canonical_impact text,original_receipt jsonb,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_impact_review')) resource_supplement_impact_reviews WHERE review_id=journal.review_id AND book_id=saved.book_id AND session_id=checkpoint.session_id;
  SELECT * INTO change FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) state_changes WHERE settlement_id=checkpoint.settlement_id AND book_id=saved.book_id AND status='active';
  SELECT * INTO proposal FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) state_change_proposals WHERE id=change.proposal_id AND book_id=saved.book_id AND status='confirmed' AND confirmed_state_change_id=change.id;
  SELECT * INTO anchor FROM new_design.text_anchors WHERE id=change.text_anchor_id AND status='active';
  SELECT * INTO body FROM new_design.chapter_body_versions WHERE id=checkpoint.body_version_id AND chapter_document_id=issue.chapter_document_id AND archived_at IS NULL;
  SELECT * INTO settlement FROM new_design.chapter_settlements WHERE id=checkpoint.settlement_id AND book_id=saved.book_id AND status='committed';
  IF checkpoint.id IS NULL OR origin.session_id IS NULL OR issue.issue_id IS NULL OR journal.settlement_id IS NULL OR review.review_id IS NULL OR change.id IS NULL OR proposal.id IS NULL OR anchor.id IS NULL OR body.id IS NULL OR settlement.id IS NULL
    OR origin.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1'
    OR NOT (origin.original_receipt->'relatedIssueIds') ? saved.issue_id::text
    OR (SELECT count(*) FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) state_changes WHERE settlement_id=checkpoint.settlement_id AND status='active')<>1
    OR checkpoint.previous_checkpoint_id IS DISTINCT FROM origin.base_checkpoint_id
    OR checkpoint.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR checkpoint.body_version_id IS DISTINCT FROM issue.body_version_id
    OR change.subject_kind IS DISTINCT FROM issue.subject_kind OR change.subject_id IS DISTINCT FROM issue.subject_id OR change.state_key IS DISTINCT FROM issue.state_key
    OR change.before_json IS DISTINCT FROM origin.source_snapshot#>'{correction,beforeValue}'
    OR proposal.before_json IS DISTINCT FROM change.before_json OR proposal.after_json IS DISTINCT FROM change.after_json
    OR anchor.book_id IS DISTINCT FROM saved.book_id OR anchor.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR anchor.body_version_id IS DISTINCT FROM issue.body_version_id
    OR body.chapter_document_id IS DISTINCT FROM issue.chapter_document_id
    THEN RAISE EXCEPTION 'resolution needs its real issue-owned corrective merge and body evidence' USING ERRCODE='23514'; END IF;
  PERFORM assert_resource_correction_formal_source(to_jsonb(original)) FROM (SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_correction_origin')) original WHERE original.session_id=checkpoint.session_id AND original.book_id=saved.book_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'resolution immutable correction original missing' USING ERRCODE='23514'; END IF;
  formal_input:=saved.full_proof->'formalInput';
  IF jsonb_typeof(formal_input) IS DISTINCT FROM 'object' OR (formal_input->>'requestKey')::uuid IS NULL
    OR formal_input->>'reviewId' IS DISTINCT FROM review.review_id::text
    OR formal_input->>'expectedSessionRevision' IS DISTINCT FROM review.session_revision::text
    OR formal_input->>'expectedImpactHash' IS DISTINCT FROM review.impact_hash::text
    THEN RAISE EXCEPTION 'resolution complete formal input mismatch' USING ERRCODE='23514'; END IF;
  expected:=jsonb_build_object('contract','resource_supplement_correction_resolution_v1','resolutionId',saved.resolution_id,'requestKey',saved.request_key,'bookId',saved.book_id,'issue',to_jsonb(issue),
    'formalInput',formal_input,'originalStart',origin.original_receipt,'originalReview',review.original_receipt,'merged',journal.merged_write,
    'correctionSource',origin.source_snapshot,'correctedState',to_jsonb(change),'proposal',to_jsonb(proposal),'anchor',to_jsonb(anchor),'body',to_jsonb(body),'checkpoint',to_jsonb(checkpoint),'settlement',to_jsonb(settlement));
  IF saved.full_proof IS DISTINCT FROM expected OR saved.canonical_proof::jsonb IS DISTINCT FROM saved.full_proof
    OR encode(sha256(convert_to(saved.canonical_proof,'UTF8')),'hex') IS DISTINCT FROM saved.proof_hash::text
    OR saved.original_receipt IS DISTINCT FROM jsonb_build_object('contract','resource_supplement_correction_resolution_v1','resolutionId',saved.resolution_id,'requestKey',saved.request_key,'bookId',saved.book_id,'issueId',saved.issue_id,'correctionCheckpointId',saved.correction_checkpoint_id,'proofHash',saved.proof_hash::text,
      'sourceRoute','/new-design/books/'||saved.book_id||'/writing?chapterDocument='||checkpoint.chapter_document_id||'&session='||checkpoint.session_id||'&resourceIssue='||saved.issue_id)
    THEN RAISE EXCEPTION 'resolution actual full proof or immutable receipt mismatch' USING ERRCODE='23514'; END IF;
END
$$;


--
-- Name: assert_resource_supplement_formal_closure(uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_resource_supplement_formal_closure(settlement uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE saved record;
BEGIN

  SELECT * INTO saved FROM (SELECT data.book_id,data.session_id,data.settlement_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,data.canonical_input,version.values->'original_receipt' AS original_receipt,data.receipt_hash,data.canonical_receipt,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(book_id uuid,session_id uuid,settlement_id uuid,request_key uuid,full_input jsonb,input_hash char(64),canonical_input text,original_receipt jsonb,receipt_hash char(64),canonical_receipt text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_formal_commit')) resource_supplement_formal_commits WHERE settlement_id=settlement;
  IF saved.settlement_id IS NULL THEN RAISE EXCEPTION 'formal supplement requires atomic full original commit receipt' USING ERRCODE='23514'; END IF;
  PERFORM assert_resource_supplement_formal_commit_source(to_jsonb(saved));
END
$$;


--
-- Name: assert_resource_supplement_formal_commit_source(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.assert_resource_supplement_formal_commit_source(saved_input jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE saved record; origin record; child record;
  base record; merged_checkpoint record;
  review record; journal record;
  corrective boolean; frame_contract text; resolution record;
  snapshot jsonb; actual jsonb; issues jsonb; field jsonb; historical jsonb; source_kind text;
  field_values jsonb:='{}'::jsonb; field_key text; before_value jsonb; expected_chain jsonb:='[]'::jsonb; effective numeric; reason text;
BEGIN
 SELECT data.book_id,data.session_id,data.settlement_id,data.request_key,saved_input->'full_input' AS full_input,data.input_hash,data.canonical_input,saved_input->'original_receipt' AS original_receipt,data.receipt_hash,data.canonical_receipt,data.created_at INTO saved FROM jsonb_to_record(saved_input) AS data(book_id uuid,session_id uuid,settlement_id uuid,request_key uuid,full_input jsonb,input_hash char(64),canonical_input text,original_receipt jsonb,receipt_hash char(64),canonical_receipt text,created_at timestamptz);

  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO child FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=saved.session_id AND book_id=saved.book_id AND status='stable' AND settlement_id=saved.settlement_id;
  SELECT * INTO journal FROM (SELECT data.settlement_id,data.book_id,data.review_id,data.checkpoint_id,version.values->'merged_write' AS merged_write,data.merged_hash,data.canonical_merged,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(settlement_id uuid,book_id uuid,review_id uuid,checkpoint_id uuid,merged_write jsonb,merged_hash char(64),canonical_merged text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_journal')) resource_supplement_integrity_journals WHERE settlement_id=saved.settlement_id AND book_id=saved.book_id;
  SELECT * INTO base FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=saved.book_id AND status='superseded';
  SELECT * INTO merged_checkpoint FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=journal.checkpoint_id AND book_id=saved.book_id AND status='stable' AND session_id=saved.session_id AND settlement_id=saved.settlement_id;
  SELECT * INTO review FROM (SELECT data.review_id,data.book_id,data.session_id,data.request_key,data.session_revision,version.values->'full_input' AS full_input,data.input_hash,data.canonical_input,version.values->'impact_snapshot' AS impact_snapshot,data.impact_hash,data.canonical_impact,version.values->'original_receipt' AS original_receipt,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(review_id uuid,book_id uuid,session_id uuid,request_key uuid,session_revision integer,full_input jsonb,input_hash char(64),canonical_input text,impact_snapshot jsonb,impact_hash char(64),canonical_impact text,original_receipt jsonb,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_impact_review')) resource_supplement_impact_reviews WHERE review_id=journal.review_id AND book_id=saved.book_id AND session_id=saved.session_id;
  corrective:=origin.source_snapshot->>'contract'='stable_resource_correction_preview_v1';
  frame_contract:=CASE WHEN corrective THEN 'resource_supplement_correction_commit_v1' ELSE 'resource_supplement_formal_commit_v1' END;
  IF corrective THEN
    PERFORM assert_resource_correction_formal_source(to_jsonb(original)) FROM (SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_correction_origin')) original WHERE original.session_id=saved.session_id AND original.book_id=saved.book_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'corrective formal commit needs its immutable original' USING ERRCODE='23514'; END IF;
  END IF;
  IF origin.session_id IS NULL OR child.id IS NULL OR journal.settlement_id IS NULL OR base.id IS NULL OR merged_checkpoint.id IS NULL OR review.review_id IS NULL
    OR origin.source_snapshot->>'contract' NOT IN ('stable_resource_supplement_preview_v1','stable_resource_correction_preview_v1')
    OR merged_checkpoint.previous_checkpoint_id IS DISTINCT FROM base.id
    OR child.revision IS DISTINCT FROM review.session_revision+2
    OR saved.full_input->>'requestKey' IS DISTINCT FROM saved.request_key::text
    OR saved.full_input->>'reviewId' IS DISTINCT FROM review.review_id::text
    OR saved.full_input->>'expectedSessionRevision' IS DISTINCT FROM review.session_revision::text
    OR saved.full_input->>'expectedImpactHash' IS DISTINCT FROM review.impact_hash::text
    OR saved.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract',frame_contract,'bookId',saved.book_id,'sessionId',saved.session_id,'input',saved.full_input)
    OR encode(sha256(convert_to(saved.canonical_input,'UTF8')),'hex') IS DISTINCT FROM saved.input_hash::text
    OR saved.canonical_receipt::jsonb IS DISTINCT FROM saved.original_receipt
    OR encode(sha256(convert_to(saved.canonical_receipt,'UTF8')),'hex') IS DISTINCT FROM saved.receipt_hash::text
    OR saved.original_receipt->>'contract' IS DISTINCT FROM frame_contract
    OR saved.original_receipt->>'bookId' IS DISTINCT FROM saved.book_id::text OR saved.original_receipt->>'sessionId' IS DISTINCT FROM saved.session_id::text
    OR saved.original_receipt->>'chapterDocumentId' IS DISTINCT FROM child.chapter_document_id::text
    OR saved.original_receipt->>'inputHash' IS DISTINCT FROM saved.input_hash::text OR saved.original_receipt->'input' IS DISTINCT FROM saved.full_input
    OR saved.original_receipt->'merged' IS DISTINCT FROM journal.merged_write
    OR saved.original_receipt->'originalStart' IS DISTINCT FROM origin.original_receipt
    OR saved.original_receipt->'originalReview' IS DISTINCT FROM review.original_receipt
    OR saved.original_receipt->'repeated' IS DISTINCT FROM 'false'::jsonb
    OR saved.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||saved.book_id||'/writing?chapterDocument='||child.chapter_document_id||'&session='||child.id
    OR journal.merged_write->'confirmed' IS DISTINCT FROM merged_checkpoint.summary->'confirmed'
    OR journal.merged_write->>'impactHash' IS DISTINCT FROM review.impact_hash::text
    OR journal.merged_write->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR NOT EXISTS(SELECT 1 FROM new_design.books WHERE id=saved.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM new_design.chapter_documents document JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id
      WHERE document.id=child.chapter_document_id AND document.book_id=saved.book_id AND document.status='active' AND body.id=child.body_version_id AND body.archived_at IS NULL
        AND encode(sha256(convert_to(body.content,'UTF8')),'hex')=body.content_hash)
    THEN RAISE EXCEPTION 'formal supplement full original receipt or merged proof mismatch' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM new_design.chapter_settlement_items WHERE session_id=child.id AND decision NOT IN ('confirm','reject'))
    OR (SELECT count(*) FROM new_design.chapter_settlement_items WHERE session_id=child.id AND decision='confirm')<>jsonb_array_length(review.impact_snapshot->'changes')
    OR (SELECT count(*) FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) state_changes WHERE settlement_id=saved.settlement_id AND status='active')<>jsonb_array_length(review.impact_snapshot->'changes')
    THEN RAISE EXCEPTION 'formal supplement candidate or actual state set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(review.impact_snapshot->'changes') LOOP
    field_key:=jsonb_build_array(snapshot->>'subjectKind',snapshot->>'subjectId',snapshot->>'stateKey')::text;
    field_values:=jsonb_set(field_values,ARRAY[field_key],snapshot->'after');
    IF NOT EXISTS(SELECT 1 FROM new_design.chapter_settlement_items item JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) proposal ON proposal.id=item.state_proposal_id
      JOIN (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change ON change.proposal_id=proposal.id AND change.id=proposal.confirmed_state_change_id
      JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id AND anchor.status='active'
      WHERE item.id=(snapshot->>'itemId')::uuid AND item.session_id=child.id AND item.decision='confirm'
        AND item.canonical_fact_id IS NULL AND item.knowledge_proposal_id IS NULL AND item.category IN ('prop','relationship')
        AND proposal.id=(snapshot->>'proposalId')::uuid AND proposal.book_id=saved.book_id AND proposal.status='confirmed' AND proposal.before_known
        AND proposal.chapter_document_id=child.chapter_document_id AND proposal.body_version_id=child.body_version_id
        AND proposal.subject_kind=snapshot->>'subjectKind' AND proposal.subject_id=(snapshot->>'subjectId')::uuid AND proposal.state_key=snapshot->>'stateKey'
        AND proposal.before_json IS NOT DISTINCT FROM snapshot->'before' AND proposal.after_json IS NOT DISTINCT FROM snapshot->'after'
        AND change.book_id=saved.book_id AND change.settlement_id=saved.settlement_id AND change.status='active'
        AND change.chapter_document_id=child.chapter_document_id AND change.body_version_id=child.body_version_id
        AND change.subject_kind=proposal.subject_kind AND change.subject_id=proposal.subject_id AND change.state_key=proposal.state_key
        AND change.before_json IS NOT DISTINCT FROM proposal.before_json AND change.after_json IS NOT DISTINCT FROM proposal.after_json
        AND change.delta_json IS NOT DISTINCT FROM proposal.delta_json AND change.text_anchor_id=proposal.text_anchor_id AND item.evidence_anchor_id=anchor.id
        AND coalesce(change.effective_story_order,base.chapter_order)=base.chapter_order
        AND anchor.book_id=saved.book_id AND anchor.chapter_document_id=child.chapter_document_id AND anchor.body_version_id=child.body_version_id)
      THEN RAISE EXCEPTION 'formal supplement actual confirmed state proof mismatch' USING ERRCODE='23514'; END IF;
    -- Reconstruct the original END-of-chapter baseline without this new commit.
    -- It cannot inherit a future chapter, a new initial version or its own after.
    SELECT to_jsonb(change) INTO historical FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change
      JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      JOIN new_design.chapter_settlements own_commit ON own_commit.id=change.settlement_id AND own_commit.book_id=change.book_id AND own_commit.status='committed' AND own_commit.chapter_document_id=document.id AND own_commit.body_version_id=body.id
      JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) proposal ON proposal.id=change.proposal_id AND proposal.status='confirmed' AND proposal.confirmed_state_change_id=change.id
        AND proposal.book_id=change.book_id AND proposal.chapter_document_id=document.id AND proposal.body_version_id=body.id
        AND proposal.subject_kind=change.subject_kind AND proposal.subject_id=change.subject_id AND proposal.state_key=change.state_key AND proposal.after_json=change.after_json
      LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
      WHERE change.book_id=saved.book_id AND change.subject_kind=snapshot->>'subjectKind' AND change.subject_id=(snapshot->>'subjectId')::uuid AND change.state_key=snapshot->>'stateKey' AND change.status='active'
        AND change.settlement_id<>saved.settlement_id AND ((NOT corrective AND document.logical_order<=base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<=base.chapter_order) OR (corrective AND document.logical_order<base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<base.chapter_order))
        AND (change.text_anchor_id IS NULL OR anchor.status='active' AND anchor.book_id=saved.book_id AND anchor.chapter_document_id=document.id AND anchor.body_version_id=body.id)
      ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
    source_kind:='state_change';
    IF historical IS NULL AND NOT corrective THEN
      SELECT to_jsonb(initial_version) INTO historical FROM (SELECT data.id,data.book_id,data.subject_kind,data.subject_id,data.state_key,data.current_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,subject_kind text,subject_id uuid,state_key text,current_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='entity_initial_state')) state JOIN (SELECT data.id,data.initial_state_id,data.version,version.values->'value_json' AS value_json,data.value_hash,data.source_fact_id,data.actor,data.note,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,initial_state_id uuid,version integer,value_json jsonb,value_hash char(64),source_fact_id uuid,actor text,note text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='entity_initial_state_version')) initial_version ON initial_version.initial_state_id=state.id
        WHERE state.book_id=saved.book_id AND state.subject_kind=snapshot->>'subjectKind' AND state.subject_id=(snapshot->>'subjectId')::uuid AND state.state_key=snapshot->>'stateKey'
          AND initial_version.created_at<=base.created_at ORDER BY initial_version.version DESC LIMIT 1;
      source_kind:='initial_state';
    END IF;
    SELECT item INTO field FROM jsonb_array_elements(origin.source_snapshot->'catalog'->'subjects') subject,jsonb_array_elements(subject->'fields') item
      WHERE subject->>'subjectKind'=snapshot->>'subjectKind' AND subject->>'id'=snapshot->>'subjectId' AND item->>'key'=snapshot->>'stateKey';
    IF historical IS NULL OR field IS NULL OR field->'baseline'->'known' IS DISTINCT FROM 'true'::jsonb
      OR field->'baseline'->'stale' IS DISTINCT FROM 'false'::jsonb OR field->'baseline'->>'sourceKind' IS DISTINCT FROM source_kind
      OR field->'baseline'->>'sourceId' IS DISTINCT FROM historical->>'id'
      OR snapshot->'before' IS DISTINCT FROM (CASE WHEN source_kind='state_change' THEN historical->'after_json' ELSE historical->'value_json' END)
      OR field->'baseline'->'value' IS DISTINCT FROM snapshot->'before'
      THEN RAISE EXCEPTION 'formal supplement actual historical chapter-end baseline changed' USING ERRCODE='23514'; END IF;
    SELECT to_jsonb(projection) INTO actual FROM (SELECT data.book_id,data.subject_kind,data.subject_id,data.state_key,version.values->'value_json' AS value_json,data.source_initial_version_id,data.source_state_change_id,data.projection_revision,data.is_stale,data.rebuilt_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(book_id uuid,subject_kind text,subject_id uuid,state_key text,value_json jsonb,source_initial_version_id uuid,source_state_change_id uuid,projection_revision bigint,is_stale boolean,rebuilt_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='current_state_projection')) projection WHERE book_id=saved.book_id
      AND subject_kind=snapshot->>'subjectKind' AND subject_id=(snapshot->>'subjectId')::uuid AND state_key=snapshot->>'stateKey';
    SELECT to_jsonb(change) INTO historical FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change
      JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      JOIN new_design.chapter_settlements own_commit ON own_commit.id=change.settlement_id AND own_commit.book_id=change.book_id AND own_commit.status='committed' AND own_commit.chapter_document_id=document.id AND own_commit.body_version_id=body.id
      JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) proposal ON proposal.id=change.proposal_id AND proposal.status='confirmed' AND proposal.confirmed_state_change_id=change.id
        AND proposal.book_id=change.book_id AND proposal.chapter_document_id=document.id AND proposal.body_version_id=body.id
        AND proposal.subject_kind=change.subject_kind AND proposal.subject_id=change.subject_id AND proposal.state_key=change.state_key
        AND proposal.before_json IS NOT DISTINCT FROM change.before_json AND proposal.after_json IS NOT DISTINCT FROM change.after_json
      WHERE change.book_id=saved.book_id AND change.subject_kind=snapshot->>'subjectKind' AND change.subject_id=(snapshot->>'subjectId')::uuid AND change.state_key=snapshot->>'stateKey' AND change.status='active'
      ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
    IF actual IS NULL OR historical IS NULL OR actual->>'source_state_change_id' IS DISTINCT FROM historical->>'id' OR actual->'value_json' IS DISTINCT FROM historical->'after_json'
      OR actual->'is_stale' IS DISTINCT FROM to_jsonb(EXISTS(SELECT 1 FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) issue WHERE issue.book_id=saved.book_id
        AND issue.subject_kind=snapshot->>'subjectKind' AND issue.subject_id=(snapshot->>'subjectId')::uuid AND issue.state_key=snapshot->>'stateKey'
        AND NOT EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE issue_id=issue.issue_id)))
      THEN RAISE EXCEPTION 'formal supplement projection and actual source fence must close atomically' USING ERRCODE='23514'; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(issue) ORDER BY issue.issue_id),'[]'::jsonb) INTO issues FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) issue WHERE settlement_id=saved.settlement_id AND book_id=saved.book_id;
  IF issues IS DISTINCT FROM saved.original_receipt->'issues'
    OR (SELECT count(*) FROM jsonb_array_elements(issues))<>(SELECT count(*) FROM jsonb_array_elements(review.impact_snapshot->'stateChain') WHERE value->>'reason'<>'compatible')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(review.impact_snapshot->'stateChain') impact WHERE impact->>'reason'<>'compatible' AND NOT EXISTS(
      SELECT 1 FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) issue WHERE issue.settlement_id=saved.settlement_id AND issue.book_id=saved.book_id AND issue.state_change_id=(impact->>'stateChangeId')::uuid
        AND issue.impact=impact AND NOT EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE issue_id=issue.issue_id)))
    THEN RAISE EXCEPTION 'formal supplement every real conflict must retain its actual immutable source fence' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM new_design.dependency_resources WHERE book_id=saved.book_id AND resource_kind='chapter_settlement' AND stable_object_id=child.chapter_document_id AND exact_version_id=saved.settlement_id)
    OR EXISTS(SELECT 1 FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change WHERE change.settlement_id=saved.settlement_id AND change.status='active' AND NOT EXISTS(
      SELECT 1 FROM new_design.dependency_resources resource WHERE resource.book_id=saved.book_id AND resource.resource_kind='state_change' AND resource.stable_object_id=change.id AND resource.exact_version_id=change.id))
    OR EXISTS(SELECT 1 FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change CROSS JOIN new_design.embedding_profiles profile JOIN (SELECT data.id,data.profile_id,data.version,data.provider_key,data.model_key,data.dimensions,data.distance_metric,data.normalize,data.chunker_key,data.chunker_version,data.max_chunk_chars,data.overlap_chars,data.allowed_source_kinds,data.content_hash,data.created_by,data.created_at,data.connection_version_id,data.knowledge_profile_key,data.knowledge_profile_hash,data.knowledge_profile_book_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,profile_id uuid,version integer,provider_key text,model_key text,dimensions integer,distance_metric text,normalize boolean,chunker_key text,chunker_version text,max_chunk_chars integer,overlap_chars integer,allowed_source_kinds text[],content_hash char(64),created_by text,created_at timestamptz,connection_version_id uuid,knowledge_profile_key uuid,knowledge_profile_hash char(64),knowledge_profile_book_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='embedding_profile_version')) profile_version ON profile_version.id=profile.current_version_id
      WHERE change.settlement_id=saved.settlement_id AND change.status='active' AND profile.status='active' AND 'state_change'=ANY(profile_version.allowed_source_kinds)
        AND NOT EXISTS(SELECT 1 FROM new_design.dependency_resources resource JOIN (SELECT data.id,data.space_id,data.book_id,data.profile_version_id,data.dependency_source_resource_id,data.source_kind,data.source_stable_id,data.source_version_id,data.source_revision,data.source_hash,data.title,data.content_text,data.chunk_recipe_hash,data.status,data.created_by,data.created_at,data.stale_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,space_id uuid,book_id uuid,profile_version_id uuid,dependency_source_resource_id uuid,source_kind text,source_stable_id uuid,source_version_id uuid,source_revision integer,source_hash char(64),title text,content_text text,chunk_recipe_hash char(64),status text,created_by text,created_at timestamptz,stale_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='embedding_source_snapshot')) source ON source.dependency_source_resource_id=resource.id
          JOIN (SELECT data.id,data.book_id,data.source_snapshot_id,data.profile_version_id,data.expected_source_hash,data.status,data.attempt_count,data.idempotency_key,data.last_error,data.created_at,data.started_at,data.completed_at,data.knowledge_index_key,data.knowledge_index_hash,data.knowledge_index_plan FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,source_snapshot_id uuid,profile_version_id uuid,expected_source_hash char(64),status text,attempt_count integer,idempotency_key text,last_error text,created_at timestamptz,started_at timestamptz,completed_at timestamptz,knowledge_index_key uuid,knowledge_index_hash char(64),knowledge_index_plan jsonb) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chunking_request')) request ON request.source_snapshot_id=source.id AND request.book_id=saved.book_id
          WHERE resource.book_id=saved.book_id AND resource.resource_kind='state_change' AND resource.stable_object_id=change.id AND resource.exact_version_id=change.id
            AND source.book_id=saved.book_id AND source.profile_version_id=profile_version.id AND source.source_kind='state_change' AND source.source_stable_id=change.id
            AND source.source_version_id=change.id AND source.source_revision=1 AND source.status='current' AND source.source_hash=resource.content_hash
            AND request.profile_version_id=profile_version.id AND request.expected_source_hash=resource.content_hash))
    THEN RAISE EXCEPTION 'formal supplement actual dependency and semantic sources incomplete' USING ERRCODE='23514'; END IF;
  -- Full actual downstream versions, references and state sources follow below.
  SELECT coalesce(jsonb_agg(to_jsonb(reference)||jsonb_build_object('source_version',to_jsonb(card_version)) ORDER BY reference.id),'[]'::jsonb) INTO actual
    FROM (SELECT data.id,data.planning_version_id,data.planning_object_id,data.book_id,data.reference_role,data.card_id,data.card_version_id,data.action_key,data.note,data.sort_order,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,planning_version_id uuid,planning_object_id uuid,book_id uuid,reference_role text,card_id uuid,card_version_id uuid,action_key text,note text,sort_order integer,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_version_reference')) reference LEFT JOIN new_design.card_versions card_version ON card_version.id=reference.card_version_id AND card_version.card_id=reference.card_id
    WHERE reference.book_id=saved.book_id AND reference.planning_version_id IN (
      SELECT (value#>>'{adopted_plan,id}')::uuid FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,chapters}')
      UNION SELECT (value#>>'{body,planning_version_id}')::uuid FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,chapters}'));
  IF actual IS DISTINCT FROM review.impact_snapshot#>'{downstreamSource,planningReferences}' THEN
    RAISE EXCEPTION 'impact review exact planning references changed' USING ERRCODE='23514'; END IF;
  -- Same authority rule as the preview: keep all rows, use the final row per
  -- chapter/field; preserve that field's first position in the ordered chain.
  FOR snapshot IN
    WITH ordered AS (SELECT value,ordinality,
      row_number() OVER(PARTITION BY value#>>'{change,chapter_document_id}',value#>>'{change,subject_kind}',value#>>'{change,subject_id}',value#>>'{change,state_key}' ORDER BY ordinality DESC) last_position,
      min(ordinality) OVER(PARTITION BY value#>>'{change,chapter_document_id}',value#>>'{change,subject_kind}',value#>>'{change,subject_id}',value#>>'{change,state_key}') first_position
      FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,states}') WITH ORDINALITY)
    SELECT value FROM ordered WHERE last_position=1 ORDER BY first_position
  LOOP
    field_key=jsonb_build_array(snapshot#>>'{change,subject_kind}',snapshot#>>'{change,subject_id}',snapshot#>>'{change,state_key}')::text;
    before_value=field_values->field_key;
    effective=(snapshot#>>'{change,effective_story_order}')::numeric;
    reason=CASE WHEN effective IS NOT NULL AND effective<=base.chapter_order THEN 'backdated_source'
      WHEN before_value IS NOT DISTINCT FROM snapshot#>'{change,before_json}' THEN 'compatible' ELSE 'before_conflict' END;
    expected_chain=expected_chain||jsonb_build_array(jsonb_build_object('chapterDocumentId',snapshot#>>'{change,chapter_document_id}',
      'bodyVersionId',snapshot#>>'{change,body_version_id}','chapterOrder',snapshot->'chapter_order','stateChangeId',snapshot#>>'{change,id}',
      'subjectKind',snapshot#>>'{change,subject_kind}','subjectId',snapshot#>>'{change,subject_id}','stateKey',snapshot#>>'{change,state_key}',
      'expectedBefore',before_value,'recordedBefore',snapshot#>'{change,before_json}','recordedAfter',snapshot#>'{change,after_json}',
      'effectiveStoryOrder',effective,'reason',reason));
    field_values=jsonb_set(field_values,ARRAY[field_key],snapshot#>'{change,after_json}');
  END LOOP;
  IF expected_chain IS DISTINCT FROM review.impact_snapshot->'stateChain' THEN
    RAISE EXCEPTION 'impact review actual state chain mismatch' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM new_design.chapter_documents WHERE book_id=saved.book_id AND status='active' AND logical_order>base.chapter_order)
    <>jsonb_array_length(review.impact_snapshot#>'{downstreamSource,chapters}')
    OR (SELECT count(DISTINCT value#>>'{document,id}') FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,chapters}'))<>jsonb_array_length(review.impact_snapshot#>'{downstreamSource,chapters}') THEN
    RAISE EXCEPTION 'impact review downstream chapter set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,chapters}') LOOP
    SELECT jsonb_build_object('document',to_jsonb(document),'body',to_jsonb(body),'planning_object',to_jsonb(object),
      'adopted_plan',to_jsonb(plan),'body_plan',to_jsonb(body_plan),'checkpoint',to_jsonb(checkpoint)) INTO actual
      FROM new_design.chapter_documents document
      LEFT JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      LEFT JOIN (SELECT data.id,data.book_id,data.level,data.parent_object_id,data.card_id,data.title,data.sort_order,data.status,data.current_version_id,data.adopted_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,level text,parent_object_id uuid,card_id uuid,title text,sort_order integer,status text,current_version_id uuid,adopted_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_object')) object ON object.book_id=document.book_id AND object.card_id=document.chapter_card_id AND object.level='chapter' AND object.status='active'
      LEFT JOIN (SELECT data.id,data.object_id,data.book_id,data.version,data.base_version_id,data.based_on_parent_version_id,data.source,data.status,version.values->'content' AS content,data.content_hash,data.source_body_version_id,data.created_by,data.stale_at,data.stale_reason,data.created_at,data.execution_mode FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_version')) plan ON plan.id=object.adopted_version_id AND plan.object_id=object.id
      LEFT JOIN (SELECT data.id,data.object_id,data.book_id,data.version,data.base_version_id,data.based_on_parent_version_id,data.source,data.status,version.values->'content' AS content,data.content_hash,data.source_body_version_id,data.created_by,data.stale_at,data.stale_reason,data.created_at,data.execution_mode FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_version')) body_plan ON body_plan.id=body.planning_version_id AND body_plan.book_id=document.book_id
      LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=document.book_id AND checkpoint.body_version_id=body.id AND checkpoint.status='stable'
      WHERE document.id=(snapshot#>>'{document,id}')::uuid AND document.book_id=saved.book_id AND document.status='active' AND document.logical_order>base.chapter_order;
    IF actual IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'impact review downstream source changed' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change
      JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      WHERE change.book_id=saved.book_id AND change.status='active' AND document.logical_order>base.chapter_order
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(review.impact_snapshot->'changes') selection
          WHERE selection->>'subjectKind'=change.subject_kind AND (selection->>'subjectId')::uuid=change.subject_id AND selection->>'stateKey'=change.state_key))
    <>jsonb_array_length(review.impact_snapshot#>'{downstreamSource,states}')
    OR (SELECT count(DISTINCT value#>>'{change,id}') FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,states}'))<>jsonb_array_length(review.impact_snapshot#>'{downstreamSource,states}')
    THEN RAISE EXCEPTION 'impact review downstream state set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,states}') LOOP
    SELECT jsonb_build_object('change',to_jsonb(change),'proposal',to_jsonb(proposal),'settlement',to_jsonb(settlement),
      'anchor',to_jsonb(anchor),'checkpoint',to_jsonb(checkpoint),'checkpoint_commit',to_jsonb(checkpoint_commit),
      'checkpoint_session',to_jsonb(checkpoint_session),'chapter_order',document.logical_order) INTO actual
      FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change
      JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) proposal ON proposal.id=change.proposal_id
      LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
      LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
      LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=change.book_id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
      LEFT JOIN new_design.chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id AND checkpoint_commit.book_id=change.book_id AND checkpoint_commit.chapter_document_id=document.id AND checkpoint_commit.body_version_id=change.body_version_id
      LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) checkpoint_session ON checkpoint_session.id=checkpoint.session_id AND checkpoint_session.book_id=change.book_id AND checkpoint_session.chapter_document_id=document.id AND checkpoint_session.body_version_id=change.body_version_id AND checkpoint_session.settlement_id=checkpoint.settlement_id
      WHERE change.id=(snapshot#>>'{change,id}')::uuid AND change.book_id=saved.book_id AND change.status='active' AND document.logical_order>base.chapter_order;
    IF actual IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'impact review downstream state source changed' USING ERRCODE='23514'; END IF;
  END LOOP;


  IF corrective THEN
    IF jsonb_array_length(review.impact_snapshot->'changes')<>1
      OR (SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.issue_id),'[]'::jsonb) FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) item WHERE item.correction_checkpoint_id=merged_checkpoint.id AND item.book_id=saved.book_id) IS DISTINCT FROM saved.original_receipt->'resolutions'
      OR (SELECT coalesce(jsonb_agg(issue_id::text ORDER BY issue_id),'[]'::jsonb) FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE correction_checkpoint_id=merged_checkpoint.id AND book_id=saved.book_id) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) FROM jsonb_array_elements_text(origin.original_receipt->'relatedIssueIds'))
      THEN RAISE EXCEPTION 'corrective commit must retain every exact atomic resolution proof' USING ERRCODE='23514'; END IF;
    FOR resolution IN SELECT * FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE correction_checkpoint_id=merged_checkpoint.id AND book_id=saved.book_id LOOP
      PERFORM assert_resource_correction_resolution_source(to_jsonb(resolution));
      IF resolution.full_proof->'formalInput' IS DISTINCT FROM saved.full_input THEN RAISE EXCEPTION 'correction proof must bind complete formal original input' USING ERRCODE='23514'; END IF;
    END LOOP;
  END IF;
END
$$;


--
-- Name: block_unavailable_resource_correction_candidates(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.block_unavailable_resource_correction_candidates() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- resource_correction_candidates_v1; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_block_unavailable_resource_correction_candidates(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: block_unavailable_resource_supplement_extraction(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.block_unavailable_resource_supplement_extraction() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- stable_resource_supplement_candidates_v1; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_block_unavailable_resource_supplement_extraction(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: bridge_asset_version_dependency(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.bridge_asset_version_dependency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE source_asset_id uuid;
BEGIN
  PERFORM register_dependency_resource('asset_version',NEW.asset_id,NEW.id);
  IF NEW.derived_from_version_id IS NOT NULL THEN
    SELECT asset_id INTO source_asset_id FROM asset_versions WHERE id=NEW.derived_from_version_id;
    PERFORM add_registered_dependency('asset_version',source_asset_id,NEW.derived_from_version_id,'asset_version',NEW.asset_id,NEW.id,'derived_from','hard','system',NEW.id);
  END IF;
  IF NEW.source_resource_id IS NOT NULL THEN
    INSERT INTO dependency_edges(id,space_id,book_id,source_resource_id,derived_resource_id,dependency_kind,dependency_strength,origin_kind,origin_id)
    SELECT gen_random_uuid(),asset.space_id,NEW.book_id,NEW.source_resource_id,derived.id,'generated_from','hard',CASE WHEN NEW.source_kind='ai_generated' THEN 'ai_result' ELSE 'system' END,NEW.id
    FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,asset_key text,asset_kind text,title text,status text,current_version_id uuid,revision integer,created_by text,created_at timestamptz,updated_at timestamptz,archived_at timestamptz) WHERE record_type.type_key='asset') asset JOIN dependency_resources derived ON derived.resource_kind='asset_version' AND derived.stable_object_id=NEW.asset_id AND derived.exact_version_id=NEW.id
    WHERE asset.id=NEW.asset_id
    ON CONFLICT(source_resource_id,derived_resource_id,dependency_kind) WHERE status='active' DO NOTHING;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: bridge_native_body_adoption(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.bridge_native_body_adoption() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE previous_resource uuid; adopted_resource uuid;
BEGIN
 IF NEW.from_version_id IS NULL THEN RETURN NEW; END IF;
 previous_resource:=register_dependency_resource('chapter_body_version',NEW.chapter_document_id,NEW.from_version_id);
 adopted_resource:=register_dependency_resource('chapter_body_version',NEW.chapter_document_id,NEW.to_version_id);
 PERFORM invalidate_registered_resource(previous_resource,adopted_resource,'正文采用版本发生变化。','body_adoption',NEW.id,'body-adoption:'||NEW.id::text);
 RETURN NEW;
END $$;


--
-- Name: bridge_native_dependency_creation(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.bridge_native_dependency_creation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE source_kind text; source_version uuid; source_stable uuid; owner_book uuid;
BEGIN
 IF TG_TABLE_NAME='context_manifests' THEN
  PERFORM register_dependency_resource('context_manifest',NEW.id,NEW.id);
  IF NEW.book_id IS NULL THEN RETURN NEW; END IF;
  SELECT recipe_id INTO source_stable FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
  PERFORM add_registered_dependency('prompt_recipe_version',source_stable,NEW.prompt_recipe_version_id,'context_manifest',NEW.id,NEW.id,'configured_by','hard','context_build',NEW.id);
  SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
  PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'context_manifest',NEW.id,NEW.id,'configured_by','hard','context_build',NEW.id);
 ELSIF TG_TABLE_NAME='context_manifest_items' THEN
  SELECT book_id INTO owner_book FROM context_manifests WHERE id=NEW.manifest_id;
  source_kind:=CASE NEW.source_type WHEN 'body_version' THEN 'chapter_body_version' WHEN 'text_anchor' THEN 'chapter_text_anchor'
   WHEN 'research_version' THEN 'research_record_version' WHEN 'research_pack_version' THEN 'research_reference_pack_version'
   WHEN 'retrieval_chunk' THEN 'embedding_chunk' WHEN 'story_time' THEN 'story_event_timing' WHEN 'prompt_component' THEN 'card_version' ELSE NEW.source_type END;
  source_version:=COALESCE(NEW.exact_version_id,NEW.stable_object_id);
  IF owner_book IS NULL THEN PERFORM register_dependency_resource(source_kind,NEW.stable_object_id,source_version);
  ELSE PERFORM add_registered_dependency(source_kind,NEW.stable_object_id,source_version,'context_manifest',NEW.manifest_id,NEW.manifest_id,'context_included','hard','context_build',NEW.manifest_id); END IF;
 ELSIF TG_TABLE_NAME='model_route_snapshots' THEN
  PERFORM register_dependency_resource('model_route_snapshot',NEW.id,NEW.id);
  IF NEW.book_id IS NULL OR NEW.task_contract_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
  PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'model_route_snapshot',NEW.id,NEW.id,'configured_by','hard','system',NEW.id);
 ELSIF TG_TABLE_NAME='ai_task_attempts' THEN
  IF NEW.status<>'succeeded' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  PERFORM register_dependency_resource('ai_task_attempt',NEW.task_id,NEW.id);
  SELECT book_id INTO owner_book FROM ai_tasks WHERE id=NEW.task_id;
  IF owner_book IS NULL THEN RETURN NEW; END IF;
  SELECT contract_id INTO source_stable FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
  PERFORM add_registered_dependency('task_contract_version',source_stable,NEW.task_contract_version_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','hard','ai_result',NEW.id);
  SELECT recipe_id INTO source_stable FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
  PERFORM add_registered_dependency('prompt_recipe_version',source_stable,NEW.prompt_recipe_version_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','hard','ai_result',NEW.id);
  PERFORM add_registered_dependency('context_manifest',NEW.context_manifest_id,NEW.context_manifest_id,'ai_task_attempt',NEW.task_id,NEW.id,'context_included','hard','ai_result',NEW.id);
  PERFORM add_registered_dependency('model_route_snapshot',NEW.model_route_snapshot_id,NEW.model_route_snapshot_id,'ai_task_attempt',NEW.task_id,NEW.id,'configured_by','soft','ai_result',NEW.id);
 END IF;
 RETURN NEW;
END $$;


--
-- Name: bridge_native_physical_request(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.bridge_native_physical_request() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE request_space uuid;
BEGIN
 IF TG_TABLE_NAME='ai_tasks' THEN
  IF NEW.book_id IS NOT NULL THEN PERFORM enqueue_registered_background_job('ai_task',NEW.id,NEW.space_id,NEW.book_id,NULL,NEW.source_id); END IF;
 ELSIF TG_TABLE_NAME='embedding_generations' THEN
  SELECT space_id INTO request_space FROM books WHERE id=NEW.book_id;
  PERFORM enqueue_registered_background_job('embedding_index_generation',NEW.id,request_space,NEW.book_id,NULL,NEW.profile_version_id);
 END IF;
 RETURN NEW;
END $$;


--
-- Name: bridge_native_request_card(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.bridge_native_request_card() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE kind text; payload jsonb; request_kind text; request_book uuid; request_space uuid; correlation uuid; causation uuid;
BEGIN
 IF OLD.current_version_id IS NOT NULL OR NEW.current_version_id IS NULL THEN RETURN NEW; END IF;
 SELECT type_key INTO kind FROM card_types WHERE id=NEW.card_type_id;
 request_kind:=CASE kind WHEN 'chunking_request' THEN 'embedding_chunking_request'
  WHEN 'dependency_recompute_request' THEN kind WHEN 'asset_derivation' THEN kind WHEN 'graph_projection_request' THEN kind
  WHEN 'embedding_request' THEN kind WHEN 'publication_export_request' THEN kind END;
 IF request_kind IS NULL THEN RETURN NEW; END IF;
 SELECT values INTO payload FROM card_versions WHERE id=NEW.current_version_id AND card_id=NEW.id;
 request_book:=(payload->>'book_id')::uuid; SELECT space_id INTO request_space FROM books WHERE id=request_book;
 correlation:=CASE kind WHEN 'dependency_recompute_request' THEN (payload->>'invalidation_event_id')::uuid WHEN 'graph_projection_request' THEN (payload->>'generation_id')::uuid END;
 causation:=CASE kind WHEN 'dependency_recompute_request' THEN (payload->>'target_resource_id')::uuid WHEN 'asset_derivation' THEN (payload->>'source_asset_version_id')::uuid
  WHEN 'graph_projection_request' THEN (payload->>'dependency_resource_id')::uuid WHEN 'chunking_request' THEN (payload->>'source_snapshot_id')::uuid
  WHEN 'embedding_request' THEN (payload->>'chunk_id')::uuid WHEN 'publication_export_request' THEN NULL::uuid END;
 PERFORM enqueue_registered_background_job(request_kind,(payload->>'id')::uuid,request_space,request_book,correlation,causation);
 RETURN NEW;
END $$;


--
-- Name: bridge_transfer_operation_to_outbox(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.bridge_transfer_operation_to_outbox() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM enqueue_registered_background_job('backup_request',NEW.id,NEW.space_id,NEW.book_id,NULL,NULL);
  RETURN NEW;
END $$;


--
-- Name: build_embedding_generation_index(uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.build_embedding_generation_index(requested_generation_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE generation_row record; profile jsonb; dims integer; operator_name text;
BEGIN
 SELECT * INTO generation_row FROM embedding_generations WHERE id=requested_generation_id FOR UPDATE;
 IF NOT FOUND OR generation_row.status NOT IN ('building','verifying') OR generation_row.index_name<>'nd_hnsw_'||replace(requested_generation_id::text,'-','') THEN RAISE EXCEPTION 'generation is not buildable' USING ERRCODE='23514'; END IF;
 SELECT v.values INTO profile FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'id'=generation_row.profile_version_id::text;
 dims:=(profile->>'dimensions')::integer;
 operator_name:=CASE profile->>'distance_metric' WHEN 'cosine' THEN 'vector_cosine_ops' WHEN 'l2' THEN 'vector_l2_ops' WHEN 'inner_product' THEN 'vector_ip_ops' END;
 IF dims IS NULL OR dims<1 OR dims>2000 OR operator_name IS NULL THEN RAISE EXCEPTION 'unsupported HNSW profile' USING ERRCODE='23514'; END IF;
 IF to_regclass('new_design.'||generation_row.index_name) IS NOT NULL THEN
  IF generation_row.status='verifying' AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relname=generation_row.index_name AND i.indrelid='new_design.embedding_vectors'::regclass AND i.indisvalid) THEN RETURN; END IF;
  RAISE EXCEPTION 'index identity already occupied' USING ERRCODE='23514';
 END IF;
 -- Dynamic DDL is limited to a validated UUID-derived index name, numeric dimensions and a fixed opclass.
 EXECUTE format('CREATE INDEX %I ON new_design.embedding_vectors USING hnsw ((embedding::public.vector(%s)) public.%I) WHERE record_kind=''index'' AND generation_id=%L::uuid AND status=''eligible''',generation_row.index_name,dims,operator_name,requested_generation_id::text);
 UPDATE embedding_generations SET status='verifying' WHERE id=requested_generation_id;
END $$;


--
-- Name: cascade_native_embedding_profile_archive(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.cascade_native_embedding_profile_archive() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE item record; next_value jsonb;
BEGIN
 IF OLD.status<>'active' OR NEW.status<>'archived' THEN RETURN NEW; END IF;
 FOR item IN SELECT c.space_id,t.type_key,v.values FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
 WHERE (t.type_key IN ('embedding_source_snapshot','embedding_request') AND EXISTS(
  SELECT 1 FROM cards p JOIN card_types pt ON pt.id=p.card_type_id JOIN card_versions pv ON pv.id=p.current_version_id WHERE pt.type_key='embedding_profile_version' AND pv.values->>'profile_id'=NEW.id::text AND pv.values->>'id'=v.values->>'profile_version_id'))
  OR (t.type_key='embedding_index_state' AND v.values->>'profile_id'=NEW.id::text)
 LOOP
  IF (item.type_key='embedding_source_snapshot' AND item.values->>'status'<>'current') OR (item.type_key='embedding_request' AND item.values->>'status' NOT IN ('pending','running','retry_scheduled','succeeded')) THEN CONTINUE; END IF;
  next_value:=item.values||jsonb_build_object('status','stale','revision',COALESCE((item.values->>'revision')::integer,0)+1,'updated_at',now());
  IF item.type_key='embedding_source_snapshot' THEN next_value:=next_value||jsonb_build_object('stale_at',now()); END IF;
  PERFORM kernel_store_record(item.type_key,item.space_id,(item.values->>'id')::uuid,next_value);
 END LOOP;
 UPDATE embedding_chunks SET status='stale',stale_at=now() WHERE status='current' AND profile_version_id IN (
  SELECT (v.values->>'id')::uuid FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'profile_id'=NEW.id::text);
 UPDATE embedding_vectors SET status='stale' WHERE record_kind='index' AND status='eligible' AND profile_version_id IN (
  SELECT (v.values->>'id')::uuid FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'profile_id'=NEW.id::text);
 UPDATE embedding_generations SET status='stale' WHERE status IN ('ready','active') AND profile_version_id IN (
  SELECT (v.values->>'id')::uuid FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'profile_id'=NEW.id::text);
 RETURN NEW;
END $$;


--
-- Name: context_activation_rule_stats(jsonb, integer); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.context_activation_rule_stats(node jsonb, depth integer DEFAULT 1) RETURNS TABLE(max_depth integer, condition_count integer, is_valid boolean)
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE child jsonb; child_stats record; field_name text; operator_name text;
BEGIN
  IF jsonb_typeof(node) IS DISTINCT FROM 'object' OR depth IS NULL OR depth<1 OR depth>4 THEN RETURN QUERY SELECT depth,0,false; RETURN; END IF;
  IF node->>'kind'='condition' THEN
    field_name:=node->>'field'; operator_name:=node->>'operator';
    RETURN QUERY SELECT depth,1,
      COALESCE(field_name=ANY(ARRAY['task_key','task_group','content_type','tag','material_status','canonical_status','volume','chapter','scene','story_range','relation_exists','association_exists','source_type','stale','manual_switch'])
      AND operator_name=ANY(ARRAY['equals','not_equals','in','not_in','contains','exists','not_exists','gte','lte','between','enabled'])
      AND (node-ARRAY['kind','field','operator','value']::text[])='{}'::jsonb
      AND (NOT (node ? 'value') OR jsonb_typeof(node->'value') IN ('string','number','boolean','array','null'))
      AND (NOT (node ? 'value') OR jsonb_typeof(node->'value')<>'array' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(node->'value')='array' THEN node->'value' ELSE '[]'::jsonb END) AS array_item(value) WHERE jsonb_typeof(value) NOT IN ('string','number'))),false);
    RETURN;
  END IF;
  IF node->>'kind' IS DISTINCT FROM 'group' OR NOT COALESCE(node->>'operator'=ANY(ARRAY['and','or']),false) OR (node-ARRAY['kind','operator','items']::text[])<>'{}'::jsonb OR jsonb_typeof(node->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(node->'items')>20 THEN
    RETURN QUERY SELECT depth,0,false; RETURN;
  END IF;
  max_depth:=depth; condition_count:=0; is_valid:=true;
  FOR child IN SELECT value FROM jsonb_array_elements(node->'items') LOOP
    SELECT * INTO child_stats FROM context_activation_rule_stats(child,depth+1);
    max_depth:=greatest(max_depth,child_stats.max_depth); condition_count:=condition_count+child_stats.condition_count; is_valid:=is_valid AND COALESCE(child_stats.is_valid,false);
  END LOOP;
  is_valid:=is_valid AND condition_count<=40;
  RETURN NEXT;
END $$;


--
-- Name: context_dependency_kind(text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.context_dependency_kind(source_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
 SELECT CASE source_type WHEN 'body_version' THEN 'chapter_body_version' WHEN 'text_anchor' THEN 'chapter_text_anchor'
  WHEN 'research_version' THEN 'research_record_version' WHEN 'research_pack_version' THEN 'research_reference_pack_version'
  WHEN 'story_time' THEN 'story_event_timing' WHEN 'prompt_component' THEN 'card_version'
  WHEN 'retrieval_chunk' THEN 'embedding_chunk' ELSE source_type END
$$;


--
-- Name: dependency_content_hash(text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.dependency_content_hash(payload text) RETURNS character
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
  SELECT (md5(COALESCE(payload,'')) || md5(reverse(COALESCE(payload,''))))::char(64)
$$;


--
-- Name: enqueue_registered_background_job(text, uuid, uuid, uuid, uuid, uuid, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.enqueue_registered_background_job(request_kind text, request_id uuid, request_space_id uuid, request_book_id uuid, requested_correlation_id uuid, requested_causation_id uuid, requested_producer_kind text DEFAULT 'domain_store'::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE handler record; event_id uuid; job_id uuid; sequence_value bigint; payload_value jsonb; ordering_value text; priority_value integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('background-request:'||request_kind||':'||request_id::text,0));
  SELECT * INTO handler FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(handler_key text,job_kind text,topic text,event_version integer,specialized_request_kind text,default_max_attempts integer,default_lease_ms integer,backoff_base_ms integer,backoff_cap_ms integer,status text,created_at timestamptz) WHERE record_type.type_key='background_job_handler') background_job_handlers WHERE specialized_request_kind=request_kind AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'no active handler registered for %',request_kind USING ERRCODE='23514'; END IF;
  IF requested_producer_kind NOT IN ('domain_store','migration_bridge') THEN RAISE EXCEPTION 'invalid specialized request producer kind' USING ERRCODE='23514'; END IF;
  IF request_kind='dependency_recompute_request' THEN SELECT priority INTO priority_value FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,target_resource_id uuid,invalidation_event_id uuid,required_upstream_versions jsonb,priority integer,status text,reason text,strategy_key text,task_contract_version_id uuid,idempotency_key text,created_at timestamptz,started_at timestamptz,completed_at timestamptz) WHERE record_type.type_key='dependency_recompute_request') dependency_recompute_requests WHERE id=request_id;
  ELSIF request_kind='ai_task' THEN SELECT priority INTO priority_value FROM ai_tasks WHERE id=request_id;
  END IF;
  payload_value:=jsonb_build_object('specializedRequestKind',request_kind,'specializedRequestId',request_id,'bookId',request_book_id);
  SELECT id,aggregate_sequence,ordering_key INTO event_id,sequence_value,ordering_value FROM outbox_events WHERE topic=handler.topic AND producer_idempotency_key='request:'||request_kind||':'||request_id::text;
  IF event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbox_events WHERE id=event_id AND space_id IS NOT DISTINCT FROM request_space_id AND book_id IS NOT DISTINCT FROM request_book_id AND payload=payload_value AND event_version=handler.event_version) THEN RAISE EXCEPTION 'background request idempotency scope conflict' USING ERRCODE='23514'; END IF;
  IF event_id IS NULL THEN
    ordering_value:=COALESCE('book:'||request_book_id::text||':handler:'||handler.handler_key,'space:'||request_space_id::text||':handler:'||handler.handler_key);
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


--
-- Name: guard_ai_attempt_update(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_ai_attempt_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
DECLARE debug_task boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AI attempts cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('succeeded','failed','cancelled','discarded') THEN RAISE EXCEPTION 'finished AI attempt is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','provider_request_digest','result_kind','result_stable_id','result_version_id','result_hash','error_category','retry_eligibility','error_summary','started_at','ended_at','debug_result','debug_execution','debug_failure']::text[]) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','provider_request_digest','result_kind','result_stable_id','result_version_id','result_hash','error_category','retry_eligibility','error_summary','started_at','ended_at','debug_result','debug_execution','debug_failure']::text[]) THEN
    RAISE EXCEPTION 'AI attempt frozen inputs are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','cancelled')) OR (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled','discarded'))) THEN
    RAISE EXCEPTION 'illegal AI attempt status transition' USING ERRCODE='23514';
  END IF;
  SELECT source_kind='prompt_composition_debug' INTO debug_task FROM new_design.ai_tasks WHERE id=OLD.task_id;
  IF debug_task IS true AND NEW.status IN ('succeeded','failed','cancelled','discarded') THEN
    IF (NEW.status='succeeded' AND (NEW.debug_result IS NULL OR NEW.debug_execution IS NULL OR NEW.debug_failure IS NOT NULL)) OR
       (NEW.status IN ('failed','cancelled','discarded') AND (NEW.debug_failure IS NULL OR NEW.debug_result IS NOT NULL)) THEN
      RAISE EXCEPTION 'debug terminal outcome is incomplete' USING ERRCODE='23514';
    END IF;
  END IF;
  IF ROW(NEW.debug_result,NEW.debug_execution,NEW.debug_failure) IS DISTINCT FROM ROW(OLD.debug_result,OLD.debug_execution,OLD.debug_failure) THEN
    IF debug_task IS DISTINCT FROM true OR OLD.status<>'running' OR NEW.status NOT IN ('succeeded','failed','cancelled','discarded') OR OLD.debug_result IS NOT NULL OR OLD.debug_execution IS NOT NULL OR OLD.debug_failure IS NOT NULL THEN
      RAISE EXCEPTION 'debug payload can only be frozen once when a debug attempt terminates' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_ai_contract_immutable(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_ai_contract_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'contract history is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME IN ('prompt_recipe_versions','task_contract_versions','model_route_versions') THEN
    IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'published contract content is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status='rejected' AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'rejected version is final' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'snapshot detail is immutable' USING ERRCODE='23514';
END $$;


--
-- Name: guard_ai_ledger_append_only(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_ai_ledger_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$ BEGIN RAISE EXCEPTION 'AI ledger rows are append-only' USING ERRCODE='23514'; END $$;


--
-- Name: guard_ai_step_transition(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_ai_step_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
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


--
-- Name: guard_ai_task_transition(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_ai_task_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
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


--
-- Name: guard_asset_content_object(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_asset_content_object() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF (to_jsonb(NEW)-ARRAY['integrity_state','last_verified_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['integrity_state','last_verified_at']::text[]) THEN
    RAISE EXCEPTION 'asset content identity and locator are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_asset_mount_append_only(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_asset_mount_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'asset mounts are append-only' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'active' OR NEW.status<>'ended' OR NEW.ended_at IS NULL OR
     (to_jsonb(NEW)-ARRAY['status','ended_at','end_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','ended_at','end_reason']::text[]) THEN
    RAISE EXCEPTION 'asset mount may only transition from active to ended' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_background_attempt_update(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_background_attempt_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('succeeded','failed','cancelled','released','lease_expired','rejected_stale') THEN RAISE EXCEPTION 'finished job attempt is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','started_at','heartbeat_at','ended_at','error_kind','error_code','error_summary','retryable']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','started_at','heartbeat_at','ended_at','error_kind','error_code','error_summary','retryable']::text[]) THEN RAISE EXCEPTION 'job attempt lease identity is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='leased' AND NEW.status IN ('running','cancelled','released','lease_expired')) OR (OLD.status='running' AND NEW.status IN ('running','succeeded','failed','cancelled','released','lease_expired','rejected_stale'))) THEN RAISE EXCEPTION 'illegal job attempt transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_background_job_transition(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_background_job_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'background job history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','attempt_count','next_run_at','lease_owner','lease_until','heartbeat_at','lease_token_digest','fencing_token','current_attempt_id','checkpoint_key','last_error_kind','last_error_code','last_error_summary','result_idempotency_key','revision','updated_at','completed_at','archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','next_run_at','lease_owner','lease_until','heartbeat_at','lease_token_digest','fencing_token','current_attempt_id','checkpoint_key','last_error_kind','last_error_code','last_error_summary','result_idempotency_key','revision','updated_at','completed_at','archived_at']::text[]) THEN RAISE EXCEPTION 'background job frozen identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'background job revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('leased','cancelled','dead_letter')) OR (OLD.status='leased' AND NEW.status IN ('running','queued','retry_scheduled','cancel_requested','cancelled','dead_letter')) OR (OLD.status='running' AND NEW.status IN ('running','queued','succeeded','failed','retry_scheduled','cancel_requested','cancelled','dead_letter')) OR (OLD.status='retry_scheduled' AND NEW.status IN ('leased','cancelled','dead_letter')) OR (OLD.status='cancel_requested' AND NEW.status='cancelled') OR (OLD.status='failed' AND NEW.status IN ('queued','archived')) OR (OLD.status IN ('succeeded','cancelled','dead_letter') AND NEW.status='archived')) THEN RAISE EXCEPTION 'illegal background job status transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_chapter_body_version_content(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_chapter_body_version_content() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['archived_at']::text[]) THEN
    RAISE EXCEPTION 'chapter body version content and provenance are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL THEN
    RAISE EXCEPTION 'chapter body version archive is one way' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_chapter_settlement_ai_payload(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_chapter_settlement_ai_payload() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE kind text; previous jsonb;
BEGIN
 -- Includes the governed new_design.character.resource_backfill asset and its exact resource scope.
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter extraction receipts cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT type.type_key,version.values INTO kind,previous FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id
  LEFT JOIN new_design.card_versions version ON version.id=card.current_version_id
  WHERE card.id=NEW.card_id;
 IF kind='chapter_proposal_extraction_request' THEN PERFORM new_design.assert_chapter_settlement_ai_payload(previous,NEW.values); END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_consumer_update(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_consumer_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'consumer registration cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','revision','pause_reason','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','pause_reason','updated_at']::text[]) THEN RAISE EXCEPTION 'consumer registration is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'consumer revision must advance by one' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_dependency_edge(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_dependency_edge() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE source_row record; derived_row record;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dependency edges are append-only' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'active' OR NEW.status<>'ended' OR NEW.ended_at IS NULL OR
       (to_jsonb(NEW)-ARRAY['status','ended_at','end_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','ended_at','end_reason']::text[]) THEN
      RAISE EXCEPTION 'dependency edge may only transition from active to ended' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dependency-edges:'||NEW.book_id::text,0));
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


--
-- Name: guard_dependency_resource_immutable(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_dependency_resource_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN RAISE EXCEPTION 'dependency resource registry is immutable' USING ERRCODE='23514'; END $$;


--
-- Name: guard_embedding_chunk(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_embedding_chunk() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','stale_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stale_at']::text[]) THEN RAISE EXCEPTION 'embedding chunk content and anchor are immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'current' OR NEW.status NOT IN ('stale','archived') OR NEW.stale_at IS NULL THEN RAISE EXCEPTION 'invalid embedding chunk lifecycle transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_native_context_delete(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_native_context_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM card_types WHERE id=OLD.card_type_id AND type_key IN ('context_binding','context_binding_version','context_binding_selector','context_binding_adoption','context_preview','context_preview_binding_version','context_preview_decision','context_management_event','context_manifest_slot','context_manifest_exclusion','context_manifest_retrieval_trace','ai_run_preview','ai_run_prompt_section','ai_run_submission')) THEN RAISE EXCEPTION 'context history cannot be deleted' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;


--
-- Name: guard_native_context_record(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_native_context_record() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $_$
DECLARE kind text; payload jsonb; previous jsonb; binding jsonb; version_value jsonb; preview jsonb; manifest record;
 stats record; field_name text; fields text[]; identity jsonb; owner_book uuid; owner_space uuid; source_type text; item jsonb; target_id uuid;
BEGIN
 SELECT type_key INTO kind FROM card_types WHERE id=NEW.card_type_id;
 IF kind NOT IN ('context_binding','context_binding_version','context_binding_selector','context_binding_adoption','context_preview',
  'context_preview_binding_version','context_preview_decision','context_management_event','context_manifest_slot','context_manifest_exclusion','context_manifest_retrieval_trace',
  'ai_run_preview','ai_run_prompt_section','ai_run_submission') OR NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 SELECT values INTO payload FROM card_versions WHERE id=NEW.current_version_id AND card_id=NEW.id;
 IF payload IS NULL THEN RAISE EXCEPTION 'context head missing' USING ERRCODE='23514'; END IF;
 IF OLD.current_version_id IS NOT NULL THEN
  SELECT values INTO previous FROM card_versions WHERE id=OLD.current_version_id;
  IF kind NOT IN ('context_binding','context_preview','ai_run_preview') THEN RAISE EXCEPTION 'context evidence % is immutable',kind USING ERRCODE='23514'; END IF;
  IF kind='context_preview' AND NOT COALESCE(previous->>'status' IN ('complete','invalid') AND payload->>'status'='stale'
   AND payload->>'stale_at' IS NOT NULL AND (payload-ARRAY['status','stale_at','stale_reason','revision','updated_at'])=(previous-ARRAY['status','stale_at','stale_reason','revision','updated_at']),false)
   THEN RAISE EXCEPTION 'context preview may only become stale' USING ERRCODE='23514'; END IF;
  IF kind='ai_run_preview' AND NOT COALESCE((payload-ARRAY['status','revision','updated_at'])=(previous-ARRAY['status','revision','updated_at'])
   AND (payload->>'revision')::integer=(previous->>'revision')::integer+1
   AND ((previous->>'status'='ready' AND payload->>'status' IN ('stale','submitted')) OR (previous->>'status'='blocked' AND payload->>'status'='stale')),false)
   THEN RAISE EXCEPTION 'AI run frozen preview or transition mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 fields:=CASE kind
  WHEN 'context_binding' THEN ARRAY['scope_kind','scope_ref','book_id','binding_key'] WHEN 'context_binding_version' THEN ARRAY['binding_id','version']
  WHEN 'context_binding_selector' THEN ARRAY['binding_version_id','sort_order'] WHEN 'context_binding_adoption' THEN ARRAY['binding_id','idempotency_key']
  WHEN 'context_preview_binding_version' THEN ARRAY['preview_id','binding_version_id'] WHEN 'context_preview_decision' THEN ARRAY['preview_id','sort_order']
  WHEN 'context_management_event' THEN ARRAY['idempotency_key'] WHEN 'context_manifest_slot' THEN ARRAY['manifest_id','slot_key']
  WHEN 'context_manifest_exclusion' THEN ARRAY['slot_id','sort_order'] WHEN 'context_manifest_retrieval_trace' THEN ARRAY['manifest_id','retrieval_run_id']
  WHEN 'ai_run_preview' THEN ARRAY['space_id','idempotency_key'] WHEN 'ai_run_prompt_section' THEN ARRAY['preview_id','sort_order']
  WHEN 'ai_run_submission' THEN ARRAY['preview_id'] END;
 IF fields IS NOT NULL THEN
  identity:='{}'::jsonb; FOREACH field_name IN ARRAY fields LOOP identity:=identity||jsonb_build_object(field_name,payload->field_name); END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('context-identity:'||kind||':'||identity::text,0));
  IF EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE c.id<>NEW.id AND t.type_key=kind AND v.values @> identity) THEN RAISE EXCEPTION 'duplicate context identity %',kind USING ERRCODE='23505'; END IF;
 END IF;
 IF kind='context_binding' THEN
  owner_book:=(payload->>'book_id')::uuid; owner_space:=(payload->>'space_id')::uuid;
  IF NOT COALESCE(payload->>'scope_kind' IN ('system','public','task_group','task_node','book','volume','chapter','scene','one_time')
   AND payload->>'binding_key' ~ '^[a-z][a-z0-9_.-]{1,99}$' AND length(btrim(payload->>'name')) BETWEEN 1 AND 160
   AND payload->>'status' IN ('active','archived') AND (payload->>'revision')::integer>0
   AND ((payload->>'scope_kind' IN ('system','public','task_group','task_node') AND owner_book IS NULL) OR (payload->>'scope_kind' IN ('book','volume','chapter','scene','one_time') AND owner_book IS NOT NULL))
   AND ((payload->>'scope_kind' IN ('system','task_group','task_node') AND owner_space IS NULL) OR (payload->>'scope_kind' IN ('public','book','volume','chapter','scene','one_time') AND owner_space IS NOT NULL))
   AND ((payload->>'scope_kind' IN ('system','public','book') AND payload->>'scope_ref' IS NULL) OR (payload->>'scope_kind' NOT IN ('system','public','book') AND length(btrim(payload->>'scope_ref'))>0)),false) THEN RAISE EXCEPTION 'context binding scope shape mismatch' USING ERRCODE='23514'; END IF;
  IF owner_book IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=owner_book AND space_id=owner_space) THEN RAISE EXCEPTION 'context binding book/space mismatch' USING ERRCODE='23514'; END IF;
  IF payload->>'scope_kind'='public' AND (NOT EXISTS(SELECT 1 FROM card_spaces WHERE id=owner_space) OR EXISTS(SELECT 1 FROM books WHERE space_id=owner_space)) THEN RAISE EXCEPTION 'public binding must use a public space' USING ERRCODE='23514'; END IF;
  IF payload->>'scope_kind' IN ('volume','chapter','scene') AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id WHERE c.id=(payload->>'scope_ref')::uuid AND c.space_id=owner_space AND t.type_key=payload->>'scope_kind' AND NOT t.is_internal) THEN RAISE EXCEPTION 'context binding local scope mismatch' USING ERRCODE='23514'; END IF;
  FOREACH field_name IN ARRAY ARRAY['current_version_id','adopted_version_id'] LOOP
   IF payload->>field_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>field_name AND v.values->>'binding_id'=payload->>'id') THEN RAISE EXCEPTION 'context binding head/version mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF previous IS NOT NULL THEN
   IF (payload-ARRAY['name','description','status','revision','current_version_id','adopted_version_id','updated_by','updated_at']) IS DISTINCT FROM (previous-ARRAY['name','description','status','revision','current_version_id','adopted_version_id','updated_by','updated_at'])
    OR previous->>'status'='archived'
    OR NOT ((payload->>'revision')::integer=(previous->>'revision')::integer+1 OR
     (previous->>'current_version_id' IS NULL AND previous->>'adopted_version_id' IS NULL AND payload->>'revision'=previous->>'revision'))
    THEN RAISE EXCEPTION 'context binding identity/revision is immutable' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF kind='context_binding_version' THEN
  SELECT v.values INTO binding FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding' AND v.values->>'id'=payload->>'binding_id';
  SELECT * INTO stats FROM context_activation_rule_stats(payload->'activation_rule');
  IF binding IS NULL OR NOT COALESCE(stats.is_valid AND stats.max_depth<=4 AND stats.condition_count<=40
   AND (payload->>'version')::integer>0 AND payload->>'inheritance_mode' IN ('inherit','override','exclude')
   AND payload->>'slot_key' ~ '^[a-z][a-z0-9_.-]{1,99}$' AND (payload->>'priority')::integer BETWEEN -10000 AND 10000
   AND payload->>'content_role' IN ('required','reference') AND (payload->>'token_budget')::integer BETWEEN 0 AND 1000000
   AND payload->>'trim_strategy' IN ('none','lowest_priority','largest_first') AND payload->>'dedupe_strategy' IN ('exact_version','stable_source')
   AND payload->>'status' IN ('draft','adopted','superseded','archived') AND payload->>'content_hash' ~ '^[a-f0-9]{64}$'
   AND (payload->>'content_role'='reference' OR payload->>'trim_strategy'='none'),false) THEN RAISE EXCEPTION 'invalid context binding version or activation rule' USING ERRCODE='23514'; END IF;
  IF payload->>'base_version_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>'base_version_id' AND v.values->>'binding_id'=payload->>'binding_id' AND v.values->>'id'<>payload->>'id') THEN RAISE EXCEPTION 'context version base belongs to another binding' USING ERRCODE='23514'; END IF;
 ELSIF kind='context_binding_selector' THEN
  PERFORM validate_context_selector_config(payload);
  SELECT v.values INTO version_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>'binding_version_id';
  SELECT v.values INTO binding FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding' AND v.values->>'id'=version_value->>'binding_id';
  IF binding IS NULL OR NOT COALESCE((payload->>'sort_order')::integer>=0,false) THEN RAISE EXCEPTION 'selector owner/order unavailable' USING ERRCODE='23514'; END IF;
  IF payload->>'selector_kind' IN ('explicit_source','prompt_component') THEN PERFORM validate_context_exact_source(payload->>'source_type',(payload->>'stable_object_id')::uuid,(payload->>'exact_version_id')::uuid,(binding->>'book_id')::uuid); END IF;
  IF payload->'selector_config' ? 'limit' AND NOT COALESCE(jsonb_typeof(payload->'selector_config'->'limit')='number' AND (payload->'selector_config'->>'limit')::integer BETWEEN 1 AND 500,false) THEN RAISE EXCEPTION 'selector limit out of range' USING ERRCODE='23514'; END IF;
  IF payload->>'selector_kind'='retrieval_trace' AND NOT EXISTS(SELECT 1 FROM retrieval_runs WHERE id=(payload->'selector_config'->>'retrievalRunId')::uuid AND book_id=(binding->>'book_id')::uuid AND status='succeeded') THEN RAISE EXCEPTION 'retrieval selector requires genuine same-book result' USING ERRCODE='23514'; END IF;
  IF payload->>'selector_kind'='relation' AND NOT EXISTS(SELECT 1 FROM relation_types WHERE id=(payload->'selector_config'->>'relationTypeId')::uuid AND (owner_space_id IS NULL OR owner_space_id=(binding->>'space_id')::uuid)) THEN RAISE EXCEPTION 'relation selector scope mismatch' USING ERRCODE='23514'; END IF;
  IF payload->>'selector_kind'='story_range' AND NOT COALESCE(jsonb_typeof(payload->'selector_config'->'start')='number' AND jsonb_typeof(payload->'selector_config'->'end')='number' AND (payload->'selector_config'->>'start')::numeric<=(payload->'selector_config'->>'end')::numeric,false) THEN RAISE EXCEPTION 'story range selector bounds mismatch' USING ERRCODE='23514'; END IF;
 ELSIF kind='context_binding_adoption' THEN
  SELECT v.values INTO binding FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding' AND v.values->>'id'=payload->>'binding_id';
  IF binding IS NULL OR NOT COALESCE(payload->>'action' IN ('adopt','readopt','rollback','archive')
   AND (payload->>'binding_revision')::integer>0 AND (payload->>'expected_revision')::integer>0
   AND payload->>'binding_revision'=binding->>'revision'
   AND ((payload->>'action'='archive' AND payload->>'to_version_id' IS NULL AND binding->>'status'='archived')
    OR (payload->>'action'<>'archive' AND payload->>'to_version_id'=binding->>'adopted_version_id')),false) THEN RAISE EXCEPTION 'binding adoption must describe explicit original head transition' USING ERRCODE='23514'; END IF;
  FOREACH field_name IN ARRAY ARRAY['from_version_id','to_version_id'] LOOP
   IF payload->>field_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>field_name AND v.values->>'binding_id'=payload->>'binding_id') THEN RAISE EXCEPTION 'binding adoption exact version mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSIF kind='context_preview' THEN
  IF NOT EXISTS(SELECT 1 FROM books b JOIN task_contract_versions contract ON contract.id=(payload->>'task_contract_version_id')::uuid
   JOIN prompt_recipe_versions recipe ON recipe.id=contract.prompt_recipe_version_id
   WHERE b.id=(payload->>'book_id')::uuid AND recipe.id=(payload->>'prompt_recipe_version_id')::uuid AND contract.task_group=payload->>'task_group')
   OR NOT COALESCE(payload->>'status' IN ('complete','invalid','stale','timed_out') AND (payload->>'total_budget')::integer BETWEEN 1 AND 1000000
    AND (payload->>'timeout_ms')::integer BETWEEN 100 AND 10000 AND payload->>'source_set_hash' ~ '^[a-f0-9]{64}$'
    AND ((payload->>'status'='stale')=(payload->>'stale_at' IS NOT NULL)),false) THEN RAISE EXCEPTION 'context preview contract or budget mismatch' USING ERRCODE='23514'; END IF;
 ELSIF kind IN ('context_preview_binding_version','context_preview_decision') THEN
  SELECT v.values INTO preview FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_preview' AND v.values->>'id'=payload->>'preview_id';
  IF preview IS NULL THEN RAISE EXCEPTION 'context decision preview missing' USING ERRCODE='23514'; END IF;
  IF payload->>'binding_version_id' IS NOT NULL THEN
   SELECT v.values INTO version_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding_version' AND v.values->>'id'=payload->>'binding_version_id';
   SELECT v.values INTO binding FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_binding' AND v.values->>'id'=version_value->>'binding_id';
   IF binding IS NULL OR (binding->>'book_id' IS NOT NULL AND binding->>'book_id' IS DISTINCT FROM preview->>'book_id')
    OR (kind='context_preview_binding_version' AND (payload->>'binding_id' IS DISTINCT FROM binding->>'id' OR payload->>'inheritance_mode' IS DISTINCT FROM version_value->>'inheritance_mode')) THEN RAISE EXCEPTION 'context preview binding source mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF kind='context_preview_decision' THEN
   IF NOT COALESCE(payload->>'decision' IN ('included','excluded','deduped','trimmed') AND payload->>'source_hash' ~ '^[a-f0-9]{64}$'
    AND (payload->>'source_revision')::integer>0 AND (payload->>'token_estimate')::integer>=0 AND (payload->>'sort_order')::integer>=0,false) THEN RAISE EXCEPTION 'invalid context source decision' USING ERRCODE='23514'; END IF;
   IF payload->>'decision'='included' THEN PERFORM validate_context_exact_source(payload->>'source_type',(payload->>'stable_object_id')::uuid,(payload->>'exact_version_id')::uuid,(preview->>'book_id')::uuid,payload->>'source_hash'); END IF;
   IF payload->>'retrieval_run_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM retrieval_runs r JOIN retrieval_results result ON result.run_id=r.id WHERE r.id=(payload->>'retrieval_run_id')::uuid AND r.book_id=(preview->>'book_id')::uuid AND result.rank=(payload->>'retrieval_rank')::integer AND result.source_stable_id=(payload->>'stable_object_id')::uuid AND result.source_version_id=(payload->>'exact_version_id')::uuid AND result.source_hash::text=payload->>'source_hash') THEN RAISE EXCEPTION 'context decision retrieval evidence mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF kind IN ('context_manifest_slot','context_manifest_exclusion','context_manifest_retrieval_trace') THEN
  SELECT * INTO manifest FROM context_manifests WHERE id=(payload->>'manifest_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'context child manifest missing' USING ERRCODE='23514'; END IF;
  IF kind='context_manifest_slot' AND NOT COALESCE(length(payload->>'slot_key')>0 AND (payload->>'sort_order')::integer>=0 AND jsonb_typeof(payload->'required')='boolean' AND (payload->>'token_budget' IS NULL OR (payload->>'token_budget')::integer>=0),false) THEN RAISE EXCEPTION 'context slot shape mismatch' USING ERRCODE='23514'; END IF;
  IF kind='context_manifest_exclusion' AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_manifest_slot' AND v.values->>'id'=payload->>'slot_id' AND v.values->>'manifest_id'=payload->>'manifest_id') THEN RAISE EXCEPTION 'context exclusion slot mismatch' USING ERRCODE='23514'; END IF;
  IF kind='context_manifest_retrieval_trace' AND NOT EXISTS(SELECT 1 FROM retrieval_runs r WHERE r.id=(payload->>'retrieval_run_id')::uuid AND r.book_id=manifest.book_id AND r.generation_id=(payload->>'generation_id')::uuid AND r.profile_version_id=(payload->>'profile_version_id')::uuid AND r.result_count=(payload->>'returned_source_count')::integer AND dependency_content_hash(r.query_hash||r.id::text||r.result_count::text)=payload->>'trace_hash') THEN RAISE EXCEPTION 'context retrieval trace is not exact' USING ERRCODE='23514'; END IF;
 ELSIF kind='ai_run_preview' THEN
  SELECT v.values INTO preview FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_preview' AND v.values->>'id'=payload->>'context_preview_id';
  IF preview IS NULL OR NOT EXISTS(SELECT 1 FROM books b JOIN context_manifests m ON m.book_id=b.id JOIN model_route_snapshots r ON r.id=m.model_route_snapshot_id
   WHERE b.id=(payload->>'book_id')::uuid AND b.space_id=(payload->>'space_id')::uuid AND m.id=(payload->>'context_manifest_id')::uuid
   AND r.id=(payload->>'model_route_snapshot_id')::uuid AND m.task_contract_version_id=(payload->>'task_contract_version_id')::uuid
   AND m.prompt_recipe_version_id=(payload->>'prompt_recipe_version_id')::uuid AND preview->>'book_id'=b.id::text
   AND preview->>'task_contract_version_id'=payload->>'task_contract_version_id' AND preview->>'prompt_recipe_version_id'=payload->>'prompt_recipe_version_id')
   THEN RAISE EXCEPTION 'run preview frozen context/model mismatch' USING ERRCODE='23514'; END IF;
 ELSIF kind IN ('ai_run_prompt_section','ai_run_submission') THEN
  SELECT v.values INTO preview FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='ai_run_preview' AND v.values->>'id'=payload->>'preview_id';
  IF preview IS NULL THEN RAISE EXCEPTION 'run evidence preview missing' USING ERRCODE='23514'; END IF;
  IF kind='ai_run_prompt_section' AND NOT COALESCE(payload->>'section_kind' IN ('instruction','formal_data','reference','output_contract') AND jsonb_typeof(payload->'source_refs')='array' AND payload->>'content_hash' ~ '^[a-f0-9]{64}$' AND (payload->>'token_estimate')::integer>=0 AND (payload->>'sort_order')::integer>=0,false) THEN RAISE EXCEPTION 'run section shape mismatch' USING ERRCODE='23514'; END IF;
  IF kind='ai_run_prompt_section' THEN
   FOR item IN SELECT * FROM jsonb_array_elements(payload->'source_refs') LOOP
    IF item->>'kind'='output_contract' THEN
     IF NOT EXISTS(SELECT 1 FROM task_contract_versions WHERE id=(preview->>'task_contract_version_id')::uuid AND output_schema_version=item->>'version' AND output_schema=item->'schema') THEN RAISE EXCEPTION 'run output contract section mismatch' USING ERRCODE='23514'; END IF;
    ELSIF item->>'kind'='prompt_component' AND item ? 'cardId' THEN
     IF NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
      WHERE t.type_key='prompt_recipe_slot_component' AND v.values->>'recipe_version_id'=preview->>'prompt_recipe_version_id'
      AND v.values->>'component_card_id'=item->>'cardId' AND v.values->>'component_version_id'=item->>'versionId') THEN RAISE EXCEPTION 'run prompt section exact component missing' USING ERRCODE='23514'; END IF;
    ELSE
     IF NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
      WHERE t.type_key='context_preview_decision' AND v.values->>'preview_id'=preview->>'context_preview_id' AND v.values->>'decision'='included'
       AND v.values->>'source_type'=item->>'kind' AND v.values->>'stable_object_id'=item->>'stableObjectId'
       AND v.values->>'exact_version_id'=item->>'exactVersionId' AND v.values->>'slot_key'=payload->>'slot_key')
      THEN RAISE EXCEPTION 'run data section differs from original context decision' USING ERRCODE='23514'; END IF;
    END IF;
   END LOOP;
  END IF;
  IF kind='ai_run_submission' THEN
   IF NOT EXISTS(SELECT 1 FROM ai_tasks task WHERE task.id=(payload->>'ai_task_id')::uuid AND task.book_id=(preview->>'book_id')::uuid AND task.space_id=(preview->>'space_id')::uuid AND task.task_contract_version_id=(preview->>'task_contract_version_id')::uuid)
    OR NOT COALESCE((payload->>'submitted_revision')::integer>0,false) THEN RAISE EXCEPTION 'run submission exact task mismatch' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE c.id<>NEW.id AND t.type_key=kind AND (v.values->>'ai_task_id'=payload->>'ai_task_id' OR v.values->>'idempotency_key'=payload->>'idempotency_key')) THEN RAISE EXCEPTION 'run submission identity reused' USING ERRCODE='23505'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $_$;


--
-- Name: guard_native_embedding_vector(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_native_embedding_vector() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR OLD.status<>'eligible' OR NEW.status NOT IN ('stale','archived') THEN RAISE EXCEPTION 'stored vector identity and response are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_native_professional_action(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_native_professional_action() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $_$
DECLARE receipt_row record; resource_kind text; resource_id jsonb;
BEGIN
 IF NEW.action_key<>'professional.resource.command' THEN RETURN NEW; END IF;
 SELECT * INTO receipt_row FROM jsonb_to_record(NEW.payload) fields(request_key text,input_hash text,operation text,resource_card_id uuid,resource_version_id uuid,book_id uuid,preview_id uuid,issue_id uuid,preference boolean,feedback_effect text,feedback_note text);
 IF NOT COALESCE(length(receipt_row.request_key) BETWEEN 8 AND 160 AND receipt_row.input_hash ~ '^[a-f0-9]{64}$'
  AND receipt_row.operation IN ('create','edit','archive','favorite','adopt_title','install','rule_settings','feedback')
  AND NEW.request_key='professional-resource:'||receipt_row.request_key AND NEW.input_hash=receipt_row.input_hash
  AND NEW.receipt->>'requestKey'=receipt_row.request_key AND NEW.receipt->>'operation'=receipt_row.operation
  AND jsonb_typeof(NEW.receipt->'resourceIds')='array',false) THEN RAISE EXCEPTION 'professional action receipt identity mismatch' USING ERRCODE='23514'; END IF;
 IF receipt_row.resource_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_versions WHERE id=receipt_row.resource_version_id AND card_id=receipt_row.resource_card_id) THEN RAISE EXCEPTION 'professional exact resource version mismatch' USING ERRCODE='23514'; END IF;
 IF receipt_row.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=receipt_row.book_id) THEN RAISE EXCEPTION 'professional target book missing' USING ERRCODE='23514'; END IF;
 FOR resource_id IN SELECT * FROM jsonb_array_elements(NEW.receipt->'resourceIds') LOOP
  SELECT t.type_key INTO resource_kind FROM cards c JOIN card_types t ON t.id=c.card_type_id WHERE c.id=(resource_id#>>'{}')::uuid AND c.space_id='60000000-0000-4000-8000-000000000001' AND NOT t.is_internal;
  IF resource_kind IS NULL OR resource_kind NOT IN ('title_candidate','writing_config','quality_rule','genre_strategy','progression_mode','character') THEN RAISE EXCEPTION 'professional original public resource missing' USING ERRCODE='23514'; END IF;
  IF resource_kind='character' AND (receipt_row.operation NOT IN ('create','edit','archive','favorite') OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_character_profile_v1' AND installed AND operational)) THEN RAISE EXCEPTION 'public character profile command unavailable' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NOT (NEW.receipt->'resourceIds' @> jsonb_build_array(NEW.card_id::text)) OR (receipt_row.resource_card_id IS NOT NULL AND NOT NEW.receipt->'resourceIds' @> jsonb_build_array(receipt_row.resource_card_id::text)) THEN RAISE EXCEPTION 'professional action owner/source mismatch' USING ERRCODE='23514'; END IF;
 IF receipt_row.operation='favorite' AND (receipt_row.resource_card_id IS NULL OR receipt_row.preference IS NULL) THEN RAISE EXCEPTION 'favorite requires explicit preference' USING ERRCODE='23514'; END IF;
 IF receipt_row.operation='feedback' THEN
  IF receipt_row.resource_card_id IS NULL OR receipt_row.resource_version_id IS NULL OR (receipt_row.preview_id IS NULL)=(receipt_row.issue_id IS NULL)
   OR NOT COALESCE(receipt_row.feedback_effect IN ('helpful','neutral','harmful') AND length(receipt_row.feedback_note) BETWEEN 1 AND 2000,false) THEN RAISE EXCEPTION 'feedback requires exact source and one genuine outcome' USING ERRCODE='23514'; END IF;
  IF receipt_row.issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='quality_issue' AND v.values->>'id'=receipt_row.issue_id::text) THEN RAISE EXCEPTION 'feedback issue missing' USING ERRCODE='23514'; END IF;
  IF receipt_row.preview_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   JOIN cards sc ON true JOIN card_types st ON st.id=sc.card_type_id JOIN card_versions sv ON sv.id=sc.current_version_id
   JOIN ai_tasks task ON task.id=(sv.values->>'ai_task_id')::uuid JOIN ai_task_steps step ON step.task_id=task.id AND step.step_key='execute_prompt_composition_debug'
   JOIN ai_task_attempts attempt ON attempt.id=step.current_attempt_id AND attempt.status='succeeded' AND attempt.debug_result IS NOT NULL
   WHERE t.type_key='ai_run_preview' AND v.values->>'id'=receipt_row.preview_id::text AND v.values->>'source_kind'='prompt_composition_debug'
    AND st.type_key='ai_run_submission' AND sv.values->>'preview_id'=v.values->>'id')
   THEN RAISE EXCEPTION 'feedback requires saved original successful debug result' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $_$;


--
-- Name: guard_native_record_history(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_native_record_history() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $_$
DECLARE kind text; payload jsonb; old_payload jsonb; key_fields text[]; identity jsonb; other_card uuid; field_name text; part jsonb;
BEGIN
 SELECT type_key INTO kind FROM card_types WHERE id=NEW.card_type_id;
 IF NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 SELECT values INTO payload FROM card_versions WHERE id=NEW.current_version_id AND card_id=NEW.id;
 IF payload IS NULL THEN RAISE EXCEPTION 'domain record head missing' USING ERRCODE='23514'; END IF;
 IF OLD.current_version_id IS NOT NULL THEN
  SELECT values INTO old_payload FROM card_versions WHERE id=OLD.current_version_id;
  IF kind IN ('asset_adoption','asset_derivation_result','asset_derivation_event','asset_content_integrity_check',
   'dependency_invalidation_event','dependency_invalidation_impact','dependency_recompute_receipt','dependency_stale_acceptance',
   'embedding_profile_version','embedding_result','chunking_result','background_job_replay',
   'transfer_export_profile','transfer_compatibility_snapshot','transfer_checkpoint','transfer_import_source','transfer_restore_drill',
   'book_completion_snapshot','book_completion_check_result','book_completion_snapshot_chapter','book_lifecycle_event',
   'publication_export_manifest_chapter','book_content_history_snapshot','book_content_history_restore') THEN
   RAISE EXCEPTION 'domain record % is append-only',kind USING ERRCODE='23514';
  END IF;
  IF kind='publication_export_request' AND (old_payload->>'job_id' IS NOT NULL OR (payload-ARRAY['job_id','revision','updated_at']) IS DISTINCT FROM (old_payload-ARRAY['job_id','revision','updated_at'])) THEN RAISE EXCEPTION 'publication request only permits initial job linkage' USING ERRCODE='23514'; END IF;
 END IF;
 key_fields:=CASE kind
  WHEN 'dependency_resource_state' THEN ARRAY['resource_id'] WHEN 'dependency_invalidation_event' THEN ARRAY['book_id','idempotency_key']
  WHEN 'dependency_recompute_request' THEN ARRAY['book_id','idempotency_key'] WHEN 'graph_projection_book_state' THEN ARRAY['book_id']
  WHEN 'graph_projection_request' THEN ARRAY['book_id','idempotency_key'] WHEN 'graph_projection_source_mapping' THEN ARRAY['generation_id','graph_element_key']
  WHEN 'embedding_index_state' THEN ARRAY['book_id','profile_id'] WHEN 'embedding_request' THEN ARRAY['book_id','idempotency_key']
  WHEN 'chunking_request' THEN ARRAY['book_id','idempotency_key'] WHEN 'embedding_attempt' THEN ARRAY['request_id','attempt_number']
  WHEN 'background_job_handler' THEN ARRAY['handler_key'] WHEN 'background_job_archive_policy' THEN ARRAY['singleton']
  WHEN 'background_job_book_pause' THEN ARRAY['book_id'] WHEN 'background_job_replay' THEN ARRAY['idempotency_key']
  WHEN 'transfer_artifact' THEN ARRAY['operation_id','normalized_case_locator'] WHEN 'transfer_step' THEN ARRAY['operation_id','step_key']
  WHEN 'transfer_staging_scope' THEN ARRAY['operation_id'] WHEN 'transfer_import_source' THEN ARRAY['operation_id']
  WHEN 'transfer_restore_drill' THEN ARRAY['drill_operation_id'] WHEN 'publication_export_request' THEN ARRAY['book_id','idempotency_key']
  WHEN 'book_content_history_snapshot' THEN ARRAY['book_id','request_key'] WHEN 'book_content_history_restore' THEN ARRAY['book_id','request_key']
  WHEN 'public_title_factory_trial' THEN ARRAY['request_key'] WHEN 'public_character_trial' THEN ARRAY['request_key']
  WHEN 'creative_extraction_preview' THEN ARRAY['book_id','request_key'] END;
 IF key_fields IS NOT NULL THEN
  identity:='{}'::jsonb;
  FOREACH field_name IN ARRAY key_fields LOOP
   IF NOT payload ? field_name OR payload->field_name='null'::jsonb THEN RAISE EXCEPTION 'domain record missing identity field %',field_name USING ERRCODE='23514'; END IF;
   identity:=identity||jsonb_build_object(field_name,payload->field_name);
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('domain-identity:'||kind||':'||identity::text,0));
  SELECT c.id INTO other_card FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE t.type_key=kind AND c.id<>NEW.id AND v.values @> identity LIMIT 1;
  IF other_card IS NOT NULL THEN RAISE EXCEPTION 'duplicate domain record identity: %',kind USING ERRCODE='23505'; END IF;
 END IF;
 IF kind='creative_extraction_preview' THEN
  FOREACH field_name IN ARRAY ARRAY['original_input','input_payload','frozen_plan','run_input','output_payload'] LOOP
   IF payload->field_name IS NOT NULL AND payload->field_name<>'null'::jsonb THEN
    IF payload->field_name->>'kind' IS DISTINCT FROM 'managed_json_v1' OR payload->field_name->>'checksum' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(payload->field_name->'parts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'creative frozen content requires managed reference' USING ERRCODE='23514'; END IF;
    FOR part IN SELECT * FROM jsonb_array_elements(payload->field_name->'parts') LOOP
     IF NOT EXISTS(SELECT 1 FROM asset_content_objects a WHERE a.id=(part->>'contentObjectId')::uuid AND a.checksum::text=part->>'checksum' AND a.byte_size=(part->>'byteSize')::bigint AND a.storage_kind='managed_file' AND a.storage_provider='local' AND a.mime_type='application/json') THEN RAISE EXCEPTION 'creative frozen content reference mismatch' USING ERRCODE='23514'; END IF;
    END LOOP;
   END IF;
  END LOOP;
  IF old_payload IS NOT NULL THEN
   IF (payload-ARRAY['status','run_key','run_hash','run_input','task_id','step_id','attempt_id','output_payload','execution','failure','revision','updated_at']) IS DISTINCT FROM (old_payload-ARRAY['status','run_key','run_hash','run_input','task_id','step_id','attempt_id','output_payload','execution','failure','revision','updated_at'])
    OR (old_payload->>'run_key' IS NOT NULL AND (payload->'run_key',payload->'run_hash',payload->'run_input',payload->'task_id',payload->'step_id',payload->'attempt_id') IS DISTINCT FROM (old_payload->'run_key',old_payload->'run_hash',old_payload->'run_input',old_payload->'task_id',old_payload->'step_id',old_payload->'attempt_id'))
    OR (old_payload->'output_payload' IS NOT NULL AND old_payload->'output_payload'<>'null'::jsonb AND (payload->'output_payload',payload->'execution') IS DISTINCT FROM (old_payload->'output_payload',old_payload->'execution'))
    OR old_payload->>'status' IN ('succeeded','failed','blocked') THEN RAISE EXCEPTION 'creative freeze, original reply or terminal state immutable' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $_$;


--
-- Name: guard_outbox_aggregate_sequence(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_outbox_aggregate_sequence() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'outbox aggregate sequence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['last_sequence','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['last_sequence','updated_at']::text[]) OR NEW.last_sequence<=OLD.last_sequence THEN RAISE EXCEPTION 'outbox aggregate sequence can only advance' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_outbox_append_only(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_outbox_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514'; END $$;


--
-- Name: guard_public_character_manifest(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_public_character_manifest() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE source_value jsonb; contract_row record; recipe_row record; source_version uuid;
BEGIN
 IF NEW.public_character_scope IS NULL THEN RETURN NEW; END IF;
 IF NEW.book_id IS NOT NULL OR NEW.public_title_scope IS NOT NULL OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_character_trial_v1' AND installed AND operational) THEN RAISE EXCEPTION 'public character manifest scope/capability unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO contract_row FROM task_contract_versions WHERE id=NEW.task_contract_version_id AND status='published';
 SELECT * INTO recipe_row FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id AND status='published';
 IF contract_row.id IS NULL OR recipe_row.id IS NULL OR recipe_row.id IS DISTINCT FROM contract_row.prompt_recipe_version_id
  OR recipe_row.variables_schema->'const' IS DISTINCT FROM contract_row.input_schema->'const'
  OR recipe_row.variables_schema->'x-public-character'->>'contract' IS DISTINCT FROM 'public_character_trial_v1'
  OR recipe_row.variables_schema->'x-public-character'->>'resourceId' IS DISTINCT FROM NEW.public_character_scope::text THEN RAISE EXCEPTION 'public character exact contract mismatch' USING ERRCODE='23514'; END IF;
 IF contract_row.task_group NOT IN ('character_dialogue','image_generation') THEN
  IF contract_row.task_group IS DISTINCT FROM 'form_assist'
   OR recipe_row.variables_schema->'x-image-preparation'->>'contract' IS DISTINCT FROM 'image_prompt_preparation_v1'
   OR contract_row.budget_policy->>'assetId' IS DISTINCT FROM 'new_design.image.prompt_preparation'
   OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='image_prompt_preparation_v1' AND installed AND operational)
   THEN RAISE EXCEPTION 'public character contract task group unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 source_value:=CASE WHEN contract_row.task_group='form_assist' THEN recipe_row.variables_schema->'const'->'source'->'data'->'profile'
  ELSE COALESCE(recipe_row.variables_schema->'const'->'source',recipe_row.variables_schema->'const'->'portraitSource') END;
 source_version:=(source_value->>'versionId')::uuid;
 IF source_value IS NULL OR source_value->>'id' IS DISTINCT FROM NEW.public_character_scope::text OR NOT EXISTS(
  SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN card_versions version ON version.card_id=card.id
  WHERE card.id=NEW.public_character_scope AND card.space_id='60000000-0000-4000-8000-000000000001'
   AND type.type_key='character' AND NOT type.is_internal AND type.status='published' AND card.status='active' AND version.id=source_version
   AND version.type_version_id::text=source_value->>'typeVersionId' AND version.revision=(source_value->>'revision')::integer AND version.title=source_value->>'title')
 THEN RAISE EXCEPTION 'public character exact source unavailable' USING ERRCODE='23514'; END IF;
 IF NEW.source_set_hash IS DISTINCT FROM (CASE WHEN contract_row.task_group='form_assist' THEN recipe_row.variables_schema->'const'->'source'->>'hash' ELSE source_value->>'hash' END)::char(64)
 THEN RAISE EXCEPTION 'public character frozen source hash mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_public_title_manifest(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_public_title_manifest() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
 IF NEW.public_title_scope IS NULL THEN RETURN NEW; END IF;
 IF NEW.book_id IS NOT NULL OR NEW.public_character_scope IS NOT NULL OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_title_factory_v1' AND installed AND operational)
 OR NOT EXISTS(
  SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN card_versions source ON source.id=card.current_version_id AND source.card_id=card.id
  JOIN task_contract_versions contract ON contract.id=NEW.task_contract_version_id JOIN prompt_recipe_versions recipe ON recipe.id=NEW.prompt_recipe_version_id AND recipe.id=contract.prompt_recipe_version_id
  WHERE card.id=NEW.public_title_scope AND card.space_id='60000000-0000-4000-8000-000000000001' AND card.status='active' AND type.type_key='public_title_brief' AND NOT type.is_internal AND type.status='published'
  AND contract.status='published' AND recipe.status='published' AND contract.task_group='creative_extraction' AND contract.budget_policy->>'assetId'='new_design.public.title_factory' AND contract.budget_policy->>'assetVersion'='v1'
  AND contract.input_schema->'const'=recipe.variables_schema->'const' AND contract.input_schema->'const'->>'contract'='public_title_factory_v1'
  AND contract.input_schema->'const'->'source'->>'id'=card.id::text AND contract.input_schema->'const'->'source'->>'versionId'=source.id::text AND contract.input_schema->'const'->'source'->'values'=source.values
  AND NEW.source_set_hash=contract.input_schema->'const'->'source'->>'hash')
 THEN RAISE EXCEPTION 'public title requires original public source and independent exact contract' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_resource_supplement_item_scope(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_resource_supplement_item_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- ; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_guard_resource_supplement_item_scope(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_scoped_field_owner(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_scoped_field_owner() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE mount jsonb; instance jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM card_types WHERE id=NEW.card_type_id AND space_id=NEW.space_id AND NOT is_internal) THEN
  RAISE EXCEPTION '字段定义必须属于同空间的作者规格'; END IF;
 IF NEW.card_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.card_id AND space_id=NEW.space_id AND card_type_id=NEW.card_type_id) THEN
  RAISE EXCEPTION '局部字段必须属于原作者卡片'; END IF;
 IF NEW.card_mount_id IS NOT NULL THEN
  mount:=structure_record('card_mount',NEW.card_mount_id);
  instance:=structure_record('card_group_form_instance',(mount->>'form_instance_id')::uuid);
  IF mount IS NULL OR instance IS NULL OR instance->>'space_id' IS DISTINCT FROM NEW.space_id::text
   OR NOT EXISTS(SELECT 1 FROM cards WHERE id=(instance->>'primary_card_id')::uuid AND card_type_id=NEW.card_type_id AND space_id=NEW.space_id) THEN
   RAISE EXCEPTION '挂载局部字段必须属于原空间和资料规格'; END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_structure_record_history(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_structure_record_history() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE kind text; old_values jsonb;
BEGIN
 SELECT type.type_key,head.values INTO kind,old_values FROM cards card JOIN card_types type ON type.id=card.card_type_id
  LEFT JOIN card_versions head ON head.id=card.current_version_id WHERE card.id=NEW.card_id;
 IF kind=ANY(ARRAY['field_option_version','field_scope_adoption','card_version_local_value','card_mount_local_value_version',
   'dictionary_item_version','card_group_form_version','card_mount_version','material_tag_version','material_tag_dimension_version',
   'material_tag_membership_version','material_group_version','material_group_membership_version','card_type_tag_binding_version',
   'smart_view_version','template_group_version','card_tree_value_snapshot']) AND old_values IS NOT NULL
  AND old_values IS DISTINCT FROM NEW.values THEN RAISE EXCEPTION '结构版本及采用历史不可改写'; END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_structure_record_scope(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_structure_record_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE kind text; payload jsonb; owner jsonb; ancestor jsonb; version_payload jsonb;
 owning_space uuid; cursor_id uuid; seen uuid[]; own_id uuid; owner_field text; version_kind text;
BEGIN
 SELECT type.type_key,head.values,card.space_id INTO kind,payload,owning_space
 FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions head ON head.id=card.current_version_id AND head.card_id=card.id
 WHERE card.id=NEW.id AND card.current_version_id=NEW.current_version_id AND type.is_internal;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF kind NOT IN ('dictionary_item','material_tag','material_group','material_tag_membership','material_group_membership',
   'field_option_definition','card_group_form','card_group_form_instance','card_mount') THEN RETURN NEW; END IF;
 own_id:=(payload->>'id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('structure-scope:'||owning_space,0));
 IF kind IN ('dictionary_item','material_tag','material_group') THEN
  owner_field:=CASE kind WHEN 'dictionary_item' THEN 'dictionary_id' WHEN 'material_tag' THEN 'dimension_id' ELSE 'space_id' END;
  IF kind IN ('dictionary_item','material_tag') THEN
   owner:=structure_record(CASE kind WHEN 'dictionary_item' THEN 'dictionary_definition' ELSE 'material_tag_dimension' END,(payload->>owner_field)::uuid);
   IF owner IS NULL OR COALESCE((owner->>'owner_space_id')::uuid,'00000000-0000-4000-8000-000000000001')<>owning_space THEN
    RAISE EXCEPTION '结构节点所属目录不存在或跨空间'; END IF;
  ELSIF payload->>'space_id' IS DISTINCT FROM owning_space::text
    OR payload->>'book_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=(payload->>'book_id')::uuid AND space_id=owning_space) THEN
   RAISE EXCEPTION '分组所属作品空间不一致'; END IF;
  seen:=ARRAY[own_id]; cursor_id:=(payload->>'parent_id')::uuid;
  WHILE cursor_id IS NOT NULL LOOP
   IF cursor_id=ANY(seen) THEN RAISE EXCEPTION '结构树不能形成循环'; END IF;
   seen:=array_append(seen,cursor_id); ancestor:=structure_record(kind,cursor_id);
   IF ancestor IS NULL OR ancestor->>owner_field IS DISTINCT FROM payload->>owner_field
    OR kind='material_group' AND (ancestor->>'book_id' IS DISTINCT FROM payload->>'book_id' OR ancestor->>'status'<>'active') THEN
    RAISE EXCEPTION '上级结构必须位于相同目录与作用域'; END IF;
   cursor_id:=(ancestor->>'parent_id')::uuid;
  END LOOP;
 ELSIF kind IN ('material_tag_membership','material_group_membership') THEN
  owner:=structure_record(CASE kind WHEN 'material_tag_membership' THEN 'material_tag' ELSE 'material_group' END,
   (payload->>CASE kind WHEN 'material_tag_membership' THEN 'tag_id' ELSE 'group_id' END)::uuid);
  IF owner IS NULL OR owner->>'space_id' IS DISTINCT FROM owning_space::text OR payload->>'space_id' IS DISTINCT FROM owning_space::text
   OR NOT EXISTS(SELECT 1 FROM cards WHERE id=(payload->>'card_id')::uuid AND space_id=owning_space) THEN
   RAISE EXCEPTION '资料组织引用不能跨空间'; END IF;
 ELSIF kind='field_option_definition' THEN
  IF NOT EXISTS(SELECT 1 FROM field_definitions WHERE id=(payload->>'field_definition_id')::uuid AND space_id=owning_space) THEN
   RAISE EXCEPTION '选项所属字段不存在或跨空间'; END IF;
 ELSIF kind='card_group_form_instance' THEN
  version_payload:=structure_record('card_group_form_version',(payload->>'form_version_id')::uuid);
  IF version_payload IS NULL OR NOT EXISTS(SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id
    WHERE card.id=(payload->>'primary_card_id')::uuid AND card.space_id=owning_space AND NOT type.is_internal
     AND type.type_key=version_payload->'definition'->>'primaryTypeKey') THEN
   RAISE EXCEPTION '表单实例必须绑定同空间及匹配规格的主卡'; END IF;
 ELSIF kind='card_mount' THEN
  owner:=structure_record('card_group_form_instance',(payload->>'form_instance_id')::uuid);
  IF owner IS NULL OR owner->>'space_id' IS DISTINCT FROM owning_space::text
   OR NOT EXISTS(SELECT 1 FROM cards WHERE id=(payload->>'card_id')::uuid AND space_id=owning_space)
   OR payload->>'relation_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_relations WHERE id=(payload->>'relation_id')::uuid AND space_id=owning_space) THEN
   RAISE EXCEPTION '表单挂载及关系不能跨空间'; END IF;
 END IF;
 version_kind:=CASE kind WHEN 'dictionary_item' THEN 'dictionary_item_version' WHEN 'material_tag' THEN 'material_tag_version'
  WHEN 'material_group' THEN 'material_group_version' WHEN 'field_option_definition' THEN 'field_option_version'
  WHEN 'card_group_form' THEN 'card_group_form_version' END;
 IF version_kind IS NOT NULL AND payload->>'current_version_id' IS NOT NULL THEN
  owner_field:=CASE kind WHEN 'dictionary_item' THEN 'item_id' WHEN 'material_tag' THEN 'tag_id'
   WHEN 'material_group' THEN 'group_id' WHEN 'field_option_definition' THEN 'option_definition_id' ELSE 'form_id' END;
  version_payload:=structure_record(version_kind,(payload->>'current_version_id')::uuid);
  IF version_payload IS NULL OR version_payload->>owner_field IS DISTINCT FROM own_id::text THEN
   RAISE EXCEPTION '结构当前版本必须属于原对象'; END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_transfer_conflict_update(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_transfer_conflict_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status='resolved' THEN RAISE EXCEPTION 'resolved transfer conflict is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','resolution','resolution_note','revision','resolved_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resolution','resolution_note','revision','resolved_at']::text[]) THEN RAISE EXCEPTION 'transfer conflict evidence is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 OR NEW.status<>'resolved' OR NEW.resolution IS NULL OR NEW.resolved_at IS NULL THEN RAISE EXCEPTION 'invalid transfer conflict resolution' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_transfer_operation_update(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.guard_transfer_operation_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'transfer operation history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','current_step_key','progress_completed','progress_total','ready_manifest_id','revision','last_error_code','last_error_summary','started_at','completed_at','archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_step_key','progress_completed','progress_total','ready_manifest_id','revision','last_error_code','last_error_summary','started_at','completed_at','archived_at']::text[]) THEN RAISE EXCEPTION 'transfer operation frozen input is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'transfer operation revision must advance by one' USING ERRCODE='23514'; END IF;
  IF OLD.ready_manifest_id IS NOT NULL AND NEW.ready_manifest_id IS DISTINCT FROM OLD.ready_manifest_id THEN RAISE EXCEPTION 'ready transfer manifest cannot be replaced' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','failed','cancelled')) OR (OLD.status='running' AND NEW.status IN ('running','verifying','failed','cancelled')) OR (OLD.status='verifying' AND NEW.status IN ('verifying','ready','failed','cancelled','imported','restored')) OR (OLD.status IN ('ready','failed','cancelled','imported','restored') AND NEW.status='archived')) THEN RAISE EXCEPTION 'illegal transfer operation transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NOT ((NEW.execution_mode='execute' AND NEW.operation_kind IN ('full_backup','book_export','template_export','resource_export')) OR NEW.execution_mode='dry_run') THEN RAISE EXCEPTION 'only export, backup, or dry-run operations can become ready' USING ERRCODE='23514'; END IF;
  IF NEW.status='imported' AND NOT (NEW.execution_mode='apply' AND NEW.operation_kind IN ('book_import','template_import','resource_import')) THEN RAISE EXCEPTION 'only apply import can become imported' USING ERRCODE='23514'; END IF;
  IF NEW.status='restored' AND NOT (NEW.operation_kind='full_restore' AND NEW.execution_mode='apply') THEN RAISE EXCEPTION 'only apply full restore can become restored' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('ready','imported','restored') AND (NEW.ready_manifest_id IS NULL OR EXISTS(SELECT 1 FROM new_design.transfer_validations WHERE operation_id=NEW.id AND outcome IN ('failed','unavailable'))) THEN RAISE EXCEPTION 'transfer operation cannot pass a failed validation gate' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('ready','imported','restored') AND NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,operation_id uuid,source_format_version integer,source_application_version text,current_application_version text,source_schema_version text,current_schema_version text,source_migration_hash char(64),current_migration_hash char(64),extension_versions jsonb,required_capabilities jsonb,missing_capabilities jsonb,unknown_required_capabilities jsonb,outcome text,detail text,checked_at timestamptz) WHERE record_type.type_key='transfer_compatibility_snapshot') transfer_compatibility_snapshots WHERE operation_id=NEW.id AND outcome IN ('compatible','upgrade_required') AND jsonb_array_length(unknown_required_capabilities)=0) THEN RAISE EXCEPTION 'transfer operation requires a fail-closed compatibility snapshot' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND NEW.execution_mode='execute' AND NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,operation_id uuid,manifest_id uuid,artifact_kind text,media_type text,storage_locator text,normalized_case_locator text,display_filename text,checksum_algorithm text,checksum char(64),byte_size bigint,entry_count integer,compressed_bytes bigint,uncompressed_bytes bigint,status text,error_code text,created_at timestamptz,ready_at timestamptz) WHERE record_type.type_key='transfer_artifact') transfer_artifacts WHERE operation_id=NEW.id AND manifest_id=NEW.ready_manifest_id AND artifact_kind='package' AND status='ready') THEN RAISE EXCEPTION 'export or backup requires a verified package artifact' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('imported','restored') AND NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,operation_id uuid,source_artifact_id uuid,source_manifest_id uuid,source_installation_hash char(64),source_operation_key text,imported_by text,created_at timestamptz) WHERE record_type.type_key='transfer_import_source') transfer_import_sources WHERE operation_id=NEW.id) THEN RAISE EXCEPTION 'import or restore requires frozen source evidence' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('failed','cancelled') AND (NEW.last_error_code='' OR NEW.last_error_summary='') THEN RAISE EXCEPTION 'failed or cancelled transfer requires sanitized error detail' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: invalidate_registered_resource(uuid, uuid, text, text, uuid, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.invalidate_registered_resource(old_resource uuid, new_resource uuid, event_reason text, event_source text, event_trigger uuid, event_key text, event_state text DEFAULT 'stale'::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE target_book uuid;
BEGIN
  FOR target_book IN SELECT DISTINCT book_id FROM dependency_edges WHERE source_resource_id=old_resource AND status='active' LOOP
    PERFORM record_dependency_invalidation(gen_random_uuid(),target_book,old_resource,new_resource,event_reason,event_source,event_state,event_trigger,event_key || ':' || target_book::text);
  END LOOP;
END $$;


--
-- Name: kernel_protect_card_version(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.kernel_protect_card_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.author_request_key IS NULL AND NEW.author_request_key IS NOT NULL
  AND (to_jsonb(NEW)-ARRAY['author_book_id','author_request_key','author_input_hash','author_write_receipt'])
      IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['author_book_id','author_request_key','author_input_hash','author_write_receipt'])
  AND NEW.author_write_receipt->>'cardVersionId'=OLD.id::text
  AND NEW.author_write_receipt->>'requestKey'=NEW.author_request_key::text
  AND NEW.author_write_receipt->>'inputHash'=NEW.author_input_hash::text
  AND EXISTS(SELECT 1 FROM cards card JOIN books book ON book.space_id=card.space_id
    JOIN card_types type ON type.id=card.card_type_id AND NOT type.is_internal
    WHERE card.id=OLD.card_id AND card.current_version_id=OLD.id AND book.id=NEW.author_book_id)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION '版本内容、来源及已保存回执不可覆盖或删除';
END $$;


--
-- Name: kernel_reject_history_change(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.kernel_reject_history_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
BEGIN RAISE EXCEPTION '已保存的版本与动作历史不可覆盖或删除'; END $$;


--
-- Name: kernel_store_record(text, uuid, uuid, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.kernel_store_record(p_type_key text, p_space_id uuid, p_logical_id uuid, p_values jsonb) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE kind record; current_card record; card_id uuid; version_id uuid;
 next_revision integer; payload jsonb; created timestamptz;
BEGIN
 IF p_space_id IS NULL OR p_logical_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION '内部记录缺少明确空间、身份或对象负载';
 END IF;
 SELECT * INTO kind FROM card_types WHERE type_key=p_type_key AND is_internal
  AND status='published' AND current_version_id IS NOT NULL
  ORDER BY CASE WHEN space_id='00000000-0000-4000-8000-000000000001'::uuid THEN 0 ELSE 1 END,id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION '内部记录类型未发布：%',p_type_key; END IF;
 IF p_values ? 'id' AND p_values->>'id' IS DISTINCT FROM p_logical_id::text THEN
  RAISE EXCEPTION '内部记录身份不可替换';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('record:'||p_type_key||':'||p_space_id||':'||p_logical_id,0));
 IF (SELECT count(*) FROM cards WHERE space_id=p_space_id AND card_type_id=kind.id AND values->>'id'=p_logical_id::text)>1 THEN
  RAISE EXCEPTION '内部记录逻辑身份不唯一，禁止猜测覆盖';
 END IF;
 SELECT card.* INTO current_card FROM cards card WHERE card.space_id=p_space_id
  AND card.card_type_id=kind.id AND card.values->>'id'=p_logical_id::text FOR UPDATE;
 IF FOUND AND current_card.status<>'active' THEN RAISE EXCEPTION '内部记录已归档，不能隐式恢复'; END IF;
 created:=coalesce((p_values->>'created_at')::timestamptz,current_card.created_at,now());
 payload:=jsonb_build_object('id',p_logical_id,'status','active','revision',1,'created_at',created,'updated_at',now())
  ||CASE WHEN p_values ? 'owner_space_id' THEN '{}'::jsonb ELSE jsonb_build_object('space_id',p_space_id) END||p_values;
 IF current_card.id IS NOT NULL THEN
  card_id:=current_card.id;
  next_revision:=current_card.revision+1;
 ELSE
  -- 逻辑身份可以跨业务类型相同，物理主键不能冲突。
  card_id:=md5('record:'||p_type_key||':'||p_space_id||':'||p_logical_id)::uuid;
  next_revision:=1;
  INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,values,created_at)
   VALUES(card_id,p_space_id,kind.id,p_type_key,'active',1,kind.current_version_id,payload,created);
 END IF;
 version_id:=gen_random_uuid();
 INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source)
  VALUES(version_id,card_id,next_revision,kind.current_version_id,coalesce(current_card.title,p_type_key),payload,
   CASE WHEN next_revision=1 THEN 'create' ELSE 'edit' END);
 UPDATE cards SET current_version_id=version_id,values=payload,revision=next_revision,updated_at=now()
  WHERE id=card_id;
 RETURN card_id;
END $$;


--
-- Name: kernel_validate_text_anchor(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.kernel_validate_text_anchor() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE body record; subject_space uuid;
BEGIN
 IF NEW.body_version_id IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.subject_card_id AND space_id=NEW.space_id)
   OR NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.chapter_card_id AND space_id=NEW.space_id)
   OR NEW.scene_card_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.scene_card_id AND space_id=NEW.space_id) THEN
   RAISE EXCEPTION '资料锚点不能跨作品空间';
  END IF;
 ELSE
  SELECT version.content,book.space_id INTO body FROM chapter_body_versions version
   JOIN chapter_documents document ON document.id=version.chapter_document_id
   JOIN books book ON book.id=document.book_id
   WHERE version.id=NEW.body_version_id AND document.id=NEW.chapter_document_id AND book.id=NEW.book_id;
  IF NOT FOUND OR NEW.end_offset>length(body.content)
   OR substring(body.content FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset) IS DISTINCT FROM NEW.excerpt THEN
   RAISE EXCEPTION '正文锚点范围或原文与精确版本不一致';
  END IF;
  IF NEW.subject_card_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.subject_card_id AND space_id=body.space_id) THEN
   RAISE EXCEPTION '正文锚点对象不属于本书';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.body_version_id IS NOT NULL AND
  (to_jsonb(NEW)-ARRAY['status','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at']) THEN
  RAISE EXCEPTION '已引用的正文锚点来源不可替换';
 END IF;
 RETURN NEW;
END $$;


--
-- Name: native_guard_public_character_trial(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.native_guard_public_character_trial() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE  next_trial record; prior_trial record; operation text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM card_types WHERE id=NEW.card_type_id AND type_key='public_character_trial') OR NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 operation:=CASE WHEN OLD.current_version_id IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
 SELECT fields.* INTO next_trial FROM card_versions v CROSS JOIN LATERAL jsonb_to_record(v.values) fields(id uuid,request_key uuid,request_hash char(64),resource_id uuid,resource_version_id uuid,input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,request_state text,reply jsonb,execution jsonb,output jsonb,summary text,created_at timestamptz) WHERE v.id=NEW.current_version_id;
 SELECT fields.* INTO prior_trial FROM jsonb_to_record(COALESCE((SELECT values FROM card_versions WHERE id=OLD.current_version_id),'{}'::jsonb)) fields(id uuid,request_key uuid,request_hash char(64),resource_id uuid,resource_version_id uuid,input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,request_state text,reply jsonb,execution jsonb,output jsonb,summary text,created_at timestamptz);

 IF operation='DELETE' THEN RAISE EXCEPTION 'public character original reply cannot be deleted' USING ERRCODE='23514'; END IF;
 IF operation='INSERT' AND NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_character_trial_v1' AND installed AND operational) THEN RAISE EXCEPTION 'public character workshop not enabled' USING ERRCODE='23514'; END IF;
 IF operation='UPDATE' THEN
  IF (to_jsonb(next_trial)-ARRAY['status','request_state','reply','execution','output','summary']::text[]) IS DISTINCT FROM (to_jsonb(prior_trial)-ARRAY['status','request_state','reply','execution','output','summary']::text[]) THEN RAISE EXCEPTION 'public character freeze immutable' USING ERRCODE='23514'; END IF;
  IF prior_trial.reply IS NOT NULL AND (prior_trial.reply,prior_trial.execution) IS DISTINCT FROM (next_trial.reply,next_trial.execution) THEN RAISE EXCEPTION 'public character received reply immutable' USING ERRCODE='23514'; END IF;
  IF prior_trial.status<>'running' AND next_trial IS DISTINCT FROM prior_trial THEN RAISE EXCEPTION 'public character terminal request immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN card_versions version ON version.card_id=card.id
  JOIN ai_tasks task ON task.id=next_trial.id JOIN ai_task_steps step ON step.task_id=task.id JOIN ai_task_attempts attempt ON attempt.task_id=task.id AND attempt.step_id=step.id
  JOIN card_type_versions spec ON spec.id=version.type_version_id AND spec.card_type_id=type.id
  JOIN task_contract_versions contract ON contract.id=attempt.task_contract_version_id AND contract.id=task.task_contract_version_id
  JOIN prompt_recipe_versions recipe ON recipe.id=attempt.prompt_recipe_version_id AND recipe.id=contract.prompt_recipe_version_id
  JOIN context_manifests manifest ON manifest.id=attempt.context_manifest_id
  JOIN model_route_snapshots route ON route.id=attempt.model_route_snapshot_id
  WHERE card.id=next_trial.resource_id AND version.id=next_trial.resource_version_id AND type.type_key='character'
   AND card.space_id='60000000-0000-4000-8000-000000000001' AND task.space_id=card.space_id AND task.book_id IS NULL
   AND task.source_kind='public_character_trial' AND task.source_id=next_trial.id AND task.request_idempotency_key=next_trial.request_key::text AND task.request_hash=next_trial.request_hash
   AND step.id=next_trial.step_id AND step.max_attempts=1 AND step.current_attempt_id=attempt.id AND attempt.id=next_trial.attempt_id AND attempt.attempt_number=1
   AND manifest.book_id IS NULL AND manifest.public_character_scope=card.id AND route.book_id IS NULL
   AND manifest.task_contract_version_id=contract.id AND manifest.prompt_recipe_version_id=recipe.id AND manifest.model_route_snapshot_id=route.id
   AND next_trial.frozen_plan->>'contractVersionId'=contract.id::text AND next_trial.frozen_plan->>'recipeVersionId'=recipe.id::text
   AND next_trial.frozen_plan->>'manifestId'=manifest.id::text AND next_trial.frozen_plan->>'inputHash'=attempt.input_hash::text
   AND next_trial.frozen_plan->>'outputSchemaVersion'=attempt.output_schema_version AND attempt.output_schema_version=contract.output_schema_version
   AND contract.retry_policy->'maxAttempts'='1'::jsonb AND contract.retry_policy->'automaticRetry'='false'::jsonb
   AND manifest.source_set_hash::text=next_trial.source_snapshot->>'hash' AND manifest.manifest_hash::text=next_trial.frozen_plan->>'inputHash'
   AND recipe.variables_schema->'const'=next_trial.frozen_plan->'promptInput' AND contract.input_schema->'const'=next_trial.frozen_plan->'promptInput'
   AND ((next_trial.input_payload->>'kind'='dialogue' AND contract.task_group='character_dialogue' AND contract.budget_policy->>'assetId'='new_design.character.public_dialogue' AND contract.budget_policy->>'assetVersion'='v1')
    OR (next_trial.input_payload->>'kind'='portrait' AND contract.task_group='image_generation' AND contract.budget_policy->>'assetId'='new_design.character.public_portrait' AND contract.budget_policy->>'assetVersion'='v1'))
   AND next_trial.input_payload->>'requestKey'=next_trial.request_key::text AND next_trial.input_payload->>'resourceId'=card.id::text AND next_trial.input_payload->>'resourceVersionId'=version.id::text
   AND next_trial.source_snapshot->>'id'=card.id::text AND next_trial.source_snapshot->>'versionId'=version.id::text AND next_trial.source_snapshot->>'typeVersionId'=version.type_version_id::text
   AND next_trial.source_snapshot->>'title'=version.title AND next_trial.source_snapshot->>'revision'=version.revision::text
   AND next_trial.source_snapshot->'values'=version.values||COALESCE((SELECT jsonb_object_agg(definition.field_key,local.value) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE record_type.type_key='card_version_local_value') local JOIN field_definitions definition ON definition.id=local.field_definition_id WHERE local.card_version_id=version.id),'{}'::jsonb)
   AND next_trial.source_snapshot->'fields'=spec.fields||COALESCE((SELECT jsonb_agg(field.field_schema ORDER BY definition.field_key) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE record_type.type_key='card_version_local_value') local JOIN field_definitions definition ON definition.id=local.field_definition_id JOIN field_definition_versions field ON field.id=local.field_definition_version_id AND field.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)
   AND next_trial.source_snapshot->'localFields'=COALESCE((SELECT jsonb_agg(jsonb_build_object('definitionId',definition.id::text,'versionId',field.id::text,'field',field.field_schema,'value',local.value) ORDER BY definition.field_key) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE record_type.type_key='card_version_local_value') local JOIN field_definitions definition ON definition.id=local.field_definition_id JOIN field_definition_versions field ON field.id=local.field_definition_version_id AND field.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)
   AND next_trial.input_payload->>'sourceHash'=next_trial.source_snapshot->>'hash'
   AND next_trial.frozen_plan->'source'=next_trial.source_snapshot AND next_trial.frozen_plan->'input'=next_trial.input_payload
   AND ((next_trial.input_payload->>'kind'='dialogue' AND next_trial.frozen_plan->'promptInput'->'source'=next_trial.source_snapshot AND next_trial.frozen_plan->'promptInput'->>'message'=next_trial.input_payload->>'message')
    OR (next_trial.input_payload->>'kind'='portrait' AND next_trial.frozen_plan->'promptInput'->'portraitSource'=next_trial.source_snapshot AND next_trial.frozen_plan->'promptInput'->>'prompt'=next_trial.input_payload->>'prompt' AND next_trial.frozen_plan->'promptInput'->>'description'=next_trial.input_payload->>'description' AND next_trial.frozen_plan->'promptInput'->>'size'=next_trial.input_payload->>'size'))
   AND ((next_trial.input_payload->>'kind'='dialogue' AND route.managed_task_key='character_dialogue'
     AND next_trial.frozen_plan->'route'->'sourceLayers'=route.source_layers AND next_trial.frozen_plan->'route'->'primary'->>'provider'=route.provider AND next_trial.frozen_plan->'route'->'primary'->>'model'=route.model)
    OR (next_trial.input_payload->>'kind'='portrait' AND route.managed_task_key='image_generation'
     AND next_trial.input_payload->>'connectionVersionId'=route.source_layers->0->>'versionId'
     AND next_trial.frozen_plan->'connection'->>'id'=next_trial.input_payload->>'connectionVersionId'
     AND EXISTS(SELECT 1 FROM model_route_versions connection JOIN model_route_configs config ON config.id=connection.config_id WHERE connection.id::text=next_trial.input_payload->>'connectionVersionId' AND config.scope='task_group' AND config.task_group='image_generation' AND connection.provider=route.provider AND connection.model=route.model AND connection.content_hash::text=next_trial.frozen_plan->'connection'->>'connectionHash')))
   AND next_trial.frozen_plan->>'snapshotId'=route.id::text AND next_trial.frozen_plan->>'snapshotHash'=route.snapshot_hash::text
 ) THEN RAISE EXCEPTION 'public character exact source and original attempt mismatch' USING ERRCODE='23514'; END IF;
 IF next_trial.reply IS NOT NULL AND (next_trial.execution IS NULL OR next_trial.request_state<>'completed' OR NOT EXISTS(
  SELECT 1 FROM model_route_snapshots route WHERE route.id::text=next_trial.frozen_plan->>'snapshotId'
   AND next_trial.execution->>'routeSnapshotId'=route.id::text AND next_trial.execution->>'routeSnapshotHash'=route.snapshot_hash::text
   AND next_trial.execution->>'provider'=route.provider AND next_trial.execution->>'model'=route.model
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(next_trial.execution->'attempts')='array' THEN next_trial.execution->'attempts' ELSE '[]'::jsonb END) trace WHERE trace->>'status'='succeeded' AND trace->'requestSent'='true'::jsonb AND trace->'responseReceived'='true'::jsonb)
 )) THEN RAISE EXCEPTION 'public character reply requires actual frozen execution' USING ERRCODE='23514'; END IF;
 IF next_trial.status='succeeded' AND (next_trial.reply IS NULL OR next_trial.output IS NULL OR NOT EXISTS(SELECT 1 FROM ai_task_attempts WHERE id=next_trial.attempt_id AND status='succeeded')) THEN RAISE EXCEPTION 'public character success requires saved original reply' USING ERRCODE='23514'; END IF;
 IF next_trial.status='succeeded' AND next_trial.input_payload->>'kind'='dialogue' AND
  (next_trial.output IS DISTINCT FROM next_trial.reply OR next_trial.output->>'resourceId' IS DISTINCT FROM next_trial.resource_id::text OR next_trial.output->>'resourceVersionId' IS DISTINCT FROM next_trial.resource_version_id::text) THEN RAISE EXCEPTION 'public dialogue output source mismatch' USING ERRCODE='23514'; END IF;
 IF next_trial.status='succeeded' AND next_trial.input_payload->>'kind'='portrait' AND NOT EXISTS(
  SELECT 1 FROM asset_content_objects content WHERE content.id::text=next_trial.output->>'contentObjectId' AND content.storage_kind='managed_file' AND content.storage_provider='local' AND content.integrity_state='verified'
   AND content.checksum::text=next_trial.output->>'checksum' AND content.byte_size::text=next_trial.output->>'byteSize' AND content.mime_type=next_trial.output->>'mimeType'
   AND next_trial.output->>'checksum'=next_trial.reply->>'checksum' AND next_trial.output->>'byteSize'=next_trial.reply->>'byteSize' AND next_trial.output->>'mimeType'=next_trial.reply->>'mimeType'
   AND next_trial.output->>'title'=next_trial.input_payload->>'title' AND next_trial.output->>'description'=next_trial.input_payload->>'description'
 ) THEN RAISE EXCEPTION 'public portrait output content mismatch' USING ERRCODE='23514'; END IF;
 IF next_trial.status='ended_unknown'  AND next_trial.reply IS NOT NULL THEN RAISE EXCEPTION 'received reply cannot be ended as unknown' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: native_guard_public_title_trial(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.native_guard_public_title_trial() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE task record;step record;attempt record;contract record;manifest record; next_trial record; prior_trial record; operation text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM card_types WHERE id=NEW.card_type_id AND type_key='public_title_factory_trial') OR NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 operation:=CASE WHEN OLD.current_version_id IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
 SELECT fields.* INTO next_trial FROM card_versions v CROSS JOIN LATERAL jsonb_to_record(v.values) fields(id uuid,request_key uuid,request_hash char(64),intent_hash char(64),source_id uuid,source_version_id uuid,source_hash char(64),input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz) WHERE v.id=NEW.current_version_id;
 SELECT fields.* INTO prior_trial FROM jsonb_to_record(COALESCE((SELECT values FROM card_versions WHERE id=OLD.current_version_id),'{}'::jsonb)) fields(id uuid,request_key uuid,request_hash char(64),intent_hash char(64),source_id uuid,source_version_id uuid,source_hash char(64),input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz);

 IF operation='DELETE' THEN RAISE EXCEPTION 'original public title trial immutable' USING ERRCODE='23514'; END IF;
 IF operation='INSERT' THEN IF next_trial.status<>'running' OR next_trial.reply IS NOT NULL OR next_trial.output IS NOT NULL OR NOT EXISTS(SELECT 1 FROM system_capabilities WHERE capability_key='public_title_factory_v1' AND installed AND operational) THEN RAISE EXCEPTION 'public title not enabled' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(next_trial)-ARRAY['status','reply','output','summary']) IS DISTINCT FROM (to_jsonb(prior_trial)-ARRAY['status','reply','output','summary']) OR prior_trial.status<>'running' OR prior_trial.reply IS NOT NULL AND next_trial.reply IS DISTINCT FROM prior_trial.reply THEN RAISE EXCEPTION 'original title input/reply immutable' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO STRICT task FROM ai_tasks WHERE id=next_trial.id;SELECT * INTO STRICT step FROM ai_task_steps WHERE id=next_trial.step_id AND task_id=next_trial.id;SELECT * INTO STRICT attempt FROM ai_task_attempts WHERE id=next_trial.attempt_id AND step_id=next_trial.step_id AND task_id=next_trial.id;
 SELECT * INTO STRICT contract FROM task_contract_versions WHERE id=task.task_contract_version_id;SELECT * INTO STRICT manifest FROM context_manifests WHERE id=attempt.context_manifest_id;
 IF NOT COALESCE(task.book_id IS NULL AND task.space_id='60000000-0000-4000-8000-000000000001' AND task.source_kind='public_title_factory' AND task.source_id=next_trial.id AND task.request_hash=next_trial.request_hash AND task.request_idempotency_key=next_trial.request_key::text AND contract.task_group='creative_extraction' AND contract.budget_policy->>'assetId'='new_design.public.title_factory' AND contract.budget_policy->>'assetVersion'='v1' AND contract.retry_policy='{"maxAttempts":1,"automaticRetry":false}'::jsonb AND contract.input_schema->'const'=next_trial.frozen_plan->'promptInput' AND contract.input_schema->'const'->'input'=next_trial.input_payload AND contract.input_schema->'const'->'source'=next_trial.source_snapshot AND next_trial.source_snapshot->>'id'=next_trial.source_id::text AND next_trial.source_snapshot->>'versionId'=next_trial.source_version_id::text AND next_trial.source_snapshot->>'hash'=next_trial.source_hash AND manifest.book_id IS NULL AND manifest.public_title_scope=next_trial.source_id AND manifest.task_contract_version_id=contract.id AND step.max_attempts=1 AND attempt.attempt_number=1 AND attempt.input_hash=next_trial.frozen_plan->>'inputHash' AND attempt.output_schema_version=next_trial.frozen_plan->>'outputSchemaVersion' AND attempt.model_route_snapshot_id=(next_trial.frozen_plan->>'snapshotId')::uuid,false) THEN RAISE EXCEPTION 'original title frozen execution mismatch' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM card_versions version JOIN cards card ON card.id=version.card_id JOIN card_types type ON type.id=card.card_type_id WHERE version.id=next_trial.source_version_id AND card.id=next_trial.source_id AND card.space_id=task.space_id AND type.type_key='public_title_brief' AND version.values=next_trial.source_snapshot->'values') OR NOT EXISTS(SELECT 1 FROM new_design.context_manifest_items entry WHERE entry.manifest_id=manifest.id AND entry.source_type='card_version' AND entry.stable_object_id=next_trial.source_id AND entry.exact_version_id=next_trial.source_version_id AND entry.transform_status='full') THEN RAISE EXCEPTION 'original title source version unavailable' USING ERRCODE='23514'; END IF;
 IF next_trial.reply IS NOT NULL AND NOT COALESCE(next_trial.reply->'output'->>'sourceId'=next_trial.source_id::text AND next_trial.reply->'output'->>'sourceVersionId'=next_trial.source_version_id::text AND next_trial.reply->'output'->>'sourceHash'=next_trial.source_hash AND next_trial.reply->'execution'->>'routeSnapshotId'=next_trial.frozen_plan->>'snapshotId' AND next_trial.reply->'execution'->>'routeSnapshotHash'=next_trial.frozen_plan->>'snapshotHash' AND jsonb_array_length(next_trial.reply->'output'->'groups')=(next_trial.input_payload->>'groupCount')::integer AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(next_trial.reply->'output'->'groups') item WHERE jsonb_array_length(item->'titles')<>(next_trial.input_payload->>'candidatesPerGroup')::integer) AND EXISTS(SELECT 1 FROM jsonb_array_elements(next_trial.reply->'execution'->'attempts') trace WHERE trace->>'status'='succeeded' AND trace->>'requestSent'='true' AND trace->>'responseReceived'='true'),false) THEN RAISE EXCEPTION 'original title reply execution mismatch' USING ERRCODE='23514'; END IF;
 IF next_trial.status='succeeded' AND (next_trial.reply IS NULL OR next_trial.output IS DISTINCT FROM next_trial.reply->'output' OR task.status<>'succeeded' OR step.status<>'succeeded' OR attempt.status<>'succeeded') THEN RAISE EXCEPTION 'original successful title requires original reply and ledger' USING ERRCODE='23514'; END IF;
 IF next_trial.status IN('failed','ended_unknown') AND (next_trial.output IS NOT NULL OR task.status<>CASE WHEN next_trial.status='failed' THEN 'failed' ELSE 'cancelled' END OR attempt.status<>CASE WHEN next_trial.status='failed' THEN 'failed' ELSE 'discarded' END) THEN RAISE EXCEPTION 'original title failure ledger mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: outbox_payload_is_reference_only(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.outbox_payload_is_reference_only(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
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


--
-- Name: quality_deferred_record_closure(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_deferred_record_closure() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE kind text; next jsonb;
BEGIN
 SELECT type.type_key,version.values INTO kind,next FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.id;
 IF kind='chapter_adoption_session' THEN
  PERFORM quality_guard_require_resource_supplement_receipt(NULL,next,'INSERT','chapter_adoption_sessions');
 ELSIF kind='chapter_resource_supplement' THEN
  PERFORM quality_guard_require_resource_supplement_correction_origin(NULL,next,'INSERT','chapter_resource_supplements');
 END IF;
 RETURN NEW;
END $$;


--
-- Name: quality_guard_block_unavailable_resource_correction_candidates(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_block_unavailable_resource_correction_candidates(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_settlement_items'); origin record; saved record; proposal record;
BEGIN
 SELECT data.id,data.session_id,data.category,data.major_category,data.title,data.canonical_fact_id,data.knowledge_proposal_id,data.state_proposal_id,data.evidence_anchor_id,data.risk_level,data.confidence,data.confidence_note,data.plan_alignment,data.plan_expectation,data.before_value,data.change_value,next->'after_value' AS after_value,data.source_kind,data.source_task_id,data.source_attempt_id,data.decision,data.decision_source,data.decision_note,data.revision,data.decided_at,data.created_at,data.updated_at,data.book_id,data.body_version_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.ai_task_id,data.status,data.request_hash,data.idempotency_key,data.created_by,data.error_summary,data.frozen_plan,data.frozen_input_hash,data.expected_session_revision,data.generated_output,data.generated_execution,data.failure INTO NEW FROM jsonb_to_record(next) AS data(id uuid,session_id uuid,category text,major_category text,title text,canonical_fact_id uuid,knowledge_proposal_id uuid,state_proposal_id uuid,evidence_anchor_id uuid,risk_level text,confidence numeric(5,4),confidence_note text,plan_alignment text,plan_expectation text,before_value jsonb,change_value jsonb,after_value jsonb,source_kind text,source_task_id uuid,source_attempt_id uuid,decision text,decision_source text,decision_note text,revision integer,decided_at timestamptz,created_at timestamptz,updated_at timestamptz,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);
 SELECT data.id,data.session_id,data.category,data.major_category,data.title,data.canonical_fact_id,data.knowledge_proposal_id,data.state_proposal_id,data.evidence_anchor_id,data.risk_level,data.confidence,data.confidence_note,data.plan_alignment,data.plan_expectation,data.before_value,data.change_value,previous->'after_value' AS after_value,data.source_kind,data.source_task_id,data.source_attempt_id,data.decision,data.decision_source,data.decision_note,data.revision,data.decided_at,data.created_at,data.updated_at,data.book_id,data.body_version_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.ai_task_id,data.status,data.request_hash,data.idempotency_key,data.created_by,data.error_summary,data.frozen_plan,data.frozen_input_hash,data.expected_session_revision,data.generated_output,data.generated_execution,data.failure INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,session_id uuid,category text,major_category text,title text,canonical_fact_id uuid,knowledge_proposal_id uuid,state_proposal_id uuid,evidence_anchor_id uuid,risk_level text,confidence numeric(5,4),confidence_note text,plan_alignment text,plan_expectation text,before_value jsonb,change_value jsonb,after_value jsonb,source_kind text,source_task_id uuid,source_attempt_id uuid,decision text,decision_source text,decision_note text,revision integer,decided_at timestamptz,created_at timestamptz,updated_at timestamptz,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);

  -- resource_correction_candidates_v1: only its actual issue field is eligible.
  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=NEW.session_id;
  IF origin.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1' THEN RETURN; END IF;
  SELECT * INTO saved FROM (SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_correction_origin')) resource_supplement_correction_origins WHERE session_id=NEW.session_id AND book_id=origin.book_id;
  IF saved.session_id IS NULL THEN RAISE EXCEPTION 'corrective candidate requires complete original source' USING ERRCODE='23514'; END IF;
  PERFORM assert_resource_correction_candidate_source(saved.session_id);
  IF TG_TABLE_NAME='chapter_settlement_items' THEN
    SELECT * INTO proposal FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) state_change_proposals WHERE id=NEW.state_proposal_id AND book_id=origin.book_id;
    IF proposal.id IS NULL OR proposal.status IS DISTINCT FROM 'proposed' OR proposal.before_known IS DISTINCT FROM true
      OR proposal.subject_kind IS DISTINCT FROM origin.source_snapshot#>>'{correction,subjectKind}'
      OR proposal.subject_id::text IS DISTINCT FROM origin.source_snapshot#>>'{correction,subjectId}'
      OR proposal.state_key IS DISTINCT FROM origin.source_snapshot#>>'{correction,stateKey}'
      OR proposal.before_json IS DISTINCT FROM origin.source_snapshot#>'{correction,beforeValue}'
      OR proposal.chapter_document_id::text IS DISTINCT FROM origin.source_snapshot#>>'{basis,chapterDocumentId}'
      OR proposal.body_version_id::text IS DISTINCT FROM origin.source_snapshot#>>'{basis,bodyVersionId}'
      OR proposal.text_anchor_id IS DISTINCT FROM NEW.evidence_anchor_id
      OR NEW.canonical_fact_id IS NOT NULL OR NEW.knowledge_proposal_id IS NOT NULL
      OR NEW.category IS DISTINCT FROM (CASE WHEN proposal.subject_kind='relation' THEN 'relationship' ELSE 'prop' END)
      OR proposal.effective_story_order IS NOT NULL AND proposal.effective_story_order<>(origin.source_snapshot#>>'{basis,chapterOrder}')::numeric
      THEN RAISE EXCEPTION 'corrective candidate must stay in its actual proven issue field and body evidence' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.frozen_plan->>'assetId' IS DISTINCT FROM 'new_design.character.stable_resource_correction' THEN
      RAISE EXCEPTION 'corrective claim requires its registered dedicated asset' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_block_unavailable_resource_supplement_extraction(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_block_unavailable_resource_supplement_extraction(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_proposal_extraction_requests'); origin record; expected_catalog jsonb;
BEGIN
 SELECT data.id,data.session_id,data.book_id,data.body_version_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.ai_task_id,data.status,data.request_hash,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.frozen_plan,data.frozen_input_hash,data.expected_session_revision,data.generated_output,data.generated_execution,data.failure INTO NEW FROM jsonb_to_record(next) AS data(id uuid,session_id uuid,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);
 SELECT data.id,data.session_id,data.book_id,data.body_version_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.ai_task_id,data.status,data.request_hash,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.frozen_plan,data.frozen_input_hash,data.expected_session_revision,data.generated_output,data.generated_execution,data.failure INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,session_id uuid,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);

  IF NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=NEW.session_id AND adoption_kind='resource_supplement') THEN RETURN; END IF;
  -- stable_resource_supplement_candidates_v1: no ordinary/cached extractor may claim a child.
  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=NEW.session_id AND book_id=NEW.book_id;
  IF origin.source_snapshot->>'contract'='stable_resource_correction_preview_v1' THEN
    PERFORM assert_resource_correction_claim(to_jsonb(NEW));
    RETURN;
  END IF;
  expected_catalog:=jsonb_set(jsonb_set(origin.source_snapshot->'catalog','{sessionId}',to_jsonb(NEW.session_id::text)),
    '{sessionRevision}',to_jsonb(NEW.expected_session_revision));
  IF origin.session_id IS NULL OR NEW.frozen_plan->>'assetId' IS DISTINCT FROM 'new_design.character.stable_resource_supplement'
    OR NEW.frozen_plan->>'assetVersion' IS DISTINCT FROM 'v1'
    OR NEW.frozen_plan->'input'->'stableSupplement'->'source' IS DISTINCT FROM origin.source_snapshot
    OR NEW.frozen_plan->'input'->'catalog' IS DISTINCT FROM expected_catalog
    OR NEW.frozen_plan->'input'->'resourceScope' IS DISTINCT FROM origin.source_snapshot->'resourceScope'
    OR NEW.frozen_plan->'input'->'bodyContent' IS DISTINCT FROM origin.source_snapshot->'basis'->'bodyContent'
    OR NEW.frozen_plan->'input'->'stableSupplement'->'sessionRevision' IS DISTINCT FROM to_jsonb(NEW.expected_session_revision)
    OR NEW.frozen_plan->'input'->'expectedChanges' IS DISTINCT FROM '[]'::jsonb
    OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) child JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) base ON base.id=child.supplement_base_checkpoint_id
      WHERE child.id=NEW.session_id AND child.revision=NEW.expected_session_revision AND base.id=origin.base_checkpoint_id
        AND base.status='stable' AND base.book_id=NEW.book_id AND base.body_version_id=NEW.body_version_id) THEN
    RAISE EXCEPTION 'stable resource candidate claim requires its exact retained source' USING ERRCODE='23514';
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_card_removal(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_card_removal() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE kind text; previous jsonb;
BEGIN
 SELECT type.type_key,version.values INTO kind,previous FROM card_types type
 LEFT JOIN card_versions version ON version.id=OLD.current_version_id AND version.card_id=OLD.id WHERE type.id=OLD.card_type_id;
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.card_type_id IS NOT DISTINCT FROM OLD.card_type_id AND NEW.space_id IS NOT DISTINCT FROM OLD.space_id THEN RETURN NEW; END IF;
 IF kind='current_state_projection' THEN
  PERFORM quality_guard_fence_resource_supplement_integrity_projection(previous,NULL,'DELETE','current_state_projections');
 ELSIF kind=ANY(ARRAY['chapter_resource_supplement','resource_supplement_impact_review','resource_supplement_integrity_journal','resource_supplement_integrity_issue','resource_supplement_integrity_resolution','resource_supplement_correction_origin','resource_supplement_formal_commit','chapter_proposal_extraction_request','chapter_stable_checkpoint','world_consistency_request','quality_report_material_version','quality_issue_evidence','quality_recheck','quality_fix_candidate_version','quality_fix_adoption','image_prompt_preparation','quality_issue_version','quality_report_body_version','quality_report_planning_version','quality_report_fact','quality_issue_event','quality_fix_candidate_event','quality_audit_report','quality_issue','quality_fix_candidate']::text[]) THEN
  RAISE EXCEPTION 'frozen quality and supplemental records cannot be deleted, retyped, moved or archived' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: quality_guard_fence_resource_supplement_integrity_extraction(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_fence_resource_supplement_integrity_extraction(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_proposal_extraction_requests'); origin record;
BEGIN
 SELECT data.id,data.session_id,data.book_id,data.body_version_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.ai_task_id,data.status,data.request_hash,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.frozen_plan,data.frozen_input_hash,data.expected_session_revision,data.generated_output,data.generated_execution,data.failure INTO NEW FROM jsonb_to_record(next) AS data(id uuid,session_id uuid,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);
 SELECT data.id,data.session_id,data.book_id,data.body_version_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.ai_task_id,data.status,data.request_hash,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.frozen_plan,data.frozen_input_hash,data.expected_session_revision,data.generated_output,data.generated_execution,data.failure INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,session_id uuid,book_id uuid,body_version_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,ai_task_id uuid,status text,request_hash char(64),idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,frozen_plan jsonb,frozen_input_hash text,expected_session_revision integer,generated_output jsonb,generated_execution jsonb,failure jsonb);

  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=NEW.session_id AND book_id=NEW.book_id;
  IF origin.session_id IS NULL THEN RETURN; END IF;
  IF origin.source_snapshot->>'contract'='stable_resource_correction_preview_v1' THEN
    PERFORM assert_resource_correction_claim(to_jsonb(NEW));
    RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) issue JOIN new_design.chapter_documents document ON document.id=issue.chapter_document_id AND document.book_id=issue.book_id
    WHERE issue.book_id=NEW.book_id AND document.logical_order<=(origin.source_snapshot#>>'{basis,chapterOrder}')::numeric
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(origin.source_snapshot#>'{catalog,subjects}') subject WHERE (subject->>'id')::uuid=issue.subject_id AND subject->>'subjectKind'=issue.subject_kind)
      AND NOT EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resolution WHERE resolution.issue_id=issue.issue_id)) THEN
    RAISE EXCEPTION 'ordinary stable resource extraction cannot bypass actual source conflict' USING ERRCODE='23514';
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_fence_resource_supplement_integrity_projection(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_fence_resource_supplement_integrity_projection(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'current_state_projections'); key_book uuid; key_kind text; key_subject uuid; key_state text;
BEGIN
 SELECT data.book_id,data.subject_kind,data.subject_id,data.state_key,next->'value_json' AS value_json,data.source_initial_version_id,data.source_state_change_id,data.projection_revision,data.is_stale,data.rebuilt_at INTO NEW FROM jsonb_to_record(next) AS data(book_id uuid,subject_kind text,subject_id uuid,state_key text,value_json jsonb,source_initial_version_id uuid,source_state_change_id uuid,projection_revision bigint,is_stale boolean,rebuilt_at timestamptz);
 SELECT data.book_id,data.subject_kind,data.subject_id,data.state_key,previous->'value_json' AS value_json,data.source_initial_version_id,data.source_state_change_id,data.projection_revision,data.is_stale,data.rebuilt_at INTO OLD FROM jsonb_to_record(previous) AS data(book_id uuid,subject_kind text,subject_id uuid,state_key text,value_json jsonb,source_initial_version_id uuid,source_state_change_id uuid,projection_revision bigint,is_stale boolean,rebuilt_at timestamptz);

  IF TG_OP='UPDATE' AND (NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.state_key IS DISTINCT FROM OLD.state_key)
    AND EXISTS(SELECT 1 FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) issue WHERE issue.book_id=OLD.book_id AND issue.subject_kind=OLD.subject_kind AND issue.subject_id=OLD.subject_id AND issue.state_key=OLD.state_key
      AND NOT EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resolution WHERE resolution.issue_id=issue.issue_id)) THEN
    RAISE EXCEPTION 'open resource source identity cannot be moved to bypass integrity' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN key_book=OLD.book_id;key_kind=OLD.subject_kind;key_subject=OLD.subject_id;key_state=OLD.state_key;
  ELSE key_book=NEW.book_id;key_kind=NEW.subject_kind;key_subject=NEW.subject_id;key_state=NEW.state_key; END IF;
  IF EXISTS(SELECT 1 FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) issue WHERE issue.book_id=key_book AND issue.subject_kind=key_kind AND issue.subject_id=key_subject AND issue.state_key=key_state
    AND NOT EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resolution WHERE resolution.issue_id=issue.issue_id)) THEN
    IF TG_OP='DELETE' OR NEW.is_stale IS DISTINCT FROM true THEN RAISE EXCEPTION 'open actual resource source conflict cannot be cleared by projection rebuild or deletion' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN; ELSE RETURN; END IF;
END
$$;


--
-- Name: quality_guard_guard_image_preparation(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_guard_image_preparation(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $_$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'image_prompt_preparations'); task record; step record; attempt record; contract record; recipe record; manifest record; snapshot record; source jsonb; item jsonb; actual jsonb; target_book record; profile jsonb; card_count integer;
BEGIN
 SELECT data.id,data.request_key,data.request_hash,data.scope_id,next->'input_payload' AS input_payload,next->'source_snapshot' AS source_snapshot,next->'frozen_plan' AS frozen_plan,data.step_id,data.attempt_id,data.status,data.reply,data.output,data.summary,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(id uuid,request_key uuid,request_hash char(64),scope_id uuid,input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz);
 SELECT data.id,data.request_key,data.request_hash,data.scope_id,previous->'input_payload' AS input_payload,previous->'source_snapshot' AS source_snapshot,previous->'frozen_plan' AS frozen_plan,data.step_id,data.attempt_id,data.status,data.reply,data.output,data.summary,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,request_key uuid,request_hash char(64),scope_id uuid,input_payload jsonb,source_snapshot jsonb,frozen_plan jsonb,step_id uuid,attempt_id uuid,status text,reply jsonb,output jsonb,summary text,created_at timestamptz);

 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'image preparation immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','reply','output','summary']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reply','output','summary']) OR OLD.status<>'running' AND NEW IS DISTINCT FROM OLD OR OLD.reply IS NOT NULL AND NEW.reply IS DISTINCT FROM OLD.reply OR NEW.status='running' AND (NEW.output IS NOT NULL OR NEW.summary IS DISTINCT FROM OLD.summary) THEN RAISE EXCEPTION 'image preparation original input and reply immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM (SELECT 'image_prompt_preparation_v1'::text AS contract,installed AND operational AS operational FROM new_design.system_capabilities WHERE capability_key='image_prompt_preparation_v1') capability WHERE capability.contract='image_prompt_preparation_v1' AND capability.operational) OR NEW.status<>'running' OR NEW.reply IS NOT NULL OR NEW.output IS NOT NULL THEN RAISE EXCEPTION 'image preparation not enabled' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO STRICT task FROM new_design.ai_tasks WHERE id=NEW.id;
 SELECT * INTO STRICT step FROM new_design.ai_task_steps WHERE id=NEW.step_id AND task_id=NEW.id AND current_attempt_id=NEW.attempt_id;
 SELECT * INTO STRICT attempt FROM new_design.ai_task_attempts WHERE id=NEW.attempt_id AND task_id=NEW.id AND step_id=NEW.step_id;
 SELECT * INTO STRICT contract FROM new_design.task_contract_versions WHERE id=attempt.task_contract_version_id;
 SELECT * INTO STRICT recipe FROM new_design.prompt_recipe_versions WHERE id=attempt.prompt_recipe_version_id;
 SELECT * INTO STRICT manifest FROM new_design.context_manifests WHERE id=attempt.context_manifest_id;
 SELECT * INTO STRICT snapshot FROM new_design.model_route_snapshots WHERE id=attempt.model_route_snapshot_id;
 source:=NEW.source_snapshot;
 IF jsonb_typeof(source)<>'object' OR source-ARRAY['scope','hash','data']<>'{}'::jsonb OR NEW.input_payload-ARRAY['requestKey','scope','sourceHash','original']<>'{}'::jsonb OR source->>'hash' !~ '^[a-f0-9]{64}$' OR NEW.request_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(NEW.input_payload->'original')<>'string' OR length(btrim(NEW.input_payload->>'original')) NOT BETWEEN 1 AND 1000000 OR NEW.frozen_plan->>'contractVersionId' IS DISTINCT FROM contract.id::text OR NEW.frozen_plan->>'recipeVersionId' IS DISTINCT FROM recipe.id::text OR NEW.frozen_plan->>'manifestId' IS DISTINCT FROM manifest.id::text OR NEW.frozen_plan->>'snapshotId' IS DISTINCT FROM snapshot.id::text THEN RAISE EXCEPTION 'image preparation input shape mismatch' USING ERRCODE='23514'; END IF;
 IF NOT COALESCE(task.source_kind='image_prompt_preparation' AND task.source_id=NEW.id AND task.request_idempotency_key=NEW.request_key::text AND task.request_hash=NEW.request_hash AND task.task_contract_version_id=contract.id AND step.step_key='image_prompt_preparation' AND step.max_attempts=1 AND attempt.attempt_number=1 AND attempt.input_hash=NEW.frozen_plan->>'inputHash' AND attempt.output_schema_version=NEW.frozen_plan->>'outputSchemaVersion' AND contract.task_group='form_assist' AND contract.status='published' AND contract.budget_policy->>'assetId'='new_design.image.prompt_preparation' AND contract.budget_policy->>'assetVersion'='v1' AND contract.retry_policy='{"maxAttempts":1,"automaticRetry":false}'::jsonb AND recipe.id=contract.prompt_recipe_version_id AND recipe.status='published' AND recipe.variables_schema->'const'=contract.input_schema->'const' AND contract.input_schema->'const'=NEW.frozen_plan->'promptInput' AND NEW.frozen_plan->'promptInput'->'source'=source AND NEW.frozen_plan->'promptInput'->>'original'=NEW.input_payload->>'original' AND source->'scope'=NEW.input_payload->'scope' AND source->>'hash'=NEW.input_payload->>'sourceHash' AND manifest.task_contract_version_id=contract.id AND manifest.prompt_recipe_version_id=recipe.id AND manifest.model_route_snapshot_id=snapshot.id AND manifest.source_set_hash=source->>'hash' AND snapshot.snapshot_hash=NEW.frozen_plan->>'snapshotHash' AND snapshot.provider=NEW.frozen_plan->'route'->'primary'->>'provider' AND snapshot.model=NEW.frozen_plan->'route'->'primary'->>'model' AND snapshot.retry_policy->>'maxRetries'='0' AND NEW.frozen_plan->'route'->'fallbacks'='[]'::jsonb,false) THEN RAISE EXCEPTION 'image preparation frozen contract mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF task.status<>'running' OR step.status<>'running' OR attempt.status<>'running' OR NEW.input_payload->>'requestKey'<>NEW.request_key::text THEN RAISE EXCEPTION 'image preparation claim mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.input_payload->'scope'->>'kind'='book' THEN
   IF (NEW.input_payload->'scope')-ARRAY['kind','bookId']<>'{}'::jsonb OR (source->'data')-ARRAY['book','cards','plans']<>'{}'::jsonb THEN RAISE EXCEPTION 'image preparation book source shape mismatch' USING ERRCODE='23514'; END IF;
   SELECT * INTO STRICT target_book FROM new_design.books WHERE id=NEW.scope_id AND status='active';
   IF task.book_id IS DISTINCT FROM target_book.id OR manifest.book_id IS DISTINCT FROM target_book.id OR NEW.input_payload->'scope'->>'bookId'<>target_book.id::text OR source->'data'->'book' IS DISTINCT FROM jsonb_build_object('id',target_book.id,'name',target_book.name,'description',target_book.description,'revision',target_book.revision) THEN RAISE EXCEPTION 'image preparation book mismatch' USING ERRCODE='23514'; END IF;
   SELECT count(*) INTO card_count FROM new_design.cards image_card JOIN new_design.card_types image_type ON image_type.id=image_card.card_type_id AND NOT image_type.is_internal WHERE image_card.space_id=target_book.space_id AND image_card.status='active';
   IF jsonb_array_length(source->'data'->'cards')<>card_count OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(source->'data'->'cards'))<>card_count THEN RAISE EXCEPTION 'image preparation incomplete card set' USING ERRCODE='23514'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(source->'data'->'cards') LOOP
    SELECT jsonb_build_object('id',card.id,'versionId',version.id,'title',version.title,'typeVersionId',version.type_version_id,'values',version.values,'fields',spec.fields,'localFields',COALESCE((SELECT jsonb_agg(jsonb_build_object('definitionId',definition.id,'versionId',local_spec.id,'field',local_spec.field_schema,'value',local.value) ORDER BY definition.field_key) FROM (SELECT data.card_version_id,data.field_definition_id,data.field_definition_version_id,version.values->'value' AS value,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='card_version_local_value')) local JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id JOIN new_design.field_definition_versions local_spec ON local_spec.id=local.field_definition_version_id AND local_spec.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)) INTO actual FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id JOIN new_design.card_type_versions spec ON spec.id=version.type_version_id WHERE card.id=(item->>'id')::uuid AND card.space_id=target_book.space_id AND card.status='active';
    IF actual IS DISTINCT FROM item THEN RAISE EXCEPTION 'image preparation actual card mismatch' USING ERRCODE='23514'; END IF;
   END LOOP;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('id',object.id,'versionId',version.id,'level',object.level,'title',object.title,'content',version.content,'contentHash',version.content_hash) ORDER BY object.id),'[]'::jsonb) INTO actual FROM (SELECT data.id,data.book_id,data.level,data.parent_object_id,data.card_id,data.title,data.sort_order,data.status,data.current_version_id,data.adopted_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,level text,parent_object_id uuid,card_id uuid,title text,sort_order integer,status text,current_version_id uuid,adopted_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_object')) object JOIN (SELECT data.id,data.object_id,data.book_id,data.version,data.base_version_id,data.based_on_parent_version_id,data.source,data.status,version.values->'content' AS content,data.content_hash,data.source_body_version_id,data.created_by,data.stale_at,data.stale_reason,data.created_at,data.execution_mode FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_version')) version ON version.id=object.adopted_version_id AND version.object_id=object.id WHERE object.book_id=target_book.id AND object.status='active' AND object.level='story' AND version.status='adopted' AND version.stale_at IS NULL;
   IF actual IS DISTINCT FROM source->'data'->'plans' THEN RAISE EXCEPTION 'image preparation story source mismatch' USING ERRCODE='23514'; END IF;
  ELSIF NEW.input_payload->'scope'->>'kind'='public_character' THEN
   profile:=source->'data'->'profile';
   IF (NEW.input_payload->'scope')-ARRAY['kind','resourceId','resourceVersionId']<>'{}'::jsonb OR (source->'data')-ARRAY['profile']<>'{}'::jsonb OR profile-ARRAY['id','versionId','revision','typeVersionId','title','values','fields','localFields','hash']<>'{}'::jsonb OR profile->>'hash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'image preparation public source shape mismatch' USING ERRCODE='23514'; END IF;
   IF task.book_id IS NOT NULL OR manifest.book_id IS NOT NULL OR manifest.public_character_scope IS DISTINCT FROM NEW.scope_id OR NEW.input_payload->'scope'->>'resourceId'<>NEW.scope_id::text OR profile->>'id'<>NEW.scope_id::text OR profile->>'versionId'<>NEW.input_payload->'scope'->>'resourceVersionId' OR NOT EXISTS(SELECT 1 FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_versions version ON version.card_id=card.id JOIN new_design.card_type_versions spec ON spec.id=version.type_version_id WHERE card.id=NEW.scope_id AND card.space_id='60000000-0000-4000-8000-000000000001' AND card.status='active' AND type.type_key='character' AND type.status='published' AND version.id=(profile->>'versionId')::uuid AND version.title=profile->>'title' AND version.revision=(profile->>'revision')::integer AND version.type_version_id=(profile->>'typeVersionId')::uuid AND profile->'values'=version.values||COALESCE((SELECT jsonb_object_agg(definition.field_key,local.value) FROM (SELECT data.card_version_id,data.field_definition_id,data.field_definition_version_id,version.values->'value' AS value,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='card_version_local_value')) local JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id WHERE local.card_version_id=version.id),'{}'::jsonb) AND profile->'fields'=spec.fields||COALESCE((SELECT jsonb_agg(field.field_schema ORDER BY definition.field_key) FROM (SELECT data.card_version_id,data.field_definition_id,data.field_definition_version_id,version.values->'value' AS value,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='card_version_local_value')) local JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id JOIN new_design.field_definition_versions field ON field.id=local.field_definition_version_id AND field.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb) AND profile->'localFields'=COALESCE((SELECT jsonb_agg(jsonb_build_object('definitionId',definition.id,'versionId',field.id,'field',field.field_schema,'value',local.value) ORDER BY definition.field_key) FROM (SELECT data.card_version_id,data.field_definition_id,data.field_definition_version_id,version.values->'value' AS value,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(card_version_id uuid,field_definition_id uuid,field_definition_version_id uuid,value jsonb,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='card_version_local_value')) local JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id JOIN new_design.field_definition_versions field ON field.id=local.field_definition_version_id AND field.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)) THEN RAISE EXCEPTION 'image preparation public source mismatch' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'image preparation unknown scope' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF (SELECT count(*) FROM new_design.context_manifest_items WHERE manifest_id=manifest.id)<>(CASE WHEN task.book_id IS NULL THEN 1 ELSE jsonb_array_length(source->'data'->'cards')+jsonb_array_length(source->'data'->'plans') END) OR EXISTS(
   SELECT 1 FROM new_design.context_manifest_items entry WHERE entry.manifest_id=manifest.id AND NOT COALESCE(
    entry.transform_status='full' AND entry.content_role='required' AND entry.token_estimate>=0 AND (
     task.book_id IS NULL AND entry.source_type='card_version' AND entry.stable_object_id=NEW.scope_id AND entry.exact_version_id=(NEW.input_payload->'scope'->>'resourceVersionId')::uuid OR
     task.book_id IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(source->'data'->'cards') card WHERE entry.source_type='card_version' AND entry.stable_object_id=(card->>'id')::uuid AND entry.exact_version_id=(card->>'versionId')::uuid) OR
     task.book_id IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(source->'data'->'plans') plan WHERE entry.source_type='planning_version' AND entry.stable_object_id=(plan->>'id')::uuid AND entry.exact_version_id=(plan->>'versionId')::uuid)
    ),false)) OR (SELECT count(DISTINCT (source_type,stable_object_id,exact_version_id)) FROM new_design.context_manifest_items WHERE manifest_id=manifest.id)<>(SELECT count(*) FROM new_design.context_manifest_items WHERE manifest_id=manifest.id) THEN
   RAISE EXCEPTION 'image preparation manifest sources mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.reply IS NOT NULL AND NOT COALESCE(NEW.reply->'output'->>'sourceHash'=source->>'hash' AND jsonb_typeof(NEW.reply->'output'->'chinese')='string' AND length(btrim(NEW.reply->'output'->>'chinese')) BETWEEN 1 AND 4000 AND jsonb_typeof(NEW.reply->'output'->'english')='string' AND length(btrim(NEW.reply->'output'->>'english')) BETWEEN 1 AND 4000 AND NEW.reply->'execution'->>'routeSnapshotId'=snapshot.id::text AND NEW.reply->'execution'->>'routeSnapshotHash'=snapshot.snapshot_hash AND NEW.reply->'execution'->>'provider'=snapshot.provider AND NEW.reply->'execution'->>'model'=snapshot.model AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reply->'execution'->'attempts') trace WHERE trace->>'status'='succeeded' AND trace->>'requestSent'='true' AND trace->>'responseReceived'='true'),false) THEN RAISE EXCEPTION 'image preparation actual reply mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.reply IS NOT NULL AND (NEW.reply-ARRAY['output','execution']<>'{}'::jsonb OR (NEW.reply->'output')-ARRAY['sourceHash','chinese','english','missingInformation']<>'{}'::jsonb OR jsonb_typeof(NEW.reply->'output'->'missingInformation')<>'array' OR jsonb_array_length(NEW.reply->'output'->'missingInformation')>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reply->'output'->'missingInformation') value WHERE jsonb_typeof(value)<>'string' OR length(value#>>'{}')>500)) THEN RAISE EXCEPTION 'image preparation reply shape mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='failed' AND (task.status<>'failed' OR step.status<>'failed' OR attempt.status<>'failed') OR NEW.status='ended_unknown' AND (NEW.reply IS NOT NULL OR task.status<>'cancelled' OR step.status<>'cancelled' OR attempt.status<>'discarded') THEN RAISE EXCEPTION 'image preparation terminal ledger mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='succeeded' AND (NEW.reply IS NULL OR NEW.output IS DISTINCT FROM NEW.reply->'output' OR task.status<>'succeeded' OR step.status<>'succeeded' OR attempt.status<>'succeeded') OR NEW.status IN ('failed','ended_unknown') AND NEW.output IS NOT NULL THEN RAISE EXCEPTION 'image preparation terminal mismatch' USING ERRCODE='23514'; END IF;
 RETURN;
END
$_$;


--
-- Name: quality_guard_guard_quality_report_update(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_guard_quality_report_update(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'quality_audit_reports');

BEGIN
 SELECT data.id,data.book_id,data.scope_kind,data.scope_id,data.task_id,data.step_id,data.attempt_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.rule_set_key,data.rule_set_version,data.input_hash,data.policy_mode,data.policy_decision,data.execution_effect,data.summary,data.idempotency_key,data.request_hash,data.created_by,data.created_at,data.stale_at,data.stale_reason INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text);
 SELECT data.id,data.book_id,data.scope_kind,data.scope_id,data.task_id,data.step_id,data.attempt_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.rule_set_key,data.rule_set_version,data.input_hash,data.policy_mode,data.policy_decision,data.execution_effect,data.summary,data.idempotency_key,data.request_hash,data.created_by,data.created_at,data.stale_at,data.stale_reason INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text);

  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'formed quality report is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['stale_at','stale_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['stale_at','stale_reason']::text[]) OR OLD.stale_at IS NOT NULL OR NEW.stale_at IS NULL THEN
    RAISE EXCEPTION 'formed quality report is immutable' USING ERRCODE='23514';
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_guard_resource_supplement_item_scope(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_guard_resource_supplement_item_scope(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_settlement_items'); child record; origin record; proposal record;
BEGIN
 SELECT data.id,data.session_id,data.category,data.major_category,data.title,data.canonical_fact_id,data.knowledge_proposal_id,data.state_proposal_id,data.evidence_anchor_id,data.risk_level,data.confidence,data.confidence_note,data.plan_alignment,data.plan_expectation,data.before_value,data.change_value,next->'after_value' AS after_value,data.source_kind,data.source_task_id,data.source_attempt_id,data.decision,data.decision_source,data.decision_note,data.revision,data.decided_at,data.created_at,data.updated_at INTO NEW FROM jsonb_to_record(next) AS data(id uuid,session_id uuid,category text,major_category text,title text,canonical_fact_id uuid,knowledge_proposal_id uuid,state_proposal_id uuid,evidence_anchor_id uuid,risk_level text,confidence numeric(5,4),confidence_note text,plan_alignment text,plan_expectation text,before_value jsonb,change_value jsonb,after_value jsonb,source_kind text,source_task_id uuid,source_attempt_id uuid,decision text,decision_source text,decision_note text,revision integer,decided_at timestamptz,created_at timestamptz,updated_at timestamptz);
 SELECT data.id,data.session_id,data.category,data.major_category,data.title,data.canonical_fact_id,data.knowledge_proposal_id,data.state_proposal_id,data.evidence_anchor_id,data.risk_level,data.confidence,data.confidence_note,data.plan_alignment,data.plan_expectation,data.before_value,data.change_value,previous->'after_value' AS after_value,data.source_kind,data.source_task_id,data.source_attempt_id,data.decision,data.decision_source,data.decision_note,data.revision,data.decided_at,data.created_at,data.updated_at INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,session_id uuid,category text,major_category text,title text,canonical_fact_id uuid,knowledge_proposal_id uuid,state_proposal_id uuid,evidence_anchor_id uuid,risk_level text,confidence numeric(5,4),confidence_note text,plan_alignment text,plan_expectation text,before_value jsonb,change_value jsonb,after_value jsonb,source_kind text,source_task_id uuid,source_attempt_id uuid,decision text,decision_source text,decision_note text,revision integer,decided_at timestamptz,created_at timestamptz,updated_at timestamptz);

  SELECT * INTO child FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=NEW.session_id;
  IF child.adoption_kind<>'resource_supplement' THEN RETURN; END IF;
  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=child.id;
  SELECT * INTO proposal FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) state_change_proposals WHERE id=NEW.state_proposal_id;
  IF NEW.category NOT IN ('prop','relationship') OR NEW.canonical_fact_id IS NOT NULL OR NEW.knowledge_proposal_id IS NOT NULL
    OR proposal.id IS NULL OR proposal.book_id IS DISTINCT FROM child.book_id
    OR proposal.chapter_document_id IS DISTINCT FROM child.chapter_document_id OR proposal.body_version_id IS DISTINCT FROM child.body_version_id
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(origin.source_snapshot->'resourceScope'->'resources') resource
      WHERE (NEW.category='prop' AND proposal.subject_kind='card' AND resource->>'id'=proposal.subject_id::text)
        OR (NEW.category='relationship' AND proposal.subject_kind='relation' AND resource->>'relationId'=proposal.subject_id::text)) THEN
    RAISE EXCEPTION 'resource supplement item must remain within its frozen resource scope' USING ERRCODE='23514';
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_guard_stable_checkpoint_origin(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_guard_stable_checkpoint_origin(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_stable_checkpoints');

BEGIN
 SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,next->'summary' AS summary,data.dependency_hash,data.status,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz);
 SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,previous->'summary' AS summary,data.dependency_hash,data.status,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz);

  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION 'stable checkpoint history and confirmation summary are immutable' USING ERRCODE='23514';
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_guard_world_consistency_request(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_guard_world_consistency_request(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'world_consistency_requests');
 BEGIN
 SELECT data.id,data.book_id,data.request_key,data.request_hash,data.input_hash,next->'input_payload' AS input_payload,next->'frozen_plan' AS frozen_plan,data.ai_task_id,data.step_id,data.attempt_id,data.report_id,data.status,data.model_request_state,data.generated_output,data.generated_execution,data.failure,data.created_at,data.updated_at INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,request_key uuid,request_hash char(64),input_hash char(64),input_payload jsonb,frozen_plan jsonb,ai_task_id uuid,step_id uuid,attempt_id uuid,report_id uuid,status text,model_request_state text,generated_output jsonb,generated_execution jsonb,failure jsonb,created_at timestamptz,updated_at timestamptz);
 SELECT data.id,data.book_id,data.request_key,data.request_hash,data.input_hash,previous->'input_payload' AS input_payload,previous->'frozen_plan' AS frozen_plan,data.ai_task_id,data.step_id,data.attempt_id,data.report_id,data.status,data.model_request_state,data.generated_output,data.generated_execution,data.failure,data.created_at,data.updated_at INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,request_key uuid,request_hash char(64),input_hash char(64),input_payload jsonb,frozen_plan jsonb,ai_task_id uuid,step_id uuid,attempt_id uuid,report_id uuid,status text,model_request_state text,generated_output jsonb,generated_execution jsonb,failure jsonb,created_at timestamptz,updated_at timestamptz);

 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'world consistency evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (OLD.book_id,OLD.request_key,OLD.request_hash,OLD.input_hash,OLD.input_payload,OLD.frozen_plan,OLD.ai_task_id,OLD.step_id,OLD.attempt_id) IS DISTINCT FROM (NEW.book_id,NEW.request_key,NEW.request_hash,NEW.input_hash,NEW.input_payload,NEW.frozen_plan,NEW.ai_task_id,NEW.step_id,NEW.attempt_id) THEN RAISE EXCEPTION 'world consistency freeze is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.generated_output IS NOT NULL AND (OLD.generated_output,OLD.generated_execution) IS DISTINCT FROM (NEW.generated_output,NEW.generated_execution) THEN RAISE EXCEPTION 'world consistency original reply is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'running' AND (OLD.status,OLD.report_id) IS DISTINCT FROM (NEW.status,NEW.report_id) THEN RAISE EXCEPTION 'terminal world check cannot be revived' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM new_design.ai_tasks task JOIN new_design.ai_task_steps step ON step.task_id=task.id JOIN new_design.ai_task_attempts attempt ON attempt.task_id=task.id AND attempt.step_id=step.id WHERE task.id=NEW.ai_task_id AND task.book_id=NEW.book_id AND task.source_kind='world_consistency' AND task.source_id=NEW.id AND step.id=NEW.step_id AND attempt.id=NEW.attempt_id AND attempt.input_hash=NEW.input_hash AND attempt.attempt_number=1 AND step.max_attempts=1) THEN RAISE EXCEPTION 'world check task attempt provenance mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='succeeded' AND NEW.report_id IS NULL THEN RAISE EXCEPTION 'world check success requires original quality report' USING ERRCODE='23514'; END IF;
 IF NEW.report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.scope_kind,data.scope_id,data.task_id,data.step_id,data.attempt_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.rule_set_key,data.rule_set_version,data.input_hash,data.policy_mode,data.policy_decision,data.execution_effect,data.summary,data.idempotency_key,data.request_hash,data.created_by,data.created_at,data.stale_at,data.stale_reason FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_audit_report')) report WHERE report.id=NEW.report_id AND report.book_id=NEW.book_id AND report.task_id=NEW.ai_task_id AND report.step_id=NEW.step_id AND report.attempt_id=NEW.attempt_id AND report.input_hash=NEW.input_hash AND report.rule_set_key='world_consistency' AND report.rule_set_version='v1') THEN RAISE EXCEPTION 'world report does not match original request' USING ERRCODE='23514'; END IF;
 IF NEW.generated_output IS NOT NULL AND (jsonb_typeof(NEW.generated_output)<>'object' OR NEW.generated_execution IS NULL OR jsonb_typeof(NEW.generated_execution)<>'object' OR NEW.model_request_state<>'completed' OR NEW.generated_execution->>'routeSnapshotId' IS DISTINCT FROM NEW.frozen_plan->>'snapshotId' OR NEW.generated_execution->>'routeSnapshotHash' IS DISTINCT FROM NEW.frozen_plan->>'snapshotHash' OR NEW.generated_execution->>'provider' IS DISTINCT FROM NEW.frozen_plan->'route'->'primary'->>'provider' OR NEW.generated_execution->>'model' IS DISTINCT FROM NEW.frozen_plan->'route'->'primary'->>'model' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.generated_execution->'attempts','[]'::jsonb)) attempt WHERE attempt->>'status'='succeeded' AND attempt->>'responseReceived'='true' AND attempt->>'requestSent'='true')) THEN RAISE EXCEPTION 'world reply requires original received execution proof' USING ERRCODE='23514'; END IF;
 IF NEW.status='ended_unknown' AND NEW.generated_output IS NOT NULL THEN RAISE EXCEPTION 'saved world reply cannot become unknown' USING ERRCODE='23514'; END IF;
 RETURN;
END
$$;


--
-- Name: quality_guard_guard_world_quality_adoption_binding(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_guard_world_quality_adoption_binding(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'quality_fix_adoptions');
 BEGIN
 SELECT data.id,data.candidate_id,data.candidate_version_id,data.chapter_body_adoption_id,data.adopted_body_version_id,data.idempotency_key,data.actor,data.created_at,data.adopted_card_version_id,data.author_write_request_key,data.world_repair_request_hash,data.world_repair_input INTO NEW FROM jsonb_to_record(next) AS data(id uuid,candidate_id uuid,candidate_version_id uuid,chapter_body_adoption_id uuid,adopted_body_version_id uuid,idempotency_key text,actor text,created_at timestamptz,adopted_card_version_id uuid,author_write_request_key uuid,world_repair_request_hash char(64),world_repair_input jsonb);
 SELECT data.id,data.candidate_id,data.candidate_version_id,data.chapter_body_adoption_id,data.adopted_body_version_id,data.idempotency_key,data.actor,data.created_at,data.adopted_card_version_id,data.author_write_request_key,data.world_repair_request_hash,data.world_repair_input INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,candidate_id uuid,candidate_version_id uuid,chapter_body_adoption_id uuid,adopted_body_version_id uuid,idempotency_key text,actor text,created_at timestamptz,adopted_card_version_id uuid,author_write_request_key uuid,world_repair_request_hash char(64),world_repair_input jsonb);

 IF NEW.adopted_card_version_id IS NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.issue_id,data.status,data.current_version_id,data.accepted_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,issue_id uuid,status text,current_version_id uuid,accepted_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_fix_candidate')) candidate JOIN (SELECT data.id,data.candidate_id,data.version,data.base_version_id,data.target_chapter_document_id,data.target_body_version_id,data.target_anchor_id,version.values->'patch' AS patch,data.content_hash,data.source,data.created_by,data.created_at,data.target_card_id,data.target_card_version_id,data.target_field_key,data.target_field_spec_version_id,data.target_field_spec_hash,data.target_before_hash FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,candidate_id uuid,version integer,base_version_id uuid,target_chapter_document_id uuid,target_body_version_id uuid,target_anchor_id uuid,patch jsonb,content_hash char(64),source text,created_by text,created_at timestamptz,target_card_id uuid,target_card_version_id uuid,target_field_key text,target_field_spec_version_id uuid,target_field_spec_hash char(64),target_before_hash char(64)) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_fix_candidate_version')) version ON version.candidate_id=candidate.id AND version.id=NEW.candidate_version_id JOIN new_design.card_versions baseline ON baseline.id=version.target_card_version_id AND baseline.card_id=version.target_card_id JOIN new_design.cards card ON card.id=version.target_card_id JOIN new_design.card_versions saved ON saved.id=NEW.adopted_card_version_id AND saved.card_id=card.id
  WHERE candidate.id=NEW.candidate_id AND saved.author_book_id=candidate.book_id AND saved.author_request_key=NEW.author_write_request_key AND card.current_version_id=saved.id AND saved.revision=baseline.revision+1 AND saved.author_write_receipt->>'operation'='update' AND saved.author_write_receipt->>'bookId'=candidate.book_id::text AND saved.author_write_receipt->>'cardVersionId'=saved.id::text AND (version.source='ai' OR NEW.world_repair_input->>'allowManualRevision'='true') AND COALESCE(saved.author_write_receipt->'localValues'->version.target_field_key,saved.values->version.target_field_key,'null'::jsonb) IS NOT DISTINCT FROM version.patch->'after')
 THEN RAISE EXCEPTION 'world fix adoption must be exact original normal form save' USING ERRCODE='23514'; END IF;RETURN;
END
$$;


--
-- Name: quality_guard_guard_world_quality_fix_binding(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_guard_world_quality_fix_binding(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'quality_fix_candidate_versions');
 BEGIN
 SELECT data.id,data.candidate_id,data.version,data.base_version_id,data.target_chapter_document_id,data.target_body_version_id,data.target_anchor_id,next->'patch' AS patch,data.content_hash,data.source,data.created_by,data.created_at,data.target_card_id,data.target_card_version_id,data.target_field_key,data.target_field_spec_version_id,data.target_field_spec_hash,data.target_before_hash INTO NEW FROM jsonb_to_record(next) AS data(id uuid,candidate_id uuid,version integer,base_version_id uuid,target_chapter_document_id uuid,target_body_version_id uuid,target_anchor_id uuid,patch jsonb,content_hash char(64),source text,created_by text,created_at timestamptz,target_card_id uuid,target_card_version_id uuid,target_field_key text,target_field_spec_version_id uuid,target_field_spec_hash char(64),target_before_hash char(64));
 SELECT data.id,data.candidate_id,data.version,data.base_version_id,data.target_chapter_document_id,data.target_body_version_id,data.target_anchor_id,previous->'patch' AS patch,data.content_hash,data.source,data.created_by,data.created_at,data.target_card_id,data.target_card_version_id,data.target_field_key,data.target_field_spec_version_id,data.target_field_spec_hash,data.target_before_hash INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,candidate_id uuid,version integer,base_version_id uuid,target_chapter_document_id uuid,target_body_version_id uuid,target_anchor_id uuid,patch jsonb,content_hash char(64),source text,created_by text,created_at timestamptz,target_card_id uuid,target_card_version_id uuid,target_field_key text,target_field_spec_version_id uuid,target_field_spec_hash char(64),target_before_hash char(64));

 IF NEW.target_card_id IS NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.issue_id,data.status,data.current_version_id,data.accepted_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,issue_id uuid,status text,current_version_id uuid,accepted_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_fix_candidate')) candidate JOIN (SELECT data.id,data.book_id,data.report_id,data.stable_key,data.current_version_id,data.current_status,data.is_quality_debt,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,report_id uuid,stable_key text,current_version_id uuid,current_status text,is_quality_debt boolean,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_issue')) issue ON issue.id=candidate.issue_id JOIN (SELECT data.id,data.book_id,data.scope_kind,data.scope_id,data.task_id,data.step_id,data.attempt_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.rule_set_key,data.rule_set_version,data.input_hash,data.policy_mode,data.policy_decision,data.execution_effect,data.summary,data.idempotency_key,data.request_hash,data.created_by,data.created_at,data.stale_at,data.stale_reason FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_audit_report')) report ON report.id=issue.report_id JOIN (SELECT data.report_id,data.subject_kind,data.subject_id,data.card_version_id,data.relation_version_id,data.snapshot_hash FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(report_id uuid,subject_kind text,subject_id uuid,card_version_id uuid,relation_version_id uuid,snapshot_hash char(64)) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_report_material_version')) binding ON binding.report_id=report.id
 WHERE candidate.id=NEW.candidate_id AND candidate.book_id=issue.book_id AND candidate.book_id=report.book_id AND binding.subject_kind='card' AND binding.subject_id=NEW.target_card_id AND binding.card_version_id=NEW.target_card_version_id)
 THEN RAISE EXCEPTION 'world fix target must bind original issue report material' USING ERRCODE='23514'; END IF;
 IF NEW.base_version_id IS NULL THEN
  IF NEW.source<>'ai' OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.request_key,data.request_hash,data.input_hash,version.values->'input_payload' AS input_payload,version.values->'frozen_plan' AS frozen_plan,data.ai_task_id,data.step_id,data.attempt_id,data.report_id,data.status,data.model_request_state,data.generated_output,data.generated_execution,data.failure,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,request_key uuid,request_hash char(64),input_hash char(64),input_payload jsonb,frozen_plan jsonb,ai_task_id uuid,step_id uuid,attempt_id uuid,report_id uuid,status text,model_request_state text,generated_output jsonb,generated_execution jsonb,failure jsonb,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='world_consistency_request')) request JOIN (SELECT data.id,data.book_id,data.scope_kind,data.scope_id,data.task_id,data.step_id,data.attempt_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.rule_set_key,data.rule_set_version,data.input_hash,data.policy_mode,data.policy_decision,data.execution_effect,data.summary,data.idempotency_key,data.request_hash,data.created_by,data.created_at,data.stale_at,data.stale_reason FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_audit_report')) report ON report.task_id=request.ai_task_id AND report.attempt_id=request.attempt_id AND report.book_id=request.book_id JOIN (SELECT data.id,data.book_id,data.report_id,data.stable_key,data.current_version_id,data.current_status,data.is_quality_debt,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,report_id uuid,stable_key text,current_version_id uuid,current_status text,is_quality_debt boolean,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_issue')) issue ON issue.report_id=report.id JOIN (SELECT data.id,data.book_id,data.issue_id,data.status,data.current_version_id,data.accepted_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,issue_id uuid,status text,current_version_id uuid,accepted_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_fix_candidate')) candidate ON candidate.issue_id=issue.id CROSS JOIN LATERAL jsonb_array_elements(request.generated_output->'findings') finding CROSS JOIN LATERAL jsonb_array_elements(finding->'fixes') fix
   WHERE candidate.id=NEW.candidate_id AND finding->>'stableKey'=issue.stable_key AND fix->>'cardId'=NEW.target_card_id::text AND fix->>'cardVersionId'=NEW.target_card_version_id::text AND fix->>'fieldKey'=NEW.target_field_key AND fix->>'specVersionId'=NEW.target_field_spec_version_id::text AND fix->>'specHash'=NEW.target_field_spec_hash AND fix->>'beforeHash'=NEW.target_before_hash AND fix->'after' IS NOT DISTINCT FROM NEW.patch->'after')
  THEN RAISE EXCEPTION 'world initial fix must be an exact original received proposal' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.candidate_id,data.version,data.base_version_id,data.target_chapter_document_id,data.target_body_version_id,data.target_anchor_id,version.values->'patch' AS patch,data.content_hash,data.source,data.created_by,data.created_at,data.target_card_id,data.target_card_version_id,data.target_field_key,data.target_field_spec_version_id,data.target_field_spec_hash,data.target_before_hash FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,candidate_id uuid,version integer,base_version_id uuid,target_chapter_document_id uuid,target_body_version_id uuid,target_anchor_id uuid,patch jsonb,content_hash char(64),source text,created_by text,created_at timestamptz,target_card_id uuid,target_card_version_id uuid,target_field_key text,target_field_spec_version_id uuid,target_field_spec_hash char(64),target_before_hash char(64)) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_fix_candidate_version')) base WHERE base.id=NEW.base_version_id AND base.candidate_id=NEW.candidate_id AND (base.target_card_id,base.target_card_version_id,base.target_field_key,base.target_field_spec_version_id,base.target_field_spec_hash,base.target_before_hash) IS NOT DISTINCT FROM (NEW.target_card_id,NEW.target_card_version_id,NEW.target_field_key,NEW.target_field_spec_version_id,NEW.target_field_spec_hash,NEW.target_before_hash)) THEN RAISE EXCEPTION 'world fix revision cannot change its exact original target' USING ERRCODE='23514'; END IF;
  IF NEW.source<>'user' OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.issue_id,data.status,data.current_version_id,data.accepted_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,issue_id uuid,status text,current_version_id uuid,accepted_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_fix_candidate')) candidate JOIN new_design.card_versions saved ON saved.card_id=NEW.target_card_id AND saved.author_book_id=candidate.book_id JOIN new_design.card_versions baseline ON baseline.id=NEW.target_card_version_id AND baseline.card_id=NEW.target_card_id JOIN new_design.cards card ON card.id=NEW.target_card_id
   WHERE candidate.id=NEW.candidate_id AND saved.id::text=NEW.patch->>'cardVersionId' AND saved.author_request_key::text=NEW.patch->>'authorWriteRequestKey' AND card.current_version_id=saved.id AND saved.revision=baseline.revision+1 AND saved.author_write_receipt->>'operation'='update' AND COALESCE(saved.author_write_receipt->'localValues'->NEW.target_field_key,saved.values->NEW.target_field_key,'null'::jsonb) IS NOT DISTINCT FROM NEW.patch->'after')
  THEN RAISE EXCEPTION 'world user revision requires exact original normal save value' USING ERRCODE='23514'; END IF;
 END IF;RETURN;
END
$$;


--
-- Name: quality_guard_guard_world_quality_recheck_binding(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_guard_world_quality_recheck_binding(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'quality_rechecks');
 BEGIN
 SELECT data.id,data.book_id,data.issue_id,data.fix_candidate_id,data.source_report_id,data.recheck_report_id,data.checked_body_version_id,data.outcome,data.evidence_summary,data.status,data.idempotency_key,data.request_hash,data.actor,data.created_at,data.stale_at,data.stale_reason,data.checked_material_versions INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,issue_id uuid,fix_candidate_id uuid,source_report_id uuid,recheck_report_id uuid,checked_body_version_id uuid,outcome text,evidence_summary text,status text,idempotency_key text,request_hash char(64),actor text,created_at timestamptz,stale_at timestamptz,stale_reason text,checked_material_versions jsonb);
 SELECT data.id,data.book_id,data.issue_id,data.fix_candidate_id,data.source_report_id,data.recheck_report_id,data.checked_body_version_id,data.outcome,data.evidence_summary,data.status,data.idempotency_key,data.request_hash,data.actor,data.created_at,data.stale_at,data.stale_reason,data.checked_material_versions INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,issue_id uuid,fix_candidate_id uuid,source_report_id uuid,recheck_report_id uuid,checked_body_version_id uuid,outcome text,evidence_summary text,status text,idempotency_key text,request_hash char(64),actor text,created_at timestamptz,stale_at timestamptz,stale_reason text,checked_material_versions jsonb);

 IF NEW.checked_material_versions IS NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.report_id,data.stable_key,data.current_version_id,data.current_status,data.is_quality_debt,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,report_id uuid,stable_key text,current_version_id uuid,current_status text,is_quality_debt boolean,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_issue')) issue JOIN (SELECT data.id,data.book_id,data.scope_kind,data.scope_id,data.task_id,data.step_id,data.attempt_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.rule_set_key,data.rule_set_version,data.input_hash,data.policy_mode,data.policy_decision,data.execution_effect,data.summary,data.idempotency_key,data.request_hash,data.created_by,data.created_at,data.stale_at,data.stale_reason FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_audit_report')) report ON report.id=NEW.recheck_report_id WHERE issue.id=NEW.issue_id AND issue.book_id=NEW.book_id AND issue.report_id=NEW.source_report_id AND report.book_id=NEW.book_id AND report.stale_at IS NULL AND (NEW.outcome<>'supports_verified' OR issue.current_status='fixed')) OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(NEW.checked_material_versions) subject WHERE jsonb_typeof(subject)<>'object' OR NOT EXISTS(
   SELECT 1 FROM (SELECT data.report_id,data.subject_kind,data.subject_id,data.card_version_id,data.relation_version_id,data.snapshot_hash FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(report_id uuid,subject_kind text,subject_id uuid,card_version_id uuid,relation_version_id uuid,snapshot_hash char(64)) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_report_material_version')) binding WHERE binding.report_id=NEW.recheck_report_id AND binding.subject_kind=subject->>'kind' AND binding.subject_id::text=subject->>'id' AND COALESCE(binding.card_version_id,binding.relation_version_id)::text=subject->>'versionId' AND binding.snapshot_hash=subject->>'snapshotHash'))
 THEN RAISE EXCEPTION 'world recheck must bind exact current report materials and original issue' USING ERRCODE='23514'; END IF;
 RETURN;
END
$$;


--
-- Name: quality_guard_record_version(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_record_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE kind text; previous jsonb; operation text;
BEGIN
 SELECT type.type_key,version.values INTO kind,previous FROM cards card
 JOIN card_types type ON type.id=card.card_type_id
 LEFT JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
 IF kind IS NULL THEN RAISE EXCEPTION 'quality record requires owning card' USING ERRCODE='23514'; END IF;
 operation:=CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END;
 PERFORM quality_validate_record_shape(kind,NEW.values,NEW.card_id);
 IF previous IS NOT NULL AND kind=ANY(ARRAY['chapter_resource_supplement','resource_supplement_impact_review','resource_supplement_integrity_journal','resource_supplement_integrity_issue','resource_supplement_integrity_resolution','resource_supplement_correction_origin','resource_supplement_formal_commit','quality_issue_version','quality_report_body_version','quality_report_planning_version','quality_report_fact','quality_issue_evidence','quality_issue_event','quality_fix_candidate_version','quality_fix_candidate_event','quality_fix_adoption','quality_report_material_version']::text[]) THEN
  RAISE EXCEPTION 'quality and resource source evidence is append-only' USING ERRCODE='23514';
 END IF;
 IF kind='quality_audit_report' AND previous IS NOT NULL THEN
  PERFORM quality_guard_guard_quality_report_update(previous,NEW.values,operation,'quality_audit_reports');
 END IF;
 IF kind='quality_recheck' AND previous IS NOT NULL THEN
  IF (NEW.values-ARRAY['status','stale_at','stale_reason']::text[]) IS DISTINCT FROM (previous-ARRAY['status','stale_at','stale_reason']::text[])
  OR previous->>'status'<>'active' OR NEW.values->>'status'<>'stale' OR NEW.values->>'stale_at' IS NULL THEN
   RAISE EXCEPTION 'quality recheck is append-only except first stale mark' USING ERRCODE='23514';
  END IF;
 END IF;
 CASE kind
 WHEN 'chapter_resource_supplement' THEN
  PERFORM quality_guard_validate_resource_supplement_origin(previous,NEW.values,operation,'chapter_resource_supplements');
 WHEN 'resource_supplement_impact_review' THEN
  PERFORM quality_guard_validate_resource_supplement_impact_review(previous,NEW.values,operation,'resource_supplement_impact_reviews');
 WHEN 'resource_supplement_integrity_journal' THEN
  PERFORM quality_guard_validate_resource_supplement_integrity_journal(previous,NEW.values,operation,'resource_supplement_integrity_journals');
 WHEN 'resource_supplement_integrity_issue' THEN
  PERFORM quality_guard_validate_resource_supplement_integrity_issue(previous,NEW.values,operation,'resource_supplement_integrity_issues');
 WHEN 'resource_supplement_integrity_resolution' THEN
  PERFORM quality_guard_reject_unavailable_resource_integrity_resolution(previous,NEW.values,operation,'resource_supplement_integrity_resolutions');
 WHEN 'resource_supplement_correction_origin' THEN
  PERFORM quality_guard_validate_resource_supplement_correction_origin(previous,NEW.values,operation,'resource_supplement_correction_origins');
 WHEN 'resource_supplement_formal_commit' THEN
  PERFORM quality_guard_validate_resource_supplement_formal_commit(previous,NEW.values,operation,'resource_supplement_formal_commits');
 WHEN 'current_state_projection' THEN
  PERFORM quality_guard_fence_resource_supplement_integrity_projection(previous,NEW.values,operation,'current_state_projections');
 WHEN 'chapter_proposal_extraction_request' THEN
  IF previous IS NULL THEN
   PERFORM quality_guard_fence_resource_supplement_integrity_extraction(previous,NEW.values,operation,'chapter_proposal_extraction_requests');
   PERFORM quality_guard_block_unavailable_resource_correction_candidates(previous,NEW.values,operation,'chapter_proposal_extraction_requests');
   PERFORM quality_guard_block_unavailable_resource_supplement_extraction(previous,NEW.values,operation,'chapter_proposal_extraction_requests');
  END IF;
 WHEN 'chapter_stable_checkpoint' THEN
  IF previous IS NOT NULL THEN PERFORM quality_guard_guard_stable_checkpoint_origin(previous,NEW.values,operation,'chapter_stable_checkpoints'); END IF;
 WHEN 'world_consistency_request' THEN
  PERFORM quality_guard_guard_world_consistency_request(previous,NEW.values,operation,'world_consistency_requests');
 WHEN 'quality_report_material_version' THEN
  PERFORM quality_guard_validate_world_quality_material(previous,NEW.values,operation,'quality_report_material_versions');
 WHEN 'quality_issue_evidence' THEN
  PERFORM quality_guard_world_quality_evidence_binding_guard(previous,NEW.values,operation,'quality_issue_evidence');
 WHEN 'quality_recheck' THEN
  IF previous IS NULL THEN PERFORM quality_guard_guard_world_quality_recheck_binding(previous,NEW.values,operation,'quality_rechecks'); END IF;
 WHEN 'quality_fix_candidate_version' THEN
  PERFORM quality_guard_guard_world_quality_fix_binding(previous,NEW.values,operation,'quality_fix_candidate_versions');
 WHEN 'quality_fix_adoption' THEN
  PERFORM quality_guard_guard_world_quality_adoption_binding(previous,NEW.values,operation,'quality_fix_adoptions');
 WHEN 'image_prompt_preparation' THEN
  PERFORM quality_guard_guard_image_preparation(previous,NEW.values,operation,'image_prompt_preparations');
 ELSE NULL;
 END CASE;
 RETURN NEW;
END $$;


--
-- Name: quality_guard_reject_unavailable_resource_integrity_resolution(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_reject_unavailable_resource_integrity_resolution(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'resource_supplement_integrity_resolutions');

BEGIN
 SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,next->'full_proof' AS full_proof,data.proof_hash,next->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof INTO NEW FROM jsonb_to_record(next) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text);
 SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,previous->'full_proof' AS full_proof,data.proof_hash,previous->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof INTO OLD FROM jsonb_to_record(previous) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text);

  -- resource_supplement_correction_commit_v1: actual proof only, never acknowledgement.
  PERFORM assert_resource_correction_resolution_source(to_jsonb(NEW));
  RETURN;
END
$$;


--
-- Name: quality_guard_require_resource_supplement_closure(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_require_resource_supplement_closure(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_settlements'); child record; base record; next_checkpoint record;
  confirmation_kind text; expected jsonb; actual jsonb;
BEGIN
 SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.status,data.revision,data.idempotency_key,data.revert_idempotency_key,data.actor,data.note,data.committed_at,data.reverted_at,data.supplement_base_checkpoint_id INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,status text,revision integer,idempotency_key text,revert_idempotency_key text,actor text,note text,committed_at timestamptz,reverted_at timestamptz,supplement_base_checkpoint_id uuid);
 SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.status,data.revision,data.idempotency_key,data.revert_idempotency_key,data.actor,data.note,data.committed_at,data.reverted_at,data.supplement_base_checkpoint_id INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,status text,revision integer,idempotency_key text,revert_idempotency_key text,actor text,note text,committed_at timestamptz,reverted_at timestamptz,supplement_base_checkpoint_id uuid);

  IF NEW.supplement_base_checkpoint_id IS NULL OR NEW.status<>'committed' THEN RETURN; END IF;
  SELECT * INTO child FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE settlement_id=NEW.id AND adoption_kind='resource_supplement';
  SELECT * INTO base FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=NEW.supplement_base_checkpoint_id;
  SELECT * INTO next_checkpoint FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE settlement_id=NEW.id AND session_id=child.id;
  IF child.status IS DISTINCT FROM 'stable' OR base.status IS DISTINCT FROM 'superseded'
    OR next_checkpoint.status IS DISTINCT FROM 'stable' OR next_checkpoint.previous_checkpoint_id IS DISTINCT FROM base.id
    OR next_checkpoint.book_id IS DISTINCT FROM base.book_id OR next_checkpoint.chapter_document_id IS DISTINCT FROM base.chapter_document_id
    OR next_checkpoint.body_version_id IS DISTINCT FROM base.body_version_id OR next_checkpoint.chapter_order IS DISTINCT FROM base.chapter_order
    OR next_checkpoint.summary->>'supplementBaseCheckpointId' IS DISTINCT FROM base.id::text
    OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) original JOIN new_design.chapter_settlements original_settlement ON original_settlement.id=original.settlement_id
      WHERE original.id=base.session_id AND original.status='stable' AND original.settlement_id=base.settlement_id AND original_settlement.status='committed') THEN
    RAISE EXCEPTION 'supplement must retain original settlement and atomically replace only its active checkpoint' USING ERRCODE='23514';
  END IF;
  FOREACH confirmation_kind IN ARRAY ARRAY['facts','knowledge','states'] LOOP
    IF jsonb_typeof(base.summary->'confirmed'->confirmation_kind) IS DISTINCT FROM 'array'
      OR jsonb_typeof(next_checkpoint.summary->'confirmed'->confirmation_kind) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'supplement requires complete original and merged confirmation lists' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO expected FROM (
      SELECT value id FROM jsonb_array_elements_text(base.summary->'confirmed'->confirmation_kind)
      UNION
      SELECT fact.id::text FROM (SELECT data.id,data.book_id,data.subject_card_id,data.predicate,data.value_kind,version.values->'value_json' AS value_json,data.value_hash,data.object_card_id,data.valid_story_start,data.valid_story_end,data.status,data.confidence,data.source_method,data.supersedes_fact_id,data.superseded_by_fact_id,data.revision,data.created_by,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,subject_card_id uuid,predicate text,value_kind text,value_json jsonb,value_hash char(64),object_card_id uuid,valid_story_start numeric,valid_story_end numeric,status text,confidence numeric(5,4),source_method text,supersedes_fact_id uuid,superseded_by_fact_id uuid,revision integer,created_by text,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='canonical_fact')) fact JOIN new_design.chapter_settlement_items item ON item.canonical_fact_id=fact.id
        WHERE confirmation_kind='facts' AND item.session_id=child.id AND item.decision='confirm' AND fact.status='confirmed'
      UNION
      SELECT change.id::text FROM (SELECT data.id,data.sequence,data.book_id,data.proposal_id,data.proposal_version_id,data.claim_id,data.holder_kind,data.holder_key,data.holder_card_id,data.stance,data.confidence,data.effective_story_order,data.effective_narrative_order,data.status,data.confirmed_by,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,proposal_id uuid,proposal_version_id uuid,claim_id uuid,holder_kind text,holder_key text,holder_card_id uuid,stance text,confidence numeric,effective_story_order numeric,effective_narrative_order numeric,status text,confirmed_by text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='knowledge_state_change')) change JOIN new_design.chapter_settlement_items item ON item.knowledge_proposal_id=change.proposal_id
        WHERE confirmation_kind='knowledge' AND item.session_id=child.id AND item.decision='confirm' AND change.status='active'
      UNION
      SELECT change.id::text FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change WHERE confirmation_kind='states' AND change.settlement_id=NEW.id AND change.status='active'
    ) merged;
    SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO actual FROM jsonb_array_elements_text(next_checkpoint.summary->'confirmed'->confirmation_kind);
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'supplement cannot omit, duplicate or invent confirmation sources' USING ERRCODE='23514'; END IF;
  END LOOP;
  -- Retain every original confirmation check; require the full actual closure.
  PERFORM assert_resource_supplement_formal_closure(NEW.id);
  RETURN;
END
$$;


--
-- Name: quality_guard_require_resource_supplement_correction_origin(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_require_resource_supplement_correction_origin(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_resource_supplements');

BEGIN
 SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,next->'full_input' AS full_input,data.input_hash,next->'source_snapshot' AS source_snapshot,data.source_hash,next->'original_receipt' AS original_receipt,data.actor,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz);
 SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,previous->'full_input' AS full_input,data.input_hash,previous->'source_snapshot' AS source_snapshot,data.source_hash,previous->'original_receipt' AS original_receipt,data.actor,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz);

  IF NEW.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_supplement_preview_v1' THEN
    IF NEW.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1' OR NOT EXISTS(
      SELECT 1 FROM (SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_correction_origin')) resource_supplement_correction_origins WHERE session_id=NEW.session_id AND book_id=NEW.book_id)
      THEN RAISE EXCEPTION 'correction session requires its atomic full original proof' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_require_resource_supplement_receipt(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_require_resource_supplement_receipt(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_adoption_sessions');

BEGIN
 SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid);
 SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid);

  IF NEW.adoption_kind='resource_supplement' AND NOT EXISTS(SELECT 1 FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) origin
    WHERE origin.session_id=NEW.id AND origin.base_checkpoint_id=NEW.supplement_base_checkpoint_id AND origin.book_id=NEW.book_id) THEN
    RAISE EXCEPTION 'supplement session requires an atomic full original receipt' USING ERRCODE='23514';
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_validate_resource_supplement_correction_origin(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_validate_resource_supplement_correction_origin(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'resource_supplement_correction_origins'); origin record; child record;
  issue record; base record;
  source jsonb; correction jsonb; actual_prefix jsonb; related jsonb; field jsonb; prefix_order integer;
BEGIN
 SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz);
 SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz);

  -- stable_resource_correction_start_v1: creation only; no candidate or resolution permission.
  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=NEW.session_id AND book_id=NEW.book_id;
  SELECT * INTO child FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=NEW.session_id AND book_id=NEW.book_id;
  SELECT * INTO issue FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) resource_supplement_integrity_issues WHERE issue_id=NEW.issue_id AND book_id=NEW.book_id;
  SELECT * INTO base FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=NEW.book_id AND status='stable';
  source:=origin.source_snapshot; correction:=source->'correction';
  IF origin.session_id IS NULL OR child.id IS NULL OR issue.issue_id IS NULL OR base.id IS NULL
    OR child.status IS DISTINCT FROM 'adopted_pending_proposals' OR child.adoption_kind IS DISTINCT FROM 'resource_supplement'
    OR base.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR base.body_version_id IS DISTINCT FROM issue.body_version_id
    OR child.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR child.body_version_id IS DISTINCT FROM issue.body_version_id
    OR NOT EXISTS(SELECT 1 FROM new_design.books WHERE id=NEW.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM new_design.chapter_documents WHERE id=issue.chapter_document_id AND book_id=NEW.book_id AND status='active' AND adopted_version_id=issue.body_version_id)
    OR EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE issue_id=NEW.issue_id)
    OR EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE chapter_document_id=issue.chapter_document_id AND id<>child.id
      AND status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed'))
    OR source->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1'
    OR origin.original_receipt->>'contract' IS DISTINCT FROM 'stable_resource_correction_start_v1'
    OR origin.full_input->>'issueId' IS DISTINCT FROM NEW.issue_id::text
    OR origin.original_receipt->>'issueId' IS DISTINCT FROM NEW.issue_id::text
    OR source->'input' IS DISTINCT FROM jsonb_build_object('issueId',NEW.issue_id,'resourceScope',origin.full_input->'resourceScope')
    OR NEW.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract','stable_resource_correction_start_v1','bookId',NEW.book_id,'input',origin.full_input)
    OR encode(sha256(convert_to(NEW.canonical_input,'UTF8')),'hex') IS DISTINCT FROM origin.input_hash::text
    OR NEW.canonical_source::jsonb IS DISTINCT FROM source-'sourceHash'
    OR encode(sha256(convert_to(NEW.canonical_source,'UTF8')),'hex') IS DISTINCT FROM origin.source_hash::text
    OR correction->>'contract' IS DISTINCT FROM 'resource_supplement_correction_basis_v1'
    OR correction->>'bookId' IS DISTINCT FROM NEW.book_id::text OR correction->>'issueId' IS DISTINCT FROM NEW.issue_id::text
    OR correction->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR correction->>'chapterDocumentId' IS DISTINCT FROM issue.chapter_document_id::text
    OR correction->>'bodyVersionId' IS DISTINCT FROM issue.body_version_id::text
    OR correction->>'subjectKind' IS DISTINCT FROM issue.subject_kind OR correction->>'subjectId' IS DISTINCT FROM issue.subject_id::text
    OR correction->>'stateKey' IS DISTINCT FROM issue.state_key
    OR correction->'issue' IS DISTINCT FROM to_jsonb(issue)||jsonb_build_object('current_checkpoint',to_jsonb(base))
    OR correction->'chapterEndBasis' IS DISTINCT FROM source->'basis'
    OR correction->'originalRecordedBefore' IS DISTINCT FROM issue.impact->'recordedBefore'
    OR correction->'originalRecordedAfter' IS DISTINCT FROM issue.impact->'recordedAfter'
    OR origin.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||NEW.book_id||'/writing?chapterDocument='||issue.chapter_document_id||'&session='||NEW.session_id||'&resourceIssue='||NEW.issue_id
    THEN RAISE EXCEPTION 'correction original input, issue or current body mismatch' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('change',to_jsonb(change),'proposal',to_jsonb(proposal),'settlement',to_jsonb(settlement),
    'anchor',to_jsonb(anchor),'document',to_jsonb(document),'body',to_jsonb(body),'checkpoint',to_jsonb(checkpoint),
    'checkpoint_commit',to_jsonb(checkpoint_commit),'checkpoint_session',to_jsonb(checkpoint_session)),document.logical_order
    INTO actual_prefix,prefix_order FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change
    JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) proposal ON proposal.id=change.proposal_id
    LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
    LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
    LEFT JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) checkpoint ON checkpoint.book_id=change.book_id AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
    LEFT JOIN new_design.chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id
    LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) checkpoint_session ON checkpoint_session.id=checkpoint.session_id
    WHERE change.book_id=NEW.book_id AND change.subject_kind=issue.subject_kind AND change.subject_id=issue.subject_id AND change.state_key=issue.state_key AND change.status='active'
      AND document.logical_order<base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<base.chapter_order
    ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
  IF actual_prefix IS NULL OR correction->'prefixSource' IS DISTINCT FROM actual_prefix
    OR correction->'beforeValue' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'proposal'->>'status' IS DISTINCT FROM 'confirmed'
    OR actual_prefix->'proposal'->>'book_id' IS DISTINCT FROM NEW.book_id::text
    OR actual_prefix->'proposal'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'proposal'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'proposal'->>'subject_kind' IS DISTINCT FROM issue.subject_kind
    OR actual_prefix->'proposal'->>'subject_id' IS DISTINCT FROM issue.subject_id::text
    OR actual_prefix->'proposal'->>'state_key' IS DISTINCT FROM issue.state_key
    OR actual_prefix->'proposal'->>'confirmed_state_change_id' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR actual_prefix->'proposal'->'before_json' IS DISTINCT FROM actual_prefix->'change'->'before_json'
    OR actual_prefix->'proposal'->'after_json' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'settlement'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'settlement'->>'book_id' IS DISTINCT FROM NEW.book_id::text
    OR actual_prefix->'settlement'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'settlement'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'body'->'archived_at' IS DISTINCT FROM 'null'::jsonb
    OR encode(sha256(convert_to(actual_prefix->'body'->>'content','UTF8')),'hex') IS DISTINCT FROM actual_prefix->'body'->>'content_hash'
    OR actual_prefix->'checkpoint_commit'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'checkpoint_commit'->>'book_id' IS DISTINCT FROM NEW.book_id::text
    OR actual_prefix->'checkpoint_commit'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_commit'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'status' IS DISTINCT FROM 'stable'
    OR actual_prefix->'checkpoint_session'->>'book_id' IS DISTINCT FROM NEW.book_id::text
    OR actual_prefix->'checkpoint_session'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_session'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'settlement_id' IS DISTINCT FROM actual_prefix->'checkpoint_commit'->>'id'
    OR NOT coalesce((actual_prefix->'checkpoint'->'summary'->'confirmed'->'states') ? (actual_prefix->'change'->>'id'),false)
    OR (SELECT count(*) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
      IS DISTINCT FROM (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
    OR actual_prefix->'change'->'text_anchor_id'<>'null'::jsonb AND (actual_prefix->'anchor'->>'status' IS DISTINCT FROM 'active'
      OR actual_prefix->'anchor'->>'book_id' IS DISTINCT FROM NEW.book_id::text
      OR actual_prefix->'anchor'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
      OR actual_prefix->'anchor'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id')
    OR EXISTS(SELECT 1 FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) earlier JOIN new_design.chapter_documents document ON document.id=earlier.chapter_document_id
      WHERE earlier.book_id=NEW.book_id AND earlier.subject_kind=issue.subject_kind AND earlier.subject_id=issue.subject_id AND document.logical_order<=prefix_order
        AND NOT EXISTS(SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE issue_id=earlier.issue_id))
    THEN RAISE EXCEPTION 'correction must retain the actual valid latest chapter-before proof' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(actual) ORDER BY document.logical_order,actual.issue_id),'[]'::jsonb) INTO related
    FROM (SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,version.values->'impact' AS impact,data.source_route,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_issue')) actual JOIN new_design.chapter_documents document ON document.id=actual.chapter_document_id AND document.book_id=actual.book_id
    WHERE actual.book_id=NEW.book_id AND document.logical_order<=base.chapter_order AND NOT EXISTS(
      SELECT 1 FROM (SELECT data.resolution_id,data.issue_id,data.book_id,data.correction_checkpoint_id,data.request_key,version.values->'full_proof' AS full_proof,data.proof_hash,version.values->'original_receipt' AS original_receipt,data.created_at,data.canonical_proof FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(resolution_id uuid,issue_id uuid,book_id uuid,correction_checkpoint_id uuid,request_key uuid,full_proof jsonb,proof_hash char(64),original_receipt jsonb,created_at timestamptz,canonical_proof text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_resolution')) resource_supplement_integrity_resolutions WHERE issue_id=actual.issue_id)
    AND ((actual.subject_kind='card' AND (origin.full_input->'resourceScope'->'resourceIds') ? actual.subject_id::text)
      OR (actual.subject_kind='relation' AND (origin.full_input->'resourceScope'->'relationIds') ? actual.subject_id::text));
  IF related IS DISTINCT FROM source->'relatedIssues' OR NOT related @> jsonb_build_array(to_jsonb(issue))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(related) item WHERE item->>'chapter_document_id' IS DISTINCT FROM issue.chapter_document_id::text
      OR item->>'body_version_id' IS DISTINCT FROM issue.body_version_id::text OR item->>'subject_kind' IS DISTINCT FROM issue.subject_kind
      OR item->>'subject_id' IS DISTINCT FROM issue.subject_id::text OR item->>'state_key' IS DISTINCT FROM issue.state_key)
    OR origin.original_receipt->'relatedIssueIds' IS DISTINCT FROM (SELECT jsonb_agg(item->'issue_id') FROM jsonb_array_elements(related) item)
    THEN RAISE EXCEPTION 'correction must retain every selected actual related issue' USING ERRCODE='23514'; END IF;
  SELECT item INTO field FROM jsonb_array_elements(source->'catalog'->'subjects') subject,
    jsonb_array_elements(subject->'fields') item WHERE subject->>'subjectKind'=issue.subject_kind AND subject->>'id'=issue.subject_id::text AND item->>'key'=issue.state_key;
  IF field IS NULL OR field->'baseline'->'known' IS DISTINCT FROM 'true'::jsonb OR field->'baseline'->'stale' IS DISTINCT FROM 'false'::jsonb
    OR field->'baseline'->'value' IS DISTINCT FROM correction->'beforeValue'
    OR field->'baseline'->>'sourceKind' IS DISTINCT FROM 'state_change'
    OR field->'baseline'->>'sourceId' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.expected_document_revision,data.planning_object_id,data.planning_version_id,data.planning_content_hash,data.context_manifest_id,version.values->'dependency_snapshot' AS dependency_snapshot,data.dependency_hash,data.status,data.idempotency_key,data.created_by,data.created_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,expected_document_revision integer,planning_object_id uuid,planning_version_id uuid,planning_content_hash char(64),context_manifest_id uuid,dependency_snapshot jsonb,dependency_hash char(64),status text,idempotency_key text,created_by text,created_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_preparation')) chapter_adoption_preparations WHERE id=child.preparation_id AND dependency_snapshot->>'correctionIssueId'=issue.issue_id::text
      AND dependency_snapshot->'correctionIssueIds'=origin.original_receipt->'relatedIssueIds' AND dependency_snapshot->>'correctionSourceHash'=correction->>'sourceHash')
    THEN RAISE EXCEPTION 'correction editor baseline must remain bound to actual chapter-before evidence' USING ERRCODE='23514'; END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_validate_resource_supplement_formal_commit(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_validate_resource_supplement_formal_commit(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'resource_supplement_formal_commits');

BEGIN
 SELECT data.book_id,data.session_id,data.settlement_id,data.request_key,next->'full_input' AS full_input,data.input_hash,data.canonical_input,next->'original_receipt' AS original_receipt,data.receipt_hash,data.canonical_receipt,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(book_id uuid,session_id uuid,settlement_id uuid,request_key uuid,full_input jsonb,input_hash char(64),canonical_input text,original_receipt jsonb,receipt_hash char(64),canonical_receipt text,created_at timestamptz);
 SELECT data.book_id,data.session_id,data.settlement_id,data.request_key,previous->'full_input' AS full_input,data.input_hash,data.canonical_input,previous->'original_receipt' AS original_receipt,data.receipt_hash,data.canonical_receipt,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(book_id uuid,session_id uuid,settlement_id uuid,request_key uuid,full_input jsonb,input_hash char(64),canonical_input text,original_receipt jsonb,receipt_hash char(64),canonical_receipt text,created_at timestamptz);

  -- resource_supplement_formal_commit_v1: full actual source proof, never a flag.
  PERFORM assert_resource_supplement_formal_commit_source(to_jsonb(NEW));
  RETURN;
END
$$;


--
-- Name: quality_guard_validate_resource_supplement_impact_review(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_validate_resource_supplement_impact_review(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'resource_supplement_impact_reviews'); session record; base record;
  snapshot jsonb; actual jsonb; origin record;
  conflicts jsonb; acknowledged jsonb; field_values jsonb:='{}'::jsonb; field_key text;
  expected_chain jsonb:='[]'::jsonb; before_value jsonb; reason text; effective numeric;
BEGIN
 SELECT data.review_id,data.book_id,data.session_id,data.request_key,data.session_revision,next->'full_input' AS full_input,data.input_hash,data.canonical_input,next->'impact_snapshot' AS impact_snapshot,data.impact_hash,data.canonical_impact,next->'original_receipt' AS original_receipt,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(review_id uuid,book_id uuid,session_id uuid,request_key uuid,session_revision integer,full_input jsonb,input_hash char(64),canonical_input text,impact_snapshot jsonb,impact_hash char(64),canonical_impact text,original_receipt jsonb,created_at timestamptz);
 SELECT data.review_id,data.book_id,data.session_id,data.request_key,data.session_revision,previous->'full_input' AS full_input,data.input_hash,data.canonical_input,previous->'impact_snapshot' AS impact_snapshot,data.impact_hash,data.canonical_impact,previous->'original_receipt' AS original_receipt,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(review_id uuid,book_id uuid,session_id uuid,request_key uuid,session_revision integer,full_input jsonb,input_hash char(64),canonical_input text,impact_snapshot jsonb,impact_hash char(64),canonical_impact text,original_receipt jsonb,created_at timestamptz);

  -- resource_supplement_impact_review_v1: awareness never resolves a conflict.
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'impact review history is immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO session FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=NEW.session_id AND book_id=NEW.book_id;
  SELECT * INTO origin FROM (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) chapter_resource_supplements WHERE session_id=session.id AND book_id=NEW.book_id;
  SELECT * INTO base FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=NEW.book_id;
  IF origin.source_snapshot->>'contract'='stable_resource_correction_preview_v1' THEN
    PERFORM assert_resource_correction_candidate_source(saved.session_id) FROM (SELECT data.session_id,data.book_id,data.issue_id,data.canonical_input,data.canonical_source,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,issue_id uuid,canonical_input text,canonical_source text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_correction_origin')) saved WHERE saved.session_id=NEW.session_id AND saved.book_id=NEW.book_id;
    IF NOT FOUND OR jsonb_array_length(NEW.impact_snapshot->'changes')<>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.impact_snapshot->'changes') item WHERE item->>'subjectKind' IS DISTINCT FROM origin.source_snapshot#>>'{correction,subjectKind}' OR item->>'subjectId' IS DISTINCT FROM origin.source_snapshot#>>'{correction,subjectId}' OR item->>'stateKey' IS DISTINCT FROM origin.source_snapshot#>>'{correction,stateKey}' OR item->'before' IS DISTINCT FROM origin.source_snapshot#>'{correction,beforeValue}') THEN RAISE EXCEPTION 'corrective review must bind its single actual issue source' USING ERRCODE='23514'; END IF;
  END IF;
  IF session.id IS NULL OR session.adoption_kind<>'resource_supplement' OR session.revision<>NEW.session_revision
    OR session.status NOT IN ('pending_review','partially_confirmed','adopted_pending_proposals','failed')
    OR base.id IS NULL OR base.status<>'stable'
    OR NOT EXISTS(SELECT 1 FROM new_design.books WHERE id=NEW.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM new_design.chapter_documents WHERE id=session.chapter_document_id AND book_id=NEW.book_id AND status='active' AND adopted_version_id=session.body_version_id)
    OR NEW.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract','resource_supplement_impact_review_v1','bookId',NEW.book_id,'sessionId',NEW.session_id,'input',NEW.full_input)
    OR encode(sha256(convert_to(NEW.canonical_input,'UTF8')),'hex') IS DISTINCT FROM NEW.input_hash::text
    OR NEW.canonical_impact::jsonb IS DISTINCT FROM NEW.impact_snapshot-'impactHash'
    OR encode(sha256(convert_to(NEW.canonical_impact,'UTF8')),'hex') IS DISTINCT FROM NEW.impact_hash::text
    OR NEW.impact_snapshot->>'contract' IS DISTINCT FROM 'resource_supplement_settlement_impact_v1'
    OR NEW.impact_snapshot->>'bookId' IS DISTINCT FROM NEW.book_id::text
    OR NEW.impact_snapshot->>'sessionId' IS DISTINCT FROM NEW.session_id::text
    OR NEW.impact_snapshot->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR NEW.impact_snapshot->>'bodyVersionId' IS DISTINCT FROM session.body_version_id::text
    OR NEW.impact_snapshot->>'sessionRevision' IS DISTINCT FROM NEW.session_revision::text
    OR NEW.impact_snapshot->>'sourceHash' IS DISTINCT FROM origin.source_hash::text
    -- pg returns session timestamps as JS Dates (millisecond ISO), whereas
    -- to_jsonb uses PostgreSQL timezone formatting and microsecond precision.
    OR (NEW.impact_snapshot#>'{inputSnapshot,session}')-ARRAY['body_hash','created_at','updated_at'] IS DISTINCT FROM to_jsonb(session)-ARRAY['created_at','updated_at']
    OR (NEW.impact_snapshot#>>'{inputSnapshot,session,created_at}')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',session.created_at)
    OR (NEW.impact_snapshot#>>'{inputSnapshot,session,updated_at}')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',session.updated_at)
    OR NEW.impact_snapshot#>'{inputSnapshot,source}' IS DISTINCT FROM origin.source_snapshot
    OR NEW.impact_snapshot->>'impactHash' IS DISTINCT FROM NEW.impact_hash::text
    OR jsonb_typeof(NEW.impact_snapshot->'changes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.impact_snapshot->'stateChain') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.impact_snapshot#>'{downstreamSource,chapters}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.impact_snapshot#>'{downstreamSource,states}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.impact_snapshot#>'{downstreamSource,planningReferences}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.full_input->'acknowledgedConflictStateChangeIds') IS DISTINCT FROM 'array'
    OR NEW.full_input->>'requestKey' IS DISTINCT FROM NEW.request_key::text
    OR NEW.full_input->>'expectedSessionRevision' IS DISTINCT FROM NEW.session_revision::text
    OR NEW.full_input->>'expectedImpactHash' IS DISTINCT FROM NEW.impact_hash::text
    OR NEW.original_receipt->>'contract' IS DISTINCT FROM 'resource_supplement_impact_review_v1'
    OR NEW.original_receipt->>'reviewId' IS DISTINCT FROM NEW.review_id::text
    OR NEW.original_receipt->>'bookId' IS DISTINCT FROM NEW.book_id::text
    OR NEW.original_receipt->>'sessionId' IS DISTINCT FROM NEW.session_id::text
    OR NEW.original_receipt->>'chapterDocumentId' IS DISTINCT FROM session.chapter_document_id::text
    OR NEW.original_receipt->>'bodyVersionId' IS DISTINCT FROM session.body_version_id::text
    OR NEW.original_receipt->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR NEW.original_receipt->>'sessionRevision' IS DISTINCT FROM NEW.session_revision::text
    OR NEW.original_receipt->>'inputHash' IS DISTINCT FROM NEW.input_hash::text
    OR NEW.original_receipt->'input' IS DISTINCT FROM NEW.full_input
    OR NEW.original_receipt->'impact' IS DISTINCT FROM NEW.impact_snapshot
    OR NEW.original_receipt->'repeated' IS DISTINCT FROM 'false'::jsonb
    OR NEW.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||NEW.book_id||'/writing?chapterDocument='||session.chapter_document_id||'&session='||session.id
    THEN RAISE EXCEPTION 'impact review origin or complete receipt mismatch' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM new_design.chapter_settlement_items WHERE session_id=session.id AND decision NOT IN ('confirm','reject'))
    OR (SELECT count(*) FROM new_design.chapter_settlement_items WHERE session_id=session.id AND decision='confirm')<>jsonb_array_length(NEW.impact_snapshot->'changes')
    OR (SELECT count(DISTINCT value->>'itemId') FROM jsonb_array_elements(NEW.impact_snapshot->'changes'))<>jsonb_array_length(NEW.impact_snapshot->'changes')
    THEN RAISE EXCEPTION 'impact review candidate set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(NEW.impact_snapshot->'changes') LOOP
    IF NOT EXISTS(SELECT 1 FROM new_design.chapter_settlement_items item JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) proposal ON proposal.id=item.state_proposal_id
      WHERE item.id=(snapshot->>'itemId')::uuid AND item.session_id=session.id AND item.decision='confirm'
        AND proposal.id=(snapshot->>'proposalId')::uuid AND proposal.book_id=NEW.book_id AND proposal.status='proposed' AND proposal.before_known
        AND proposal.subject_kind=snapshot->>'subjectKind' AND proposal.subject_id=(snapshot->>'subjectId')::uuid AND proposal.state_key=snapshot->>'stateKey'
        AND proposal.before_json IS NOT DISTINCT FROM snapshot->'before' AND proposal.after_json IS NOT DISTINCT FROM snapshot->'after')
      THEN RAISE EXCEPTION 'impact review confirmed proposal mismatch' USING ERRCODE='23514'; END IF;
    field_key=jsonb_build_array(snapshot->>'subjectKind',snapshot->>'subjectId',snapshot->>'stateKey')::text;
    field_values=jsonb_set(field_values,ARRAY[field_key],snapshot->'after');
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(reference)||jsonb_build_object('source_version',to_jsonb(card_version)) ORDER BY reference.id),'[]'::jsonb) INTO actual
    FROM (SELECT data.id,data.planning_version_id,data.planning_object_id,data.book_id,data.reference_role,data.card_id,data.card_version_id,data.action_key,data.note,data.sort_order,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,planning_version_id uuid,planning_object_id uuid,book_id uuid,reference_role text,card_id uuid,card_version_id uuid,action_key text,note text,sort_order integer,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_version_reference')) reference LEFT JOIN new_design.card_versions card_version ON card_version.id=reference.card_version_id AND card_version.card_id=reference.card_id
    WHERE reference.book_id=NEW.book_id AND reference.planning_version_id IN (
      SELECT (value#>>'{adopted_plan,id}')::uuid FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,chapters}')
      UNION SELECT (value#>>'{body,planning_version_id}')::uuid FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,chapters}'));
  IF actual IS DISTINCT FROM NEW.impact_snapshot#>'{downstreamSource,planningReferences}' THEN
    RAISE EXCEPTION 'impact review exact planning references changed' USING ERRCODE='23514'; END IF;
  -- Same authority rule as the preview: keep all rows, use the final row per
  -- chapter/field; preserve that field's first position in the ordered chain.
  FOR snapshot IN
    WITH ordered AS (SELECT value,ordinality,
      row_number() OVER(PARTITION BY value#>>'{change,chapter_document_id}',value#>>'{change,subject_kind}',value#>>'{change,subject_id}',value#>>'{change,state_key}' ORDER BY ordinality DESC) last_position,
      min(ordinality) OVER(PARTITION BY value#>>'{change,chapter_document_id}',value#>>'{change,subject_kind}',value#>>'{change,subject_id}',value#>>'{change,state_key}') first_position
      FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,states}') WITH ORDINALITY)
    SELECT value FROM ordered WHERE last_position=1 ORDER BY first_position
  LOOP
    field_key=jsonb_build_array(snapshot#>>'{change,subject_kind}',snapshot#>>'{change,subject_id}',snapshot#>>'{change,state_key}')::text;
    before_value=field_values->field_key;
    effective=(snapshot#>>'{change,effective_story_order}')::numeric;
    reason=CASE WHEN effective IS NOT NULL AND effective<=base.chapter_order THEN 'backdated_source'
      WHEN before_value IS NOT DISTINCT FROM snapshot#>'{change,before_json}' THEN 'compatible' ELSE 'before_conflict' END;
    expected_chain=expected_chain||jsonb_build_array(jsonb_build_object('chapterDocumentId',snapshot#>>'{change,chapter_document_id}',
      'bodyVersionId',snapshot#>>'{change,body_version_id}','chapterOrder',snapshot->'chapter_order','stateChangeId',snapshot#>>'{change,id}',
      'subjectKind',snapshot#>>'{change,subject_kind}','subjectId',snapshot#>>'{change,subject_id}','stateKey',snapshot#>>'{change,state_key}',
      'expectedBefore',before_value,'recordedBefore',snapshot#>'{change,before_json}','recordedAfter',snapshot#>'{change,after_json}',
      'effectiveStoryOrder',effective,'reason',reason));
    field_values=jsonb_set(field_values,ARRAY[field_key],snapshot#>'{change,after_json}');
  END LOOP;
  IF expected_chain IS DISTINCT FROM NEW.impact_snapshot->'stateChain' THEN
    RAISE EXCEPTION 'impact review actual state chain mismatch' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM new_design.chapter_documents WHERE book_id=NEW.book_id AND status='active' AND logical_order>base.chapter_order)
    <>jsonb_array_length(NEW.impact_snapshot#>'{downstreamSource,chapters}')
    OR (SELECT count(DISTINCT value#>>'{document,id}') FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,chapters}'))<>jsonb_array_length(NEW.impact_snapshot#>'{downstreamSource,chapters}') THEN
    RAISE EXCEPTION 'impact review downstream chapter set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,chapters}') LOOP
    SELECT jsonb_build_object('document',to_jsonb(document),'body',to_jsonb(body),'planning_object',to_jsonb(object),
      'adopted_plan',to_jsonb(plan),'body_plan',to_jsonb(body_plan),'checkpoint',to_jsonb(checkpoint)) INTO actual
      FROM new_design.chapter_documents document
      LEFT JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      LEFT JOIN (SELECT data.id,data.book_id,data.level,data.parent_object_id,data.card_id,data.title,data.sort_order,data.status,data.current_version_id,data.adopted_version_id,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,level text,parent_object_id uuid,card_id uuid,title text,sort_order integer,status text,current_version_id uuid,adopted_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_object')) object ON object.book_id=document.book_id AND object.card_id=document.chapter_card_id AND object.level='chapter' AND object.status='active'
      LEFT JOIN (SELECT data.id,data.object_id,data.book_id,data.version,data.base_version_id,data.based_on_parent_version_id,data.source,data.status,version.values->'content' AS content,data.content_hash,data.source_body_version_id,data.created_by,data.stale_at,data.stale_reason,data.created_at,data.execution_mode FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_version')) plan ON plan.id=object.adopted_version_id AND plan.object_id=object.id
      LEFT JOIN (SELECT data.id,data.object_id,data.book_id,data.version,data.base_version_id,data.based_on_parent_version_id,data.source,data.status,version.values->'content' AS content,data.content_hash,data.source_body_version_id,data.created_by,data.stale_at,data.stale_reason,data.created_at,data.execution_mode FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='planning_version')) body_plan ON body_plan.id=body.planning_version_id AND body_plan.book_id=document.book_id
      LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=document.book_id AND checkpoint.body_version_id=body.id AND checkpoint.status='stable'
      WHERE document.id=(snapshot#>>'{document,id}')::uuid AND document.book_id=NEW.book_id AND document.status='active' AND document.logical_order>base.chapter_order;
    IF actual IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'impact review downstream source changed' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change
      JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      WHERE change.book_id=NEW.book_id AND change.status='active' AND document.logical_order>base.chapter_order
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.impact_snapshot->'changes') selection
          WHERE selection->>'subjectKind'=change.subject_kind AND (selection->>'subjectId')::uuid=change.subject_id AND selection->>'stateKey'=change.state_key))
    <>jsonb_array_length(NEW.impact_snapshot#>'{downstreamSource,states}')
    OR (SELECT count(DISTINCT value#>>'{change,id}') FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,states}'))<>jsonb_array_length(NEW.impact_snapshot#>'{downstreamSource,states}')
    THEN RAISE EXCEPTION 'impact review downstream state set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,states}') LOOP
    SELECT jsonb_build_object('change',to_jsonb(change),'proposal',to_jsonb(proposal),'settlement',to_jsonb(settlement),
      'anchor',to_jsonb(anchor),'checkpoint',to_jsonb(checkpoint),'checkpoint_commit',to_jsonb(checkpoint_commit),
      'checkpoint_session',to_jsonb(checkpoint_session),'chapter_order',document.logical_order) INTO actual
      FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change
      JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.source,data.status,data.confirmed_state_change_id,data.revision,data.created_at,data.updated_at,data.before_known FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,source text,status text,confirmed_state_change_id uuid,revision integer,created_at timestamptz,updated_at timestamptz,before_known boolean) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change_proposal')) proposal ON proposal.id=change.proposal_id
      LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
      LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
      LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=change.book_id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
      LEFT JOIN new_design.chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id AND checkpoint_commit.book_id=change.book_id AND checkpoint_commit.chapter_document_id=document.id AND checkpoint_commit.body_version_id=change.body_version_id
      LEFT JOIN (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) checkpoint_session ON checkpoint_session.id=checkpoint.session_id AND checkpoint_session.book_id=change.book_id AND checkpoint_session.chapter_document_id=document.id AND checkpoint_session.body_version_id=change.body_version_id AND checkpoint_session.settlement_id=checkpoint.settlement_id
      WHERE change.id=(snapshot#>>'{change,id}')::uuid AND change.book_id=NEW.book_id AND change.status='active' AND document.logical_order>base.chapter_order;
    IF actual IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'impact review downstream state source changed' USING ERRCODE='23514'; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(value->>'stateChangeId' ORDER BY value->>'stateChangeId'),'[]'::jsonb) INTO conflicts
    FROM jsonb_array_elements(NEW.impact_snapshot->'stateChain') WHERE value->>'reason'<>'compatible';
  SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO acknowledged FROM jsonb_array_elements_text(NEW.full_input->'acknowledgedConflictStateChangeIds');
  IF acknowledged IS DISTINCT FROM conflicts THEN RAISE EXCEPTION 'impact review conflicts not explicitly acknowledged' USING ERRCODE='23514'; END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_validate_resource_supplement_integrity_issue(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_validate_resource_supplement_integrity_issue(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'resource_supplement_integrity_issues'); review record; actual jsonb;
BEGIN
 SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,next->'impact' AS impact,data.source_route,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz);
 SELECT data.issue_id,data.settlement_id,data.book_id,data.chapter_document_id,data.body_version_id,data.state_change_id,data.subject_kind,data.subject_id,data.state_key,previous->'impact' AS impact,data.source_route,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(issue_id uuid,settlement_id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,state_change_id uuid,subject_kind text,subject_id uuid,state_key text,impact jsonb,source_route text,created_at timestamptz);

  SELECT review_row.* INTO review FROM (SELECT data.settlement_id,data.book_id,data.review_id,data.checkpoint_id,version.values->'merged_write' AS merged_write,data.merged_hash,data.canonical_merged,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(settlement_id uuid,book_id uuid,review_id uuid,checkpoint_id uuid,merged_write jsonb,merged_hash char(64),canonical_merged text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_integrity_journal')) journal JOIN (SELECT data.review_id,data.book_id,data.session_id,data.request_key,data.session_revision,version.values->'full_input' AS full_input,data.input_hash,data.canonical_input,version.values->'impact_snapshot' AS impact_snapshot,data.impact_hash,data.canonical_impact,version.values->'original_receipt' AS original_receipt,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(review_id uuid,book_id uuid,session_id uuid,request_key uuid,session_revision integer,full_input jsonb,input_hash char(64),canonical_input text,impact_snapshot jsonb,impact_hash char(64),canonical_impact text,original_receipt jsonb,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_impact_review')) review_row ON review_row.review_id=journal.review_id WHERE journal.settlement_id=NEW.settlement_id AND journal.book_id=NEW.book_id;
  SELECT value INTO actual FROM jsonb_array_elements(review.impact_snapshot->'stateChain') WHERE value->>'stateChangeId'=NEW.state_change_id::text;
  IF review.review_id IS NULL OR actual IS NULL OR actual IS DISTINCT FROM NEW.impact OR actual->>'reason' NOT IN ('before_conflict','backdated_source')
    OR actual->>'chapterDocumentId' IS DISTINCT FROM NEW.chapter_document_id::text OR actual->>'bodyVersionId' IS DISTINCT FROM NEW.body_version_id::text
    OR actual->>'subjectKind' IS DISTINCT FROM NEW.subject_kind OR actual->>'subjectId' IS DISTINCT FROM NEW.subject_id::text OR actual->>'stateKey' IS DISTINCT FROM NEW.state_key
    OR NEW.source_route IS DISTINCT FROM '/new-design/books/'||NEW.book_id||'/writing?chapterDocument='||NEW.chapter_document_id||'&resourceIssue='||NEW.issue_id
    OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) change JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id
      WHERE change.id=NEW.state_change_id AND change.book_id=NEW.book_id AND change.status='active' AND document.status='active' AND document.adopted_version_id=change.body_version_id
        AND change.chapter_document_id=NEW.chapter_document_id AND change.body_version_id=NEW.body_version_id AND change.subject_kind=NEW.subject_kind AND change.subject_id=NEW.subject_id AND change.state_key=NEW.state_key
        AND change.before_json IS NOT DISTINCT FROM actual->'recordedBefore' AND change.after_json IS NOT DISTINCT FROM actual->'recordedAfter')
    THEN RAISE EXCEPTION 'integrity issue actual conflicting source mismatch' USING ERRCODE='23514'; END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_validate_resource_supplement_integrity_journal(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_validate_resource_supplement_integrity_journal(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'resource_supplement_integrity_journals'); review record; checkpoint record;
  child record; snapshot jsonb;
BEGIN
 SELECT data.settlement_id,data.book_id,data.review_id,data.checkpoint_id,next->'merged_write' AS merged_write,data.merged_hash,data.canonical_merged,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(settlement_id uuid,book_id uuid,review_id uuid,checkpoint_id uuid,merged_write jsonb,merged_hash char(64),canonical_merged text,created_at timestamptz);
 SELECT data.settlement_id,data.book_id,data.review_id,data.checkpoint_id,previous->'merged_write' AS merged_write,data.merged_hash,data.canonical_merged,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(settlement_id uuid,book_id uuid,review_id uuid,checkpoint_id uuid,merged_write jsonb,merged_hash char(64),canonical_merged text,created_at timestamptz);

  -- resource_supplement_integrity_v1
  SELECT * INTO review FROM (SELECT data.review_id,data.book_id,data.session_id,data.request_key,data.session_revision,version.values->'full_input' AS full_input,data.input_hash,data.canonical_input,version.values->'impact_snapshot' AS impact_snapshot,data.impact_hash,data.canonical_impact,version.values->'original_receipt' AS original_receipt,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(review_id uuid,book_id uuid,session_id uuid,request_key uuid,session_revision integer,full_input jsonb,input_hash char(64),canonical_input text,impact_snapshot jsonb,impact_hash char(64),canonical_impact text,original_receipt jsonb,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='resource_supplement_impact_review')) resource_supplement_impact_reviews WHERE review_id=NEW.review_id AND book_id=NEW.book_id;
  SELECT * INTO checkpoint FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=NEW.checkpoint_id AND book_id=NEW.book_id AND settlement_id=NEW.settlement_id AND status='stable';
  SELECT * INTO child FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=checkpoint.session_id AND book_id=NEW.book_id AND settlement_id=NEW.settlement_id AND status='stable' AND adoption_kind='resource_supplement';
  IF review.review_id IS NULL OR checkpoint.id IS NULL OR child.id IS NULL OR review.session_id IS DISTINCT FROM child.id
    OR checkpoint.previous_checkpoint_id IS DISTINCT FROM child.supplement_base_checkpoint_id
    OR checkpoint.summary->>'supplementReviewId' IS DISTINCT FROM NEW.review_id::text
    OR checkpoint.summary->>'supplementImpactHash' IS DISTINCT FROM review.impact_hash::text
    OR NEW.merged_write->>'sessionId' IS DISTINCT FROM child.id::text
    OR NEW.merged_write->>'settlementId' IS DISTINCT FROM NEW.settlement_id::text
    OR NEW.merged_write->>'checkpointId' IS DISTINCT FROM NEW.checkpoint_id::text
    OR NEW.merged_write->>'baseCheckpointId' IS DISTINCT FROM child.supplement_base_checkpoint_id::text
    OR NEW.merged_write->>'bodyVersionId' IS DISTINCT FROM child.body_version_id::text
    OR NEW.merged_write->>'reviewId' IS DISTINCT FROM NEW.review_id::text
    OR NEW.merged_write->>'impactHash' IS DISTINCT FROM review.impact_hash::text
    OR NEW.merged_write->'confirmed' IS DISTINCT FROM checkpoint.summary->'confirmed'
    OR NEW.canonical_merged::jsonb IS DISTINCT FROM NEW.merged_write
    OR encode(sha256(convert_to(NEW.canonical_merged,'UTF8')),'hex') IS DISTINCT FROM NEW.merged_hash::text
    OR NOT EXISTS(SELECT 1 FROM new_design.chapter_settlements WHERE id=NEW.settlement_id AND book_id=NEW.book_id AND status='committed' AND supplement_base_checkpoint_id=child.supplement_base_checkpoint_id)
    THEN RAISE EXCEPTION 'integrity journal merged source mismatch' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(NEW.merged_write->'newStateChangeIds') IS DISTINCT FROM 'array'
    OR (SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]'::jsonb) FROM (SELECT data.id,data.sequence,data.book_id,data.settlement_id,data.proposal_id,data.chapter_document_id,data.body_version_id,data.text_anchor_id,data.cause_event_card_id,data.subject_kind,data.subject_id,data.state_key,data.before_json,version.values->'after_json' AS after_json,data.delta_json,data.reason,data.effective_story_order,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='state_change')) state_changes WHERE settlement_id=NEW.settlement_id AND status='active')
      IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) FROM jsonb_array_elements_text(NEW.merged_write->'newStateChangeIds'))
    THEN RAISE EXCEPTION 'integrity journal new states incomplete' USING ERRCODE='23514'; END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_validate_resource_supplement_origin(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_validate_resource_supplement_origin(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_resource_supplements'); child record; base record;
BEGIN
 SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,next->'full_input' AS full_input,data.input_hash,next->'source_snapshot' AS source_snapshot,data.source_hash,next->'original_receipt' AS original_receipt,data.actor,data.created_at INTO NEW FROM jsonb_to_record(next) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz);
 SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,previous->'full_input' AS full_input,data.input_hash,previous->'source_snapshot' AS source_snapshot,data.source_hash,previous->'original_receipt' AS original_receipt,data.actor,data.created_at INTO OLD FROM jsonb_to_record(previous) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz);

  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'supplement original receipt is immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO child FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) chapter_adoption_sessions WHERE id=NEW.session_id;
  SELECT * INTO base FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint')) chapter_stable_checkpoints WHERE id=NEW.base_checkpoint_id;
  IF child.adoption_kind IS DISTINCT FROM 'resource_supplement' OR child.supplement_base_checkpoint_id IS DISTINCT FROM base.id
    OR child.book_id IS DISTINCT FROM NEW.book_id OR base.book_id IS DISTINCT FROM NEW.book_id OR base.status IS DISTINCT FROM 'stable'
    OR NEW.source_snapshot->'basis'->'original'->'checkpoint' IS DISTINCT FROM to_jsonb(base)
    OR NEW.source_snapshot->>'sourceHash' IS DISTINCT FROM NEW.source_hash::text
    OR NEW.full_input->>'requestKey' IS DISTINCT FROM NEW.request_key
    OR NEW.full_input->>'checkpointId' IS DISTINCT FROM base.id::text
    OR NEW.full_input->>'expectedSourceHash' IS DISTINCT FROM NEW.source_hash::text
    OR NEW.original_receipt->>'sessionId' IS DISTINCT FROM child.id::text
    OR NEW.original_receipt->>'bookId' IS DISTINCT FROM NEW.book_id::text
    OR NEW.original_receipt->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR NEW.original_receipt->>'bodyVersionId' IS DISTINCT FROM child.body_version_id::text
    OR NEW.original_receipt->>'preparationId' IS DISTINCT FROM child.preparation_id::text
    OR NEW.original_receipt->>'requestKey' IS DISTINCT FROM NEW.request_key
    OR NEW.original_receipt->'input' IS DISTINCT FROM NEW.full_input
    OR NEW.original_receipt->>'inputHash' IS DISTINCT FROM NEW.input_hash::text THEN
    RAISE EXCEPTION 'supplement full original input and source receipt mismatch' USING ERRCODE='23514';
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_validate_resource_supplement_settlement(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_validate_resource_supplement_settlement(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'chapter_settlements');

BEGIN
 SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.status,data.revision,data.idempotency_key,data.revert_idempotency_key,data.actor,data.note,data.committed_at,data.reverted_at,data.supplement_base_checkpoint_id INTO NEW FROM jsonb_to_record(next) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,status text,revision integer,idempotency_key text,revert_idempotency_key text,actor text,note text,committed_at timestamptz,reverted_at timestamptz,supplement_base_checkpoint_id uuid);
 SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.status,data.revision,data.idempotency_key,data.revert_idempotency_key,data.actor,data.note,data.committed_at,data.reverted_at,data.supplement_base_checkpoint_id INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,status text,revision integer,idempotency_key text,revert_idempotency_key text,actor text,note text,committed_at timestamptz,reverted_at timestamptz,supplement_base_checkpoint_id uuid);

  IF TG_OP='UPDATE' AND NEW.supplement_base_checkpoint_id IS DISTINCT FROM OLD.supplement_base_checkpoint_id THEN
    RAISE EXCEPTION 'supplement settlement origin is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.supplement_base_checkpoint_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.preparation_id,data.prior_body_version_id,data.adoption_id,data.settlement_id,data.policy_version_id,data.planning_object_id,data.planning_version_id,data.context_manifest_id,data.dependency_hash,data.adoption_kind,data.status,data.revision,data.idempotency_key,data.created_by,data.error_summary,data.created_at,data.updated_at,data.supplement_base_checkpoint_id FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,preparation_id uuid,prior_body_version_id uuid,adoption_id uuid,settlement_id uuid,policy_version_id uuid,planning_object_id uuid,planning_version_id uuid,context_manifest_id uuid,dependency_hash char(64),adoption_kind text,status text,revision integer,idempotency_key text,created_by text,error_summary text,created_at timestamptz,updated_at timestamptz,supplement_base_checkpoint_id uuid) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_adoption_session')) child JOIN (SELECT data.session_id,data.book_id,data.base_checkpoint_id,data.request_key,version.values->'full_input' AS full_input,data.input_hash,version.values->'source_snapshot' AS source_snapshot,data.source_hash,version.values->'original_receipt' AS original_receipt,data.actor,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(session_id uuid,book_id uuid,base_checkpoint_id uuid,request_key text,full_input jsonb,input_hash char(64),source_snapshot jsonb,source_hash char(64),original_receipt jsonb,actor text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='chapter_resource_supplement')) origin ON origin.session_id=child.id
    WHERE child.supplement_base_checkpoint_id=NEW.supplement_base_checkpoint_id AND child.book_id=NEW.book_id
      AND child.chapter_document_id=NEW.chapter_document_id AND child.body_version_id=NEW.body_version_id
      AND child.adoption_kind='resource_supplement') THEN
    RAISE EXCEPTION 'supplement settlement requires its owning supplement session' USING ERRCODE='23514';
  END IF;
  RETURN;
END
$$;


--
-- Name: quality_guard_validate_world_quality_material(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_validate_world_quality_material(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'quality_report_material_versions'); actual_book uuid; BEGIN
 SELECT data.report_id,data.subject_kind,data.subject_id,data.card_version_id,data.relation_version_id,data.snapshot_hash INTO NEW FROM jsonb_to_record(next) AS data(report_id uuid,subject_kind text,subject_id uuid,card_version_id uuid,relation_version_id uuid,snapshot_hash char(64));
 SELECT data.report_id,data.subject_kind,data.subject_id,data.card_version_id,data.relation_version_id,data.snapshot_hash INTO OLD FROM jsonb_to_record(previous) AS data(report_id uuid,subject_kind text,subject_id uuid,card_version_id uuid,relation_version_id uuid,snapshot_hash char(64));

 IF NEW.subject_kind='card' THEN SELECT book.id INTO actual_book FROM new_design.card_versions version JOIN new_design.cards card ON card.id=version.card_id JOIN new_design.card_types material_type ON material_type.id=card.card_type_id AND NOT material_type.is_internal JOIN new_design.books book ON book.space_id=card.space_id WHERE version.id=NEW.card_version_id AND card.id=NEW.subject_id;
 ELSE SELECT book.id INTO actual_book FROM new_design.card_relation_versions version JOIN new_design.card_relations relation ON relation.id=version.card_relation_id JOIN new_design.books book ON book.space_id=relation.space_id JOIN new_design.cards source_card ON source_card.id=relation.source_card_id JOIN new_design.card_types source_type ON source_type.id=source_card.card_type_id AND NOT source_type.is_internal JOIN new_design.cards target_card ON target_card.id=relation.target_card_id JOIN new_design.card_types target_type ON target_type.id=target_card.card_type_id AND NOT target_type.is_internal WHERE version.id=NEW.relation_version_id AND relation.id=NEW.subject_id; END IF;
 IF actual_book IS NULL OR NOT EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.scope_kind,data.scope_id,data.task_id,data.step_id,data.attempt_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.rule_set_key,data.rule_set_version,data.input_hash,data.policy_mode,data.policy_decision,data.execution_effect,data.summary,data.idempotency_key,data.request_hash,data.created_by,data.created_at,data.stale_at,data.stale_reason FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_audit_report')) quality_audit_reports WHERE id=NEW.report_id AND book_id=actual_book) THEN RAISE EXCEPTION 'world quality source belongs to another book' USING ERRCODE='23514'; END IF;RETURN;
END
$$;


--
-- Name: quality_guard_world_quality_evidence_binding_guard(jsonb, jsonb, text, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_guard_world_quality_evidence_binding_guard(previous jsonb, next jsonb, operation text DEFAULT NULL::text, source_table text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE NEW record; OLD record; TG_OP text:=coalesce(operation,CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END); TG_TABLE_NAME text:=coalesce(source_table,'quality_issue_evidence');
 BEGIN
 SELECT data.id,data.issue_version_id,data.evidence_kind,data.text_anchor_id,data.fact_id,data.state_change_id,data.story_timing_id,data.story_relation_id,data.planning_version_id,data.rule_key,data.rule_version,data.note,data.is_unverified_observation,data.created_at,data.material_kind,data.material_id,data.card_version_id,data.relation_version_id,data.field_key,data.field_spec_version_id,data.field_spec_hash,data.observed_value_hash INTO NEW FROM jsonb_to_record(next) AS data(id uuid,issue_version_id uuid,evidence_kind text,text_anchor_id uuid,fact_id uuid,state_change_id uuid,story_timing_id uuid,story_relation_id uuid,planning_version_id uuid,rule_key text,rule_version text,note text,is_unverified_observation boolean,created_at timestamptz,material_kind text,material_id uuid,card_version_id uuid,relation_version_id uuid,field_key text,field_spec_version_id uuid,field_spec_hash char(64),observed_value_hash char(64));
 SELECT data.id,data.issue_version_id,data.evidence_kind,data.text_anchor_id,data.fact_id,data.state_change_id,data.story_timing_id,data.story_relation_id,data.planning_version_id,data.rule_key,data.rule_version,data.note,data.is_unverified_observation,data.created_at,data.material_kind,data.material_id,data.card_version_id,data.relation_version_id,data.field_key,data.field_spec_version_id,data.field_spec_hash,data.observed_value_hash INTO OLD FROM jsonb_to_record(previous) AS data(id uuid,issue_version_id uuid,evidence_kind text,text_anchor_id uuid,fact_id uuid,state_change_id uuid,story_timing_id uuid,story_relation_id uuid,planning_version_id uuid,rule_key text,rule_version text,note text,is_unverified_observation boolean,created_at timestamptz,material_kind text,material_id uuid,card_version_id uuid,relation_version_id uuid,field_key text,field_spec_version_id uuid,field_spec_hash char(64),observed_value_hash char(64));

 IF NEW.evidence_kind IN('card_field','relation_field') AND NOT EXISTS(
 SELECT 1 FROM (SELECT data.id,data.issue_id,data.version,data.base_version_id,data.category_key,data.severity,data.confidence,data.title,data.description,data.detection_source,version.values->'impact_scope' AS impact_scope,data.suggested_action,data.target_value,data.observed_value,data.scale_version,data.interpretation,data.created_by,data.created_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,issue_id uuid,version integer,base_version_id uuid,category_key text,severity text,confidence numeric(5,4),title text,description text,detection_source text,impact_scope jsonb,suggested_action text,target_value jsonb,observed_value jsonb,scale_version text,interpretation text,created_by text,created_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_issue_version')) version JOIN (SELECT data.id,data.book_id,data.report_id,data.stable_key,data.current_version_id,data.current_status,data.is_quality_debt,data.revision,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,report_id uuid,stable_key text,current_version_id uuid,current_status text,is_quality_debt boolean,revision integer,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_issue')) issue ON issue.id=version.issue_id JOIN (SELECT data.report_id,data.subject_kind,data.subject_id,data.card_version_id,data.relation_version_id,data.snapshot_hash FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(report_id uuid,subject_kind text,subject_id uuid,card_version_id uuid,relation_version_id uuid,snapshot_hash char(64)) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_report_material_version')) binding ON binding.report_id=issue.report_id
 WHERE version.id=NEW.issue_version_id AND binding.subject_kind=NEW.material_kind AND binding.subject_id=NEW.material_id
 AND binding.card_version_id IS NOT DISTINCT FROM NEW.card_version_id AND binding.relation_version_id IS NOT DISTINCT FROM NEW.relation_version_id
 AND EXISTS(SELECT 1 FROM (SELECT data.id,data.book_id,data.request_key,data.request_hash,data.input_hash,version.values->'input_payload' AS input_payload,version.values->'frozen_plan' AS frozen_plan,data.ai_task_id,data.step_id,data.attempt_id,data.report_id,data.status,data.model_request_state,data.generated_output,data.generated_execution,data.failure,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,request_key uuid,request_hash char(64),input_hash char(64),input_payload jsonb,frozen_plan jsonb,ai_task_id uuid,step_id uuid,attempt_id uuid,report_id uuid,status text,model_request_state text,generated_output jsonb,generated_execution jsonb,failure jsonb,created_at timestamptz,updated_at timestamptz) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='world_consistency_request')) request JOIN (SELECT data.id,data.book_id,data.scope_kind,data.scope_id,data.task_id,data.step_id,data.attempt_id,data.task_contract_version_id,data.prompt_recipe_version_id,data.context_manifest_id,data.model_route_snapshot_id,data.rule_set_key,data.rule_set_version,data.input_hash,data.policy_mode,data.policy_decision,data.execution_effect,data.summary,data.idempotency_key,data.request_hash,data.created_by,data.created_at,data.stale_at,data.stale_reason FROM new_design.cards card JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text) WHERE card.status='active' AND EXISTS(SELECT 1 FROM new_design.card_types type WHERE type.id=card.card_type_id AND type.type_key='quality_audit_report')) report ON report.task_id=request.ai_task_id AND report.attempt_id=request.attempt_id AND report.book_id=request.book_id CROSS JOIN LATERAL jsonb_array_elements(request.generated_output->'findings') finding CROSS JOIN LATERAL jsonb_array_elements(finding->'evidence') evidence
  WHERE report.id=issue.report_id AND finding->>'stableKey'=issue.stable_key AND evidence->>'kind'=NEW.material_kind AND evidence->>'id'=NEW.material_id::text AND evidence->>'versionId'=COALESCE(NEW.card_version_id,NEW.relation_version_id)::text AND evidence->>'fieldKey'=NEW.field_key AND evidence->>'specVersionId' IS NOT DISTINCT FROM NEW.field_spec_version_id::text AND evidence->>'specHash'=NEW.field_spec_hash AND evidence->>'valueHash'=NEW.observed_value_hash))
 THEN RAISE EXCEPTION 'world issue evidence must bind exact original report material' USING ERRCODE='23514'; END IF;RETURN;
END
$$;


--
-- Name: quality_mark_integrity_projection(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_mark_integrity_projection(issue jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE item record; marked boolean:=false;
BEGIN
 FOR item IN SELECT card.space_id,version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='current_state_projection' AND version.values->>'book_id'=issue->>'book_id'
 AND version.values->>'subject_kind'=issue->>'subject_kind' AND version.values->>'subject_id'=issue->>'subject_id'
 AND version.values->>'state_key'=issue->>'state_key' FOR UPDATE OF card LOOP
  marked:=true;
  PERFORM quality_patch_record('current_state_projection',(item.values->>'id')::uuid,
  jsonb_build_object('is_stale',true,'projection_revision',(item.values->>'projection_revision')::integer+1,'rebuilt_at',now()));
 END LOOP;
 IF NOT marked THEN RAISE EXCEPTION 'actual resource projection missing; cannot publish an unfenced issue' USING ERRCODE='23514'; END IF;
END $$;


--
-- Name: quality_patch_record(text, uuid, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_patch_record(kind text, logical_id uuid, patch jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE stored record; updated jsonb;
BEGIN
 SELECT card.id,card.space_id,version.values INTO STRICT stored
 FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE type.type_key=kind AND card.status='active' AND (version.values->>'id')::uuid=logical_id
 FOR UPDATE OF card;
 updated:=stored.values||patch;
 PERFORM kernel_store_record(kind,stored.space_id,logical_id,updated);
 RETURN updated;
END $$;


--
-- Name: quality_record_head_changed(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_record_head_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE kind text; internal boolean; previous jsonb; next jsonb;
BEGIN
 SELECT type.type_key,type.is_internal INTO kind,internal FROM card_types type WHERE type.id=NEW.card_type_id;
 SELECT values INTO previous FROM card_versions WHERE id=OLD.current_version_id AND card_id=OLD.id;
 SELECT values INTO next FROM card_versions WHERE id=NEW.current_version_id AND card_id=NEW.id;
 IF NOT internal THEN
  IF OLD.current_version_id IS DISTINCT FROM NEW.current_version_id OR OLD.status IS DISTINCT FROM NEW.status THEN
   PERFORM quality_stale_world_material(NEW.id,'card');
  END IF;
 ELSIF OLD.current_version_id IS DISTINCT FROM NEW.current_version_id THEN
  IF kind='resource_supplement_integrity_issue' AND previous IS NULL THEN PERFORM quality_mark_integrity_projection(next); END IF;
  IF kind IN('dictionary_item','dictionary_definition') THEN
   PERFORM quality_stale_world_specification(CASE WHEN kind='dictionary_item' THEN 'dictionary_items' ELSE 'dictionary_definitions' END,previous,next);
  END IF;
  IF previous IS NOT NULL AND kind IN('planning_object','planning_version','canonical_fact') THEN
   PERFORM quality_stale_record_source(kind,previous,next);
  END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: quality_stale_record_source(text, jsonb, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_stale_record_source(kind text, previous jsonb, next jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE item record; binding_kind text; reason text;
BEGIN
 IF kind='planning_object' AND previous->>'adopted_version_id' IS DISTINCT FROM next->>'adopted_version_id' THEN
  binding_kind:='quality_report_planning_version';reason:='规划对象已采用其他版本。';
 ELSIF kind='planning_version' AND ((next->>'stale_at' IS NOT NULL AND previous->>'stale_at' IS NULL)
 OR(next->>'status' IN('rejected','superseded') AND next->>'status' IS DISTINCT FROM previous->>'status')) THEN
  binding_kind:='quality_report_planning_version';reason:='引用的规划版本已失效。';
 ELSIF kind='canonical_fact' AND next->>'status' IN('rejected','superseded','stale') AND next->>'status' IS DISTINCT FROM previous->>'status' THEN
  binding_kind:='quality_report_fact';reason:='引用的事实已失效。';
 ELSE RETURN; END IF;
 FOR item IN SELECT DISTINCT (version.values->>'report_id')::uuid AS report_id
 FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key=binding_kind AND
 ((kind='planning_object' AND version.values->>'planning_object_id'=next->>'id' AND version.values->>'planning_version_id' IS DISTINCT FROM next->>'adopted_version_id')
 OR(kind='planning_version' AND version.values->>'planning_version_id'=next->>'id')
 OR(kind='canonical_fact' AND version.values->>'fact_id'=next->>'id')) LOOP
  PERFORM stale_quality_report(item.report_id,reason);
 END LOOP;
END $$;


--
-- Name: quality_stale_world_material(uuid, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_stale_world_material(subject uuid, subject_kind text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE item record;
BEGIN
 FOR item IN SELECT version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='quality_audit_report' AND version.values->>'stale_at' IS NULL
 AND EXISTS(SELECT 1 FROM cards binding JOIN card_types bt ON bt.id=binding.card_type_id
 JOIN card_versions bv ON bv.id=binding.current_version_id AND bv.card_id=binding.id
 WHERE binding.status='active' AND bt.type_key='quality_report_material_version'
 AND bv.values->>'report_id'=version.values->>'id' AND (bv.values->>'subject_id')::uuid=subject AND bv.values->>'subject_kind'=subject_kind)
 FOR UPDATE OF card LOOP
  PERFORM quality_patch_record('quality_audit_report',(item.values->>'id')::uuid,jsonb_build_object('stale_at',now(),'stale_reason','正式资料或关系版本已变化；旧报告仅为历史证据'));
 END LOOP;
 FOR item IN SELECT version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='quality_recheck' AND version.values->>'status'='active'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(version.values->'checked_material_versions','null'::jsonb),'[]'::jsonb)) material
 WHERE (material->>'id')::uuid=subject AND material->>'kind'=subject_kind) FOR UPDATE OF card LOOP
  PERFORM quality_patch_record('quality_recheck',(item.values->>'id')::uuid,jsonb_build_object('status','stale','stale_at',now(),'stale_reason','复查的正式来源版本已变化'));
 END LOOP;
END $$;


--
-- Name: quality_stale_world_specification(text, jsonb, jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_stale_world_specification(source_table text, old_data jsonb, new_data jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE report_ids uuid[];item record;
BEGIN
 IF old_data IS NOT NULL AND old_data-ARRAY['revision','updated_at','updated_by']::text[]
 IS NOT DISTINCT FROM new_data-ARRAY['revision','updated_at','updated_by']::text[] THEN RETURN; END IF;
 SELECT array_agg((version.values->>'report_id')::uuid) INTO report_ids
 FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='world_consistency_request' AND version.values->>'report_id' IS NOT NULL AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(version.values->'frozen_plan'->'catalog'->'subjects') subject WHERE
 (source_table='field_definitions' AND new_data->>'scope' IN('book_type','card') AND subject->>'kind'='card'
  AND subject->>'typeId'=new_data->>'card_type_id' AND(new_data->>'scope'='book_type' OR subject->>'id'=new_data->>'card_id')
  AND EXISTS(SELECT 1 FROM books WHERE id=(version.values->>'book_id')::uuid AND space_id::text=new_data->>'space_id'))
 OR(source_table='card_types' AND subject->>'kind'='card' AND subject->>'typeId'=new_data->>'id'
  AND(old_data->>'name' IS DISTINCT FROM new_data->>'name' OR old_data->>'status' IS DISTINCT FROM new_data->>'status'))
 OR(source_table='relation_types' AND subject->>'kind'='relation' AND subject->>'typeId'=new_data->>'id')
 OR(source_table IN('dictionary_items','dictionary_definitions') AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(subject->'fields') field WHERE field->'specification'->'optionSource'->>'kind'='dictionary_tree'
  AND field->'specification'->'optionSource'->>'dictionaryId'=CASE WHEN source_table='dictionary_items' THEN new_data->>'dictionary_id' ELSE new_data->>'id' END)));
 IF report_ids IS NULL THEN RETURN; END IF;
 FOR item IN SELECT type.type_key,version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND
 ((type.type_key='quality_audit_report' AND (version.values->>'id')::uuid=ANY(report_ids) AND version.values->>'stale_at' IS NULL)
 OR(type.type_key='quality_recheck' AND (version.values->>'recheck_report_id')::uuid=ANY(report_ids) AND version.values->>'status'='active'))
 FOR UPDATE OF card LOOP
  PERFORM quality_patch_record(item.type_key,(item.values->>'id')::uuid,
   CASE WHEN item.type_key='quality_recheck' THEN jsonb_build_object('status','stale','stale_at',now(),'stale_reason','复查的正式规格或字典树已变化')
   ELSE jsonb_build_object('stale_at',now(),'stale_reason','正式字段／关系规格或字典树已变化；原检查仅为历史证据') END);
 END LOOP;
END $$;


--
-- Name: quality_validate_record_shape(text, jsonb, uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.quality_validate_record_shape(kind text, data jsonb, physical_card uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $_$
DECLARE valid boolean:=true; collision boolean:=false;
BEGIN
 IF kind='world_consistency_request' THEN
  valid:=data->>'status' IN('running','failed','succeeded','stale','ended_unknown')
   AND data->>'model_request_state' IN('not_sent','sent_unknown','completed')
   AND data->>'request_hash' ~ '^[0-9a-f]{64}$' AND data->>'input_hash' ~ '^[0-9a-f]{64}$';
 ELSIF kind='image_prompt_preparation' THEN
  valid:=data->>'status' IN('running','succeeded','failed','ended_unknown')
   AND num_nonnulls(data->>'request_key',data->>'request_hash',data->>'scope_id',data->>'step_id',data->>'attempt_id',data->>'summary')=6
   AND data->'input_payload' IS NOT NULL AND data->'source_snapshot' IS NOT NULL AND data->'frozen_plan' IS NOT NULL;
 ELSIF kind='quality_report_material_version' THEN
  valid:=data->>'snapshot_hash' ~ '^[0-9a-f]{64}$' AND
   ((data->>'subject_kind'='card' AND data->>'card_version_id' IS NOT NULL AND data->>'relation_version_id' IS NULL)
   OR(data->>'subject_kind'='relation' AND data->>'relation_version_id' IS NOT NULL AND data->>'card_version_id' IS NULL));
 ELSIF kind='quality_recheck' THEN
  valid:=(data->>'checked_body_version_id' IS NOT NULL AND data->>'checked_material_versions' IS NULL)
   OR(data->>'checked_body_version_id' IS NULL AND jsonb_typeof(data->'checked_material_versions')='array'
    AND jsonb_array_length(data->'checked_material_versions')>0);
 ELSIF kind='quality_fix_candidate_version' THEN
  valid:=(num_nonnulls(data->>'target_chapter_document_id',data->>'target_body_version_id')=2 AND
   num_nonnulls(data->>'target_card_id',data->>'target_card_version_id',data->>'target_field_key',data->>'target_field_spec_version_id',data->>'target_field_spec_hash',data->>'target_before_hash')=0)
   OR(num_nonnulls(data->>'target_chapter_document_id',data->>'target_body_version_id',data->>'target_anchor_id')=0 AND
   num_nonnulls(data->>'target_card_id',data->>'target_card_version_id',data->>'target_field_key',data->>'target_field_spec_version_id',data->>'target_field_spec_hash',data->>'target_before_hash')=6
   AND data->>'target_field_spec_hash' ~ '^[0-9a-f]{64}$' AND data->>'target_before_hash' ~ '^[0-9a-f]{64}$');
 ELSIF kind='quality_fix_adoption' THEN
  valid:=(num_nonnulls(data->>'chapter_body_adoption_id',data->>'adopted_body_version_id')=2 AND
   num_nonnulls(data->>'adopted_card_version_id',data->>'author_write_request_key',data->>'world_repair_request_hash',data->>'world_repair_input')=0)
   OR(num_nonnulls(data->>'chapter_body_adoption_id',data->>'adopted_body_version_id')=0 AND
   num_nonnulls(data->>'adopted_card_version_id',data->>'author_write_request_key',data->>'world_repair_request_hash',data->>'world_repair_input')=4
   AND data->>'world_repair_request_hash' ~ '^[0-9a-f]{64}$' AND jsonb_typeof(data->'world_repair_input')='object'
   AND data->'world_repair_input'->>'authorWriteRequestKey'=data->>'author_write_request_key'
   AND data->'world_repair_input'->>'requestKey'=data->>'idempotency_key');
 ELSIF kind='quality_issue_evidence' THEN
  IF data->>'evidence_kind' IN('card_field','relation_field') THEN
   valid:=num_nonnulls(data->>'text_anchor_id',data->>'fact_id',data->>'state_change_id',data->>'story_timing_id',data->>'story_relation_id',data->>'planning_version_id',data->>'rule_key',data->>'rule_version')=0
    AND (data->>'is_unverified_observation')::boolean=false
    AND data->>'field_spec_hash' ~ '^[0-9a-f]{64}$' AND data->>'observed_value_hash' ~ '^[0-9a-f]{64}$'
    AND ((data->>'evidence_kind'='card_field' AND data->>'material_kind'='card'
     AND num_nonnulls(data->>'material_id',data->>'card_version_id',data->>'field_key',data->>'field_spec_version_id',data->>'field_spec_hash',data->>'observed_value_hash')=6 AND data->>'relation_version_id' IS NULL)
    OR(data->>'evidence_kind'='relation_field' AND data->>'material_kind'='relation'
     AND num_nonnulls(data->>'material_id',data->>'relation_version_id',data->>'field_key',data->>'field_spec_hash',data->>'observed_value_hash')=5
     AND num_nonnulls(data->>'card_version_id',data->>'field_spec_version_id')=0));
  ELSE
   valid:=num_nonnulls(data->>'material_kind',data->>'material_id',data->>'card_version_id',data->>'relation_version_id',data->>'field_key',data->>'field_spec_version_id',data->>'field_spec_hash',data->>'observed_value_hash')=0;
  END IF;
 END IF;
 IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'quality or image record exact source shape mismatch' USING ERRCODE='23514'; END IF;
 IF kind IN('world_consistency_request','image_prompt_preparation','quality_report_material_version') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('quality-source-unique:'||kind,0));
  SELECT EXISTS(SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id
   JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
   WHERE type.type_key=kind AND card.id<>physical_card AND
   ((kind='world_consistency_request' AND
    ((version.values->>'book_id'=data->>'book_id' AND version.values->>'request_key'=data->>'request_key')
     OR(version.values->>'report_id'=data->>'report_id')))
   OR(kind='image_prompt_preparation' AND
    (version.values->>'request_key'=data->>'request_key' OR version.values->>'step_id'=data->>'step_id' OR version.values->>'attempt_id'=data->>'attempt_id'
     OR(version.values->>'scope_id'=data->>'scope_id' AND version.values->>'status'='running' AND data->>'status'='running')))
   OR(kind='quality_report_material_version' AND version.values->>'report_id'=data->>'report_id'
    AND version.values->>'subject_kind'=data->>'subject_kind' AND version.values->>'subject_id'=data->>'subject_id'))) INTO collision;
  IF collision THEN RAISE EXCEPTION 'original quality or image request key already exists' USING ERRCODE='23505'; END IF;
 END IF;
END $_$;


--
-- Name: reconcile_chapter_revision_after_checkpoint(uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.reconcile_chapter_revision_after_checkpoint(checkpoint_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$

DECLARE checkpoint record; execution_row record; plan record; pending_count integer; owning_space uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('story-record-writes',0));
 SELECT * INTO STRICT checkpoint FROM (SELECT data.id,data.book_id,data.chapter_document_id,data.body_version_id,data.session_id,data.settlement_id,data.previous_checkpoint_id,data.chapter_order,version.values->'summary' AS summary,data.dependency_hash,data.status,data.created_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_stable_checkpoint' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,chapter_document_id uuid,body_version_id uuid,session_id uuid,settlement_id uuid,previous_checkpoint_id uuid,chapter_order integer,summary jsonb,dependency_hash char(64),status text,created_at timestamptz) WHERE card.status='active') AS chapter_stable_checkpoints WHERE id=checkpoint_id;
 SELECT * INTO execution_row FROM (SELECT data.id,data.plan_id,data.preview_id,data.book_id,data.chapter_document_id,data.old_body_version_id,data.new_body_version_id,data.old_checkpoint_id,data.restart_checkpoint_id,data.adoption_id,data.invalidation_event_id,data.status,data.current_step,data.total_steps,data.revision,data.idempotency_key,data.actor,data.error_summary,data.created_at,data.updated_at,data.completed_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_revision_execution' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,plan_id uuid,preview_id uuid,book_id uuid,chapter_document_id uuid,old_body_version_id uuid,new_body_version_id uuid,old_checkpoint_id uuid,restart_checkpoint_id uuid,adoption_id uuid,invalidation_event_id uuid,status text,current_step integer,total_steps integer,revision integer,idempotency_key text,actor text,error_summary text,created_at timestamptz,updated_at timestamptz,completed_at timestamptz) WHERE card.status='active') AS chapter_revision_executions
  WHERE chapter_document_id=checkpoint.chapter_document_id AND new_body_version_id=checkpoint.body_version_id
   AND status IN ('queued','running','awaiting_review','partially_failed','failed') ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT space_id INTO STRICT owning_space FROM new_design.books WHERE id=execution_row.book_id;
 SELECT count(*) INTO pending_count FROM (SELECT data.id,data.book_id,data.execution_id,data.changed_chapter_document_id,data.target_chapter_document_id,data.target_body_version_id,data.impact_id,data.status,data.reason,data.source_route,data.manual_protected,data.resolution_note,data.revision,data.created_at,data.updated_at,data.resolved_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_revision_review_flag' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,book_id uuid,execution_id uuid,changed_chapter_document_id uuid,target_chapter_document_id uuid,target_body_version_id uuid,impact_id uuid,status text,reason text,source_route text,manual_protected boolean,resolution_note text,revision integer,created_at timestamptz,updated_at timestamptz,resolved_at timestamptz) WHERE card.status='active') AS chapter_revision_review_flags WHERE execution_id=execution_row.id AND status IN ('pending_review','in_review');
 PERFORM new_design.kernel_store_record('chapter_revision_execution',owning_space,execution_row.id,
  to_jsonb(execution_row)||jsonb_build_object('status',CASE WHEN pending_count=0 THEN 'stable' ELSE 'awaiting_review' END,'current_step',execution_row.total_steps,'revision',execution_row.revision+1,'error_summary','','updated_at',now(),'completed_at',CASE WHEN pending_count=0 THEN now() ELSE NULL END));
 IF pending_count=0 THEN
  SELECT * INTO plan FROM (SELECT data.id,data.preview_id,data.book_id,data.expected_preview_revision,data.expected_document_revision,data.reason,data.status,version.values->'summary' AS summary,data.revision,data.idempotency_key,data.created_by,data.confirmed_by,data.confirmed_at,data.created_at,data.updated_at FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='chapter_revision_plan' JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id CROSS JOIN LATERAL jsonb_to_record(version.values) AS data(id uuid,preview_id uuid,book_id uuid,expected_preview_revision integer,expected_document_revision integer,reason text,status text,summary jsonb,revision integer,idempotency_key text,created_by text,confirmed_by text,confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz) WHERE card.status='active') AS chapter_revision_plans WHERE id=execution_row.plan_id AND status='executing';
  IF FOUND THEN PERFORM new_design.kernel_store_record('chapter_revision_plan',owning_space,plan.id,to_jsonb(plan)||jsonb_build_object('status','completed','revision',plan.revision+1,'updated_at',now())); END IF;
 END IF;
 PERFORM new_design.kernel_store_record('chapter_revision_event',owning_space,gen_random_uuid(),
  jsonb_build_object('book_id',execution_row.book_id,'created_at',now(),'preview_id',execution_row.preview_id,'plan_id',execution_row.plan_id,'execution_id',execution_row.id,'event_kind',CASE WHEN pending_count=0 THEN 'execution_completed' ELSE 'step_updated' END,'actor','system','idempotency_key',NULL,'detail',jsonb_build_object('stableCheckpointId',checkpoint.id,'pendingReviewCount',pending_count)));
END;
$$;


--
-- Name: record_dependency_invalidation(uuid, uuid, uuid, uuid, text, text, text, uuid, text, uuid, uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.record_dependency_invalidation(event_uuid uuid, event_book_id uuid, old_resource uuid, new_resource uuid, event_reason text, event_source text, event_state text, event_trigger_id uuid, event_idempotency_key text, preview_id uuid DEFAULT NULL::uuid, change_set_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE event_space uuid; prior jsonb; impact record; impact_id uuid; state_value jsonb; request_uuid uuid; upstream jsonb; impact_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('dependency-invalidation:'||event_book_id::text,0));
 SELECT v.values INTO prior FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
 WHERE t.type_key='dependency_invalidation_event' AND v.values->>'book_id'=event_book_id::text AND v.values->>'idempotency_key'=event_idempotency_key;
 IF prior IS NOT NULL THEN
  IF prior->>'old_resource_id' IS DISTINCT FROM old_resource::text OR prior->>'new_resource_id' IS DISTINCT FROM new_resource::text
   OR prior->>'reason' IS DISTINCT FROM event_reason OR prior->>'trigger_source' IS DISTINCT FROM event_source OR prior->>'requested_state' IS DISTINCT FROM event_state
   OR prior->>'trigger_id' IS DISTINCT FROM event_trigger_id::text OR prior->>'change_preview_id' IS DISTINCT FROM preview_id::text
   OR prior->>'book_change_set_id' IS DISTINCT FROM change_set_id::text THEN RAISE EXCEPTION 'invalidation idempotency conflict' USING ERRCODE='23514'; END IF;
  RETURN (prior->>'id')::uuid;
 END IF;
 SELECT space_id INTO event_space FROM books WHERE id=event_book_id;
 IF event_space IS NULL OR event_state NOT IN ('stale','invalid','needs_review') THEN RAISE EXCEPTION 'invalid invalidation scope or state' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM dependency_resources WHERE id=old_resource AND (book_id IS NULL OR book_id=event_book_id))
 OR (new_resource IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dependency_resources WHERE id=new_resource AND (book_id IS NULL OR book_id=event_book_id))) THEN
  RAISE EXCEPTION 'invalidation resource scope mismatch' USING ERRCODE='23514'; END IF;
 PERFORM kernel_store_record('dependency_invalidation_event',event_space,event_uuid,jsonb_build_object(
  'id',event_uuid,'space_id',event_space,'book_id',event_book_id,'old_resource_id',old_resource,'new_resource_id',new_resource,
  'change_preview_id',preview_id,'book_change_set_id',change_set_id,'reason',event_reason,'trigger_source',event_source,
  'requested_state',event_state,'trigger_id',event_trigger_id,'idempotency_key',event_idempotency_key,'created_at',now()));
 FOR impact IN
  WITH RECURSIVE walk(resource_id,depth,path,strength) AS (
   SELECT e.derived_resource_id,1,ARRAY[e.source_resource_id,e.derived_resource_id],e.dependency_strength
   FROM dependency_edges e WHERE e.book_id=event_book_id AND e.source_resource_id=old_resource AND e.status='active'
   UNION ALL SELECT e.derived_resource_id,w.depth+1,w.path||e.derived_resource_id,
    CASE WHEN w.strength='hard' OR e.dependency_strength='hard' THEN 'hard' ELSE 'soft' END
   FROM walk w JOIN dependency_edges e ON e.source_resource_id=w.resource_id AND e.book_id=event_book_id AND e.status='active'
   WHERE NOT e.derived_resource_id=ANY(w.path) AND w.depth<99)
  SELECT DISTINCT ON(resource_id) * FROM walk ORDER BY resource_id,depth,CASE strength WHEN 'hard' THEN 0 ELSE 1 END,path
 LOOP
  impact_id:=gen_random_uuid(); impact_state:=CASE WHEN event_state='invalid' AND impact.strength='soft' THEN 'needs_review' ELSE event_state END;
  PERFORM kernel_store_record('dependency_invalidation_impact',event_space,impact_id,jsonb_build_object(
   'id',impact_id,'event_id',event_uuid,'resource_id',impact.resource_id,'depth',impact.depth,'propagation_path',impact.path,
   'dependency_strength',impact.strength,'impact_state',impact_state,'created_at',now()));
  PERFORM kernel_store_record('dependency_stale_reason',event_space,gen_random_uuid(),jsonb_build_object(
   'book_id',event_book_id,'resource_id',impact.resource_id,'event_id',event_uuid,'impact_id',impact_id,'state',impact_state,'reason',event_reason,'created_at',now()));
  SELECT v.values INTO state_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE t.type_key='dependency_resource_state' AND v.values->>'resource_id'=impact.resource_id::text;
  INSERT INTO dependency_events(id,book_id,resource_id,invalidation_event_id,from_state,to_state,event_kind,detail)
   VALUES(gen_random_uuid(),event_book_id,impact.resource_id,event_uuid,state_value->>'state',impact_state,'invalidated',event_reason);
  PERFORM kernel_store_record('dependency_resource_state',event_space,COALESCE((state_value->>'id')::uuid,impact.resource_id),
   COALESCE(state_value,'{}'::jsonb)||jsonb_build_object('resource_id',impact.resource_id,'book_id',event_book_id,'state',impact_state,
    'revision',COALESCE((state_value->>'revision')::integer,0)+1,'last_event_id',event_uuid,'updated_at',now()));
  SELECT COALESCE(jsonb_agg(jsonb_build_object('resourceId',s.id,'kind',s.resource_kind,'stableObjectId',s.stable_object_id,'exactVersionId',s.exact_version_id,'contentHash',s.content_hash) ORDER BY s.id),'[]'::jsonb)
   INTO upstream FROM dependency_edges e JOIN dependency_resources s ON s.id=e.source_resource_id WHERE e.derived_resource_id=impact.resource_id AND e.book_id=event_book_id AND e.status='active';
  request_uuid:=gen_random_uuid();
  PERFORM kernel_store_record('dependency_recompute_request',event_space,request_uuid,jsonb_build_object(
   'id',request_uuid,'book_id',event_book_id,'target_resource_id',impact.resource_id,'invalidation_event_id',event_uuid,
   'required_upstream_versions',upstream,'priority',(CASE WHEN impact.strength='hard' THEN 50 ELSE 0 END)-impact.depth,
   'reason',event_reason,'strategy_key','manual_review','idempotency_key',event_uuid::text||':'||impact.resource_id::text,
   'status','pending','attempt_count',0,'revision',1,'last_error','','created_at',now(),'updated_at',now()));
  PERFORM enqueue_registered_background_job('dependency_recompute_request',request_uuid,event_space,event_book_id,event_uuid,impact.resource_id);
  INSERT INTO dependency_events(id,book_id,resource_id,invalidation_event_id,from_state,to_state,event_kind,detail)
   VALUES(gen_random_uuid(),event_book_id,impact.resource_id,event_uuid,impact_state,'recompute_pending','recompute_requested',event_reason);
  PERFORM kernel_store_record('dependency_resource_state',event_space,COALESCE((state_value->>'id')::uuid,impact.resource_id),
   COALESCE(state_value,'{}'::jsonb)||jsonb_build_object('resource_id',impact.resource_id,'book_id',event_book_id,'state','recompute_pending',
    'revision',COALESCE((state_value->>'revision')::integer,0)+2,'last_event_id',event_uuid,'updated_at',now()));
 END LOOP;
 RETURN event_uuid;
END $$;


--
-- Name: register_dependency_resource(text, uuid, uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.register_dependency_resource(kind text, stable_id uuid, version_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
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


--
-- Name: register_type_version_fields(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.register_type_version_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM card_types WHERE id=NEW.card_type_id AND NOT is_internal) THEN
  PERFORM sync_type_version_fields(NEW.id);
 END IF;
 RETURN NEW;
END $$;


--
-- Name: reject_unavailable_resource_integrity_resolution(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.reject_unavailable_resource_integrity_resolution() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- resource_supplement_correction_commit_v1; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_reject_unavailable_resource_integrity_resolution(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: require_resource_supplement_closure(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.require_resource_supplement_closure() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- assert_resource_supplement_formal_closure; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_require_resource_supplement_closure(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: reserve_outbox_aggregate_sequence(uuid, uuid, text, uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.reserve_outbox_aggregate_sequence(requested_space_id uuid, requested_book_id uuid, requested_kind text, requested_id uuid) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE sequence_value bigint;
BEGIN
  INSERT INTO outbox_aggregate_sequences(space_id,book_id,aggregate_kind,aggregate_id,last_sequence) VALUES(requested_space_id,requested_book_id,requested_kind,requested_id,1)
  ON CONFLICT(aggregate_kind,aggregate_id) DO UPDATE SET last_sequence=outbox_aggregate_sequences.last_sequence+1,updated_at=now()
  RETURNING last_sequence INTO sequence_value;
  RETURN sequence_value;
END $$;


--
-- Name: resolve_dependency_resource(text, uuid, uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.resolve_dependency_resource(requested_kind text, requested_stable_id uuid, requested_version_id uuid) RETURNS TABLE(resolved_space_id uuid, resolved_book_id uuid, resolved_hash character)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
 CASE requested_kind
 WHEN 'card_type_version' THEN
  RETURN QUERY SELECT type.space_id,book.id,(dependency_content_hash(version.fields::text)
     )::char(64) FROM card_type_versions version JOIN card_types type ON type.id=version.card_type_id
      LEFT JOIN books book ON book.space_id=type.space_id
      WHERE type.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'template_group_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(dependency_content_hash(version.payload::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,template_id uuid,version integer,payload jsonb,created_at timestamptz) WHERE record_type.type_key='template_group_version') version WHERE version.template_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'card_version' THEN
  RETURN QUERY SELECT card.space_id,book.id,(dependency_content_hash(version.title || version.values::text || version.type_version_id::text)
     )::char(64) FROM card_versions version JOIN cards card ON card.id=version.card_id LEFT JOIN books book ON book.space_id=card.space_id
      WHERE card.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'card_relation' THEN
  RETURN QUERY SELECT relation.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM card_relations relation JOIN card_relation_versions version ON version.card_relation_id=relation.id
    LEFT JOIN books book ON book.space_id=relation.space_id
    WHERE relation.id=requested_stable_id AND version.id=CASE WHEN requested_version_id=relation.id THEN relation.current_version_id ELSE requested_version_id END;
 WHEN 'research_document_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(version.content_hash::char(64)
     )::char(64) FROM research_document_versions version WHERE version.document_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'research_record_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(version.run_hash::char(64)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,record_id uuid,version integer,parent_version_id uuid,source_scope jsonb,template_key text,template_version integer,run_status text,progress integer,budget_tokens integer,used_tokens integer,prompt_snapshot jsonb,model_snapshot jsonb,input_snapshot jsonb,structured_result jsonb,report text,last_error text,cancel_requested boolean,run_hash text,created_at timestamptz,completed_at timestamptz) WHERE record_type.type_key='research_record_version') version WHERE version.record_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'research_reference_pack_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(dependency_content_hash(version.id::text || version.note)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,pack_id uuid,version integer,note text,created_at timestamptz) WHERE record_type.type_key='research_reference_pack_version') version WHERE version.pack_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'chapter_body_version' THEN
  RETURN QUERY SELECT book.space_id,document.book_id,(version.content_hash
     )::char(64) FROM chapter_body_versions version JOIN chapter_documents document ON document.id=version.chapter_document_id JOIN books book ON book.id=document.book_id
      WHERE document.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'chapter_text_anchor' THEN
  RETURN QUERY SELECT book.space_id,anchor.book_id,(anchor.fragment_hash
     )::char(64) FROM new_design.text_anchors anchor JOIN books book ON book.id=anchor.book_id
      WHERE anchor.id=requested_stable_id AND anchor.body_version_id=requested_version_id;
 WHEN 'canonical_fact' THEN
  RETURN QUERY SELECT book.space_id,fact.book_id,(fact.value_hash
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,subject_card_id uuid,predicate text,value_kind text,value_json jsonb,value_hash char(64),object_card_id uuid,valid_story_start numeric,valid_story_end numeric,status text,confidence numeric(5,4),source_method text,supersedes_fact_id uuid,superseded_by_fact_id uuid,revision integer,created_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='canonical_fact') fact JOIN books book ON book.id=fact.book_id
      WHERE fact.id=requested_stable_id AND fact.id=requested_version_id;
 WHEN 'chapter_settlement' THEN
  RETURN QUERY SELECT book.space_id,settlement.book_id,(dependency_content_hash(to_jsonb(settlement)::text)
     )::char(64) FROM chapter_settlements settlement JOIN books book ON book.id=settlement.book_id
      WHERE settlement.chapter_document_id=requested_stable_id AND settlement.id=requested_version_id;
 WHEN 'state_change' THEN
  RETURN QUERY SELECT book.space_id,change.book_id,(dependency_content_hash(to_jsonb(change)::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,sequence bigint,book_id uuid,settlement_id uuid,proposal_id uuid,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,cause_event_card_id uuid,subject_kind text,subject_id uuid,state_key text,before_json jsonb,after_json jsonb,delta_json jsonb,reason text,effective_story_order numeric,status text,created_at timestamptz) WHERE record_type.type_key='state_change') change JOIN books book ON book.id=change.book_id
      WHERE change.id=requested_stable_id AND change.id=requested_version_id;
 WHEN 'knowledge_state_change' THEN
  RETURN QUERY SELECT book.space_id,change.book_id,(dependency_content_hash(to_jsonb(change)::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,sequence bigint,book_id uuid,proposal_id uuid,proposal_version_id uuid,claim_id uuid,holder_kind text,holder_key text,holder_card_id uuid,stance text,confidence numeric,effective_story_order numeric,effective_narrative_order numeric,status text,confirmed_by text,created_at timestamptz) WHERE record_type.type_key='knowledge_state_change') change JOIN books book ON book.id=change.book_id
      WHERE change.proposal_id=requested_stable_id AND change.id=requested_version_id;
 WHEN 'story_event_timing' THEN
  RETURN QUERY SELECT book.space_id,timing.book_id,(dependency_content_hash(to_jsonb(timing)::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,sequence bigint,book_id uuid,event_card_id uuid,proposal_id uuid,proposal_version_id uuid,lifecycle text,status text,time_mode text,start_certainty text,end_certainty text,start_instant timestamptz,end_instant timestamptz,timezone_name text,calendar_key text,start_label text,end_label text,normalized_start numeric,normalized_end numeric,duration_value numeric,duration_unit text,relative_to_event_card_id uuid,relative_relation text,relative_offset numeric,evidence_kind text,chapter_document_id uuid,body_version_id uuid,text_anchor_id uuid,fact_id uuid,plan_version_id uuid,state_proposal_id uuid,replaces_timing_id uuid,confirmed_by text,reason text,confirmed_at timestamptz) WHERE record_type.type_key='story_event_timing') timing JOIN books book ON book.id=timing.book_id
      WHERE timing.id=requested_stable_id AND timing.id=requested_version_id;
 WHEN 'story_event_relation' THEN
  RETURN QUERY SELECT book.space_id,relation.book_id,(dependency_content_hash(to_jsonb(relation)::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,sequence bigint,book_id uuid,proposal_id uuid,proposal_version_id uuid,relation_family text,relation_type text,source_event_card_id uuid,target_event_card_id uuid,confidence numeric,status text,confirmed_by text,reason text,created_at timestamptz) WHERE record_type.type_key='story_event_relation') relation JOIN books book ON book.id=relation.book_id
      WHERE relation.proposal_id=requested_stable_id AND relation.id=requested_version_id;
 WHEN 'planning_version' THEN
  RETURN QUERY SELECT book.space_id,version.book_id,(version.content_hash
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,object_id uuid,book_id uuid,version integer,base_version_id uuid,based_on_parent_version_id uuid,source text,status text,content jsonb,content_hash char(64),source_body_version_id uuid,created_by text,stale_at timestamptz,stale_reason text,created_at timestamptz,execution_mode text) WHERE record_type.type_key='planning_version') version JOIN books book ON book.id=version.book_id
      WHERE version.object_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'prompt_recipe_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(version.content_hash
     )::char(64) FROM prompt_recipe_versions version WHERE version.recipe_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'task_contract_version' THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,(version.content_hash
     )::char(64) FROM task_contract_versions version WHERE version.contract_id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'context_manifest' THEN
  RETURN QUERY SELECT COALESCE(book.space_id,scope.space_id),manifest.book_id,(manifest.manifest_hash)::char(64) FROM context_manifests manifest LEFT JOIN books book ON book.id=manifest.book_id LEFT JOIN cards scope ON scope.id=COALESCE(manifest.public_character_scope,manifest.public_title_scope) WHERE manifest.id=requested_stable_id AND manifest.id=requested_version_id AND (book.id IS NOT NULL OR scope.id IS NOT NULL);
 WHEN 'model_route_snapshot' THEN
  RETURN QUERY SELECT book.space_id,snapshot.book_id,(snapshot.snapshot_hash)::char(64) FROM model_route_snapshots snapshot LEFT JOIN books book ON book.id=snapshot.book_id WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id AND (book.id IS NOT NULL OR (snapshot.book_id IS NULL AND snapshot.task_contract_version_id IS NULL AND snapshot.managed_task_key IN ('directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate','chapter_settlement','chapter_generation','world_consistency','creative_extraction','character_dialogue','image_generation')));
 WHEN 'ai_task_attempt' THEN
  RETURN QUERY SELECT task.space_id,task.book_id,(COALESCE(attempt.result_hash,attempt.input_hash)
     )::char(64) FROM ai_task_attempts attempt JOIN ai_tasks task ON task.id=attempt.task_id
      WHERE attempt.task_id=requested_stable_id AND attempt.id=requested_version_id;
 WHEN 'quality_audit_report' THEN
  RETURN QUERY SELECT book.space_id,report.book_id,(dependency_content_hash(report.input_hash || report.id::text)
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,scope_kind text,scope_id uuid,task_id uuid,step_id uuid,attempt_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,context_manifest_id uuid,model_route_snapshot_id uuid,rule_set_key text,rule_set_version text,input_hash char(64),policy_mode text,policy_decision text,execution_effect text,summary text,idempotency_key text,request_hash char(64),created_by text,created_at timestamptz,stale_at timestamptz,stale_reason text) WHERE record_type.type_key='quality_audit_report') report JOIN books book ON book.id=report.book_id
      WHERE report.id=requested_stable_id AND report.id=requested_version_id;
 WHEN 'embedding_source_snapshot' THEN
  RETURN QUERY SELECT snapshot.space_id,snapshot.book_id,(snapshot.source_hash)::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,profile_version_id uuid,dependency_source_resource_id uuid,source_kind text,source_stable_id uuid,source_version_id uuid,source_revision integer,source_hash text,title text,chunk_recipe_hash text,status text,created_by text,created_at timestamptz,stale_at timestamptz) WHERE record_type.type_key='embedding_source_snapshot') snapshot WHERE snapshot.id=requested_stable_id AND snapshot.id=requested_version_id;
 WHEN 'embedding_chunk' THEN
  RETURN QUERY SELECT snapshot.space_id,chunk.book_id,(chunk.content_hash)::char(64) FROM embedding_chunks chunk JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,profile_version_id uuid,dependency_source_resource_id uuid,source_kind text,source_stable_id uuid,source_version_id uuid,source_revision integer,source_hash text,title text,chunk_recipe_hash text,status text,created_by text,created_at timestamptz,stale_at timestamptz) WHERE record_type.type_key='embedding_source_snapshot') snapshot ON snapshot.id=chunk.source_snapshot_id WHERE chunk.record_kind='chunk' AND chunk.id=requested_stable_id AND chunk.id=requested_version_id;
 WHEN 'embedding_result' THEN
  RETURN QUERY SELECT snapshot.space_id,request.book_id,(result.vector_hash)::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,request_id uuid,attempt_id uuid,chunk_id uuid,profile_version_id uuid,observed_source_hash text,observed_chunk_hash text,outcome text,vector_hash text,detail text,created_at timestamptz) WHERE record_type.type_key='embedding_result') result JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,chunk_id uuid,profile_version_id uuid,expected_source_hash text,expected_chunk_hash text,status text,attempt_count integer,idempotency_key text,next_retry_at timestamptz,last_error_code text,last_error_detail text,retryable boolean,created_at timestamptz,updated_at timestamptz,embedding_freeze jsonb,embedding_execution_key uuid,embedding_lease_expires_at timestamptz,embedding_model_state text) WHERE record_type.type_key='embedding_request') request ON request.id=result.request_id JOIN embedding_chunks chunk ON chunk.id=result.chunk_id JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,profile_version_id uuid,dependency_source_resource_id uuid,source_kind text,source_stable_id uuid,source_version_id uuid,source_revision integer,source_hash text,title text,chunk_recipe_hash text,status text,created_by text,created_at timestamptz,stale_at timestamptz) WHERE record_type.type_key='embedding_source_snapshot') snapshot ON snapshot.id=chunk.source_snapshot_id WHERE result.id=requested_stable_id AND result.id=requested_version_id AND result.outcome='applied';
 WHEN 'embedding_index_generation' THEN
  RETURN QUERY SELECT book.space_id,generation.book_id,(generation.checksum)::char(64) FROM new_design.embedding_generations generation JOIN books book ON book.id=generation.book_id WHERE generation.id=requested_stable_id AND generation.id=requested_version_id AND generation.checksum IS NOT NULL;
 WHEN 'card_mount' THEN
  RETURN QUERY SELECT instance.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,card_mount_id uuid,revision integer,form_version_id uuid,source_card_version_id uuid,slot_key text,card_id uuid,sort_order integer,local_values jsonb,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='card_mount_version') version JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,form_instance_id uuid,slot_key text,card_id uuid,relation_id uuid,sort_order integer,local_values jsonb,revision integer,created_at timestamptz,updated_at timestamptz,status text,source_card_version_id uuid,current_version_id uuid,created_by text,ended_by text,ended_at timestamptz) WHERE record_type.type_key='card_mount') mount ON mount.id=version.card_mount_id
    JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,form_version_id uuid,primary_card_id uuid,title text,revision integer,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='card_group_form_instance') instance ON instance.id=mount.form_instance_id LEFT JOIN books book ON book.space_id=instance.space_id
    WHERE mount.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'tag_version' THEN
  RETURN QUERY SELECT tag.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,tag_key text,status text,revision integer,current_version_id uuid,visibility text,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='material_tag') tag JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,tag_id uuid,version integer,name text,aliases text[],color text,metadata jsonb,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='material_tag_version') version ON version.tag_id=tag.id LEFT JOIN books book ON book.space_id=tag.space_id
    WHERE tag.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'tag_membership' THEN
  RETURN QUERY SELECT membership.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,tag_id uuid,card_id uuid,status text,revision integer,current_version_id uuid,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='material_tag_membership') membership JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,membership_id uuid,revision integer,tag_version_id uuid,card_version_id uuid,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='material_tag_membership_version') version ON version.membership_id=membership.id LEFT JOIN books book ON book.space_id=membership.space_id
    WHERE membership.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'material_group_version' THEN
  RETURN QUERY SELECT group_row.space_id,group_row.book_id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,group_key text,parent_id uuid,sort_order integer,status text,revision integer,current_version_id uuid,visibility text,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='material_group') group_row JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,group_id uuid,version integer,name text,parent_id uuid,sort_order integer,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='material_group_version') version ON version.group_id=group_row.id
    WHERE group_row.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'group_membership' THEN
  RETURN QUERY SELECT membership.space_id,book.id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,group_id uuid,card_id uuid,sort_order integer,status text,revision integer,current_version_id uuid,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='material_group_membership') membership JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,membership_id uuid,revision integer,group_version_id uuid,card_version_id uuid,sort_order integer,status text,created_by text,created_at timestamptz) WHERE record_type.type_key='material_group_membership_version') version ON version.membership_id=membership.id LEFT JOIN books book ON book.space_id=membership.space_id
    WHERE membership.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'smart_view_version' THEN
  RETURN QUERY SELECT view_row.space_id,view_row.book_id,(dependency_content_hash(to_jsonb(version)::text)
   )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,view_key text,base_view_key text,status text,revision integer,current_version_id uuid,visibility text,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='smart_view') view_row JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,smart_view_id uuid,version integer,name text,description text,filter_ast jsonb,sort_config jsonb,grouping jsonb,display_columns text[],layout jsonb,copied_from_version_id uuid,created_by text,created_at timestamptz) WHERE record_type.type_key='smart_view_version') version ON version.smart_view_id=view_row.id
    WHERE view_row.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'context_binding_version' THEN
  RETURN QUERY SELECT binding.space_id,binding.book_id,(version.content_hash)::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,binding_key text,scope_kind text,scope_ref text,name text,description text,status text,revision integer,current_version_id uuid,adopted_version_id uuid,created_by text,updated_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='context_binding') binding JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,binding_id uuid,version integer,base_version_id uuid,inheritance_mode text,activation_rule jsonb,slot_key text,priority integer,content_role text,token_budget integer,trim_strategy text,dedupe_strategy text,status text,content_hash char(64),created_by text,created_at timestamptz) WHERE record_type.type_key='context_binding_version') version ON version.binding_id=binding.id WHERE binding.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'context_preview' THEN
  RETURN QUERY SELECT book.space_id,preview.book_id,(preview.source_set_hash)::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,task_contract_version_id uuid,prompt_recipe_version_id uuid,volume_id uuid,chapter_id uuid,scene_id uuid,task_node_key text,task_group text,one_time_overrides jsonb,status text,total_budget integer,required_tokens integer,reference_tokens integer,included_tokens integer,remaining_tokens integer,candidate_count integer,included_count integer,decision_summary jsonb,source_set_hash char(64),timeout_ms integer,stale_at timestamptz,stale_reason text,created_by text,created_at timestamptz) WHERE record_type.type_key='context_preview') preview JOIN books book ON book.id=preview.book_id WHERE preview.id=requested_stable_id AND preview.id=requested_version_id;
 WHEN 'semantic_retrieval_run' THEN
  RETURN QUERY SELECT book.space_id,run.book_id,(dependency_content_hash(run.query_hash||run.id::text||run.result_count::text))::char(64) FROM new_design.retrieval_runs run JOIN books book ON book.id=run.book_id WHERE run.id=requested_stable_id AND run.id=requested_version_id;
 WHEN 'entity_initial_state' THEN
  RETURN QUERY SELECT book.space_id,initial.book_id,(version.value_hash
     )::char(64) FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,subject_kind text,subject_id uuid,state_key text,current_version_id uuid,revision integer,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='entity_initial_state') initial JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,initial_state_id uuid,version integer,value_json jsonb,value_hash char(64),source_fact_id uuid,actor text,note text,created_at timestamptz) WHERE record_type.type_key='entity_initial_state_version') version ON version.initial_state_id=initial.id JOIN books book ON book.id=initial.book_id
      WHERE initial.id=requested_stable_id AND version.id=requested_version_id;
 WHEN 'asset_version' THEN
  RETURN QUERY SELECT asset.space_id,version.book_id,(content.checksum)::char(64) FROM asset_versions version JOIN (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,space_id uuid,book_id uuid,asset_key text,asset_kind text,title text,status text,current_version_id uuid,revision integer,created_by text,created_at timestamptz,updated_at timestamptz,archived_at timestamptz) WHERE record_type.type_key='asset') asset ON asset.id=version.asset_id JOIN asset_content_objects content ON content.id=version.content_object_id WHERE version.asset_id=requested_stable_id AND version.id=requested_version_id;
 ELSE RAISE EXCEPTION 'unsupported dependency resource kind: %',requested_kind USING ERRCODE='23514';
 END CASE;
END $$;


--
-- Name: scoped_field_uuid(text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.scoped_field_uuid(seed text) RETURNS uuid
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
 SELECT (substr(md5(seed),1,8)||'-'||substr(md5(seed),9,4)||'-4'||substr(md5(seed),14,3)||'-8'||substr(md5(seed),18,3)||'-'||substr(md5(seed),21,12))::uuid
$$;


--
-- Name: stale_quality_on_body_switch(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.stale_quality_on_body_switch() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE item record; changed jsonb; event_id uuid;
BEGIN
 IF NEW.adopted_version_id IS NOT DISTINCT FROM OLD.adopted_version_id THEN RETURN NEW; END IF;
 FOR item IN SELECT DISTINCT (version.values->>'report_id')::uuid AS report_id
 FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='quality_report_body_version'
 AND (version.values->>'chapter_document_id')::uuid=NEW.id
 AND (version.values->>'body_version_id')::uuid IS DISTINCT FROM NEW.adopted_version_id LOOP
  PERFORM stale_quality_report(item.report_id,'章节正文已采用其他版本。');
 END LOOP;
 FOR item IN SELECT version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='quality_recheck' AND version.values->>'status'='active'
 AND (version.values->>'checked_body_version_id')::uuid IS DISTINCT FROM NEW.adopted_version_id
 AND EXISTS(SELECT 1 FROM chapter_body_versions body WHERE body.id=(version.values->>'checked_body_version_id')::uuid AND body.chapter_document_id=NEW.id)
 FOR UPDATE OF card LOOP
  PERFORM quality_patch_record('quality_recheck',(item.values->>'id')::uuid,jsonb_build_object('status','stale','stale_at',now(),'stale_reason','章节正文已采用其他版本。'));
 END LOOP;
 FOR item IN SELECT card.space_id,version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='quality_fix_candidate' AND version.values->>'status'='proposed'
 AND EXISTS(SELECT 1 FROM cards candidate_version JOIN card_types vt ON vt.id=candidate_version.card_type_id
 JOIN card_versions vv ON vv.id=candidate_version.current_version_id AND vv.card_id=candidate_version.id
 WHERE candidate_version.status='active' AND vt.type_key='quality_fix_candidate_version' AND vv.values->>'id'=version.values->>'current_version_id'
 AND (vv.values->>'target_chapter_document_id')::uuid=NEW.id AND (vv.values->>'target_body_version_id')::uuid IS DISTINCT FROM NEW.adopted_version_id)
 FOR UPDATE OF card LOOP
  changed:=quality_patch_record('quality_fix_candidate',(item.values->>'id')::uuid,jsonb_build_object('status','stale','revision',(item.values->>'revision')::integer+1,'updated_at',now()));
  event_id:=gen_random_uuid();
  PERFORM kernel_store_record('quality_fix_candidate_event',item.space_id,event_id,jsonb_build_object('id',event_id,'candidate_id',item.values->>'id',
   'candidate_version_id',item.values->>'current_version_id','from_status','proposed','to_status','stale','action','mark_stale','actor','system','reason','目标正文已切换。','candidate_revision',changed->'revision'));
 END LOOP;
 RETURN NEW;
END $$;


--
-- Name: stale_quality_report(uuid, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.stale_quality_report(target_report uuid, reason text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE item record; changed jsonb; event_id uuid;
BEGIN
 FOR item IN SELECT card.space_id,version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='quality_audit_report'
 AND (version.values->>'id')::uuid=target_report AND version.values->>'stale_at' IS NULL FOR UPDATE OF card LOOP
  PERFORM quality_patch_record('quality_audit_report',target_report,jsonb_build_object('stale_at',now(),'stale_reason',reason));
 END LOOP;
 FOR item IN SELECT card.space_id,version.values,
   CASE WHEN (version.values->>'report_id')::uuid=target_report THEN 'dependency_invalidated' ELSE 'recheck_dependency_invalidated' END AS action
 FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='quality_issue' AND version.values->>'current_status' NOT IN('stale','superseded')
 AND ((version.values->>'report_id')::uuid=target_report OR EXISTS(
  SELECT 1 FROM cards recheck JOIN card_types rt ON rt.id=recheck.card_type_id
  JOIN card_versions rv ON rv.id=recheck.current_version_id AND rv.card_id=recheck.id
  WHERE recheck.status='active' AND rt.type_key='quality_recheck' AND rv.values->>'status'='active'
  AND (rv.values->>'recheck_report_id')::uuid=target_report AND rv.values->>'issue_id'=version.values->>'id'))
 FOR UPDATE OF card LOOP
  changed:=quality_patch_record('quality_issue',(item.values->>'id')::uuid,jsonb_build_object('current_status','stale','revision',(item.values->>'revision')::integer+1,'updated_at',now()));
  event_id:=gen_random_uuid();
  PERFORM kernel_store_record('quality_issue_event',item.space_id,event_id,jsonb_build_object('id',event_id,
   'issue_id',item.values->>'id','issue_version_id',item.values->>'current_version_id','from_status',item.values->>'current_status',
   'to_status','stale','action',item.action,'actor_kind','system','actor','system','reason',reason,'issue_revision',changed->'revision'));
 END LOOP;
 FOR item IN SELECT version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND type.type_key='quality_recheck' AND version.values->>'status'='active'
 AND (version.values->>'recheck_report_id')::uuid=target_report FOR UPDATE OF card LOOP
  PERFORM quality_patch_record('quality_recheck',(item.values->>'id')::uuid,jsonb_build_object('status','stale','stale_at',now(),'stale_reason',reason));
 END LOOP;
END $$;


--
-- Name: stale_world_quality_material(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.stale_world_quality_material() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
BEGIN
 IF OLD.current_version_id IS DISTINCT FROM NEW.current_version_id OR OLD.status IS DISTINCT FROM NEW.status THEN
  PERFORM quality_stale_world_material(NEW.id,CASE WHEN TG_TABLE_NAME='cards' THEN 'card' ELSE 'relation' END);
 END IF;
 RETURN NEW;
END $$;


--
-- Name: stale_world_quality_specification(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.stale_world_quality_specification() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
BEGIN
 PERFORM quality_stale_world_specification(TG_TABLE_NAME,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;


--
-- Name: structure_record(text, uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.structure_record(kind text, logical_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'new_design', 'public'
    AS $$
 SELECT (SELECT version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
  JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  WHERE type.is_internal AND type.type_key=kind AND card.status='active' AND version.values->>'id'=logical_id::text)
$$;


--
-- Name: structure_template_dictionaries(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.structure_template_dictionaries() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'new_design', 'public'
    AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceId',head.values->>'id','key',head.values->>'dictionary_key',
  'name',head.values->>'name','description',COALESCE(head.values->>'description',''),'items',
  COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',item.values->>'id','parentSourceId',item.values->'parent_id',
   'key',item.values->>'item_key','label',item.values->>'label','description',COALESCE(item.values->>'description',''),
   'value',item.values->'value','sortOrder',(item.values->>'sort_order')::integer) ORDER BY (item.values->>'sort_order')::integer,item.values->>'id')
   FROM cards child JOIN card_types child_type ON child_type.id=child.card_type_id AND child_type.type_key='dictionary_item'
   JOIN card_versions item ON item.id=child.current_version_id AND item.card_id=child.id WHERE child.status='active'
    AND item.values->>'dictionary_id'=head.values->>'id' AND item.values->>'status'='active'),'[]'::jsonb))
  ORDER BY head.values->>'name'),'[]'::jsonb)
 FROM cards dictionary JOIN card_types type ON type.id=dictionary.card_type_id AND type.type_key='dictionary_definition'
 JOIN card_versions head ON head.id=dictionary.current_version_id AND head.card_id=dictionary.id
 WHERE dictionary.status='active' AND head.values->>'scope'='system' AND head.values->>'status'='published'
$$;


--
-- Name: structure_template_forms(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.structure_template_forms() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'new_design', 'public'
    AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceId',head.values->>'id','sourceVersionId',head.values->>'current_version_id',
  'key',head.values->>'form_key','name',head.values->>'name','description',COALESCE(head.values->>'description',''),
  'definition',structure_record('card_group_form_version',(head.values->>'current_version_id')::uuid)->'definition')
 ORDER BY head.values->>'name'),'[]'::jsonb)
 FROM cards form JOIN card_types type ON type.id=form.card_type_id AND type.type_key='card_group_form'
 JOIN card_versions head ON head.id=form.current_version_id AND head.card_id=form.id
 WHERE form.status='active' AND head.values->>'status'='published'
  AND COALESCE((head.values->>'space_id')::uuid,'00000000-0000-4000-8000-000000000001')='00000000-0000-4000-8000-000000000001'
$$;


--
-- Name: sync_type_version_fields(uuid); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.sync_type_version_fields(target_version_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $_$
DECLARE version_row record; type_row record; source_template uuid; source_form uuid;
 item jsonb; option_item jsonb; definition_id uuid; definition_version_id uuid; option_id uuid;
 option_version_id uuid; prior jsonb; option_version jsonb; resolved_origin text;
BEGIN
 SELECT * INTO STRICT version_row FROM card_type_versions WHERE id=target_version_id;
 SELECT * INTO STRICT type_row FROM card_types WHERE id=version_row.card_type_id;
 IF type_row.is_internal THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('type-field-sync:'||type_row.id,0));
 SELECT book.template_version_id INTO source_template FROM books book WHERE book.space_id=type_row.space_id;
 SELECT (head.values->>'current_version_id')::uuid INTO source_form
 FROM cards form JOIN card_types kind ON kind.id=form.card_type_id AND kind.type_key='card_group_form'
 JOIN card_versions head ON head.id=form.current_version_id AND head.card_id=form.id
 WHERE form.status='active' AND COALESCE((head.values->>'space_id')::uuid,'00000000-0000-4000-8000-000000000001')=type_row.space_id
   AND structure_record('card_group_form_version',(head.values->>'current_version_id')::uuid)->'definition'->>'primaryTypeKey'=type_row.type_key
 ORDER BY (head.values->>'updated_at')::timestamptz DESC,form.id LIMIT 1;
 FOR item IN SELECT value FROM jsonb_array_elements(version_row.fields) LOOP
  definition_id:=scoped_field_uuid(version_row.card_type_id::text||':'||(item->>'key'));
  definition_version_id:=scoped_field_uuid(definition_id::text||':version:'||version_row.id::text);
  SELECT origin INTO resolved_origin FROM field_definitions WHERE id=definition_id;
  resolved_origin:=COALESCE(resolved_origin,CASE
    WHEN type_row.space_id='00000000-0000-4000-8000-000000000001' THEN 'core'
    WHEN type_row.source_type_version_id IS NOT NULL AND version_row.version=1 THEN 'template' ELSE 'book_extension' END);
  INSERT INTO field_definitions(id,space_id,card_type_id,field_key,origin,scope,status,source_template_version_id,source_type_version_id,source_form_version_id,created_by)
   VALUES(definition_id,type_row.space_id,type_row.id,item->>'key',resolved_origin,'book_type',
    CASE WHEN COALESCE((item->>'hidden')::boolean,false) THEN 'archived' ELSE 'active' END,
    source_template,version_row.id,source_form,'system:type-version')
   ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,source_type_version_id=EXCLUDED.source_type_version_id,
    source_form_version_id=COALESCE(EXCLUDED.source_form_version_id,field_definitions.source_form_version_id),
    revision=field_definitions.revision+CASE WHEN field_definitions.source_type_version_id IS DISTINCT FROM EXCLUDED.source_type_version_id THEN 1 ELSE 0 END,
    updated_at=now();
  INSERT INTO field_definition_versions(id,field_definition_id,version,field_schema,created_by)
   VALUES(definition_version_id,definition_id,version_row.version,item,'system:type-version') ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM field_definition_versions WHERE id=definition_version_id AND field_definition_id=definition_id AND version=version_row.version AND field_schema=item) THEN
   RAISE EXCEPTION '字段版本身份或内容不一致'; END IF;
  UPDATE field_definitions SET current_version_id=definition_version_id WHERE id=definition_id;
  FOR option_item IN SELECT value FROM jsonb_array_elements(COALESCE(item->'options','[]'::jsonb)) LOOP
   option_id:=CASE WHEN COALESCE(option_item->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (option_item->>'id')::uuid ELSE scoped_field_uuid(definition_id::text||':option:'||(option_item->>'value')) END;
   prior:=structure_record('field_option_definition',option_id);
   IF prior IS NOT NULL AND (prior->>'field_definition_id' IS DISTINCT FROM definition_id::text OR prior->>'option_key' IS DISTINCT FROM option_item->>'value') THEN
    RAISE EXCEPTION '可选内容身份不属于当前字段或稳定键发生变化'; END IF;
   option_version_id:=scoped_field_uuid(option_id::text||':version:'||version_row.id::text);
   option_version:=structure_record('field_option_version',option_version_id);
   IF option_version IS NULL THEN
    PERFORM kernel_store_record('field_option_version',type_row.space_id,option_version_id,jsonb_build_object(
      'option_definition_id',option_id,'version',version_row.version,'label',option_item->>'label','created_by','system:type-version'));
   ELSIF option_version->>'option_definition_id' IS DISTINCT FROM option_id::text OR option_version->>'label' IS DISTINCT FROM option_item->>'label' THEN
    RAISE EXCEPTION '可选内容版本不一致'; END IF;
   IF prior IS NULL OR prior->>'current_version_id' IS DISTINCT FROM option_version_id::text OR prior->>'status'<>'active' THEN
    PERFORM kernel_store_record('field_option_definition',type_row.space_id,option_id,COALESCE(prior,'{}'::jsonb)||jsonb_build_object(
      'field_definition_id',definition_id,'option_key',option_item->>'value','status','active',
      'revision',COALESCE((prior->>'revision')::integer,0)+1,'current_version_id',option_version_id,'updated_at',now()));
   END IF;
  END LOOP;
 END LOOP;
END $_$;


--
-- Name: transfer_json_is_safe(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.transfer_json_is_safe(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
DECLARE entry record; item jsonb; scalar text;
BEGIN
  IF jsonb_typeof(value)='object' THEN
    FOR entry IN SELECT key,val FROM jsonb_each(value) pair(key,val) LOOP
      IF regexp_replace(lower(entry.key),'[^a-z0-9]','','g') IN ('password','token','accesstoken','refreshtoken','sessiontoken','secret','clientsecret','apikey','privatekey','credential','connectionstring','databaseurl','authorization','cookie','setcookie','absolutepath','temporaryurl') THEN RETURN false; END IF;
      IF NOT transfer_json_is_safe(entry.val) THEN RETURN false; END IF;
    END LOOP;
  ELSIF jsonb_typeof(value)='array' THEN
    FOR item IN SELECT array_item FROM jsonb_array_elements(value) items(array_item) LOOP IF NOT transfer_json_is_safe(item) THEN RETURN false; END IF; END LOOP;
  ELSIF jsonb_typeof(value)='string' THEN
    scalar:=value#>>'{}';
    IF scalar ~ '^[A-Za-z]:[\\/]' OR scalar ~ '^/' OR scalar ~ '^[/\\]{2}' OR scalar ~* '^file://' OR scalar ~* '\mbearer[[:space:]]+[^[:space:]]+' OR scalar ~* '://[^/@:]+:[^/@]+@' OR scalar ~* '[?&](token|signature|x-amz-credential|x-amz-signature)=' THEN RETURN false; END IF;
  END IF;
  RETURN true;
END $$;


--
-- Name: transfer_locator_is_safe(text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.transfer_locator_is_safe(value text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $_$
DECLARE segment text;
BEGIN
  IF value IS NULL OR value='' OR position(E'\\' IN value)>0 OR value !~ '^[A-Za-z0-9._/-]+$' OR value ~ '(^/|^[A-Za-z]:|(^|/)\.\.(/|$)|//)' THEN RETURN false; END IF;
  FOR segment IN SELECT part FROM unnest(string_to_array(value,'/')) AS parts(part) LOOP
    IF segment='' OR segment IN ('.','..') OR segment ~ '[ .]$' OR upper(split_part(segment,'.',1)) ~ '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $_$;


--
-- Name: validate_background_job_reference(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_background_job_reference() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE expected_handler record; event_row record; resolved_book uuid; resolved_space uuid;
BEGIN
  SELECT * INTO expected_handler FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(handler_key text,job_kind text,topic text,event_version integer,specialized_request_kind text,default_max_attempts integer,default_lease_ms integer,backoff_base_ms integer,backoff_cap_ms integer,status text,created_at timestamptz) WHERE record_type.type_key='background_job_handler') background_job_handlers WHERE handler_key=NEW.handler_key AND job_kind=NEW.job_kind AND specialized_request_kind=NEW.specialized_request_kind AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'job handler or specialized request kind is not registered' USING ERRCODE='23514'; END IF;
  SELECT * INTO event_row FROM outbox_events WHERE id=NEW.outbox_event_id;
  IF NOT FOUND OR event_row.topic IS DISTINCT FROM expected_handler.topic OR event_row.event_version IS DISTINCT FROM expected_handler.event_version OR event_row.space_id IS DISTINCT FROM NEW.space_id OR event_row.book_id IS DISTINCT FROM NEW.book_id OR event_row.ordering_key IS DISTINCT FROM NEW.ordering_key OR event_row.aggregate_sequence IS DISTINCT FROM NEW.aggregate_sequence OR event_row.payload->>'specializedRequestKind' IS DISTINCT FROM NEW.specialized_request_kind OR event_row.payload->>'specializedRequestId' IS DISTINCT FROM NEW.specialized_request_id::text THEN RAISE EXCEPTION 'job and outbox event identity mismatch' USING ERRCODE='23514'; END IF;
  CASE NEW.specialized_request_kind
    WHEN 'dependency_recompute_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,target_resource_id uuid,invalidation_event_id uuid,required_upstream_versions jsonb,priority integer,status text,reason text,strategy_key text,task_contract_version_id uuid,idempotency_key text,created_at timestamptz,started_at timestamptz,completed_at timestamptz) WHERE record_type.type_key='dependency_recompute_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'asset_derivation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,source_asset_version_id uuid,output_asset_id uuid,derivative_kind text,recipe_key text,recipe_version text,tool_key text,tool_version text,parameters jsonb,parameters_hash text,expected_source_checksum text,expected_output_asset_revision integer,expected_output_current_version_id uuid,status text,revision integer,idempotency_key text,created_by text,created_at timestamptz,updated_at timestamptz) WHERE record_type.type_key='asset_derivation') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'graph_projection_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,generation_id uuid,request_kind text,dependency_resource_id uuid,source_kind text,source_id uuid,source_version_id uuid,source_revision bigint,source_hash char(64),reason text,status text,attempt_count integer,idempotency_key text,last_error_code text,last_error_detail text,retryable boolean,created_at timestamptz,started_at timestamptz,completed_at timestamptz) WHERE record_type.type_key='graph_projection_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_chunking_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,source_snapshot_id uuid,profile_version_id uuid,expected_source_hash text,status text,attempt_count integer,idempotency_key text,last_error text,created_at timestamptz,started_at timestamptz,completed_at timestamptz,knowledge_index_key uuid,knowledge_index_hash text,knowledge_index_plan jsonb) WHERE record_type.type_key='chunking_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,chunk_id uuid,profile_version_id uuid,expected_source_hash text,expected_chunk_hash text,status text,attempt_count integer,idempotency_key text,next_retry_at timestamptz,last_error_code text,last_error_detail text,retryable boolean,created_at timestamptz,updated_at timestamptz,embedding_freeze jsonb,embedding_execution_key uuid,embedding_lease_expires_at timestamptz,embedding_model_state text) WHERE record_type.type_key='embedding_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_index_generation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM new_design.embedding_generations request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'ai_task' THEN SELECT request.book_id,request.space_id INTO resolved_book,resolved_space FROM ai_tasks request WHERE request.id=NEW.specialized_request_id;
    WHEN 'backup_request' THEN SELECT operation.book_id,operation.space_id INTO resolved_book,resolved_space FROM transfer_operations operation WHERE operation.id=NEW.specialized_request_id;
    WHEN 'publication_export_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,manifest_id uuid,book_id uuid,job_id uuid,requested_by text,idempotency_key text,created_at timestamptz) WHERE record_type.type_key='publication_export_request') request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
  END CASE;
  IF resolved_space IS NULL OR resolved_book IS DISTINCT FROM NEW.book_id OR resolved_space IS DISTINCT FROM NEW.space_id THEN RAISE EXCEPTION 'job specialized request does not resolve in the same scope' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: validate_context_exact_source(text, uuid, uuid, uuid, text); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_context_exact_source(source_type text, stable_id uuid, exact_id uuid, target_book uuid, expected_hash text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE resolved record; allowed boolean;
BEGIN
 SELECT * INTO resolved FROM resolve_dependency_resource(context_dependency_kind(source_type),stable_id,COALESCE(exact_id,stable_id));
 IF NOT FOUND OR (resolved.resolved_book_id IS NOT NULL AND resolved.resolved_book_id IS DISTINCT FROM target_book)
  OR (expected_hash IS NOT NULL AND expected_hash IS DISTINCT FROM resolved.resolved_hash::text) THEN RAISE EXCEPTION 'context exact source missing, cross-book or hash mismatch' USING ERRCODE='23514'; END IF;
 IF source_type IN ('card_version','prompt_component') AND NOT EXISTS(
  SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.card_id=c.id
  WHERE c.id=stable_id AND v.id=exact_id AND NOT t.is_internal AND (source_type<>'prompt_component' OR t.type_key='prompt_component'))
 THEN RAISE EXCEPTION 'context source must be an author material version' USING ERRCODE='23514'; END IF;
 IF target_book IS NOT NULL AND source_type IN ('research_version','research_pack_version','research_document_version') THEN
  SELECT EXISTS(
   SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE t.type_key='book_research_reference' AND v.values->>'book_id'=target_book::text AND (
    (source_type='research_pack_version' AND v.values->>'pack_version_id'=exact_id::text)
    OR (source_type='research_version' AND (v.values->>'research_version_id'=exact_id::text OR EXISTS(
     SELECT 1 FROM cards p JOIN card_types pt ON pt.id=p.card_type_id JOIN card_versions pv ON pv.id=p.current_version_id
     WHERE pt.type_key='research_reference_pack_item' AND pv.values->>'pack_version_id'=v.values->>'pack_version_id' AND pv.values->>'research_version_id'=exact_id::text)))
    OR (source_type='research_document_version' AND EXISTS(
     SELECT 1 FROM cards rc JOIN card_types rt ON rt.id=rc.card_type_id JOIN card_versions rv ON rv.id=rc.current_version_id
     JOIN cards vc ON true JOIN card_types vt ON vt.id=vc.card_type_id JOIN card_versions vv ON vv.id=vc.current_version_id
     WHERE rt.type_key='research_record' AND rv.values->>'source_document_version_id'=exact_id::text AND vt.type_key='research_record_version'
      AND vv.values->>'record_id'=rv.values->>'id' AND (v.values->>'research_version_id'=vv.values->>'id' OR EXISTS(
       SELECT 1 FROM cards p JOIN card_types pt ON pt.id=p.card_type_id JOIN card_versions pv ON pv.id=p.current_version_id
       WHERE pt.type_key='research_reference_pack_item' AND pv.values->>'pack_version_id'=v.values->>'pack_version_id' AND pv.values->>'research_version_id'=vv.values->>'id'))))))
  INTO allowed;
  IF NOT allowed THEN RAISE EXCEPTION 'research context source not adopted by this book' USING ERRCODE='23514'; END IF;
 END IF;
END $$;


--
-- Name: validate_context_selector_config(jsonb); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_context_selector_config(payload jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE selector record;
BEGIN
 SELECT * INTO selector FROM jsonb_to_record(payload) fields(selector_kind text,source_type text,stable_object_id uuid,exact_version_id uuid,selector_config jsonb);
 IF NOT COALESCE(selector.selector_kind IN ('explicit_source','card_type','tag','smart_view','relation','story_range','research_pack','prompt_component','retrieval_trace')
  AND selector.source_type IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version','prompt_component','retrieval_chunk','asset_version','entity_initial_state')
  AND jsonb_typeof(selector.selector_config)='object',false) THEN RAISE EXCEPTION 'invalid typed context selector' USING ERRCODE='23514'; END IF;

  IF selector.selector_kind IN ('explicit_source','prompt_component') AND (selector.stable_object_id IS NULL OR selector.exact_version_id IS NULL) THEN RAISE EXCEPTION 'explicit selector requires an exact source version' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind NOT IN ('explicit_source','prompt_component') AND (selector.stable_object_id IS NOT NULL OR selector.exact_version_id IS NOT NULL) THEN RAISE EXCEPTION 'dynamic selector cannot pin an unrelated source identity' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='explicit_source' AND selector.source_type NOT IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version','asset_version','entity_initial_state') THEN RAISE EXCEPTION 'unsupported explicit source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='prompt_component' AND selector.source_type<>'prompt_component' THEN RAISE EXCEPTION 'prompt component selector requires prompt_component source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind IN ('card_type','tag','smart_view','relation') AND selector.source_type<>'card_version' THEN RAISE EXCEPTION 'card selector requires card_version source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='story_range' AND selector.source_type NOT IN ('card_version','story_time') THEN RAISE EXCEPTION 'story range selector has an unsupported source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='research_pack' AND selector.source_type NOT IN ('research_version','research_pack_version') THEN RAISE EXCEPTION 'research pack selector has an unsupported source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='retrieval_trace' AND selector.source_type<>'retrieval_chunk' THEN RAISE EXCEPTION 'retrieval selector requires retrieval_chunk source type' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind IN ('explicit_source','prompt_component') AND selector.selector_config<>'{}'::jsonb THEN RAISE EXCEPTION 'explicit selector config must be empty' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='card_type' AND (NOT (selector.selector_config ? 'typeKey') OR (selector.selector_config-ARRAY['typeKey']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'card type selector requires only typeKey' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='tag' AND (NOT (selector.selector_config ? 'tagId') OR (selector.selector_config-ARRAY['tagId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'tag selector requires only tagId' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='smart_view' AND (NOT (selector.selector_config ? 'smartViewId') OR (selector.selector_config-ARRAY['smartViewId','limit']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'smart view selector requires smartViewId and optional limit' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='relation' AND (NOT (selector.selector_config ? 'relationTypeId') OR (selector.selector_config-ARRAY['relationTypeId','anchorCardId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'relation selector requires relationTypeId and optional anchorCardId' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='story_range' AND (NOT (selector.selector_config ?& ARRAY['start','end']) OR (selector.selector_config-ARRAY['start','end']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'story range selector requires start and end' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='research_pack' AND (NOT (selector.selector_config ? 'packVersionId') OR (selector.selector_config-ARRAY['packVersionId']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'research pack selector requires only packVersionId' USING ERRCODE='23514'; END IF;
  IF selector.selector_kind='retrieval_trace' AND (NOT (selector.selector_config ? 'retrievalRunId') OR (selector.selector_config-ARRAY['retrievalRunId','limit']::text[])<>'{}'::jsonb) THEN RAISE EXCEPTION 'retrieval selector requires an existing trace and optional limit; fake retrieval is forbidden' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(selector.selector_config) AS item(key_name) WHERE key_name ~* '(sql|jsonpath|cypher|javascript|script|prompt)') THEN RAISE EXCEPTION 'selector contains a forbidden executable expression' USING ERRCODE='23514'; END IF;
  RETURN;

END $$;


--
-- Name: validate_dependency_resource(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_dependency_resource() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE resolved record;
BEGIN
  SELECT * INTO resolved FROM resolve_dependency_resource(NEW.resource_kind,NEW.stable_object_id,NEW.exact_version_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'dependency resource reference does not resolve' USING ERRCODE='23503'; END IF;
  NEW.space_id:=resolved.resolved_space_id;
  NEW.book_id:=resolved.resolved_book_id;
  NEW.content_hash:=resolved.resolved_hash;
  RETURN NEW;
END $$;


--
-- Name: validate_embedding_generation(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_embedding_generation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,profile_id uuid,version integer,provider_key text,model_key text,dimensions integer,distance_metric text,normalize boolean,chunker_key text,chunker_version text,max_chunk_chars integer,overlap_chars integer,allowed_source_kinds text[],content_hash text,created_by text,created_at timestamptz,connection_version_id uuid,knowledge_profile_key uuid,knowledge_profile_hash text,knowledge_profile_book_id uuid) WHERE record_type.type_key='embedding_profile_version') version JOIN embedding_profiles profile ON profile.id=version.profile_id WHERE version.id=NEW.profile_version_id AND profile.status='active') THEN RAISE EXCEPTION 'embedding generation requires an active profile' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: validate_native_asset_link(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_asset_link() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE owner_book uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM asset_versions WHERE id=NEW.asset_version_id AND asset_id=NEW.asset_id AND book_id=NEW.book_id) THEN RAISE EXCEPTION 'asset link version scope mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.owner_kind='book' THEN
  SELECT id INTO owner_book FROM books WHERE id=NEW.owner_stable_id AND id=NEW.owner_exact_version_id;
 ELSIF NEW.owner_kind='quality_issue_evidence' THEN
  SELECT (issue.values->>'book_id')::uuid INTO owner_book
  FROM cards evidence_card JOIN card_types evidence_type ON evidence_type.id=evidence_card.card_type_id JOIN card_versions evidence ON evidence.id=evidence_card.current_version_id
  JOIN cards version_card ON true JOIN card_types version_type ON version_type.id=version_card.card_type_id JOIN card_versions version ON version.id=version_card.current_version_id
  JOIN cards issue_card ON true JOIN card_types issue_type ON issue_type.id=issue_card.card_type_id JOIN card_versions issue ON issue.id=issue_card.current_version_id
  WHERE evidence_type.type_key='quality_issue_evidence' AND evidence.values->>'id'=NEW.owner_stable_id::text AND NEW.owner_stable_id=NEW.owner_exact_version_id
   AND version_type.type_key='quality_issue_version' AND version.values->>'id'=evidence.values->>'issue_version_id'
   AND issue_type.type_key='quality_issue' AND issue.values->>'id'=version.values->>'issue_id';
 ELSE
  SELECT resolved_book_id INTO owner_book FROM resolve_dependency_resource(NEW.owner_kind,NEW.owner_stable_id,NEW.owner_exact_version_id);
  IF NEW.owner_kind='prompt_recipe_version' AND EXISTS(SELECT 1 FROM prompt_recipe_versions WHERE id=NEW.owner_exact_version_id AND recipe_id=NEW.owner_stable_id) THEN owner_book:=NEW.book_id; END IF;
  IF NEW.owner_kind='research_record_version' AND EXISTS(
   SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
   WHERE t.type_key='book_research_reference' AND v.values->>'book_id'=NEW.book_id::text AND
    (v.values->>'research_version_id'=NEW.owner_exact_version_id::text OR EXISTS(
     SELECT 1 FROM cards i JOIN card_types it ON it.id=i.card_type_id JOIN card_versions iv ON iv.id=i.current_version_id
     WHERE it.type_key='research_reference_pack_item' AND iv.values->>'pack_version_id'=v.values->>'pack_version_id' AND iv.values->>'research_version_id'=NEW.owner_exact_version_id::text)))
   AND EXISTS(SELECT 1 FROM resolve_dependency_resource(NEW.owner_kind,NEW.owner_stable_id,NEW.owner_exact_version_id)) THEN owner_book:=NEW.book_id; END IF;
 END IF;
 IF owner_book IS DISTINCT FROM NEW.book_id THEN RAISE EXCEPTION 'asset link owner unavailable or cross-book' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_native_asset_version(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_asset_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
  WHERE t.type_key='asset' AND v.values->>'id'=NEW.asset_id::text AND v.values->>'book_id'=NEW.book_id::text)
 OR (NEW.base_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_versions WHERE id=NEW.base_version_id AND asset_id=NEW.asset_id AND book_id=NEW.book_id))
 OR (NEW.derived_from_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_versions WHERE id=NEW.derived_from_version_id AND book_id=NEW.book_id))
 OR (NEW.source_resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dependency_resources WHERE id=NEW.source_resource_id AND (book_id IS NULL OR book_id=NEW.book_id))) THEN RAISE EXCEPTION 'asset exact version scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_native_context_item(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_context_item() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE manifest record; slot jsonb; decision jsonb;
BEGIN
 SELECT * INTO manifest FROM context_manifests WHERE id=NEW.manifest_id;
 SELECT v.values INTO slot FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_manifest_slot' AND v.values->>'id'=NEW.slot_id::text;
 IF manifest.id IS NULL OR slot IS NULL OR slot->>'manifest_id' IS DISTINCT FROM NEW.manifest_id::text THEN RAISE EXCEPTION 'manifest item slot scope mismatch' USING ERRCODE='23514'; END IF;
 PERFORM validate_context_exact_source(NEW.source_type,NEW.stable_object_id,NEW.exact_version_id,manifest.book_id,
  CASE WHEN NEW.source_type IN ('body_version','text_anchor','planning_version','canonical_fact','research_version','research_document_version','asset_version','entity_initial_state') THEN NEW.content_hash::text ELSE NULL END);
 IF manifest.book_id IS NULL AND (NEW.source_type<>'card_version' OR NEW.stable_object_id IS DISTINCT FROM COALESCE(manifest.public_character_scope,manifest.public_title_scope)) THEN RAISE EXCEPTION 'public manifest item outside original source' USING ERRCODE='23514'; END IF;
 IF NEW.preview_decision_id IS NOT NULL THEN
  SELECT v.values INTO decision FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_preview_decision' AND v.values->>'id'=NEW.preview_decision_id::text;
  IF decision IS NULL OR decision->>'preview_id' IS DISTINCT FROM manifest.preview_id::text OR decision->>'decision'<>'included'
   OR decision->>'source_type' IS DISTINCT FROM NEW.source_type OR decision->>'stable_object_id' IS DISTINCT FROM NEW.stable_object_id::text
   OR decision->>'exact_version_id' IS DISTINCT FROM NEW.exact_version_id::text OR decision->>'source_hash' IS DISTINCT FROM NEW.content_hash::text
   OR decision->>'binding_version_id' IS DISTINCT FROM NEW.binding_version_id::text OR decision->>'slot_key' IS DISTINCT FROM slot->>'slot_key'
   OR decision->>'content_role' IS DISTINCT FROM NEW.content_role THEN RAISE EXCEPTION 'manifest item differs from frozen decision' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.binding_version_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
  JOIN cards bc ON true JOIN card_types bt ON bt.id=bc.card_type_id JOIN card_versions bv ON bv.id=bc.current_version_id
  WHERE t.type_key='context_binding_version' AND v.values->>'id'=NEW.binding_version_id::text AND bt.type_key='context_binding'
   AND bv.values->>'id'=v.values->>'binding_id' AND (bv.values->>'book_id' IS NULL OR bv.values->>'book_id'=manifest.book_id::text))
  THEN RAISE EXCEPTION 'manifest binding version scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_native_context_manifest(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_context_manifest() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE preview jsonb; route record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM task_contract_versions contract JOIN prompt_recipe_versions recipe ON recipe.id=contract.prompt_recipe_version_id
  WHERE contract.id=NEW.task_contract_version_id AND recipe.id=NEW.prompt_recipe_version_id
  AND (NEW.task_group IS NULL OR contract.task_group=NEW.task_group)) THEN RAISE EXCEPTION 'context manifest contract/recipe mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.model_route_snapshot_id IS NOT NULL THEN
  SELECT * INTO route FROM model_route_snapshots WHERE id=NEW.model_route_snapshot_id;
  IF NOT FOUND OR (route.book_id IS NOT NULL AND route.book_id IS DISTINCT FROM NEW.book_id)
   OR (route.task_contract_version_id IS NOT NULL AND route.task_contract_version_id IS DISTINCT FROM NEW.task_contract_version_id)
   OR (NEW.book_id IS NULL AND route.book_id IS NOT NULL) THEN RAISE EXCEPTION 'context manifest frozen model scope mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.preview_id IS NOT NULL THEN
  SELECT v.values INTO preview FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='context_preview' AND v.values->>'id'=NEW.preview_id::text;
  IF preview IS NULL OR preview->>'book_id' IS DISTINCT FROM NEW.book_id::text
   OR preview->>'task_contract_version_id' IS DISTINCT FROM NEW.task_contract_version_id::text OR preview->>'prompt_recipe_version_id' IS DISTINCT FROM NEW.prompt_recipe_version_id::text
   OR preview->>'source_set_hash' IS DISTINCT FROM NEW.source_set_hash::text OR preview->>'status'<>'complete'
   OR preview->>'volume_id' IS DISTINCT FROM NEW.volume_id::text OR preview->>'chapter_id' IS DISTINCT FROM NEW.chapter_id::text
   OR preview->>'scene_id' IS DISTINCT FROM NEW.scene_id::text OR preview->'decision_summary' IS DISTINCT FROM NEW.decision_summary
   THEN RAISE EXCEPTION 'context manifest must freeze its original complete preview' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_native_embedding_chunk(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_embedding_chunk() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE source_value jsonb;
BEGIN
 SELECT v.values INTO source_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_source_snapshot' AND v.values->>'id'=NEW.source_snapshot_id::text;
 IF source_value IS NULL OR source_value->>'book_id' IS DISTINCT FROM NEW.book_id::text OR source_value->>'profile_version_id' IS DISTINCT FROM NEW.profile_version_id::text THEN RAISE EXCEPTION 'chunk source scope mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.record_kind='source' THEN
  IF NEW.id<>NEW.source_snapshot_id OR NEW.ordinal<>0 OR NEW.anchor_kind<>'whole' OR NEW.content_hash IS DISTINCT FROM (source_value->>'source_hash')::char(64) OR NEW.chunker_version IS DISTINCT FROM source_value->>'chunk_recipe_hash' THEN RAISE EXCEPTION 'source text identity mismatch' USING ERRCODE='23514'; END IF;
 ELSIF source_value->>'status'<>'current' OR NOT EXISTS(SELECT 1 FROM embedding_chunks WHERE id=NEW.source_snapshot_id AND record_kind='source' AND status='current') THEN RAISE EXCEPTION 'chunk requires exact current source text' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_native_embedding_vector(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_embedding_vector() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $_$
DECLARE chunk_row record; source_value jsonb; profile jsonb; request_value jsonb; result_value jsonb; generation_row record;
BEGIN
 SELECT * INTO chunk_row FROM embedding_chunks WHERE id=NEW.chunk_id AND record_kind='chunk';
 IF NOT FOUND THEN RAISE EXCEPTION 'vector chunk missing' USING ERRCODE='23503'; END IF;
 SELECT v.values INTO source_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_source_snapshot' AND v.values->>'id'=chunk_row.source_snapshot_id::text;
 SELECT v.values INTO profile FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'id'=NEW.profile_version_id::text;
 IF profile IS NULL OR source_value IS NULL OR NEW.book_id<>chunk_row.book_id OR NEW.profile_version_id<>chunk_row.profile_version_id
 OR public.vector_dims(NEW.embedding) IS DISTINCT FROM (profile->>'dimensions')::integer
 OR NEW.content_text IS DISTINCT FROM chunk_row.chunk_text OR NEW.chunk_hash IS DISTINCT FROM chunk_row.content_hash
 OR NEW.source_kind IS DISTINCT FROM source_value->>'source_kind' OR NEW.source_stable_id::text IS DISTINCT FROM source_value->>'source_stable_id'
 OR NEW.source_version_id::text IS DISTINCT FROM source_value->>'source_version_id' OR NEW.source_revision IS DISTINCT FROM (source_value->>'source_revision')::integer
 OR NEW.source_hash IS DISTINCT FROM (source_value->>'source_hash')::char(64) THEN RAISE EXCEPTION 'vector frozen source or dimensions mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.record_kind IN ('attempt','result') THEN
  IF cardinality(NEW.response_vector) IS DISTINCT FROM (profile->>'dimensions')::integer OR array_ndims(NEW.response_vector)<>1
   OR EXISTS(SELECT 1 FROM unnest(NEW.response_vector) x WHERE x IS NULL OR x::text IN ('NaN','Infinity','-Infinity'))
   OR NEW.embedding IS DISTINCT FROM NEW.response_vector::public.vector THEN RAISE EXCEPTION 'invalid exact response vector' USING ERRCODE='22000'; END IF;
  SELECT v.values INTO request_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_request' AND v.values->>'id'=NEW.request_id::text;
  IF request_value IS NULL OR request_value->>'chunk_id'<>NEW.chunk_id::text OR request_value->>'profile_version_id'<>NEW.profile_version_id::text
   OR NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_attempt' AND v.values->>'id'=NEW.attempt_id::text AND v.values->>'request_id'=NEW.request_id::text)
   OR (NEW.record_kind='attempt' AND NEW.id<>NEW.attempt_id) OR (NEW.record_kind='result' AND NEW.id<>NEW.result_id) THEN RAISE EXCEPTION 'vector response identity mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.record_kind IN ('result','index') THEN
  SELECT v.values INTO result_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_result' AND v.values->>'id'=NEW.result_id::text;
  IF result_value IS NULL OR result_value->>'outcome'<>'applied' OR result_value->>'chunk_id'<>NEW.chunk_id::text
   OR result_value->>'profile_version_id'<>NEW.profile_version_id::text OR result_value->>'observed_source_hash' IS DISTINCT FROM NEW.source_hash::text
   OR result_value->>'observed_chunk_hash' IS DISTINCT FROM NEW.chunk_hash::text OR result_value->>'vector_hash' !~ '^[a-f0-9]{64}$'
   OR source_value->>'status'<>'current' OR chunk_row.status<>'current' THEN RAISE EXCEPTION 'vector result is not eligible' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.record_kind='index' THEN
  SELECT * INTO generation_row FROM embedding_generations WHERE id=NEW.generation_id;
  IF NOT FOUND OR generation_row.book_id<>NEW.book_id OR generation_row.profile_version_id<>NEW.profile_version_id OR generation_row.status NOT IN ('building','verifying')
   OR NOT EXISTS(SELECT 1 FROM embedding_vectors v WHERE v.id=NEW.result_id AND v.record_kind='result' AND v.embedding=NEW.embedding AND v.chunk_id=NEW.chunk_id AND v.profile_version_id=NEW.profile_version_id) THEN RAISE EXCEPTION 'index vector generation/result mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $_$;


--
-- Name: validate_native_history_sources(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_history_sources() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE kind text; value jsonb; item jsonb; owner_book uuid; snapshot_value jsonb;
BEGIN
 IF NEW.current_version_id IS NULL OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN RETURN NEW; END IF;
 SELECT type_key INTO kind FROM card_types WHERE id=NEW.card_type_id;
 IF kind NOT IN ('book_content_history_snapshot','book_content_history_restore','book_completion_snapshot_chapter','publication_export_manifest_chapter') THEN RETURN NEW; END IF;
 SELECT values INTO value FROM card_versions WHERE id=NEW.current_version_id;
 IF kind='book_content_history_snapshot' THEN
  IF NOT COALESCE(value->'payload'->>'bookId'=value->>'book_id' AND jsonb_typeof(value->'payload'->'plans')='array' AND jsonb_typeof(value->'payload'->'chapters')='array',false) THEN RAISE EXCEPTION 'history snapshot scope mismatch' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'payload'->'chapters') LOOP
   IF item ? 'content' OR NOT EXISTS(SELECT 1 FROM chapter_documents d JOIN chapter_body_versions b ON b.chapter_document_id=d.id
    WHERE d.book_id=(value->>'book_id')::uuid AND d.id=(item->>'id')::uuid AND b.id=(item->>'bodyVersionId')::uuid AND b.content_hash::text=item->>'contentHash') THEN RAISE EXCEPTION 'history requires exact physical body reference' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'payload'->'plans') LOOP
   IF NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='planning_version'
    AND v.values->>'id'=item->>'versionId' AND v.values->>'object_id'=item->>'id' AND v.values->>'book_id'=value->>'book_id' AND v.values->'content'=item->'content') THEN RAISE EXCEPTION 'history plan exact source unavailable' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSIF kind='book_content_history_restore' THEN
  SELECT v.values INTO snapshot_value FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='book_content_history_snapshot' AND v.values->>'id'=value->'input_payload'->>'snapshotId' AND v.values->>'book_id'=value->>'book_id';
  IF snapshot_value IS NULL OR NOT COALESCE(snapshot_value->>'source_hash'=value->'input_payload'->>'sourceHash'
   AND value->'input_payload'->>'requestKey'=value->>'request_key' AND value->'input_payload'->>'confirm'='true'
   AND value->'receipt'->>'requestKey'=value->>'request_key' AND value->'receipt'->>'bookId'=value->>'book_id'
   AND value->'receipt'->>'inputHash'=value->>'input_hash' AND value->'receipt'->'input'=value->'input_payload'
   AND value->'receipt'->>'beforeSnapshotId'=value->>'before_snapshot_id',false)
   OR NOT EXISTS(SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='book_content_history_snapshot' AND v.values->>'id'=value->>'before_snapshot_id' AND v.values->>'book_id'=value->>'book_id' AND v.values->>'kind'='before_restore') THEN RAISE EXCEPTION 'history restore original receipt mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF kind='book_completion_snapshot_chapter' THEN
   SELECT (v.values->>'book_id')::uuid INTO owner_book FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='book_completion_snapshot' AND v.values->>'id'=value->>'snapshot_id';
  ELSE SELECT book_id INTO owner_book FROM publication_manifests WHERE id=(value->>'manifest_id')::uuid;
  END IF;
IF owner_book IS NULL OR NOT EXISTS(SELECT 1 FROM chapter_documents d LEFT JOIN chapter_body_versions b ON b.chapter_document_id=d.id AND b.id=(value->>'body_version_id')::uuid
   WHERE d.book_id=owner_book AND d.id=(value->>'chapter_document_id')::uuid
    AND ((kind='book_completion_snapshot_chapter' AND value->>'body_version_id' IS NULL) OR (b.id IS NOT NULL AND b.content_hash::text=value->>'body_hash')))
   OR (value->>'stable_checkpoint_id' IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
    WHERE t.type_key='chapter_stable_checkpoint' AND v.values->>'id'=value->>'stable_checkpoint_id'
     AND v.values->>'chapter_document_id'=value->>'chapter_document_id' AND v.values->>'body_version_id'=value->>'body_version_id'))
   THEN RAISE EXCEPTION 'frozen chapter manifest source mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_native_job_evidence(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_job_evidence() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE job_row record; attempt_row record;
BEGIN
 SELECT * INTO job_row FROM background_jobs WHERE id=NEW.job_id FOR UPDATE;
 SELECT * INTO attempt_row FROM background_job_attempts WHERE id=NEW.attempt_id AND job_id=NEW.job_id;
 IF job_row.id IS NULL OR attempt_row.id IS NULL OR job_row.current_attempt_id IS DISTINCT FROM NEW.attempt_id
  OR job_row.fencing_token IS DISTINCT FROM NEW.fencing_token OR attempt_row.fencing_token IS DISTINCT FROM NEW.fencing_token
  OR attempt_row.lease_token_digest IS DISTINCT FROM job_row.lease_token_digest
  OR job_row.status NOT IN ('running','cancel_requested') OR job_row.lease_until<=clock_timestamp()
  OR attempt_row.status NOT IN ('running','leased') THEN RAISE EXCEPTION 'stale or expired background evidence lease' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_native_publication_artifact(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_publication_artifact() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM publication_manifests manifest JOIN cards c ON true JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id
 WHERE manifest.id=NEW.manifest_id AND manifest.format=NEW.format AND t.type_key='publication_export_request'
 AND v.values->>'id'=NEW.request_id::text AND v.values->>'manifest_id'=manifest.id::text AND v.values->>'book_id'=manifest.book_id::text)
 THEN RAISE EXCEPTION 'publication artifact scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_native_retrieval_vector(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_native_retrieval_vector() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE dimensions integer;
BEGIN
 IF TG_OP='UPDATE' AND OLD.query_vector IS NOT NULL AND NEW.query_vector IS DISTINCT FROM OLD.query_vector THEN RAISE EXCEPTION 'retrieval exact response immutable' USING ERRCODE='23514'; END IF;
 IF NEW.query_vector IS NULL THEN RETURN NEW; END IF;
 SELECT (v.values->>'dimensions')::integer INTO dimensions FROM cards c JOIN card_types t ON t.id=c.card_type_id JOIN card_versions v ON v.id=c.current_version_id WHERE t.type_key='embedding_profile_version' AND v.values->>'id'=NEW.profile_version_id::text;
 IF dimensions IS NULL OR cardinality(NEW.query_vector)<>dimensions OR array_ndims(NEW.query_vector)<>1 OR EXISTS(SELECT 1 FROM unnest(NEW.query_vector) x WHERE x IS NULL OR x::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'retrieval reply vector is invalid' USING ERRCODE='22000'; END IF;
 IF TG_OP='UPDATE' AND OLD.query_vector IS NOT NULL AND NEW.query_vector IS DISTINCT FROM OLD.query_vector THEN RAISE EXCEPTION 'retrieval exact response immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_outbox_inbox_receipt(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_outbox_inbox_receipt() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE expected_hash char(64); job_handler text; consumer_handler text; stored_outcome text;
BEGIN
  SELECT event.payload_hash,job.handler_key INTO expected_hash,job_handler FROM background_jobs job JOIN outbox_events event ON event.id=job.outbox_event_id WHERE job.id=NEW.job_id AND event.id=NEW.event_id;
  SELECT handler_key INTO consumer_handler FROM outbox_consumers WHERE consumer_key=NEW.consumer_key;
  IF expected_hash IS NULL OR expected_hash IS DISTINCT FROM NEW.event_payload_hash OR job_handler IS DISTINCT FROM consumer_handler THEN RAISE EXCEPTION 'inbox receipt does not match event or consumer handler' USING ERRCODE='23514'; END IF;
  IF NEW.result_id IS NULL THEN
    IF NEW.outcome<>'cancelled' THEN RAISE EXCEPTION 'non-cancelled inbox receipt requires a result' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT outcome INTO stored_outcome FROM new_design.background_job_events WHERE id=NEW.result_id AND job_id=NEW.job_id;
    IF (CASE stored_outcome WHEN 'applied' THEN 'succeeded' ELSE stored_outcome END) IS DISTINCT FROM NEW.outcome THEN RAISE EXCEPTION 'inbox receipt outcome does not match result' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: validate_outbox_scope(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_outbox_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.space_id IS NULL THEN RAISE EXCEPTION 'outbox runtime record requires a space' USING ERRCODE='23514'; END IF;
  IF NEW.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND space_id=NEW.space_id) THEN RAISE EXCEPTION 'outbox runtime book and space mismatch' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='outbox_events' AND NOT EXISTS(SELECT 1 FROM outbox_aggregate_sequences aggregate_row WHERE aggregate_row.aggregate_kind=NEW.aggregate_kind AND aggregate_row.aggregate_id=NEW.aggregate_id AND aggregate_row.space_id=NEW.space_id AND aggregate_row.book_id IS NOT DISTINCT FROM NEW.book_id AND aggregate_row.last_sequence>=(to_jsonb(NEW)->>'aggregate_sequence')::bigint) THEN RAISE EXCEPTION 'outbox event aggregate sequence mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: validate_publication_manifest(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_publication_manifest() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.completion_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,rule_set_key text,rule_set_version integer,source_hash char(64),blocker_count integer,warning_count integer,info_count integer,stable_through_order integer,chapter_count integer,created_by text,created_at timestamptz) WHERE record_type.type_key='book_completion_snapshot') snapshot WHERE snapshot.id=NEW.completion_snapshot_id AND snapshot.book_id=NEW.book_id) THEN RAISE EXCEPTION 'completion snapshot and export manifest book mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.export_mode='formal' AND NEW.completion_snapshot_id IS NULL THEN RAISE EXCEPTION 'formal export requires a completion snapshot' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: validate_resource_supplement_correction_origin(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_resource_supplement_correction_origin() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- stable_resource_correction_start_v1; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_validate_resource_supplement_correction_origin(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_resource_supplement_formal_commit(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_resource_supplement_formal_commit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- resource_supplement_formal_commit_v1; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_validate_resource_supplement_formal_commit(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_resource_supplement_impact_review(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_resource_supplement_impact_review() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- resource_supplement_impact_review_v1; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_validate_resource_supplement_impact_review(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_resource_supplement_integrity_journal(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_resource_supplement_integrity_journal() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- resource_supplement_integrity_v1; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_validate_resource_supplement_integrity_journal(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_resource_supplement_origin(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_resource_supplement_origin() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- NEW.source_snapshot->>'sourceHash'; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_validate_resource_supplement_origin(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_resource_supplement_settlement(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_resource_supplement_settlement() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'public'
    AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
 -- ; the same executable assertion is also dispatched for card records.
 IF TG_TABLE_NAME='card_versions' THEN
  SELECT version.values INTO previous FROM cards card JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.id=NEW.card_id;
  next:=NEW.values;
 ELSE
  previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  next:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 END IF;
 PERFORM quality_guard_validate_resource_supplement_settlement(previous,next,CASE WHEN TG_TABLE_NAME='card_versions' THEN CASE WHEN previous IS NULL THEN 'INSERT' ELSE 'UPDATE' END ELSE TG_OP END,TG_TABLE_NAME);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_transfer_active_evidence(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_transfer_active_evidence() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
DECLARE owning_operation uuid;
BEGIN
  IF TG_TABLE_NAME='transfer_entries' THEN SELECT operation_id INTO owning_operation FROM (SELECT fields.* FROM new_design.cards record_card JOIN new_design.card_types record_type ON record_type.id=record_card.card_type_id JOIN new_design.card_versions record_version ON record_version.id=record_card.current_version_id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,operation_id uuid,manifest_id uuid,artifact_kind text,media_type text,storage_locator text,normalized_case_locator text,display_filename text,checksum_algorithm text,checksum char(64),byte_size bigint,entry_count integer,compressed_bytes bigint,uncompressed_bytes bigint,status text,error_code text,created_at timestamptz,ready_at timestamptz) WHERE record_type.type_key='transfer_artifact') transfer_artifacts WHERE id=NEW.artifact_id;
  ELSE owning_operation:=NEW.operation_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM transfer_operations WHERE id=owning_operation AND status IN ('running','verifying')) THEN RAISE EXCEPTION 'transfer evidence can only be appended while the operation is active' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


--
-- Name: validate_transfer_operation_scope(); Type: FUNCTION; Schema: new_design; Owner: -
--

CREATE FUNCTION new_design.validate_transfer_operation_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'new_design', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.book_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND space_id=NEW.space_id) THEN RAISE EXCEPTION 'transfer operation book and space mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.operation_kind='book_export' AND NEW.book_id IS NULL THEN RAISE EXCEPTION 'book export requires a book' USING ERRCODE='23514'; END IF;
  IF NEW.execution_mode='apply' AND NOT EXISTS(SELECT 1 FROM transfer_operations source WHERE source.id=NEW.source_operation_id AND source.status='ready' AND source.execution_mode='dry_run' AND source.operation_kind=NEW.operation_kind AND source.profile_key=NEW.profile_key AND source.source_artifact_id=NEW.source_artifact_id) THEN RAISE EXCEPTION 'apply operation requires a compatible ready dry-run source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_attempt_usage; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.ai_attempt_usage (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    step_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    input_tokens bigint,
    output_tokens bigint,
    cached_input_tokens bigint,
    duration_ms bigint,
    estimated_cost numeric(18,8),
    currency text,
    fallback_count integer DEFAULT 0 NOT NULL,
    budget_decision text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_attempt_usage_budget_decision_check CHECK ((budget_decision = ANY (ARRAY['unknown'::text, 'within_budget'::text, 'exceeded'::text]))),
    CONSTRAINT ai_attempt_usage_cached_input_tokens_check CHECK (((cached_input_tokens IS NULL) OR (cached_input_tokens >= 0))),
    CONSTRAINT ai_attempt_usage_check CHECK ((((estimated_cost IS NULL) AND (currency IS NULL)) OR ((estimated_cost IS NOT NULL) AND (currency IS NOT NULL)))),
    CONSTRAINT ai_attempt_usage_duration_ms_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT ai_attempt_usage_estimated_cost_check CHECK (((estimated_cost IS NULL) OR (estimated_cost >= (0)::numeric))),
    CONSTRAINT ai_attempt_usage_fallback_count_check CHECK ((fallback_count >= 0)),
    CONSTRAINT ai_attempt_usage_input_tokens_check CHECK (((input_tokens IS NULL) OR (input_tokens >= 0))),
    CONSTRAINT ai_attempt_usage_output_tokens_check CHECK (((output_tokens IS NULL) OR (output_tokens >= 0)))
);


--
-- Name: ai_task_attempts; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.ai_task_attempts (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    step_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    trigger_kind text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    task_contract_version_id uuid NOT NULL,
    prompt_recipe_version_id uuid NOT NULL,
    context_manifest_id uuid NOT NULL,
    model_route_snapshot_id uuid NOT NULL,
    input_hash character(64) NOT NULL,
    output_schema_version text NOT NULL,
    checkpoint_key text,
    lease_token_digest character(64) NOT NULL,
    provider_request_digest character(64),
    result_kind text,
    result_stable_id uuid,
    result_version_id uuid,
    result_hash character(64),
    error_category text,
    retry_eligibility text,
    error_summary text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    debug_result jsonb,
    debug_execution jsonb,
    debug_failure jsonb,
    image_freeze jsonb,
    CONSTRAINT ai_task_attempts_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT ai_task_attempts_check CHECK ((((result_kind IS NULL) AND (result_stable_id IS NULL) AND (result_version_id IS NULL) AND (result_hash IS NULL)) OR ((result_kind IS NOT NULL) AND (result_stable_id IS NOT NULL) AND (result_hash IS NOT NULL)))),
    CONSTRAINT ai_task_attempts_check1 CHECK ((((status = ANY (ARRAY['succeeded'::text, 'failed'::text, 'cancelled'::text, 'discarded'::text])) AND (ended_at IS NOT NULL)) OR ((status = ANY (ARRAY['queued'::text, 'running'::text])) AND (ended_at IS NULL)))),
    CONSTRAINT ai_task_attempts_check2 CHECK ((((status = 'failed'::text) AND (error_category IS NOT NULL) AND (retry_eligibility IS NOT NULL)) OR (status <> 'failed'::text))),
    CONSTRAINT ai_task_attempts_debug_execution_check CHECK (((debug_execution IS NULL) OR (jsonb_typeof(debug_execution) = 'object'::text))),
    CONSTRAINT ai_task_attempts_debug_failure_check CHECK (((debug_failure IS NULL) OR (jsonb_typeof(debug_failure) = 'object'::text))),
    CONSTRAINT ai_task_attempts_error_category_check CHECK (((error_category IS NULL) OR (error_category = ANY (ARRAY['timeout'::text, 'rate_limit'::text, 'authentication'::text, 'provider_unavailable'::text, 'transport'::text, 'context_limit'::text, 'structure_parse'::text, 'content_unsatisfactory'::text, 'cancelled'::text, 'safety'::text, 'data_integrity'::text, 'unknown'::text])))),
    CONSTRAINT ai_task_attempts_image_freeze_check CHECK (((image_freeze IS NULL) OR (jsonb_typeof(image_freeze) = 'object'::text))),
    CONSTRAINT ai_task_attempts_retry_eligibility_check CHECK (((retry_eligibility IS NULL) OR (retry_eligibility = ANY (ARRAY['technical'::text, 'manual'::text, 'none'::text])))),
    CONSTRAINT ai_task_attempts_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'discarded'::text]))),
    CONSTRAINT ai_task_attempts_trigger_kind_check CHECK ((trigger_kind = ANY (ARRAY['initial'::text, 'technical_retry'::text, 'manual_retry'::text, 'recovery'::text])))
);


--
-- Name: COLUMN ai_task_attempts.debug_result; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON COLUMN new_design.ai_task_attempts.debug_result IS 'Trial output only, never a card/body/planning adoption. Frozen once on running-to-terminal transition.';


--
-- Name: COLUMN ai_task_attempts.image_freeze; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON COLUMN new_design.ai_task_attempts.image_freeze IS 'Exact dedicated image connection version and contract; original ledger attempt, no text fallback.';


--
-- Name: ai_task_events; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.ai_task_events (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    step_id uuid,
    attempt_id uuid,
    entity_kind text NOT NULL,
    from_status text,
    to_status text NOT NULL,
    checkpoint_key text,
    reason_code text NOT NULL,
    reason_detail text DEFAULT ''::text NOT NULL,
    actor_kind text NOT NULL,
    actor text DEFAULT ''::text NOT NULL,
    entity_revision integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    image_reply jsonb,
    CONSTRAINT ai_task_state_events_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['user'::text, 'worker'::text, 'system'::text, 'policy'::text]))),
    CONSTRAINT ai_task_state_events_check CHECK ((((entity_kind = 'task'::text) AND (step_id IS NULL) AND (attempt_id IS NULL)) OR ((entity_kind = 'step'::text) AND (step_id IS NOT NULL) AND (attempt_id IS NULL)) OR ((entity_kind = 'attempt'::text) AND (step_id IS NOT NULL) AND (attempt_id IS NOT NULL)))),
    CONSTRAINT ai_task_state_events_entity_kind_check CHECK ((entity_kind = ANY (ARRAY['task'::text, 'step'::text, 'attempt'::text]))),
    CONSTRAINT ai_task_state_events_entity_revision_check CHECK (((entity_revision IS NULL) OR (entity_revision > 0))),
    CONSTRAINT ai_task_state_events_image_reply_check CHECK (((image_reply IS NULL) OR (jsonb_typeof(image_reply) = 'object'::text)))
);


--
-- Name: COLUMN ai_task_events.image_reply; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON COLUMN new_design.ai_task_events.image_reply IS 'Original model base64 reply retained once; resulting image facts remain asset_versions.';


--
-- Name: ai_task_steps; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.ai_task_steps (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    step_key text NOT NULL,
    sort_order integer NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    checkpoint_key text,
    current_attempt_id uuid,
    max_attempts integer NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    lease_owner text,
    lease_token text,
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT ai_task_steps_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT ai_task_steps_retry_count_check CHECK ((retry_count >= 0)),
    CONSTRAINT ai_task_steps_revision_check CHECK ((revision > 0)),
    CONSTRAINT ai_task_steps_sort_order_check CHECK ((sort_order >= 0)),
    CONSTRAINT ai_task_steps_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'waiting_approval'::text, 'retry_scheduled'::text, 'paused'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: ai_tasks; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.ai_tasks (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    book_id uuid,
    task_key text NOT NULL,
    task_contract_version_id uuid NOT NULL,
    source_route text NOT NULL,
    source_kind text NOT NULL,
    source_id uuid,
    request_idempotency_key text NOT NULL,
    request_hash character(64) NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    current_step_key text,
    current_checkpoint text,
    revision integer DEFAULT 1 NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT ai_tasks_priority_check CHECK (((priority >= '-100'::integer) AND (priority <= 100))),
    CONSTRAINT ai_tasks_revision_check CHECK ((revision > 0)),
    CONSTRAINT ai_tasks_source_route_check CHECK ((source_route ~ '^/'::text)),
    CONSTRAINT ai_tasks_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'waiting_approval'::text, 'retry_scheduled'::text, 'paused'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: asset_content_objects; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.asset_content_objects (
    id uuid NOT NULL,
    checksum_algorithm text DEFAULT 'sha256'::text NOT NULL,
    checksum character(64) NOT NULL,
    byte_size bigint NOT NULL,
    mime_type text NOT NULL,
    storage_kind text NOT NULL,
    storage_provider text NOT NULL,
    storage_locator text NOT NULL,
    integrity_state text DEFAULT 'pending'::text NOT NULL,
    last_verified_at timestamp with time zone,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_content_objects_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT asset_content_objects_check CHECK ((((storage_kind = 'managed_file'::text) AND (storage_provider = 'local'::text)) OR ((storage_kind = 'external_object'::text) AND (storage_provider <> 'local'::text)))),
    CONSTRAINT asset_content_objects_checksum_algorithm_check CHECK ((checksum_algorithm = 'sha256'::text)),
    CONSTRAINT asset_content_objects_checksum_check CHECK ((checksum ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT asset_content_objects_integrity_state_check CHECK ((integrity_state = ANY (ARRAY['pending'::text, 'verified'::text, 'missing'::text, 'corrupt'::text]))),
    CONSTRAINT asset_content_objects_mime_type_check CHECK ((mime_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'::text)),
    CONSTRAINT asset_content_objects_storage_kind_check CHECK ((storage_kind = ANY (ARRAY['managed_file'::text, 'external_object'::text]))),
    CONSTRAINT asset_content_objects_storage_locator_check CHECK ((((length(storage_locator) >= 1) AND (length(storage_locator) <= 1000)) AND (storage_locator ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'::text) AND (storage_locator !~ '(^[\\/]|^[A-Za-z]:|(^|/)\.\.(/|$)|\\|://|//)'::text))),
    CONSTRAINT asset_content_objects_storage_provider_check CHECK ((storage_provider ~ '^[a-z][a-z0-9_.-]{1,79}$'::text))
);


--
-- Name: asset_events; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.asset_events (
    id uuid NOT NULL,
    asset_id uuid NOT NULL,
    book_id uuid NOT NULL,
    asset_version_id uuid,
    action text NOT NULL,
    from_status text,
    to_status text,
    asset_revision integer NOT NULL,
    dependency_preview_id uuid,
    idempotency_key text,
    actor text DEFAULT ''::text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    knowledge_input_hash character(64),
    knowledge_receipt jsonb,
    visual_input_hash text,
    visual_receipt jsonb,
    CONSTRAINT asset_events_action_check CHECK ((action = ANY (ARRAY['create'::text, 'add_version'::text, 'adopt'::text, 'rollback'::text, 'readopt'::text, 'archive'::text]))),
    CONSTRAINT asset_events_asset_revision_check CHECK ((asset_revision > 0)),
    CONSTRAINT asset_events_knowledge_receipt_check CHECK ((((knowledge_input_hash IS NULL) AND (knowledge_receipt IS NULL)) OR ((knowledge_input_hash IS NOT NULL) AND (knowledge_receipt IS NOT NULL) AND (knowledge_input_hash ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(knowledge_receipt) = 'object'::text)))),
    CONSTRAINT asset_events_visual_input_hash_check CHECK ((visual_input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT asset_events_visual_receipt_check CHECK ((jsonb_typeof(visual_receipt) = 'object'::text)),
    CONSTRAINT asset_events_visual_receipt_pair CHECK ((((visual_input_hash IS NULL) = (visual_receipt IS NULL)) AND ((visual_receipt IS NULL) OR (idempotency_key IS NOT NULL))))
);


--
-- Name: asset_links; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.asset_links (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    asset_version_id uuid NOT NULL,
    owner_kind text NOT NULL,
    owner_stable_id uuid NOT NULL,
    owner_exact_version_id uuid NOT NULL,
    role text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    idempotency_key text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    end_reason text DEFAULT ''::text NOT NULL,
    knowledge_input_hash character(64),
    knowledge_receipt jsonb,
    visual_input_hash text,
    visual_receipt jsonb,
    CONSTRAINT asset_mounts_check CHECK ((((status = 'active'::text) AND (ended_at IS NULL)) OR ((status = 'ended'::text) AND (ended_at IS NOT NULL)))),
    CONSTRAINT asset_mounts_knowledge_receipt_check CHECK ((((knowledge_input_hash IS NULL) AND (knowledge_receipt IS NULL)) OR ((knowledge_input_hash IS NOT NULL) AND (knowledge_receipt IS NOT NULL) AND (knowledge_input_hash ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(knowledge_receipt) = 'object'::text)))),
    CONSTRAINT asset_mounts_owner_kind_check CHECK ((owner_kind = ANY (ARRAY['book'::text, 'card_version'::text, 'chapter_body_version'::text, 'research_record_version'::text, 'prompt_recipe_version'::text, 'ai_task_attempt'::text, 'quality_issue_evidence'::text]))),
    CONSTRAINT asset_mounts_role_check CHECK ((role ~ '^[a-z][a-z0-9_.-]{1,99}$'::text)),
    CONSTRAINT asset_mounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text]))),
    CONSTRAINT asset_mounts_visual_input_hash_check CHECK ((visual_input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT asset_mounts_visual_receipt_check CHECK ((jsonb_typeof(visual_receipt) = 'object'::text)),
    CONSTRAINT asset_mounts_visual_receipt_pair CHECK (((visual_input_hash IS NULL) = (visual_receipt IS NULL)))
);


--
-- Name: asset_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.asset_versions (
    id uuid NOT NULL,
    asset_id uuid NOT NULL,
    book_id uuid NOT NULL,
    version integer NOT NULL,
    content_object_id uuid NOT NULL,
    base_version_id uuid,
    derived_from_version_id uuid,
    source_kind text NOT NULL,
    source_resource_id uuid,
    display_filename text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    rebuildable boolean DEFAULT false NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_versions_check CHECK ((((source_kind = 'derived'::text) AND (derived_from_version_id IS NOT NULL) AND rebuildable) OR (source_kind <> 'derived'::text))),
    CONSTRAINT asset_versions_display_filename_check CHECK ((((length(display_filename) >= 1) AND (length(display_filename) <= 500)) AND (display_filename !~ '[\\/]'::text))),
    CONSTRAINT asset_versions_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT asset_versions_source_kind_check CHECK ((source_kind = ANY (ARRAY['upload'::text, 'import'::text, 'ai_generated'::text, 'derived'::text, 'external_reference'::text, 'migration'::text]))),
    CONSTRAINT asset_versions_version_check CHECK ((version > 0))
);


--
-- Name: background_job_attempts; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.background_job_attempts (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    fencing_token bigint NOT NULL,
    lease_token_digest character(64) NOT NULL,
    owner text NOT NULL,
    consumer_key text NOT NULL,
    trigger_kind text NOT NULL,
    status text DEFAULT 'leased'::text NOT NULL,
    started_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    ended_at timestamp with time zone,
    error_kind text,
    error_code text DEFAULT ''::text NOT NULL,
    error_summary text DEFAULT ''::text NOT NULL,
    retryable boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT background_job_attempts_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT background_job_attempts_check CHECK ((((status = ANY (ARRAY['succeeded'::text, 'failed'::text, 'cancelled'::text, 'released'::text, 'lease_expired'::text, 'rejected_stale'::text])) AND (ended_at IS NOT NULL)) OR ((status = ANY (ARRAY['leased'::text, 'running'::text])) AND (ended_at IS NULL)))),
    CONSTRAINT background_job_attempts_error_code_check CHECK ((length(error_code) <= 120)),
    CONSTRAINT background_job_attempts_error_kind_check CHECK (((error_kind IS NULL) OR (error_kind = ANY (ARRAY['technical'::text, 'business_rejected'::text, 'rejected_stale'::text, 'cancelled'::text])))),
    CONSTRAINT background_job_attempts_error_summary_check CHECK ((length(error_summary) <= 2000)),
    CONSTRAINT background_job_attempts_fencing_token_check CHECK ((fencing_token > 0)),
    CONSTRAINT background_job_attempts_lease_token_digest_check CHECK ((lease_token_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT background_job_attempts_owner_check CHECK (((length(owner) >= 1) AND (length(owner) <= 160))),
    CONSTRAINT background_job_attempts_status_check CHECK ((status = ANY (ARRAY['leased'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'released'::text, 'lease_expired'::text, 'rejected_stale'::text]))),
    CONSTRAINT background_job_attempts_trigger_kind_check CHECK ((trigger_kind = ANY (ARRAY['initial'::text, 'technical_retry'::text, 'manual_retry'::text, 'worker_release'::text, 'lease_recovery'::text, 'dead_letter_replay'::text])))
);


--
-- Name: background_job_checkpoints; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.background_job_checkpoints (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    fencing_token bigint NOT NULL,
    checkpoint_key text NOT NULL,
    checkpoint_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    checkpoint_hash character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT background_job_checkpoints_checkpoint_data_check CHECK (((jsonb_typeof(checkpoint_data) = 'object'::text) AND (octet_length((checkpoint_data)::text) <= 16384))),
    CONSTRAINT background_job_checkpoints_checkpoint_data_check1 CHECK ((NOT (checkpoint_data ?| ARRAY['body'::text, 'contentText'::text, 'chunkText'::text, 'vector'::text, 'embedding'::text, 'binary'::text, 'prompt'::text, 'credential'::text, 'secret'::text, 'apiKey'::text, 'password'::text]))),
    CONSTRAINT background_job_checkpoints_checkpoint_hash_check CHECK ((checkpoint_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT background_job_checkpoints_checkpoint_key_check CHECK (((length(checkpoint_key) >= 1) AND (length(checkpoint_key) <= 240))),
    CONSTRAINT background_job_checkpoints_reference_payload_check CHECK (new_design.outbox_payload_is_reference_only(checkpoint_data))
);


--
-- Name: background_job_events; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.background_job_events (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    fencing_token bigint NOT NULL,
    outcome text NOT NULL,
    specialized_result_kind text,
    specialized_result_id uuid,
    result_hash character(64),
    result_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT background_job_results_check CHECK ((((outcome = 'applied'::text) AND (specialized_result_kind IS NOT NULL) AND (specialized_result_id IS NOT NULL) AND (result_hash IS NOT NULL)) OR (outcome <> 'applied'::text))),
    CONSTRAINT background_job_results_idempotency_key_check CHECK (((length(idempotency_key) >= 8) AND (length(idempotency_key) <= 240))),
    CONSTRAINT background_job_results_outcome_check CHECK ((outcome = ANY (ARRAY['applied'::text, 'business_rejected'::text, 'rejected_stale'::text, 'cancelled'::text]))),
    CONSTRAINT background_job_results_reference_payload_check CHECK (new_design.outbox_payload_is_reference_only(result_metadata)),
    CONSTRAINT background_job_results_result_hash_check CHECK (((result_hash IS NULL) OR (result_hash ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT background_job_results_result_metadata_check CHECK (((jsonb_typeof(result_metadata) = 'object'::text) AND (octet_length((result_metadata)::text) <= 16384))),
    CONSTRAINT background_job_results_result_metadata_check1 CHECK ((NOT (result_metadata ?| ARRAY['body'::text, 'contentText'::text, 'chunkText'::text, 'vector'::text, 'embedding'::text, 'binary'::text, 'prompt'::text, 'credential'::text, 'secret'::text, 'apiKey'::text, 'password'::text])))
);


--
-- Name: background_jobs; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.background_jobs (
    id uuid NOT NULL,
    outbox_event_id uuid NOT NULL,
    space_id uuid,
    book_id uuid,
    handler_key text NOT NULL,
    job_kind text NOT NULL,
    specialized_request_kind text NOT NULL,
    specialized_request_id uuid NOT NULL,
    execution_generation integer DEFAULT 1 NOT NULL,
    ordering_key text NOT NULL,
    aggregate_sequence bigint NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    max_attempts integer NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_owner text,
    lease_until timestamp with time zone,
    heartbeat_at timestamp with time zone,
    lease_token_digest character(64),
    fencing_token bigint DEFAULT 0 NOT NULL,
    current_attempt_id uuid,
    checkpoint_key text,
    last_error_kind text,
    last_error_code text DEFAULT ''::text NOT NULL,
    last_error_summary text DEFAULT ''::text NOT NULL,
    result_idempotency_key text,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    archived_at timestamp with time zone,
    CONSTRAINT background_jobs_aggregate_sequence_check CHECK ((aggregate_sequence > 0)),
    CONSTRAINT background_jobs_check CHECK (((attempt_count >= 0) AND (attempt_count <= max_attempts))),
    CONSTRAINT background_jobs_check1 CHECK ((((status = ANY (ARRAY['leased'::text, 'running'::text, 'cancel_requested'::text])) AND (lease_owner IS NOT NULL) AND (lease_until IS NOT NULL) AND (lease_token_digest IS NOT NULL)) OR ((status <> ALL (ARRAY['leased'::text, 'running'::text, 'cancel_requested'::text])) AND (lease_owner IS NULL) AND (lease_until IS NULL) AND (lease_token_digest IS NULL)))),
    CONSTRAINT background_jobs_check2 CHECK ((((status = ANY (ARRAY['succeeded'::text, 'failed'::text, 'cancelled'::text, 'dead_letter'::text, 'archived'::text])) AND (completed_at IS NOT NULL)) OR (status <> ALL (ARRAY['succeeded'::text, 'failed'::text, 'cancelled'::text, 'dead_letter'::text, 'archived'::text])))),
    CONSTRAINT background_jobs_check3 CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status <> 'archived'::text) AND (archived_at IS NULL)))),
    CONSTRAINT background_jobs_execution_generation_check CHECK ((execution_generation > 0)),
    CONSTRAINT background_jobs_fencing_token_check CHECK ((fencing_token >= 0)),
    CONSTRAINT background_jobs_last_error_code_check CHECK ((length(last_error_code) <= 120)),
    CONSTRAINT background_jobs_last_error_kind_check CHECK (((last_error_kind IS NULL) OR (last_error_kind = ANY (ARRAY['technical'::text, 'business_rejected'::text, 'rejected_stale'::text, 'cancelled'::text])))),
    CONSTRAINT background_jobs_last_error_summary_check CHECK ((length(last_error_summary) <= 2000)),
    CONSTRAINT background_jobs_lease_owner_check CHECK (((lease_owner IS NULL) OR ((length(lease_owner) >= 1) AND (length(lease_owner) <= 160)))),
    CONSTRAINT background_jobs_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 20))),
    CONSTRAINT background_jobs_ordering_key_check CHECK (((length(ordering_key) >= 1) AND (length(ordering_key) <= 240))),
    CONSTRAINT background_jobs_priority_check CHECK (((priority >= '-100'::integer) AND (priority <= 100))),
    CONSTRAINT background_jobs_revision_check CHECK ((revision > 0)),
    CONSTRAINT background_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'leased'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'retry_scheduled'::text, 'cancel_requested'::text, 'cancelled'::text, 'dead_letter'::text, 'archived'::text])))
);


--
-- Name: books; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.books (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    book_key text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    template_id uuid NOT NULL,
    template_version_id uuid NOT NULL,
    installed_payload jsonb NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT books_revision_check CHECK ((revision > 0)),
    CONSTRAINT books_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: card_relation_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.card_relation_versions (
    id uuid NOT NULL,
    card_relation_id uuid NOT NULL,
    revision integer NOT NULL,
    source_card_version_id uuid NOT NULL,
    target_card_version_id uuid NOT NULL,
    status text NOT NULL,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_relation_versions_revision_check CHECK ((revision > 0)),
    CONSTRAINT card_relation_versions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: TABLE card_relation_versions; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON TABLE new_design.card_relation_versions IS 'Immutable snapshots for independent business relations; form composition does not also write these relations.';


--
-- Name: card_relations; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.card_relations (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    relation_type_id uuid NOT NULL,
    source_card_id uuid NOT NULL,
    target_card_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    valid_from text,
    valid_to text,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_version_id uuid,
    created_by text DEFAULT 'migration'::text NOT NULL,
    CONSTRAINT card_relations_check CHECK ((source_card_id <> target_card_id)),
    CONSTRAINT card_relations_revision_check CHECK ((revision > 0)),
    CONSTRAINT card_relations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: card_spaces; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.card_spaces (
    id uuid NOT NULL,
    space_key text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: card_type_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.card_type_versions (
    id uuid NOT NULL,
    card_type_id uuid NOT NULL,
    version integer NOT NULL,
    fields jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_type_versions_version_check CHECK ((version > 0))
);


--
-- Name: card_types; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.card_types (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    type_key text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    current_version_id uuid,
    draft_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 1000 NOT NULL,
    semantic_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_card_type_id uuid,
    source_type_version_id uuid,
    category_id uuid,
    is_internal boolean DEFAULT false NOT NULL,
    CONSTRAINT card_types_revision_check CHECK ((revision > 0)),
    CONSTRAINT card_types_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


--
-- Name: card_version_actions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.card_version_actions (
    id uuid NOT NULL,
    card_id uuid NOT NULL,
    card_version_id uuid,
    action_key text NOT NULL,
    request_key text,
    input_hash character(64),
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    receipt jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_version_actions_action_key_check CHECK (((length(btrim(action_key)) >= 1) AND (length(btrim(action_key)) <= 120))),
    CONSTRAINT card_version_actions_check CHECK ((((request_key IS NULL) AND (input_hash IS NULL)) OR ((request_key IS NOT NULL) AND (input_hash ~ '^[a-f0-9]{64}$'::text)))),
    CONSTRAINT card_version_actions_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT card_version_actions_receipt_check CHECK (((receipt IS NULL) OR (jsonb_typeof(receipt) = 'object'::text)))
);


--
-- Name: card_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.card_versions (
    id uuid NOT NULL,
    card_id uuid NOT NULL,
    revision integer NOT NULL,
    type_version_id uuid NOT NULL,
    title text NOT NULL,
    "values" jsonb NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    form_version_id uuid,
    form_resolution_kind text DEFAULT 'legacy'::text NOT NULL,
    author_book_id uuid,
    author_request_key uuid,
    author_input_hash character(64),
    author_write_receipt jsonb,
    CONSTRAINT card_versions_author_receipt_complete CHECK ((((author_book_id IS NULL) AND (author_request_key IS NULL) AND (author_input_hash IS NULL) AND (author_write_receipt IS NULL)) OR ((author_book_id IS NOT NULL) AND (author_request_key IS NOT NULL) AND (author_input_hash IS NOT NULL) AND (author_write_receipt IS NOT NULL) AND (author_input_hash ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(author_write_receipt) = 'object'::text)))),
    CONSTRAINT card_versions_form_resolution_kind_check CHECK ((form_resolution_kind = ANY (ARRAY['installed_form'::text, 'type_schema'::text, 'system_default'::text, 'generic'::text, 'legacy'::text]))),
    CONSTRAINT card_versions_revision_check CHECK ((revision > 0)),
    CONSTRAINT card_versions_source_check CHECK ((source = ANY (ARRAY['create'::text, 'edit'::text, 'archive'::text, 'restore'::text])))
);


--
-- Name: COLUMN card_versions.form_version_id; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON COLUMN new_design.card_versions.form_version_id IS '实际用于本次填写的已发布创作表单版本；未使用组合表单时为空。';


--
-- Name: COLUMN card_versions.form_resolution_kind; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON COLUMN new_design.card_versions.form_resolution_kind IS '填写外壳解析来源，只记录来源类型，不复制渲染后的表单配置。';


--
-- Name: COLUMN card_versions.author_write_receipt; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON COLUMN new_design.card_versions.author_write_receipt IS 'Immutable original-request acknowledgement; metadata on canonical card version, not a second material fact.';


--
-- Name: cards; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.cards (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    card_type_id uuid NOT NULL,
    title text NOT NULL,
    status text NOT NULL,
    revision integer NOT NULL,
    type_version_id uuid NOT NULL,
    current_version_id uuid,
    "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT cards_revision_check CHECK ((revision > 0)),
    CONSTRAINT cards_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: chapter_body_adoptions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.chapter_body_adoptions (
    id uuid NOT NULL,
    chapter_document_id uuid NOT NULL,
    from_version_id uuid,
    to_version_id uuid NOT NULL,
    action text NOT NULL,
    document_revision integer NOT NULL,
    idempotency_key text NOT NULL,
    actor text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chapter_body_adoptions_action_check CHECK ((action = ANY (ARRAY['adopt'::text, 'rollback'::text, 'readopt'::text]))),
    CONSTRAINT chapter_body_adoptions_document_revision_check CHECK ((document_revision > 0))
);


--
-- Name: chapter_body_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.chapter_body_versions (
    id uuid NOT NULL,
    chapter_document_id uuid NOT NULL,
    version integer NOT NULL,
    parent_version_id uuid,
    base_version_id uuid,
    source text NOT NULL,
    source_run_id uuid,
    created_by_kind text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    content text NOT NULL,
    content_hash character(64) NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    operation_kind text DEFAULT 'manual_draft'::text NOT NULL,
    planning_object_id uuid,
    planning_version_id uuid,
    context_manifest_id uuid,
    task_contract_version_id uuid,
    prompt_recipe_version_id uuid,
    model_route_snapshot_id uuid,
    ai_task_id uuid,
    ai_attempt_id uuid,
    input_body_version_id uuid,
    selection_start integer,
    selection_end integer,
    CONSTRAINT chapter_body_versions_check CHECK (((selection_end IS NULL) OR (selection_end > selection_start))),
    CONSTRAINT chapter_body_versions_content_check CHECK ((length(content) > 0)),
    CONSTRAINT chapter_body_versions_created_by_kind_check CHECK ((created_by_kind = ANY (ARRAY['user'::text, 'ai'::text, 'system'::text, 'import'::text]))),
    CONSTRAINT chapter_body_versions_operation_kind_check CHECK ((operation_kind = ANY (ARRAY['manual_draft'::text, 'copy'::text, 'continue'::text, 'rewrite'::text, 'expand'::text, 'shorten'::text, 'dialogue'::text, 'conflict'::text, 'fix'::text, 'regenerate'::text]))),
    CONSTRAINT chapter_body_versions_selection_pair_check CHECK (((selection_start IS NULL) = (selection_end IS NULL))),
    CONSTRAINT chapter_body_versions_selection_start_check CHECK (((selection_start IS NULL) OR (selection_start >= 0))),
    CONSTRAINT chapter_body_versions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'ai_candidate'::text, 'revision'::text, 'import'::text]))),
    CONSTRAINT chapter_body_versions_version_check CHECK ((version > 0))
);


--
-- Name: chapter_documents; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.chapter_documents (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    chapter_card_id uuid NOT NULL,
    logical_order integer NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    adopted_version_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chapter_documents_logical_order_check CHECK ((logical_order > 0)),
    CONSTRAINT chapter_documents_revision_check CHECK ((revision > 0)),
    CONSTRAINT chapter_documents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: chapter_settlement_items; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.chapter_settlement_items (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    category text NOT NULL,
    major_category text,
    title text NOT NULL,
    canonical_fact_id uuid,
    knowledge_proposal_id uuid,
    state_proposal_id uuid,
    evidence_anchor_id uuid NOT NULL,
    risk_level text NOT NULL,
    confidence numeric(5,4),
    confidence_note text DEFAULT ''::text NOT NULL,
    plan_alignment text DEFAULT 'not_applicable'::text NOT NULL,
    plan_expectation text DEFAULT ''::text NOT NULL,
    before_value jsonb,
    change_value jsonb,
    after_value jsonb NOT NULL,
    source_kind text NOT NULL,
    source_task_id uuid,
    source_attempt_id uuid,
    decision text DEFAULT 'pending'::text NOT NULL,
    decision_source text,
    decision_note text DEFAULT ''::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chapter_settlement_items_category_check CHECK ((category = ANY (ARRAY['fact'::text, 'knowledge'::text, 'character_state'::text, 'relationship'::text, 'prop'::text, 'event'::text, 'foreshadow'::text]))),
    CONSTRAINT chapter_settlement_items_check CHECK ((num_nonnulls(canonical_fact_id, knowledge_proposal_id, state_proposal_id) = 1)),
    CONSTRAINT chapter_settlement_items_check1 CHECK ((((source_kind = 'ai'::text) AND (source_task_id IS NOT NULL) AND (source_attempt_id IS NOT NULL)) OR ((source_kind = 'manual'::text) AND (source_task_id IS NULL) AND (source_attempt_id IS NULL)))),
    CONSTRAINT chapter_settlement_items_check2 CHECK ((((decision = 'pending'::text) AND (decision_source IS NULL) AND (decided_at IS NULL)) OR ((decision <> 'pending'::text) AND (decision_source IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT chapter_settlement_items_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT chapter_settlement_items_decision_check CHECK ((decision = ANY (ARRAY['pending'::text, 'confirm'::text, 'reject'::text, 'defer'::text]))),
    CONSTRAINT chapter_settlement_items_decision_source_check CHECK (((decision_source IS NULL) OR (decision_source = ANY (ARRAY['user'::text, 'policy'::text])))),
    CONSTRAINT chapter_settlement_items_plan_alignment_check CHECK ((plan_alignment = ANY (ARRAY['matches'::text, 'deviates'::text, 'missing'::text, 'not_applicable'::text]))),
    CONSTRAINT chapter_settlement_items_revision_check CHECK ((revision > 0)),
    CONSTRAINT chapter_settlement_items_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT chapter_settlement_items_source_kind_check CHECK ((source_kind = ANY (ARRAY['manual'::text, 'ai'::text]))),
    CONSTRAINT chapter_settlement_items_title_check CHECK (((length(title) >= 1) AND (length(title) <= 240)))
);


--
-- Name: chapter_settlements; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.chapter_settlements (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    chapter_document_id uuid NOT NULL,
    body_version_id uuid NOT NULL,
    status text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    revert_idempotency_key text,
    actor text DEFAULT 'user'::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    committed_at timestamp with time zone DEFAULT now() NOT NULL,
    reverted_at timestamp with time zone,
    supplement_base_checkpoint_id uuid,
    CONSTRAINT chapter_settlements_revision_check CHECK ((revision > 0)),
    CONSTRAINT chapter_settlements_status_check CHECK ((status = ANY (ARRAY['committed'::text, 'reverted'::text, 'superseded'::text])))
);


--
-- Name: context_manifest_items; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.context_manifest_items (
    id uuid NOT NULL,
    manifest_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    source_type text NOT NULL,
    stable_object_id uuid NOT NULL,
    exact_version_id uuid,
    source_space_id uuid,
    content_hash character(64) NOT NULL,
    inclusion_reason text NOT NULL,
    priority integer NOT NULL,
    token_estimate integer NOT NULL,
    transform_status text NOT NULL,
    sort_order integer NOT NULL,
    binding_version_id uuid,
    preview_decision_id uuid,
    source_revision integer,
    content_role text,
    layer_label text DEFAULT ''::text NOT NULL,
    knowledge_segment jsonb,
    CONSTRAINT context_manifest_entries_content_role_check CHECK ((content_role = ANY (ARRAY['required'::text, 'reference'::text]))),
    CONSTRAINT context_manifest_entries_knowledge_segment_check CHECK (((knowledge_segment IS NULL) OR (((source_type = 'asset_version'::text) AND (content_role = 'reference'::text) AND (jsonb_typeof(knowledge_segment) = 'object'::text) AND (knowledge_segment ?& ARRAY['chunkId'::text, 'start'::text, 'end'::text, 'checksum'::text]) AND ((knowledge_segment - ARRAY['chunkId'::text, 'start'::text, 'end'::text, 'checksum'::text]) = '{}'::jsonb) AND (jsonb_typeof((knowledge_segment -> 'chunkId'::text)) = 'string'::text) AND (jsonb_typeof((knowledge_segment -> 'checksum'::text)) = 'string'::text) AND ((knowledge_segment ->> 'chunkId'::text) ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'::text) AND ((knowledge_segment ->> 'checksum'::text) ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof((knowledge_segment -> 'start'::text)) = 'number'::text) AND (jsonb_typeof((knowledge_segment -> 'end'::text)) = 'number'::text) AND ((knowledge_segment ->> 'start'::text) ~ '^(0|[1-9][0-9]*)$'::text) AND ((knowledge_segment ->> 'end'::text) ~ '^[1-9][0-9]*$'::text) AND (((knowledge_segment ->> 'start'::text))::numeric >= (0)::numeric) AND (((knowledge_segment ->> 'end'::text))::numeric <= (2097152)::numeric) AND (((knowledge_segment ->> 'end'::text))::numeric > ((knowledge_segment ->> 'start'::text))::numeric) AND ((((knowledge_segment ->> 'end'::text))::numeric - ((knowledge_segment ->> 'start'::text))::numeric) <= (50000)::numeric)) IS TRUE))),
    CONSTRAINT context_manifest_entries_sort_order_check CHECK ((sort_order >= 0)),
    CONSTRAINT context_manifest_entries_source_type_check CHECK ((source_type = ANY (ARRAY['card_version'::text, 'card_relation'::text, 'body_version'::text, 'text_anchor'::text, 'planning_version'::text, 'canonical_fact'::text, 'knowledge_state_change'::text, 'state_change'::text, 'story_time'::text, 'story_event_relation'::text, 'research_document_version'::text, 'research_version'::text, 'research_pack_version'::text, 'prompt_component'::text, 'retrieval_chunk'::text, 'asset_version'::text, 'entity_initial_state'::text]))),
    CONSTRAINT context_manifest_entries_token_estimate_check CHECK ((token_estimate >= 0)),
    CONSTRAINT context_manifest_entries_transform_status_check CHECK ((transform_status = ANY (ARRAY['full'::text, 'truncated'::text, 'summarized'::text])))
);


--
-- Name: context_manifests; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.context_manifests (
    id uuid NOT NULL,
    book_id uuid,
    task_contract_version_id uuid NOT NULL,
    prompt_recipe_version_id uuid NOT NULL,
    node_key text,
    status text NOT NULL,
    manifest_hash character(64) NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    preview_id uuid,
    volume_id uuid,
    chapter_id uuid,
    scene_id uuid,
    task_group text,
    model_route_snapshot_id uuid,
    source_set_hash character(64),
    decision_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    finalized_at timestamp with time zone,
    knowledge_request_key text,
    knowledge_input_hash character(64),
    knowledge_receipt jsonb,
    public_character_scope uuid,
    public_title_scope uuid,
    CONSTRAINT context_manifests_decision_summary_check CHECK ((jsonb_typeof(decision_summary) = 'object'::text)),
    CONSTRAINT context_manifests_finalized_shape CHECK (((status <> 'finalized'::text) OR ((preview_id IS NOT NULL) AND (model_route_snapshot_id IS NOT NULL) AND (source_set_hash IS NOT NULL) AND (finalized_at IS NOT NULL)))),
    CONSTRAINT context_manifests_knowledge_receipt_check CHECK ((((knowledge_request_key IS NULL) AND (knowledge_input_hash IS NULL) AND (knowledge_receipt IS NULL)) OR ((knowledge_request_key IS NOT NULL) AND (knowledge_input_hash IS NOT NULL) AND (knowledge_receipt IS NOT NULL) AND ((length(knowledge_request_key) >= 8) AND (length(knowledge_request_key) <= 160)) AND (knowledge_input_hash ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(knowledge_receipt) = 'object'::text)))),
    CONSTRAINT context_manifests_public_creative_scope_check CHECK ((((book_id IS NOT NULL) AND (public_character_scope IS NULL) AND (public_title_scope IS NULL)) OR ((book_id IS NULL) AND (public_character_scope IS NOT NULL) AND (public_title_scope IS NULL) AND COALESCE(((decision_summary ->> 'contract'::text) = 'public_character_trial_v1'::text), false)) OR ((book_id IS NULL) AND (public_character_scope IS NULL) AND (public_title_scope IS NOT NULL) AND COALESCE(((decision_summary ->> 'contract'::text) = 'public_title_factory_v1'::text), false)))),
    CONSTRAINT context_manifests_status_check CHECK ((status = ANY (ARRAY['complete'::text, 'invalid'::text, 'finalized'::text])))
);


--
-- Name: TABLE context_manifests; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON TABLE new_design.context_manifests IS 'A finalized manifest is the immutable itemized receipt of exact source versions used by one future AI run.';


--
-- Name: dependency_edges; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.dependency_edges (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    book_id uuid NOT NULL,
    source_resource_id uuid NOT NULL,
    derived_resource_id uuid NOT NULL,
    dependency_kind text NOT NULL,
    dependency_strength text NOT NULL,
    origin_kind text NOT NULL,
    origin_id uuid,
    idempotency_key text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    end_reason text DEFAULT ''::text NOT NULL,
    CONSTRAINT dependency_edges_check CHECK ((source_resource_id <> derived_resource_id)),
    CONSTRAINT dependency_edges_check1 CHECK ((((status = 'active'::text) AND (ended_at IS NULL)) OR ((status = 'ended'::text) AND (ended_at IS NOT NULL)))),
    CONSTRAINT dependency_edges_dependency_kind_check CHECK ((dependency_kind = ANY (ARRAY['generated_from'::text, 'planned_from'::text, 'validated_against'::text, 'evidenced_by'::text, 'context_included'::text, 'configured_by'::text, 'settled_from'::text, 'audited_from'::text, 'derived_from'::text]))),
    CONSTRAINT dependency_edges_dependency_strength_check CHECK ((dependency_strength = ANY (ARRAY['hard'::text, 'soft'::text]))),
    CONSTRAINT dependency_edges_origin_kind_check CHECK ((origin_kind = ANY (ARRAY['adoption'::text, 'confirmation'::text, 'settlement'::text, 'contract_publication'::text, 'context_build'::text, 'ai_result'::text, 'audit'::text, 'manual'::text, 'import'::text, 'system'::text]))),
    CONSTRAINT dependency_edges_status_check CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text])))
);


--
-- Name: dependency_events; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.dependency_events (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    invalidation_event_id uuid,
    from_state text,
    to_state text NOT NULL,
    event_kind text NOT NULL,
    actor text DEFAULT ''::text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dependency_state_events_event_kind_check CHECK ((event_kind = ANY (ARRAY['invalidated'::text, 'recompute_requested'::text, 'recompute_started'::text, 'recompute_completed'::text, 'recompute_rejected'::text, 'accepted_stale'::text]))),
    CONSTRAINT dependency_state_events_to_state_check CHECK ((to_state = ANY (ARRAY['fresh'::text, 'stale'::text, 'invalid'::text, 'needs_review'::text, 'recompute_pending'::text, 'recomputing'::text, 'recomputed'::text, 'accepted_stale'::text])))
);


--
-- Name: dependency_resources; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.dependency_resources (
    id uuid NOT NULL,
    resource_kind text NOT NULL,
    space_id uuid,
    book_id uuid,
    stable_object_id uuid NOT NULL,
    exact_version_id uuid NOT NULL,
    content_hash character(64) NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dependency_resources_check CHECK (((book_id IS NULL) OR (space_id IS NOT NULL))),
    CONSTRAINT dependency_resources_resource_kind_check CHECK ((resource_kind = ANY (ARRAY['card_type_version'::text, 'template_group_version'::text, 'card_version'::text, 'card_relation'::text, 'card_mount'::text, 'tag_version'::text, 'tag_membership'::text, 'material_group_version'::text, 'group_membership'::text, 'smart_view_version'::text, 'research_document_version'::text, 'research_record_version'::text, 'research_reference_pack_version'::text, 'chapter_body_version'::text, 'chapter_text_anchor'::text, 'canonical_fact'::text, 'chapter_settlement'::text, 'state_change'::text, 'knowledge_state_change'::text, 'story_event_timing'::text, 'story_event_relation'::text, 'planning_version'::text, 'prompt_recipe_version'::text, 'task_contract_version'::text, 'context_binding_version'::text, 'context_preview'::text, 'context_manifest'::text, 'semantic_retrieval_run'::text, 'model_route_snapshot'::text, 'ai_task_attempt'::text, 'quality_audit_report'::text, 'asset_version'::text, 'embedding_source_snapshot'::text, 'embedding_chunk'::text, 'embedding_result'::text, 'embedding_index_generation'::text, 'entity_initial_state'::text])))
);


--
-- Name: embedding_chunks; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.embedding_chunks (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    source_snapshot_id uuid NOT NULL,
    profile_version_id uuid NOT NULL,
    ordinal integer NOT NULL,
    anchor_kind text NOT NULL,
    anchor jsonb DEFAULT '{}'::jsonb NOT NULL,
    chunk_text text NOT NULL,
    token_estimate integer DEFAULT 0 NOT NULL,
    content_hash character(64) NOT NULL,
    chunker_version text NOT NULL,
    status text DEFAULT 'current'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stale_at timestamp with time zone,
    record_kind text DEFAULT 'chunk'::text NOT NULL,
    CONSTRAINT embedding_chunks_anchor_check CHECK ((jsonb_typeof(anchor) = 'object'::text)),
    CONSTRAINT embedding_chunks_anchor_kind_check CHECK ((anchor_kind = ANY (ARRAY['whole'::text, 'character_range'::text, 'json_pointer'::text, 'text_anchor'::text, 'section'::text]))),
    CONSTRAINT embedding_chunks_check CHECK ((((status = 'current'::text) AND (stale_at IS NULL)) OR ((status <> 'current'::text) AND (stale_at IS NOT NULL)))),
    CONSTRAINT embedding_chunks_chunk_text_check CHECK ((length(chunk_text) > 0)),
    CONSTRAINT embedding_chunks_content_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT embedding_chunks_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT embedding_chunks_record_kind_check CHECK ((record_kind = ANY (ARRAY['source'::text, 'chunk'::text]))),
    CONSTRAINT embedding_chunks_status_check CHECK ((status = ANY (ARRAY['current'::text, 'stale'::text, 'archived'::text]))),
    CONSTRAINT embedding_chunks_token_estimate_check CHECK ((token_estimate >= 0))
);


--
-- Name: embedding_generations; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.embedding_generations (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    profile_version_id uuid NOT NULL,
    generation integer NOT NULL,
    status text DEFAULT 'building'::text NOT NULL,
    index_name text NOT NULL,
    expected_vector_count integer DEFAULT 0 NOT NULL,
    indexed_vector_count integer DEFAULT 0 NOT NULL,
    coverage numeric(8,7) DEFAULT 0 NOT NULL,
    checksum character(64),
    error_code text DEFAULT ''::text NOT NULL,
    error_detail text DEFAULT ''::text NOT NULL,
    retryable boolean DEFAULT false NOT NULL,
    idempotency_key text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    activated_at timestamp with time zone,
    retired_at timestamp with time zone,
    knowledge_build_hash character(64),
    CONSTRAINT embedding_index_generations_check CHECK (((index_name ~ '^nd_hnsw_[a-f0-9]{32}$'::text) AND (index_name = ('nd_hnsw_'::text || replace((id)::text, '-'::text, ''::text))))),
    CONSTRAINT embedding_index_generations_coverage_check CHECK (((coverage >= (0)::numeric) AND (coverage <= (1)::numeric))),
    CONSTRAINT embedding_index_generations_expected_vector_count_check CHECK ((expected_vector_count >= 0)),
    CONSTRAINT embedding_index_generations_generation_check CHECK ((generation > 0)),
    CONSTRAINT embedding_index_generations_indexed_vector_count_check CHECK ((indexed_vector_count >= 0)),
    CONSTRAINT embedding_index_generations_knowledge_build_hash_check CHECK ((knowledge_build_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT embedding_index_generations_status_check CHECK ((status = ANY (ARRAY['building'::text, 'verifying'::text, 'ready'::text, 'active'::text, 'retired'::text, 'failed'::text, 'stale'::text])))
);


--
-- Name: embedding_profiles; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.embedding_profiles (
    id uuid NOT NULL,
    profile_key text NOT NULL,
    name text NOT NULL,
    purpose text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_version_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT embedding_profiles_profile_key_check CHECK ((profile_key ~ '^[a-z][a-z0-9_.-]{1,79}$'::text)),
    CONSTRAINT embedding_profiles_purpose_check CHECK ((purpose = ANY (ARRAY['semantic_retrieval'::text, 'similarity'::text, 'clustering'::text]))),
    CONSTRAINT embedding_profiles_revision_check CHECK ((revision > 0)),
    CONSTRAINT embedding_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: embedding_vectors; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.embedding_vectors (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    generation_id uuid,
    result_id uuid,
    chunk_id uuid NOT NULL,
    profile_version_id uuid NOT NULL,
    source_kind text NOT NULL,
    source_stable_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    source_revision integer NOT NULL,
    source_hash character(64) NOT NULL,
    chunk_hash character(64) NOT NULL,
    content_text text NOT NULL,
    search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content_text)) STORED,
    embedding public.vector NOT NULL,
    status text DEFAULT 'eligible'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    record_kind text DEFAULT 'index'::text NOT NULL,
    request_id uuid,
    attempt_id uuid,
    response_vector double precision[],
    CONSTRAINT embedding_vector_kind_scope CHECK ((((record_kind = 'index'::text) AND (generation_id IS NOT NULL) AND (result_id IS NOT NULL)) OR ((record_kind = ANY (ARRAY['attempt'::text, 'result'::text])) AND (generation_id IS NULL) AND (request_id IS NOT NULL) AND (attempt_id IS NOT NULL) AND (response_vector IS NOT NULL) AND ((record_kind = 'attempt'::text) OR (result_id IS NOT NULL))))),
    CONSTRAINT embedding_vectors_record_kind_check CHECK ((record_kind = ANY (ARRAY['attempt'::text, 'result'::text, 'index'::text]))),
    CONSTRAINT embedding_vectors_status_check CHECK ((status = ANY (ARRAY['eligible'::text, 'stale'::text, 'archived'::text])))
);


--
-- Name: field_definition_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.field_definition_versions (
    id uuid NOT NULL,
    field_definition_id uuid NOT NULL,
    version integer NOT NULL,
    field_schema jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT field_definition_versions_version_check CHECK ((version > 0))
);


--
-- Name: field_definitions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.field_definitions (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    card_type_id uuid,
    card_id uuid,
    card_mount_id uuid,
    field_key text NOT NULL,
    origin text NOT NULL,
    scope text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    current_version_id uuid,
    source_template_version_id uuid,
    source_type_version_id uuid,
    source_form_version_id uuid,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT field_definitions_check CHECK ((((scope = 'book_type'::text) AND (card_type_id IS NOT NULL) AND (card_id IS NULL) AND (card_mount_id IS NULL)) OR ((scope = 'card'::text) AND (card_type_id IS NOT NULL) AND (card_id IS NOT NULL) AND (card_mount_id IS NULL)) OR ((scope = 'card_mount'::text) AND (card_type_id IS NOT NULL) AND (card_id IS NULL) AND (card_mount_id IS NOT NULL)))),
    CONSTRAINT field_definitions_origin_check CHECK ((origin = ANY (ARRAY['core'::text, 'template'::text, 'book_extension'::text, 'local_supplement'::text]))),
    CONSTRAINT field_definitions_revision_check CHECK ((revision > 0)),
    CONSTRAINT field_definitions_scope_check CHECK ((scope = ANY (ARRAY['book_type'::text, 'card'::text, 'card_mount'::text]))),
    CONSTRAINT field_definitions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: COLUMN field_definitions.field_key; Type: COMMENT; Schema: new_design; Owner: -
--

COMMENT ON COLUMN new_design.field_definitions.field_key IS 'Server-generated stable key. Renaming a customer-facing label never changes this key.';


--
-- Name: graph_projection_checkpoints; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.graph_projection_checkpoints (
    id uuid NOT NULL,
    batch_id uuid NOT NULL,
    checkpoint_key text NOT NULL,
    source_watermark jsonb DEFAULT '{}'::jsonb NOT NULL,
    processed_count bigint NOT NULL,
    checksum character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT graph_projection_checkpoints_checksum_check CHECK ((checksum ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT graph_projection_checkpoints_processed_count_check CHECK ((processed_count >= 0)),
    CONSTRAINT graph_projection_checkpoints_source_watermark_check CHECK ((jsonb_typeof(source_watermark) = 'object'::text))
);


--
-- Name: graph_projection_configs; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.graph_projection_configs (
    id uuid NOT NULL,
    graph_name text NOT NULL,
    mapping_version integer NOT NULL,
    max_depth integer NOT NULL,
    max_results integer NOT NULL,
    statement_timeout_ms integer NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT graph_projection_configs_graph_name_check CHECK ((graph_name = 'new_design_projection'::text)),
    CONSTRAINT graph_projection_configs_mapping_version_check CHECK ((mapping_version > 0)),
    CONSTRAINT graph_projection_configs_max_depth_check CHECK (((max_depth >= 1) AND (max_depth <= 6))),
    CONSTRAINT graph_projection_configs_max_results_check CHECK (((max_results >= 1) AND (max_results <= 200))),
    CONSTRAINT graph_projection_configs_statement_timeout_ms_check CHECK (((statement_timeout_ms >= 100) AND (statement_timeout_ms <= 5000))),
    CONSTRAINT graph_projection_configs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: graph_projection_runs; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.graph_projection_runs (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    generation bigint NOT NULL,
    mapping_version integer NOT NULL,
    status text DEFAULT 'building'::text NOT NULL,
    source_watermark jsonb DEFAULT '{}'::jsonb NOT NULL,
    vertex_count bigint DEFAULT 0 NOT NULL,
    edge_count bigint DEFAULT 0 NOT NULL,
    projection_checksum character(64),
    error_code text DEFAULT ''::text NOT NULL,
    error_detail text DEFAULT ''::text NOT NULL,
    retryable boolean DEFAULT true NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    activated_at timestamp with time zone,
    CONSTRAINT graph_projection_generations_edge_count_check CHECK ((edge_count >= 0)),
    CONSTRAINT graph_projection_generations_generation_check CHECK ((generation > 0)),
    CONSTRAINT graph_projection_generations_mapping_version_check CHECK ((mapping_version > 0)),
    CONSTRAINT graph_projection_generations_projection_checksum_check CHECK (((projection_checksum IS NULL) OR (projection_checksum ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT graph_projection_generations_source_watermark_check CHECK ((jsonb_typeof(source_watermark) = 'object'::text)),
    CONSTRAINT graph_projection_generations_status_check CHECK ((status = ANY (ARRAY['building'::text, 'ready'::text, 'active'::text, 'failed'::text, 'superseded'::text]))),
    CONSTRAINT graph_projection_generations_vertex_count_check CHECK ((vertex_count >= 0))
);


--
-- Name: media_job_attempts; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.media_job_attempts (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt integer NOT NULL,
    provider_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    failure text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT media_job_attempts_attempt_check CHECK ((attempt > 0))
);


--
-- Name: media_jobs; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.media_jobs (
    id uuid NOT NULL,
    media_kind text NOT NULL,
    subject_card_id uuid,
    request_key uuid,
    input_hash character(64),
    status text NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT media_jobs_input_hash_check CHECK (((input_hash IS NULL) OR (input_hash ~ '^[a-f0-9]{64}$'::text)))
);


--
-- Name: media_outputs; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.media_outputs (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt_id uuid,
    asset_version_id uuid,
    output_kind text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: model_credential_refs; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.model_credential_refs (
    id uuid NOT NULL,
    credential_key text NOT NULL,
    provider text NOT NULL,
    secret_locator text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    secret_envelope bytea,
    CONSTRAINT model_credential_refs_secret_locator_check CHECK ((secret_locator ~ '^(secret|env|keychain)://[A-Za-z0-9_.:/-]+$'::text)),
    CONSTRAINT model_credential_refs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
    CONSTRAINT model_credential_secret_envelope_guard CHECK ((((secret_locator = 'secret://database'::text) AND (secret_envelope IS NOT NULL) AND (octet_length(secret_envelope) > 29)) OR ((secret_locator <> 'secret://database'::text) AND (secret_envelope IS NULL))))
);


--
-- Name: model_route_configs; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.model_route_configs (
    id uuid NOT NULL,
    scope text NOT NULL,
    task_group text,
    node_key text,
    book_id uuid,
    override_key text,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_version_id uuid,
    published_version_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    task_key text,
    CONSTRAINT model_route_configs_revision_check CHECK ((revision > 0)),
    CONSTRAINT model_route_configs_scope_check CHECK ((scope = ANY (ARRAY['system_default'::text, 'task_group'::text, 'task'::text, 'node'::text, 'book'::text, 'one_time'::text]))),
    CONSTRAINT model_route_configs_shape_check CHECK ((((scope = 'system_default'::text) AND (task_group IS NULL) AND (task_key IS NULL) AND (node_key IS NULL) AND (book_id IS NULL) AND (override_key IS NULL)) OR ((scope = 'task_group'::text) AND (task_group IS NOT NULL) AND (task_key IS NULL) AND (node_key IS NULL) AND (book_id IS NULL) AND (override_key IS NULL)) OR ((scope = 'task'::text) AND (task_key IS NOT NULL) AND (node_key IS NULL) AND (book_id IS NULL) AND (override_key IS NULL)) OR ((scope = 'node'::text) AND (node_key IS NOT NULL) AND (task_key IS NULL) AND (book_id IS NULL) AND (override_key IS NULL)) OR ((scope = 'book'::text) AND (book_id IS NOT NULL) AND (task_group IS NULL) AND (task_key IS NULL) AND (node_key IS NULL) AND (override_key IS NULL)) OR ((scope = 'one_time'::text) AND (override_key IS NOT NULL) AND (task_key IS NULL) AND (node_key IS NULL)))),
    CONSTRAINT model_route_configs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: model_route_snapshots; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.model_route_snapshots (
    id uuid NOT NULL,
    book_id uuid,
    task_contract_version_id uuid,
    node_key text,
    provider text NOT NULL,
    model text NOT NULL,
    parameters jsonb NOT NULL,
    required_capabilities text[] NOT NULL,
    credential_ref_id uuid,
    budget_policy jsonb NOT NULL,
    timeout_ms integer NOT NULL,
    retry_policy jsonb NOT NULL,
    source_layers jsonb NOT NULL,
    policy_version text NOT NULL,
    snapshot_hash character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    managed_task_key text,
    CONSTRAINT model_route_snapshots_budget_policy_check CHECK ((jsonb_typeof(budget_policy) = 'object'::text)),
    CONSTRAINT model_route_snapshots_managed_scope_check CHECK ((((book_id IS NOT NULL) AND (task_contract_version_id IS NOT NULL) AND (managed_task_key IS NULL)) OR ((book_id IS NULL) AND (task_contract_version_id IS NULL) AND (managed_task_key IS NOT NULL) AND (managed_task_key = ANY (ARRAY['directions'::text, 'initial_content'::text, 'form_assist'::text, 'market_analysis'::text, 'book_analysis'::text, 'planning_candidate'::text, 'chapter_settlement'::text, 'chapter_generation'::text, 'quality_audit'::text, 'world_consistency'::text, 'creative_extraction'::text, 'character_dialogue'::text, 'creative_hub'::text, 'world_generation'::text]))))),
    CONSTRAINT model_route_snapshots_parameters_check CHECK ((jsonb_typeof(parameters) = 'object'::text)),
    CONSTRAINT model_route_snapshots_retry_policy_check CHECK ((jsonb_typeof(retry_policy) = 'object'::text)),
    CONSTRAINT model_route_snapshots_source_layers_check CHECK ((jsonb_typeof(source_layers) = 'array'::text)),
    CONSTRAINT model_route_snapshots_timeout_ms_check CHECK ((timeout_ms > 0))
);


--
-- Name: model_route_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.model_route_versions (
    id uuid NOT NULL,
    config_id uuid NOT NULL,
    version integer NOT NULL,
    base_version_id uuid,
    source text NOT NULL,
    status text NOT NULL,
    provider text,
    model text,
    parameters jsonb,
    required_capabilities text[],
    credential_ref_id uuid,
    budget_policy jsonb,
    timeout_ms integer,
    retry_policy jsonb,
    fallback_mode text DEFAULT 'inherit'::text NOT NULL,
    content_hash character(64) NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_route_versions_budget_policy_check CHECK (((budget_policy IS NULL) OR (jsonb_typeof(budget_policy) = 'object'::text))),
    CONSTRAINT model_route_versions_fallback_mode_check CHECK ((fallback_mode = ANY (ARRAY['inherit'::text, 'replace'::text]))),
    CONSTRAINT model_route_versions_parameters_check CHECK (((parameters IS NULL) OR (jsonb_typeof(parameters) = 'object'::text))),
    CONSTRAINT model_route_versions_retry_policy_check CHECK (((retry_policy IS NULL) OR (jsonb_typeof(retry_policy) = 'object'::text))),
    CONSTRAINT model_route_versions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'import'::text, 'system'::text]))),
    CONSTRAINT model_route_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'superseded'::text, 'rejected'::text]))),
    CONSTRAINT model_route_versions_timeout_ms_check CHECK (((timeout_ms IS NULL) OR (timeout_ms > 0))),
    CONSTRAINT model_route_versions_version_check CHECK ((version > 0))
);


--
-- Name: outbox_aggregate_sequences; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.outbox_aggregate_sequences (
    space_id uuid,
    book_id uuid,
    aggregate_kind text NOT NULL,
    aggregate_id uuid NOT NULL,
    last_sequence bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_aggregate_sequences_aggregate_kind_check CHECK ((aggregate_kind ~ '^[a-z][a-z0-9_.-]{1,119}$'::text)),
    CONSTRAINT outbox_aggregate_sequences_check CHECK (((book_id IS NULL) OR (space_id IS NOT NULL))),
    CONSTRAINT outbox_aggregate_sequences_last_sequence_check CHECK ((last_sequence > 0))
);


--
-- Name: outbox_consumers; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.outbox_consumers (
    consumer_key text NOT NULL,
    handler_key text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    max_concurrency integer DEFAULT 1 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    pause_reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_consumers_consumer_key_check CHECK ((consumer_key ~ '^[a-z][a-z0-9_.-]{2,119}$'::text)),
    CONSTRAINT outbox_consumers_max_concurrency_check CHECK (((max_concurrency >= 1) AND (max_concurrency <= 64))),
    CONSTRAINT outbox_consumers_pause_reason_check CHECK ((length(pause_reason) <= 1000)),
    CONSTRAINT outbox_consumers_revision_check CHECK ((revision > 0)),
    CONSTRAINT outbox_consumers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'disabled'::text])))
);


--
-- Name: outbox_events; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.outbox_events (
    id uuid NOT NULL,
    space_id uuid,
    book_id uuid,
    topic text NOT NULL,
    event_version integer NOT NULL,
    aggregate_kind text NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_sequence bigint NOT NULL,
    ordering_key text NOT NULL,
    producer_kind text NOT NULL,
    producer_idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    payload_hash character(64) NOT NULL,
    correlation_id uuid,
    causation_id uuid,
    trace_id text DEFAULT ''::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_events_aggregate_sequence_check CHECK ((aggregate_sequence > 0)),
    CONSTRAINT outbox_events_check CHECK (((book_id IS NULL) OR (space_id IS NOT NULL))),
    CONSTRAINT outbox_events_ordering_key_check CHECK (((length(ordering_key) >= 1) AND (length(ordering_key) <= 240))),
    CONSTRAINT outbox_events_payload_check CHECK (((jsonb_typeof(payload) = 'object'::text) AND (octet_length((payload)::text) <= 32768))),
    CONSTRAINT outbox_events_payload_check1 CHECK ((NOT (payload ?| ARRAY['body'::text, 'contentText'::text, 'chunkText'::text, 'vector'::text, 'embedding'::text, 'binary'::text, 'prompt'::text, 'credential'::text, 'secret'::text, 'apiKey'::text, 'password'::text]))),
    CONSTRAINT outbox_events_payload_hash_check CHECK ((payload_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT outbox_events_producer_idempotency_key_check CHECK (((length(producer_idempotency_key) >= 8) AND (length(producer_idempotency_key) <= 240))),
    CONSTRAINT outbox_events_producer_kind_check CHECK ((producer_kind = ANY (ARRAY['domain_store'::text, 'migration_bridge'::text, 'system'::text, 'operator'::text]))),
    CONSTRAINT outbox_events_reference_payload_check CHECK (new_design.outbox_payload_is_reference_only(payload)),
    CONSTRAINT outbox_events_trace_id_check CHECK ((length(trace_id) <= 240))
);


--
-- Name: outbox_inbox_receipts; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.outbox_inbox_receipts (
    id uuid NOT NULL,
    consumer_key text NOT NULL,
    event_id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    outcome text NOT NULL,
    result_id uuid,
    event_payload_hash character(64) NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_inbox_receipts_event_payload_hash_check CHECK ((event_payload_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT outbox_inbox_receipts_outcome_check CHECK ((outcome = ANY (ARRAY['succeeded'::text, 'business_rejected'::text, 'rejected_stale'::text, 'cancelled'::text])))
);


--
-- Name: prompt_recipe_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.prompt_recipe_versions (
    id uuid NOT NULL,
    recipe_id uuid NOT NULL,
    version integer NOT NULL,
    base_version_id uuid,
    source text NOT NULL,
    status text NOT NULL,
    variables_schema jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash character(64) NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prompt_recipe_versions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'ai'::text, 'import'::text, 'system'::text]))),
    CONSTRAINT prompt_recipe_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'proposed'::text, 'published'::text, 'superseded'::text, 'rejected'::text]))),
    CONSTRAINT prompt_recipe_versions_variables_schema_check CHECK ((jsonb_typeof(variables_schema) = 'object'::text)),
    CONSTRAINT prompt_recipe_versions_version_check CHECK ((version > 0))
);


--
-- Name: prompt_recipes; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.prompt_recipes (
    id uuid NOT NULL,
    recipe_key text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_version_id uuid,
    published_version_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prompt_recipes_revision_check CHECK ((revision > 0)),
    CONSTRAINT prompt_recipes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: publication_artifacts; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.publication_artifacts (
    id uuid NOT NULL,
    request_id uuid NOT NULL,
    manifest_id uuid NOT NULL,
    format text NOT NULL,
    storage_locator text NOT NULL,
    display_filename text NOT NULL,
    media_type text NOT NULL,
    checksum character(64) NOT NULL,
    byte_size bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT publication_export_artifacts_byte_size_check CHECK ((byte_size > 0)),
    CONSTRAINT publication_export_artifacts_checksum_check CHECK ((checksum ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT publication_export_artifacts_display_filename_check CHECK ((((length(display_filename) >= 1) AND (length(display_filename) <= 180)) AND (display_filename !~ '[\\/:*?"<>|]'::text))),
    CONSTRAINT publication_export_artifacts_format_check CHECK ((format = ANY (ARRAY['markdown'::text, 'plain_text'::text, 'docx'::text]))),
    CONSTRAINT publication_export_artifacts_storage_locator_check CHECK (((storage_locator ~ '^exports/[A-Za-z0-9._/-]+$'::text) AND (storage_locator !~ '(^|/)\.\.(/|$)'::text)))
);


--
-- Name: publication_manifests; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.publication_manifests (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    completion_snapshot_id uuid,
    export_mode text NOT NULL,
    format text NOT NULL,
    range_kind text NOT NULL,
    range_ref jsonb NOT NULL,
    include_version_manifest boolean DEFAULT true NOT NULL,
    rule_set_key text NOT NULL,
    rule_set_version integer NOT NULL,
    source_hash character(64) NOT NULL,
    content_hash character(64) NOT NULL,
    chapter_count integer NOT NULL,
    character_count bigint NOT NULL,
    warning_count integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT publication_export_manifests_chapter_count_check CHECK ((chapter_count > 0)),
    CONSTRAINT publication_export_manifests_character_count_check CHECK ((character_count >= 0)),
    CONSTRAINT publication_export_manifests_content_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT publication_export_manifests_export_mode_check CHECK ((export_mode = ANY (ARRAY['formal'::text, 'review_draft'::text]))),
    CONSTRAINT publication_export_manifests_format_check CHECK ((format = ANY (ARRAY['markdown'::text, 'plain_text'::text, 'docx'::text]))),
    CONSTRAINT publication_export_manifests_range_kind_check CHECK ((range_kind = ANY (ARRAY['book'::text, 'volume'::text, 'chapters'::text]))),
    CONSTRAINT publication_export_manifests_range_ref_check CHECK ((jsonb_typeof(range_ref) = 'object'::text)),
    CONSTRAINT publication_export_manifests_source_hash_check CHECK ((source_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT publication_export_manifests_warning_count_check CHECK ((warning_count >= 0))
);


--
-- Name: relation_types; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.relation_types (
    id uuid NOT NULL,
    relation_key text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    direction text DEFAULT 'directed'::text NOT NULL,
    source_type_keys text[] DEFAULT '{}'::text[] NOT NULL,
    target_type_keys text[] DEFAULT '{}'::text[] NOT NULL,
    source_max integer,
    target_max integer,
    scope text NOT NULL,
    owner_space_id uuid,
    properties_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_relation_type_id uuid,
    CONSTRAINT relation_types_direction_check CHECK ((direction = ANY (ARRAY['directed'::text, 'undirected'::text]))),
    CONSTRAINT relation_types_revision_check CHECK ((revision > 0)),
    CONSTRAINT relation_types_scope_check CHECK ((scope = ANY (ARRAY['system'::text, 'template'::text, 'book'::text]))),
    CONSTRAINT relation_types_source_max_check CHECK (((source_max IS NULL) OR (source_max > 0))),
    CONSTRAINT relation_types_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))),
    CONSTRAINT relation_types_target_max_check CHECK (((target_max IS NULL) OR (target_max > 0)))
);


--
-- Name: release_assessments; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.release_assessments (
    id uuid NOT NULL,
    gate_key text NOT NULL,
    outcome text NOT NULL,
    evidence text NOT NULL,
    evidence_ref text DEFAULT ''::text NOT NULL,
    assessed_by text NOT NULL,
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT release_gate_assessments_outcome_check CHECK ((outcome = ANY (ARRAY['unexecuted'::text, 'passed'::text, 'failed'::text, 'blocked'::text])))
);


--
-- Name: release_definitions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.release_definitions (
    gate_key text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    acceptance text NOT NULL,
    sort_order integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT release_gate_definitions_category_check CHECK ((category = ANY (ARRAY['database'::text, 'extensions'::text, 'novel_flow'::text, 'recovery'::text, 'export'::text, 'interface'::text, 'isolation'::text, 'packaging'::text]))),
    CONSTRAINT release_gate_definitions_gate_key_check CHECK ((gate_key ~ '^[a-z][a-z0-9_.-]{2,119}$'::text)),
    CONSTRAINT release_gate_definitions_sort_order_check CHECK ((sort_order >= 0)),
    CONSTRAINT release_gate_definitions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])))
);


--
-- Name: research_document_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.research_document_versions (
    id uuid NOT NULL,
    document_id uuid NOT NULL,
    version integer NOT NULL,
    content text NOT NULL,
    content_hash text NOT NULL,
    character_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_document_versions_character_count_check CHECK ((character_count >= 0)),
    CONSTRAINT research_document_versions_version_check CHECK ((version > 0))
);


--
-- Name: research_documents; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.research_documents (
    id uuid NOT NULL,
    title text NOT NULL,
    source_kind text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_version_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_documents_revision_check CHECK ((revision > 0)),
    CONSTRAINT research_documents_source_kind_check CHECK ((source_kind = ANY (ARRAY['paste'::text, 'file'::text, 'public_url'::text, 'book_export'::text]))),
    CONSTRAINT research_documents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: retrieval_results; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.retrieval_results (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    rank integer NOT NULL,
    chunk_id uuid NOT NULL,
    source_kind text NOT NULL,
    source_stable_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    source_revision integer NOT NULL,
    source_hash character(64) NOT NULL,
    vector_score numeric(12,9) NOT NULL,
    fts_score numeric(12,9) NOT NULL,
    trigram_score numeric(12,9) NOT NULL,
    final_score numeric(12,9) NOT NULL,
    inclusion_reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT semantic_retrieval_results_rank_check CHECK ((rank > 0))
);


--
-- Name: retrieval_runs; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.retrieval_runs (
    id uuid NOT NULL,
    book_id uuid NOT NULL,
    caller_kind text NOT NULL,
    caller_id text DEFAULT ''::text NOT NULL,
    profile_version_id uuid NOT NULL,
    generation_id uuid NOT NULL,
    query_hash character(64) NOT NULL,
    query_summary text DEFAULT ''::text NOT NULL,
    query_ref text DEFAULT ''::text NOT NULL,
    filter_snapshot jsonb NOT NULL,
    source_kinds text[] NOT NULL,
    top_k integer NOT NULL,
    candidate_limit integer NOT NULL,
    similarity_threshold numeric(8,7),
    timeout_ms integer NOT NULL,
    vector_weight numeric(5,4) NOT NULL,
    fts_weight numeric(5,4) NOT NULL,
    trigram_weight numeric(5,4) NOT NULL,
    status text NOT NULL,
    elapsed_ms integer,
    result_count integer DEFAULT 0 NOT NULL,
    failure_code text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    embedding_request_key uuid,
    embedding_freeze jsonb,
    embedding_lease_expires_at timestamp with time zone,
    embedding_model_state text DEFAULT 'not_sent'::text NOT NULL,
    embedding_reply jsonb,
    embedding_reply_hash character(64),
    embedding_execution jsonb,
    query_vector double precision[],
    CONSTRAINT semantic_retrieval_runs_caller_kind_check CHECK ((caller_kind = ANY (ARRAY['user'::text, 'ai_task'::text, 'system'::text, 'debug'::text]))),
    CONSTRAINT semantic_retrieval_runs_check CHECK ((((candidate_limit >= 1) AND (candidate_limit <= 10000)) AND (candidate_limit >= top_k))),
    CONSTRAINT semantic_retrieval_runs_check1 CHECK ((((vector_weight + fts_weight) + trigram_weight) = (1)::numeric)),
    CONSTRAINT semantic_retrieval_runs_elapsed_ms_check CHECK (((elapsed_ms IS NULL) OR (elapsed_ms >= 0))),
    CONSTRAINT semantic_retrieval_runs_embedding_model_state_check CHECK ((embedding_model_state = ANY (ARRAY['not_sent'::text, 'sent_unknown'::text, 'completed'::text]))),
    CONSTRAINT semantic_retrieval_runs_filter_snapshot_check CHECK ((jsonb_typeof(filter_snapshot) = 'object'::text)),
    CONSTRAINT semantic_retrieval_runs_fts_weight_check CHECK (((fts_weight >= (0)::numeric) AND (fts_weight <= (1)::numeric))),
    CONSTRAINT semantic_retrieval_runs_query_hash_check CHECK ((query_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT semantic_retrieval_runs_result_count_check CHECK ((result_count >= 0)),
    CONSTRAINT semantic_retrieval_runs_similarity_threshold_check CHECK (((similarity_threshold >= (0)::numeric) AND (similarity_threshold <= (1)::numeric))),
    CONSTRAINT semantic_retrieval_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'timed_out'::text]))),
    CONSTRAINT semantic_retrieval_runs_timeout_ms_check CHECK (((timeout_ms >= 100) AND (timeout_ms <= 60000))),
    CONSTRAINT semantic_retrieval_runs_top_k_check CHECK (((top_k >= 1) AND (top_k <= 500))),
    CONSTRAINT semantic_retrieval_runs_trigram_weight_check CHECK (((trigram_weight >= (0)::numeric) AND (trigram_weight <= (1)::numeric))),
    CONSTRAINT semantic_retrieval_runs_vector_weight_check CHECK (((vector_weight >= (0)::numeric) AND (vector_weight <= (1)::numeric)))
);


--
-- Name: runtime_events; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.runtime_events (
    id uuid NOT NULL,
    installation_id uuid NOT NULL,
    event_kind text NOT NULL,
    from_status text,
    to_status text NOT NULL,
    runtime_id text NOT NULL,
    data_generation text NOT NULL,
    error_code text DEFAULT ''::text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_lifecycle_events_data_generation_check CHECK ((data_generation ~ '^data-[a-f0-9]{16}$'::text)),
    CONSTRAINT runtime_lifecycle_events_detail_check CHECK ((length(detail) <= 2000)),
    CONSTRAINT runtime_lifecycle_events_error_code_check CHECK ((length(error_code) <= 120)),
    CONSTRAINT runtime_lifecycle_events_event_kind_check CHECK ((event_kind = ANY (ARRAY['install'::text, 'start'::text, 'ready'::text, 'degraded'::text, 'stop'::text, 'crash_detected'::text, 'upgrade_plan'::text, 'upgrade_stage'::text, 'upgrade_switch'::text, 'upgrade_rollback'::text, 'restore_stage'::text, 'restore_switch'::text, 'failure'::text]))),
    CONSTRAINT runtime_lifecycle_events_from_status_check CHECK (((from_status IS NULL) OR (from_status = ANY (ARRAY['starting'::text, 'healthy'::text, 'degraded'::text, 'stopped'::text, 'upgrading'::text, 'restoring'::text, 'failed'::text])))),
    CONSTRAINT runtime_lifecycle_events_runtime_id_check CHECK ((runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'::text)),
    CONSTRAINT runtime_lifecycle_events_to_status_check CHECK ((to_status = ANY (ARRAY['starting'::text, 'healthy'::text, 'degraded'::text, 'stopped'::text, 'upgrading'::text, 'restoring'::text, 'failed'::text])))
);


--
-- Name: runtime_installations; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.runtime_installations (
    installation_id uuid NOT NULL,
    runtime_id text NOT NULL,
    manifest_sha256 character(64) NOT NULL,
    application_version text NOT NULL,
    postgres_version text NOT NULL,
    age_version text NOT NULL,
    pgvector_version text NOT NULL,
    pg_trgm_version text NOT NULL,
    active_data_generation text NOT NULL,
    status text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    last_started_at timestamp with time zone,
    last_stopped_at timestamp with time zone,
    last_health_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_installations_active_data_generation_check CHECK ((active_data_generation ~ '^data-[a-f0-9]{16}$'::text)),
    CONSTRAINT runtime_installations_age_version_check CHECK (((length(age_version) >= 1) AND (length(age_version) <= 80))),
    CONSTRAINT runtime_installations_application_version_check CHECK (((length(application_version) >= 1) AND (length(application_version) <= 80))),
    CONSTRAINT runtime_installations_manifest_sha256_check CHECK ((manifest_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT runtime_installations_pg_trgm_version_check CHECK (((length(pg_trgm_version) >= 1) AND (length(pg_trgm_version) <= 80))),
    CONSTRAINT runtime_installations_pgvector_version_check CHECK (((length(pgvector_version) >= 1) AND (length(pgvector_version) <= 80))),
    CONSTRAINT runtime_installations_postgres_version_check CHECK (((length(postgres_version) >= 1) AND (length(postgres_version) <= 80))),
    CONSTRAINT runtime_installations_revision_check CHECK ((revision > 0)),
    CONSTRAINT runtime_installations_runtime_id_check CHECK ((runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'::text)),
    CONSTRAINT runtime_installations_status_check CHECK ((status = ANY (ARRAY['starting'::text, 'healthy'::text, 'degraded'::text, 'stopped'::text, 'upgrading'::text, 'restoring'::text, 'failed'::text])))
);


--
-- Name: runtime_snapshots; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.runtime_snapshots (
    id uuid NOT NULL,
    installation_id uuid NOT NULL,
    runtime_id text NOT NULL,
    data_generation text NOT NULL,
    outcome text NOT NULL,
    package_integrity text NOT NULL,
    database_ready boolean NOT NULL,
    extensions jsonb NOT NULL,
    migration_count integer NOT NULL,
    active_job_count integer NOT NULL,
    dead_letter_count integer NOT NULL,
    latest_backup_at timestamp with time zone,
    free_disk_bytes bigint NOT NULL,
    checks_hash character(64) NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_health_snapshots_active_job_count_check CHECK ((active_job_count >= 0)),
    CONSTRAINT runtime_health_snapshots_checks_hash_check CHECK ((checks_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT runtime_health_snapshots_data_generation_check CHECK ((data_generation ~ '^data-[a-f0-9]{16}$'::text)),
    CONSTRAINT runtime_health_snapshots_dead_letter_count_check CHECK ((dead_letter_count >= 0)),
    CONSTRAINT runtime_health_snapshots_extensions_check CHECK (((jsonb_typeof(extensions) = 'object'::text) AND new_design.transfer_json_is_safe(extensions))),
    CONSTRAINT runtime_health_snapshots_free_disk_bytes_check CHECK ((free_disk_bytes >= 0)),
    CONSTRAINT runtime_health_snapshots_migration_count_check CHECK (((migration_count >= 0) AND (migration_count <= 10000))),
    CONSTRAINT runtime_health_snapshots_outcome_check CHECK ((outcome = ANY (ARRAY['healthy'::text, 'degraded'::text, 'failed'::text]))),
    CONSTRAINT runtime_health_snapshots_package_integrity_check CHECK ((package_integrity = ANY (ARRAY['verified'::text, 'failed'::text]))),
    CONSTRAINT runtime_health_snapshots_runtime_id_check CHECK ((runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'::text))
);


--
-- Name: runtime_upgrade_plans; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.runtime_upgrade_plans (
    id uuid NOT NULL,
    installation_id uuid NOT NULL,
    source_runtime_id text NOT NULL,
    target_runtime_id text NOT NULL,
    source_manifest_sha256 character(64) NOT NULL,
    target_manifest_sha256 character(64) NOT NULL,
    source_postgres_major integer NOT NULL,
    target_postgres_major integer NOT NULL,
    strategy text NOT NULL,
    backup_operation_id uuid NOT NULL,
    compatibility_operation_id uuid NOT NULL,
    source_data_generation text NOT NULL,
    target_data_generation text NOT NULL,
    rollback_data_generation text NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    last_error_code text DEFAULT ''::text NOT NULL,
    last_error_summary text DEFAULT ''::text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT runtime_upgrade_plans_check CHECK (((target_runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'::text) AND (target_runtime_id <> source_runtime_id))),
    CONSTRAINT runtime_upgrade_plans_check1 CHECK (((target_data_generation ~ '^data-[a-f0-9]{16}$'::text) AND (target_data_generation <> source_data_generation))),
    CONSTRAINT runtime_upgrade_plans_check2 CHECK ((rollback_data_generation = source_data_generation)),
    CONSTRAINT runtime_upgrade_plans_check3 CHECK ((((status = ANY (ARRAY['switched'::text, 'rolled_back'::text, 'failed'::text])) AND (completed_at IS NOT NULL)) OR ((status <> ALL (ARRAY['switched'::text, 'rolled_back'::text, 'failed'::text])) AND (completed_at IS NULL)))),
    CONSTRAINT runtime_upgrade_plans_created_by_check CHECK (((length(created_by) >= 1) AND (length(created_by) <= 160))),
    CONSTRAINT runtime_upgrade_plans_last_error_code_check CHECK ((length(last_error_code) <= 120)),
    CONSTRAINT runtime_upgrade_plans_last_error_summary_check CHECK ((length(last_error_summary) <= 2000)),
    CONSTRAINT runtime_upgrade_plans_revision_check CHECK ((revision > 0)),
    CONSTRAINT runtime_upgrade_plans_source_data_generation_check CHECK ((source_data_generation ~ '^data-[a-f0-9]{16}$'::text)),
    CONSTRAINT runtime_upgrade_plans_source_manifest_sha256_check CHECK ((source_manifest_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT runtime_upgrade_plans_source_postgres_major_check CHECK (((source_postgres_major >= 12) AND (source_postgres_major <= 30))),
    CONSTRAINT runtime_upgrade_plans_source_runtime_id_check CHECK ((source_runtime_id ~ '^[A-Za-z0-9._-]{8,160}$'::text)),
    CONSTRAINT runtime_upgrade_plans_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'backed_up'::text, 'staging'::text, 'verifying'::text, 'switched'::text, 'rolled_back'::text, 'failed'::text]))),
    CONSTRAINT runtime_upgrade_plans_strategy_check CHECK ((strategy = ANY (ARRAY['same_major_staged'::text, 'cross_major_pg_upgrade'::text, 'cross_major_logical_restore'::text]))),
    CONSTRAINT runtime_upgrade_plans_target_manifest_sha256_check CHECK ((target_manifest_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT runtime_upgrade_plans_target_postgres_major_check CHECK (((target_postgres_major >= 12) AND (target_postgres_major <= 30)))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.schema_migrations (
    id text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_capabilities; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.system_capabilities (
    capability_key text NOT NULL,
    installed boolean DEFAULT false NOT NULL,
    operational boolean DEFAULT false NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_capabilities_details_check CHECK ((jsonb_typeof(details) = 'object'::text))
);


--
-- Name: task_contract_versions; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.task_contract_versions (
    id uuid NOT NULL,
    contract_id uuid NOT NULL,
    version integer NOT NULL,
    base_version_id uuid,
    source text NOT NULL,
    status text NOT NULL,
    task_group text NOT NULL,
    input_schema jsonb NOT NULL,
    input_schema_version text NOT NULL,
    output_schema jsonb NOT NULL,
    output_schema_version text NOT NULL,
    context_policy_version text NOT NULL,
    prompt_recipe_version_id uuid NOT NULL,
    required_capabilities text[] DEFAULT '{}'::text[] NOT NULL,
    budget_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    timeout_ms integer NOT NULL,
    retry_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    confirmation_policy text NOT NULL,
    content_hash character(64) NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_contract_versions_budget_policy_check CHECK ((jsonb_typeof(budget_policy) = 'object'::text)),
    CONSTRAINT task_contract_versions_confirmation_policy_check CHECK ((confirmation_policy = ANY (ARRAY['none'::text, 'before_execute'::text, 'before_adopt'::text, 'always'::text]))),
    CONSTRAINT task_contract_versions_input_schema_check CHECK ((jsonb_typeof(input_schema) = 'object'::text)),
    CONSTRAINT task_contract_versions_output_schema_check CHECK ((jsonb_typeof(output_schema) = 'object'::text)),
    CONSTRAINT task_contract_versions_retry_policy_check CHECK ((jsonb_typeof(retry_policy) = 'object'::text)),
    CONSTRAINT task_contract_versions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'ai'::text, 'import'::text, 'system'::text]))),
    CONSTRAINT task_contract_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'proposed'::text, 'published'::text, 'superseded'::text, 'rejected'::text]))),
    CONSTRAINT task_contract_versions_timeout_ms_check CHECK ((timeout_ms > 0)),
    CONSTRAINT task_contract_versions_version_check CHECK ((version > 0))
);


--
-- Name: task_contracts; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.task_contracts (
    id uuid NOT NULL,
    task_key text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_version_id uuid,
    published_version_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_contracts_revision_check CHECK ((revision > 0)),
    CONSTRAINT task_contracts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: text_anchors; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.text_anchors (
    id uuid NOT NULL,
    space_id uuid,
    subject_card_id uuid,
    chapter_card_id uuid,
    scene_card_id uuid,
    role text DEFAULT 'reference'::text NOT NULL,
    anchor_label text DEFAULT ''::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    book_id uuid,
    chapter_document_id uuid,
    body_version_id uuid,
    label text DEFAULT ''::text NOT NULL,
    start_offset integer,
    end_offset integer,
    excerpt text,
    fragment_hash character(64),
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT text_anchor_shape CHECK ((((body_version_id IS NULL) AND (book_id IS NULL) AND (chapter_document_id IS NULL) AND (space_id IS NOT NULL) AND (subject_card_id IS NOT NULL) AND (chapter_card_id IS NOT NULL) AND (role = ANY (ARRAY['plant'::text, 'reveal'::text, 'evidence'::text, 'mention'::text])) AND (start_offset IS NULL) AND (end_offset IS NULL) AND (excerpt IS NULL) AND (fragment_hash IS NULL)) OR ((body_version_id IS NOT NULL) AND (book_id IS NOT NULL) AND (chapter_document_id IS NOT NULL) AND (space_id IS NULL) AND (chapter_card_id IS NULL) AND (scene_card_id IS NULL) AND (role = ANY (ARRAY['reference'::text, 'evidence'::text, 'mention'::text, 'plant'::text, 'reveal'::text])) AND (start_offset IS NOT NULL) AND (end_offset IS NOT NULL) AND (start_offset >= 0) AND (end_offset > start_offset) AND (excerpt IS NOT NULL) AND (fragment_hash IS NOT NULL) AND (fragment_hash ~ '^[a-f0-9]{64}$'::text) AND ((fragment_hash)::text = encode(sha256(convert_to(excerpt, 'UTF8'::name)), 'hex'::text))))),
    CONSTRAINT text_anchors_revision_check CHECK ((revision > 0)),
    CONSTRAINT text_anchors_status_check CHECK ((status = ANY (ARRAY['active'::text, 'stale'::text, 'archived'::text])))
);


--
-- Name: transfer_conflicts; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.transfer_conflicts (
    id uuid NOT NULL,
    operation_id uuid NOT NULL,
    conflict_kind text NOT NULL,
    entity_kind text NOT NULL,
    portable_key text NOT NULL,
    source_version text DEFAULT ''::text NOT NULL,
    target_version text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    resolution text,
    resolution_note text DEFAULT ''::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT transfer_conflicts_conflict_kind_check CHECK ((conflict_kind = ANY (ARRAY['portable_key_exists'::text, 'version_exists'::text, 'missing_dependency'::text, 'schema_incompatible'::text, 'unknown_required_capability'::text, 'target_exists'::text]))),
    CONSTRAINT transfer_conflicts_entity_kind_check CHECK (((length(entity_kind) >= 1) AND (length(entity_kind) <= 120))),
    CONSTRAINT transfer_conflicts_portable_key_check CHECK (((length(portable_key) >= 1) AND (length(portable_key) <= 240))),
    CONSTRAINT transfer_conflicts_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['new_local_version'::text, 'remap'::text, 'skip'::text, 'abort'::text])))),
    CONSTRAINT transfer_conflicts_resolution_note_check CHECK ((length(resolution_note) <= 2000)),
    CONSTRAINT transfer_conflicts_revision_check CHECK ((revision > 0)),
    CONSTRAINT transfer_conflicts_source_version_check CHECK ((length(source_version) <= 120)),
    CONSTRAINT transfer_conflicts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'resolved'::text, 'blocking'::text]))),
    CONSTRAINT transfer_conflicts_target_version_check CHECK ((length(target_version) <= 120))
);


--
-- Name: transfer_entries; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.transfer_entries (
    id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    archive_path text NOT NULL,
    normalized_case_path text NOT NULL,
    entry_kind text NOT NULL,
    checksum character(64),
    compressed_bytes bigint DEFAULT 0 NOT NULL,
    uncompressed_bytes bigint DEFAULT 0 NOT NULL,
    compression_ratio numeric(12,3) DEFAULT 1 NOT NULL,
    symbolic_link boolean DEFAULT false NOT NULL,
    reparse_point boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transfer_archive_entries_archive_path_check CHECK (((length(archive_path) >= 1) AND (length(archive_path) <= 480))),
    CONSTRAINT transfer_archive_entries_check CHECK ((((entry_kind = 'file'::text) AND (checksum ~ '^[a-f0-9]{64}$'::text)) OR ((entry_kind = 'directory'::text) AND (checksum IS NULL)))),
    CONSTRAINT transfer_archive_entries_compressed_bytes_check CHECK ((compressed_bytes >= 0)),
    CONSTRAINT transfer_archive_entries_compression_ratio_check CHECK (((compression_ratio >= (0)::numeric) AND (compression_ratio <= (10000)::numeric))),
    CONSTRAINT transfer_archive_entries_entry_kind_check CHECK ((entry_kind = ANY (ARRAY['file'::text, 'directory'::text]))),
    CONSTRAINT transfer_archive_entries_normalized_case_path_check CHECK (((length(normalized_case_path) >= 1) AND (length(normalized_case_path) <= 480))),
    CONSTRAINT transfer_archive_entries_reparse_point_check CHECK ((NOT reparse_point)),
    CONSTRAINT transfer_archive_entries_symbolic_link_check CHECK ((NOT symbolic_link)),
    CONSTRAINT transfer_archive_entries_uncompressed_bytes_check CHECK ((uncompressed_bytes >= 0)),
    CONSTRAINT transfer_entries_safe_locator CHECK ((new_design.transfer_locator_is_safe(archive_path) AND (normalized_case_path = lower(archive_path))))
);


--
-- Name: transfer_events; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.transfer_events (
    id uuid NOT NULL,
    operation_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    operation_revision integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transfer_operation_events_action_check CHECK ((action = ANY (ARRAY['request'::text, 'start'::text, 'verify'::text, 'ready'::text, 'fail'::text, 'cancel'::text, 'import'::text, 'restore'::text, 'archive'::text]))),
    CONSTRAINT transfer_operation_events_actor_check CHECK (((length(actor) >= 1) AND (length(actor) <= 160))),
    CONSTRAINT transfer_operation_events_detail_check CHECK ((length(detail) <= 2000)),
    CONSTRAINT transfer_operation_events_operation_revision_check CHECK ((operation_revision > 0))
);


--
-- Name: transfer_id_mappings; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.transfer_id_mappings (
    id uuid NOT NULL,
    operation_id uuid NOT NULL,
    entity_kind text NOT NULL,
    portable_key text NOT NULL,
    source_internal_id uuid,
    target_internal_id uuid NOT NULL,
    mapping_action text NOT NULL,
    target_version text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transfer_id_mappings_entity_kind_check CHECK (((length(entity_kind) >= 1) AND (length(entity_kind) <= 120))),
    CONSTRAINT transfer_id_mappings_mapping_action_check CHECK ((mapping_action = ANY (ARRAY['created'::text, 'reused'::text, 'new_local_version'::text, 'remapped'::text]))),
    CONSTRAINT transfer_id_mappings_portable_key_check CHECK (((length(portable_key) >= 1) AND (length(portable_key) <= 240))),
    CONSTRAINT transfer_id_mappings_target_version_check CHECK ((length(target_version) <= 120))
);


--
-- Name: transfer_manifests; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.transfer_manifests (
    id uuid NOT NULL,
    operation_id uuid NOT NULL,
    manifest_kind text NOT NULL,
    format_version integer NOT NULL,
    application_version text NOT NULL,
    minimum_application_version text NOT NULL,
    maximum_application_version text NOT NULL,
    schema_version text NOT NULL,
    schema_migrations jsonb NOT NULL,
    migration_hash character(64) NOT NULL,
    postgres_version text NOT NULL,
    age_version text,
    pgvector_version text,
    required_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    card_schema_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
    form_schema_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
    template_schema_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
    prompt_schema_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
    encoding text DEFAULT 'UTF8'::text NOT NULL,
    platform_constraints jsonb DEFAULT '{}'::jsonb NOT NULL,
    consistency_snapshot text NOT NULL,
    consistency_watermark jsonb NOT NULL,
    content_scope jsonb NOT NULL,
    excluded_derived_domains jsonb NOT NULL,
    secret_reconfiguration_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    manifest_hash character(64) NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transfer_manifests_application_version_check CHECK (((length(application_version) >= 1) AND (length(application_version) <= 80))),
    CONSTRAINT transfer_manifests_card_schema_versions_check CHECK ((jsonb_typeof(card_schema_versions) = 'array'::text)),
    CONSTRAINT transfer_manifests_consistency_snapshot_check CHECK (((length(consistency_snapshot) >= 1) AND (length(consistency_snapshot) <= 240))),
    CONSTRAINT transfer_manifests_consistency_watermark_check CHECK ((jsonb_typeof(consistency_watermark) = 'object'::text)),
    CONSTRAINT transfer_manifests_content_scope_check CHECK ((jsonb_typeof(content_scope) = 'object'::text)),
    CONSTRAINT transfer_manifests_created_by_check CHECK (((length(created_by) >= 1) AND (length(created_by) <= 160))),
    CONSTRAINT transfer_manifests_encoding_check CHECK ((encoding = 'UTF8'::text)),
    CONSTRAINT transfer_manifests_excluded_derived_domains_check CHECK ((jsonb_typeof(excluded_derived_domains) = 'array'::text)),
    CONSTRAINT transfer_manifests_form_schema_versions_check CHECK ((jsonb_typeof(form_schema_versions) = 'array'::text)),
    CONSTRAINT transfer_manifests_format_version_check CHECK ((format_version > 0)),
    CONSTRAINT transfer_manifests_manifest_hash_check CHECK ((manifest_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT transfer_manifests_manifest_kind_check CHECK ((manifest_kind = ANY (ARRAY['full_backup'::text, 'book_package'::text, 'template_package'::text, 'resource_package'::text]))),
    CONSTRAINT transfer_manifests_maximum_application_version_check CHECK (((length(maximum_application_version) >= 1) AND (length(maximum_application_version) <= 80))),
    CONSTRAINT transfer_manifests_migration_hash_check CHECK ((migration_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT transfer_manifests_minimum_application_version_check CHECK (((length(minimum_application_version) >= 1) AND (length(minimum_application_version) <= 80))),
    CONSTRAINT transfer_manifests_platform_constraints_check CHECK ((jsonb_typeof(platform_constraints) = 'object'::text)),
    CONSTRAINT transfer_manifests_postgres_version_check CHECK (((length(postgres_version) >= 1) AND (length(postgres_version) <= 80))),
    CONSTRAINT transfer_manifests_prompt_schema_versions_check CHECK ((jsonb_typeof(prompt_schema_versions) = 'array'::text)),
    CONSTRAINT transfer_manifests_required_capabilities_check CHECK ((jsonb_typeof(required_capabilities) = 'array'::text)),
    CONSTRAINT transfer_manifests_safe_json CHECK ((new_design.transfer_json_is_safe(schema_migrations) AND new_design.transfer_json_is_safe(required_capabilities) AND new_design.transfer_json_is_safe(card_schema_versions) AND new_design.transfer_json_is_safe(form_schema_versions) AND new_design.transfer_json_is_safe(template_schema_versions) AND new_design.transfer_json_is_safe(prompt_schema_versions) AND new_design.transfer_json_is_safe(platform_constraints) AND new_design.transfer_json_is_safe(consistency_watermark) AND new_design.transfer_json_is_safe(content_scope) AND new_design.transfer_json_is_safe(excluded_derived_domains) AND new_design.transfer_json_is_safe(secret_reconfiguration_refs))),
    CONSTRAINT transfer_manifests_schema_migrations_check CHECK ((jsonb_typeof(schema_migrations) = 'array'::text)),
    CONSTRAINT transfer_manifests_schema_version_check CHECK (((length(schema_version) >= 1) AND (length(schema_version) <= 120))),
    CONSTRAINT transfer_manifests_secret_reconfiguration_refs_check CHECK ((jsonb_typeof(secret_reconfiguration_refs) = 'array'::text)),
    CONSTRAINT transfer_manifests_template_schema_versions_check CHECK ((jsonb_typeof(template_schema_versions) = 'array'::text))
);


--
-- Name: transfer_operations; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.transfer_operations (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    book_id uuid,
    operation_kind text NOT NULL,
    execution_mode text NOT NULL,
    profile_key text NOT NULL,
    source_operation_id uuid,
    source_artifact_id uuid,
    target_staging_key text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    current_step_key text DEFAULT ''::text NOT NULL,
    progress_completed bigint DEFAULT 0 NOT NULL,
    progress_total bigint,
    ready_manifest_id uuid,
    compatibility_policy text DEFAULT 'strict'::text NOT NULL,
    max_entry_count integer DEFAULT 100000 NOT NULL,
    max_single_file_bytes bigint DEFAULT '2147483648'::bigint NOT NULL,
    max_total_bytes bigint DEFAULT '53687091200'::bigint NOT NULL,
    max_compression_ratio numeric(12,3) DEFAULT 200 NOT NULL,
    maintenance_mode_required boolean DEFAULT false NOT NULL,
    local_confirmation_digest character(64),
    requested_by text NOT NULL,
    idempotency_key text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    last_error_code text DEFAULT ''::text NOT NULL,
    last_error_summary text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    archived_at timestamp with time zone,
    CONSTRAINT transfer_operations_check CHECK (((progress_total IS NULL) OR (progress_total >= progress_completed))),
    CONSTRAINT transfer_operations_check1 CHECK (((max_total_bytes >= max_single_file_bytes) AND (max_total_bytes <= '10995116277760'::bigint))),
    CONSTRAINT transfer_operations_check2 CHECK (((book_id IS NULL) OR (operation_kind = 'book_export'::text))),
    CONSTRAINT transfer_operations_check3 CHECK ((((operation_kind = ANY (ARRAY['full_backup'::text, 'book_export'::text, 'template_export'::text, 'resource_export'::text])) AND (execution_mode = 'execute'::text)) OR ((operation_kind = ANY (ARRAY['full_restore'::text, 'book_import'::text, 'template_import'::text, 'resource_import'::text])) AND (execution_mode = ANY (ARRAY['dry_run'::text, 'apply'::text]))))),
    CONSTRAINT transfer_operations_check4 CHECK ((((operation_kind = ANY (ARRAY['full_backup'::text, 'full_restore'::text])) AND (profile_key = 'full_system'::text)) OR ((operation_kind = ANY (ARRAY['book_export'::text, 'book_import'::text])) AND (profile_key = ANY (ARRAY['compact_continue'::text, 'full_audit'::text]))) OR ((operation_kind = ANY (ARRAY['template_export'::text, 'template_import'::text])) AND (profile_key = 'template_bundle'::text)) OR ((operation_kind = ANY (ARRAY['resource_export'::text, 'resource_import'::text])) AND (profile_key = 'resource_bundle'::text)))),
    CONSTRAINT transfer_operations_check5 CHECK ((((operation_kind = ANY (ARRAY['full_restore'::text, 'book_import'::text, 'template_import'::text, 'resource_import'::text])) AND (source_artifact_id IS NOT NULL)) OR (operation_kind <> ALL (ARRAY['full_restore'::text, 'book_import'::text, 'template_import'::text, 'resource_import'::text])))),
    CONSTRAINT transfer_operations_check6 CHECK ((((execution_mode = 'apply'::text) AND (source_operation_id IS NOT NULL)) OR (execution_mode <> 'apply'::text))),
    CONSTRAINT transfer_operations_check7 CHECK ((((operation_kind = 'full_restore'::text) AND (execution_mode = 'apply'::text) AND maintenance_mode_required AND (local_confirmation_digest ~ '^[a-f0-9]{64}$'::text)) OR (((operation_kind <> 'full_restore'::text) OR (execution_mode <> 'apply'::text)) AND (NOT maintenance_mode_required) AND (local_confirmation_digest IS NULL)))),
    CONSTRAINT transfer_operations_check8 CHECK ((((status = ANY (ARRAY['ready'::text, 'failed'::text, 'cancelled'::text, 'imported'::text, 'restored'::text, 'archived'::text])) AND (completed_at IS NOT NULL)) OR (status <> ALL (ARRAY['ready'::text, 'failed'::text, 'cancelled'::text, 'imported'::text, 'restored'::text, 'archived'::text])))),
    CONSTRAINT transfer_operations_check9 CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status <> 'archived'::text) AND (archived_at IS NULL)))),
    CONSTRAINT transfer_operations_compatibility_policy_check CHECK ((compatibility_policy = ANY (ARRAY['strict'::text, 'explicit_upgrade'::text]))),
    CONSTRAINT transfer_operations_current_step_key_check CHECK ((length(current_step_key) <= 120)),
    CONSTRAINT transfer_operations_execution_mode_check CHECK ((execution_mode = ANY (ARRAY['execute'::text, 'dry_run'::text, 'apply'::text]))),
    CONSTRAINT transfer_operations_idempotency_key_check CHECK (((length(idempotency_key) >= 8) AND (length(idempotency_key) <= 240))),
    CONSTRAINT transfer_operations_last_error_code_check CHECK ((length(last_error_code) <= 120)),
    CONSTRAINT transfer_operations_last_error_summary_check CHECK ((length(last_error_summary) <= 2000)),
    CONSTRAINT transfer_operations_max_compression_ratio_check CHECK (((max_compression_ratio >= (1)::numeric) AND (max_compression_ratio <= (10000)::numeric))),
    CONSTRAINT transfer_operations_max_entry_count_check CHECK (((max_entry_count >= 1) AND (max_entry_count <= 1000000))),
    CONSTRAINT transfer_operations_max_single_file_bytes_check CHECK (((max_single_file_bytes >= 1) AND (max_single_file_bytes <= '1099511627776'::bigint))),
    CONSTRAINT transfer_operations_operation_kind_check CHECK ((operation_kind = ANY (ARRAY['full_backup'::text, 'full_restore'::text, 'book_export'::text, 'book_import'::text, 'template_export'::text, 'template_import'::text, 'resource_export'::text, 'resource_import'::text]))),
    CONSTRAINT transfer_operations_progress_completed_check CHECK ((progress_completed >= 0)),
    CONSTRAINT transfer_operations_requested_by_check CHECK (((length(requested_by) >= 1) AND (length(requested_by) <= 160))),
    CONSTRAINT transfer_operations_revision_check CHECK ((revision > 0)),
    CONSTRAINT transfer_operations_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'verifying'::text, 'ready'::text, 'failed'::text, 'cancelled'::text, 'imported'::text, 'restored'::text, 'archived'::text]))),
    CONSTRAINT transfer_operations_target_staging_key_check CHECK ((target_staging_key ~ '^[a-z][a-z0-9-]{2,79}$'::text))
);


--
-- Name: transfer_validations; Type: TABLE; Schema: new_design; Owner: -
--

CREATE TABLE new_design.transfer_validations (
    id uuid NOT NULL,
    operation_id uuid NOT NULL,
    stage text NOT NULL,
    rule_key text NOT NULL,
    outcome text NOT NULL,
    subject_kind text NOT NULL,
    subject_ref text DEFAULT ''::text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transfer_validation_results_detail_check CHECK ((length(detail) <= 4000)),
    CONSTRAINT transfer_validation_results_outcome_check CHECK ((outcome = ANY (ARRAY['passed'::text, 'warning'::text, 'failed'::text, 'unavailable'::text]))),
    CONSTRAINT transfer_validation_results_rule_key_check CHECK ((rule_key ~ '^[a-z][a-z0-9_.-]{1,119}$'::text)),
    CONSTRAINT transfer_validation_results_stage_check CHECK ((stage = ANY (ARRAY['preflight'::text, 'archive_scan'::text, 'checksum'::text, 'compatibility'::text, 'database_integrity'::text, 'asset_integrity'::text, 'staging_integrity'::text, 'publish_gate'::text, 'restore_drill'::text]))),
    CONSTRAINT transfer_validation_results_subject_kind_check CHECK (((length(subject_kind) >= 1) AND (length(subject_kind) <= 120))),
    CONSTRAINT transfer_validation_results_subject_ref_check CHECK ((length(subject_ref) <= 240))
);


--
-- Name: _ag_label_edge; Type: TABLE; Schema: new_design_projection; Owner: -
--

CREATE TABLE new_design_projection._ag_label_edge (
    id ag_catalog.graphid NOT NULL,
    start_id ag_catalog.graphid NOT NULL,
    end_id ag_catalog.graphid NOT NULL,
    properties ag_catalog.agtype DEFAULT ag_catalog.agtype_build_map() NOT NULL
);


--
-- Name: PROJECTED_RELATION; Type: TABLE; Schema: new_design_projection; Owner: -
--

CREATE TABLE new_design_projection."PROJECTED_RELATION" (
)
INHERITS (new_design_projection._ag_label_edge);


--
-- Name: PROJECTED_RELATION_id_seq; Type: SEQUENCE; Schema: new_design_projection; Owner: -
--

CREATE SEQUENCE new_design_projection."PROJECTED_RELATION_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


--
-- Name: PROJECTED_RELATION_id_seq; Type: SEQUENCE OWNED BY; Schema: new_design_projection; Owner: -
--

ALTER SEQUENCE new_design_projection."PROJECTED_RELATION_id_seq" OWNED BY new_design_projection."PROJECTED_RELATION".id;


--
-- Name: _ag_label_vertex; Type: TABLE; Schema: new_design_projection; Owner: -
--

CREATE TABLE new_design_projection._ag_label_vertex (
    id ag_catalog.graphid NOT NULL,
    properties ag_catalog.agtype DEFAULT ag_catalog.agtype_build_map() NOT NULL
);


--
-- Name: ProjectedNode; Type: TABLE; Schema: new_design_projection; Owner: -
--

CREATE TABLE new_design_projection."ProjectedNode" (
)
INHERITS (new_design_projection._ag_label_vertex);


--
-- Name: ProjectedNode_id_seq; Type: SEQUENCE; Schema: new_design_projection; Owner: -
--

CREATE SEQUENCE new_design_projection."ProjectedNode_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


--
-- Name: ProjectedNode_id_seq; Type: SEQUENCE OWNED BY; Schema: new_design_projection; Owner: -
--

ALTER SEQUENCE new_design_projection."ProjectedNode_id_seq" OWNED BY new_design_projection."ProjectedNode".id;


--
-- Name: _ag_label_edge_id_seq; Type: SEQUENCE; Schema: new_design_projection; Owner: -
--

CREATE SEQUENCE new_design_projection._ag_label_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


--
-- Name: _ag_label_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: new_design_projection; Owner: -
--

ALTER SEQUENCE new_design_projection._ag_label_edge_id_seq OWNED BY new_design_projection._ag_label_edge.id;


--
-- Name: _ag_label_vertex_id_seq; Type: SEQUENCE; Schema: new_design_projection; Owner: -
--

CREATE SEQUENCE new_design_projection._ag_label_vertex_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


--
-- Name: _ag_label_vertex_id_seq; Type: SEQUENCE OWNED BY; Schema: new_design_projection; Owner: -
--

ALTER SEQUENCE new_design_projection._ag_label_vertex_id_seq OWNED BY new_design_projection._ag_label_vertex.id;


--
-- Name: _label_id_seq; Type: SEQUENCE; Schema: new_design_projection; Owner: -
--

CREATE SEQUENCE new_design_projection._label_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 65535
    CACHE 1
    CYCLE;


--
-- Name: PROJECTED_RELATION id; Type: DEFAULT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection."PROJECTED_RELATION" ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('new_design_projection'::name, 'PROJECTED_RELATION'::name))::integer, nextval('new_design_projection."PROJECTED_RELATION_id_seq"'::regclass));


--
-- Name: PROJECTED_RELATION properties; Type: DEFAULT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection."PROJECTED_RELATION" ALTER COLUMN properties SET DEFAULT ag_catalog.agtype_build_map();


--
-- Name: ProjectedNode id; Type: DEFAULT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection."ProjectedNode" ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('new_design_projection'::name, 'ProjectedNode'::name))::integer, nextval('new_design_projection."ProjectedNode_id_seq"'::regclass));


--
-- Name: ProjectedNode properties; Type: DEFAULT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection."ProjectedNode" ALTER COLUMN properties SET DEFAULT ag_catalog.agtype_build_map();


--
-- Name: _ag_label_edge id; Type: DEFAULT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection._ag_label_edge ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('new_design_projection'::name, '_ag_label_edge'::name))::integer, nextval('new_design_projection._ag_label_edge_id_seq'::regclass));


--
-- Name: _ag_label_vertex id; Type: DEFAULT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection._ag_label_vertex ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('new_design_projection'::name, '_ag_label_vertex'::name))::integer, nextval('new_design_projection._ag_label_vertex_id_seq'::regclass));


--
-- Name: ai_attempt_usage ai_attempt_usage_attempt_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_attempt_usage
    ADD CONSTRAINT ai_attempt_usage_attempt_id_key UNIQUE (attempt_id);


--
-- Name: ai_attempt_usage ai_attempt_usage_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_attempt_usage
    ADD CONSTRAINT ai_attempt_usage_pkey PRIMARY KEY (id);


--
-- Name: ai_task_attempts ai_task_attempts_id_step_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_attempts
    ADD CONSTRAINT ai_task_attempts_id_step_id_key UNIQUE (id, step_id);


--
-- Name: ai_task_attempts ai_task_attempts_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_attempts
    ADD CONSTRAINT ai_task_attempts_pkey PRIMARY KEY (id);


--
-- Name: ai_task_attempts ai_task_attempts_step_id_attempt_number_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_attempts
    ADD CONSTRAINT ai_task_attempts_step_id_attempt_number_key UNIQUE (step_id, attempt_number);


--
-- Name: ai_task_events ai_task_state_events_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_events
    ADD CONSTRAINT ai_task_state_events_pkey PRIMARY KEY (id);


--
-- Name: ai_task_steps ai_task_steps_id_task_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_steps
    ADD CONSTRAINT ai_task_steps_id_task_id_key UNIQUE (id, task_id);


--
-- Name: ai_task_steps ai_task_steps_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_steps
    ADD CONSTRAINT ai_task_steps_pkey PRIMARY KEY (id);


--
-- Name: ai_task_steps ai_task_steps_task_id_sort_order_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_steps
    ADD CONSTRAINT ai_task_steps_task_id_sort_order_key UNIQUE (task_id, sort_order);


--
-- Name: ai_task_steps ai_task_steps_task_id_step_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_steps
    ADD CONSTRAINT ai_task_steps_task_id_step_key_key UNIQUE (task_id, step_key);


--
-- Name: ai_tasks ai_tasks_id_space_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_tasks
    ADD CONSTRAINT ai_tasks_id_space_id_key UNIQUE (id, space_id);


--
-- Name: ai_tasks ai_tasks_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_tasks
    ADD CONSTRAINT ai_tasks_pkey PRIMARY KEY (id);


--
-- Name: ai_tasks ai_tasks_space_id_request_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_tasks
    ADD CONSTRAINT ai_tasks_space_id_request_idempotency_key_key UNIQUE (space_id, request_idempotency_key);


--
-- Name: asset_content_objects asset_content_objects_checksum_algorithm_checksum_byte_size_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_content_objects
    ADD CONSTRAINT asset_content_objects_checksum_algorithm_checksum_byte_size_key UNIQUE (checksum_algorithm, checksum, byte_size);


--
-- Name: asset_content_objects asset_content_objects_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_content_objects
    ADD CONSTRAINT asset_content_objects_pkey PRIMARY KEY (id);


--
-- Name: asset_content_objects asset_content_objects_storage_provider_storage_locator_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_content_objects
    ADD CONSTRAINT asset_content_objects_storage_provider_storage_locator_key UNIQUE (storage_provider, storage_locator);


--
-- Name: asset_events asset_events_book_id_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_events
    ADD CONSTRAINT asset_events_book_id_idempotency_key_key UNIQUE (book_id, idempotency_key);


--
-- Name: asset_events asset_events_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_events
    ADD CONSTRAINT asset_events_pkey PRIMARY KEY (id);


--
-- Name: asset_links asset_mounts_book_id_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_links
    ADD CONSTRAINT asset_mounts_book_id_idempotency_key_key UNIQUE (book_id, idempotency_key);


--
-- Name: asset_links asset_mounts_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_links
    ADD CONSTRAINT asset_mounts_pkey PRIMARY KEY (id);


--
-- Name: asset_versions asset_versions_asset_id_version_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_versions
    ADD CONSTRAINT asset_versions_asset_id_version_key UNIQUE (asset_id, version);


--
-- Name: asset_versions asset_versions_id_asset_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_versions
    ADD CONSTRAINT asset_versions_id_asset_id_key UNIQUE (id, asset_id);


--
-- Name: asset_versions asset_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_versions
    ADD CONSTRAINT asset_versions_pkey PRIMARY KEY (id);


--
-- Name: background_job_attempts background_job_attempts_id_job_id_fencing_token_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_attempts
    ADD CONSTRAINT background_job_attempts_id_job_id_fencing_token_key UNIQUE (id, job_id, fencing_token);


--
-- Name: background_job_attempts background_job_attempts_id_job_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_attempts
    ADD CONSTRAINT background_job_attempts_id_job_id_key UNIQUE (id, job_id);


--
-- Name: background_job_attempts background_job_attempts_job_id_attempt_number_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_attempts
    ADD CONSTRAINT background_job_attempts_job_id_attempt_number_key UNIQUE (job_id, attempt_number);


--
-- Name: background_job_attempts background_job_attempts_job_id_fencing_token_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_attempts
    ADD CONSTRAINT background_job_attempts_job_id_fencing_token_key UNIQUE (job_id, fencing_token);


--
-- Name: background_job_attempts background_job_attempts_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_attempts
    ADD CONSTRAINT background_job_attempts_pkey PRIMARY KEY (id);


--
-- Name: background_job_checkpoints background_job_checkpoints_job_id_attempt_id_checkpoint_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_checkpoints
    ADD CONSTRAINT background_job_checkpoints_job_id_attempt_id_checkpoint_key_key UNIQUE (job_id, attempt_id, checkpoint_key, checkpoint_hash);


--
-- Name: background_job_checkpoints background_job_checkpoints_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_checkpoints
    ADD CONSTRAINT background_job_checkpoints_pkey PRIMARY KEY (id);


--
-- Name: background_job_events background_job_results_id_job_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_events
    ADD CONSTRAINT background_job_results_id_job_id_key UNIQUE (id, job_id);


--
-- Name: background_job_events background_job_results_job_id_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_events
    ADD CONSTRAINT background_job_results_job_id_idempotency_key_key UNIQUE (job_id, idempotency_key);


--
-- Name: background_job_events background_job_results_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_events
    ADD CONSTRAINT background_job_results_pkey PRIMARY KEY (id);


--
-- Name: background_jobs background_jobs_handler_key_specialized_request_kind_specia_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_jobs
    ADD CONSTRAINT background_jobs_handler_key_specialized_request_kind_specia_key UNIQUE (handler_key, specialized_request_kind, specialized_request_id, execution_generation);


--
-- Name: background_jobs background_jobs_id_outbox_event_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_jobs
    ADD CONSTRAINT background_jobs_id_outbox_event_id_key UNIQUE (id, outbox_event_id);


--
-- Name: background_jobs background_jobs_outbox_event_id_handler_key_execution_gener_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_jobs
    ADD CONSTRAINT background_jobs_outbox_event_id_handler_key_execution_gener_key UNIQUE (outbox_event_id, handler_key, execution_generation);


--
-- Name: background_jobs background_jobs_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_jobs
    ADD CONSTRAINT background_jobs_pkey PRIMARY KEY (id);


--
-- Name: books books_book_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.books
    ADD CONSTRAINT books_book_key_key UNIQUE (book_key);


--
-- Name: books books_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.books
    ADD CONSTRAINT books_pkey PRIMARY KEY (id);


--
-- Name: books books_space_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.books
    ADD CONSTRAINT books_space_id_key UNIQUE (space_id);


--
-- Name: card_relation_versions card_relation_versions_card_relation_id_revision_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relation_versions
    ADD CONSTRAINT card_relation_versions_card_relation_id_revision_key UNIQUE (card_relation_id, revision);


--
-- Name: card_relation_versions card_relation_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relation_versions
    ADD CONSTRAINT card_relation_versions_pkey PRIMARY KEY (id);


--
-- Name: card_relations card_relations_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relations
    ADD CONSTRAINT card_relations_pkey PRIMARY KEY (id);


--
-- Name: card_spaces card_spaces_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_spaces
    ADD CONSTRAINT card_spaces_pkey PRIMARY KEY (id);


--
-- Name: card_spaces card_spaces_space_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_spaces
    ADD CONSTRAINT card_spaces_space_key_key UNIQUE (space_key);


--
-- Name: card_type_versions card_type_versions_card_type_id_version_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_type_versions
    ADD CONSTRAINT card_type_versions_card_type_id_version_key UNIQUE (card_type_id, version);


--
-- Name: card_type_versions card_type_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_type_versions
    ADD CONSTRAINT card_type_versions_pkey PRIMARY KEY (id);


--
-- Name: card_types card_types_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_types
    ADD CONSTRAINT card_types_pkey PRIMARY KEY (id);


--
-- Name: card_types card_types_space_id_type_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_types
    ADD CONSTRAINT card_types_space_id_type_key_key UNIQUE (space_id, type_key);


--
-- Name: card_version_actions card_version_actions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_version_actions
    ADD CONSTRAINT card_version_actions_pkey PRIMARY KEY (id);


--
-- Name: card_versions card_versions_card_id_revision_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_versions
    ADD CONSTRAINT card_versions_card_id_revision_key UNIQUE (card_id, revision);


--
-- Name: card_versions card_versions_id_card_unique; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_versions
    ADD CONSTRAINT card_versions_id_card_unique UNIQUE (id, card_id);


--
-- Name: card_versions card_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_versions
    ADD CONSTRAINT card_versions_pkey PRIMARY KEY (id);


--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- Name: chapter_body_adoptions chapter_body_adoptions_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_adoptions
    ADD CONSTRAINT chapter_body_adoptions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: chapter_body_adoptions chapter_body_adoptions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_adoptions
    ADD CONSTRAINT chapter_body_adoptions_pkey PRIMARY KEY (id);


--
-- Name: chapter_body_versions chapter_body_versions_chapter_document_id_version_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_chapter_document_id_version_key UNIQUE (chapter_document_id, version);


--
-- Name: chapter_body_versions chapter_body_versions_id_chapter_document_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_id_chapter_document_id_key UNIQUE (id, chapter_document_id);


--
-- Name: chapter_body_versions chapter_body_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_pkey PRIMARY KEY (id);


--
-- Name: chapter_documents chapter_documents_book_id_chapter_card_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_documents
    ADD CONSTRAINT chapter_documents_book_id_chapter_card_id_key UNIQUE (book_id, chapter_card_id);


--
-- Name: chapter_documents chapter_documents_book_id_logical_order_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_documents
    ADD CONSTRAINT chapter_documents_book_id_logical_order_key UNIQUE (book_id, logical_order);


--
-- Name: chapter_documents chapter_documents_id_book_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_documents
    ADD CONSTRAINT chapter_documents_id_book_id_key UNIQUE (id, book_id);


--
-- Name: chapter_documents chapter_documents_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_documents
    ADD CONSTRAINT chapter_documents_pkey PRIMARY KEY (id);


--
-- Name: chapter_settlement_items chapter_settlement_items_canonical_fact_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlement_items
    ADD CONSTRAINT chapter_settlement_items_canonical_fact_id_key UNIQUE (canonical_fact_id);


--
-- Name: chapter_settlement_items chapter_settlement_items_knowledge_proposal_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlement_items
    ADD CONSTRAINT chapter_settlement_items_knowledge_proposal_id_key UNIQUE (knowledge_proposal_id);


--
-- Name: chapter_settlement_items chapter_settlement_items_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlement_items
    ADD CONSTRAINT chapter_settlement_items_pkey PRIMARY KEY (id);


--
-- Name: chapter_settlement_items chapter_settlement_items_state_proposal_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlement_items
    ADD CONSTRAINT chapter_settlement_items_state_proposal_id_key UNIQUE (state_proposal_id);


--
-- Name: chapter_settlements chapter_settlements_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlements
    ADD CONSTRAINT chapter_settlements_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: chapter_settlements chapter_settlements_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlements
    ADD CONSTRAINT chapter_settlements_pkey PRIMARY KEY (id);


--
-- Name: chapter_settlements chapter_settlements_revert_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlements
    ADD CONSTRAINT chapter_settlements_revert_idempotency_key_key UNIQUE (revert_idempotency_key);


--
-- Name: context_manifest_items context_manifest_entries_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifest_items
    ADD CONSTRAINT context_manifest_entries_pkey PRIMARY KEY (id);


--
-- Name: context_manifest_items context_manifest_entries_slot_id_sort_order_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifest_items
    ADD CONSTRAINT context_manifest_entries_slot_id_sort_order_key UNIQUE (slot_id, sort_order);


--
-- Name: context_manifest_items context_manifest_entries_slot_id_source_type_stable_object__key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifest_items
    ADD CONSTRAINT context_manifest_entries_slot_id_source_type_stable_object__key UNIQUE (slot_id, source_type, stable_object_id, exact_version_id);


--
-- Name: context_manifests context_manifests_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifests
    ADD CONSTRAINT context_manifests_pkey PRIMARY KEY (id);


--
-- Name: dependency_edges dependency_edges_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_edges
    ADD CONSTRAINT dependency_edges_pkey PRIMARY KEY (id);


--
-- Name: dependency_resources dependency_resources_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_resources
    ADD CONSTRAINT dependency_resources_pkey PRIMARY KEY (id);


--
-- Name: dependency_resources dependency_resources_resource_kind_stable_object_id_exact_v_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_resources
    ADD CONSTRAINT dependency_resources_resource_kind_stable_object_id_exact_v_key UNIQUE (resource_kind, stable_object_id, exact_version_id);


--
-- Name: dependency_events dependency_state_events_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_events
    ADD CONSTRAINT dependency_state_events_pkey PRIMARY KEY (id);


--
-- Name: embedding_chunks embedding_chunks_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_chunks
    ADD CONSTRAINT embedding_chunks_pkey PRIMARY KEY (id);


--
-- Name: embedding_chunks embedding_chunks_source_snapshot_id_profile_version_id_chun_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_chunks
    ADD CONSTRAINT embedding_chunks_source_snapshot_id_profile_version_id_chun_key UNIQUE (source_snapshot_id, profile_version_id, chunker_version, ordinal, record_kind);


--
-- Name: embedding_generations embedding_index_generations_book_id_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_generations
    ADD CONSTRAINT embedding_index_generations_book_id_idempotency_key_key UNIQUE (book_id, idempotency_key);


--
-- Name: embedding_generations embedding_index_generations_book_id_profile_version_id_gene_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_generations
    ADD CONSTRAINT embedding_index_generations_book_id_profile_version_id_gene_key UNIQUE (book_id, profile_version_id, generation);


--
-- Name: embedding_generations embedding_index_generations_index_name_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_generations
    ADD CONSTRAINT embedding_index_generations_index_name_key UNIQUE (index_name);


--
-- Name: embedding_generations embedding_index_generations_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_generations
    ADD CONSTRAINT embedding_index_generations_pkey PRIMARY KEY (id);


--
-- Name: embedding_profiles embedding_profiles_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_profiles
    ADD CONSTRAINT embedding_profiles_pkey PRIMARY KEY (id);


--
-- Name: embedding_profiles embedding_profiles_profile_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_profiles
    ADD CONSTRAINT embedding_profiles_profile_key_key UNIQUE (profile_key);


--
-- Name: embedding_vectors embedding_vectors_generation_id_chunk_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_vectors
    ADD CONSTRAINT embedding_vectors_generation_id_chunk_id_key UNIQUE (generation_id, chunk_id);


--
-- Name: embedding_vectors embedding_vectors_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_vectors
    ADD CONSTRAINT embedding_vectors_pkey PRIMARY KEY (id);


--
-- Name: field_definition_versions field_definition_versions_field_definition_id_version_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definition_versions
    ADD CONSTRAINT field_definition_versions_field_definition_id_version_key UNIQUE (field_definition_id, version);


--
-- Name: field_definition_versions field_definition_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definition_versions
    ADD CONSTRAINT field_definition_versions_pkey PRIMARY KEY (id);


--
-- Name: field_definitions field_definitions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definitions
    ADD CONSTRAINT field_definitions_pkey PRIMARY KEY (id);


--
-- Name: field_definitions field_definitions_space_id_card_type_id_card_id_card_mount__key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definitions
    ADD CONSTRAINT field_definitions_space_id_card_type_id_card_id_card_mount__key UNIQUE NULLS NOT DISTINCT (space_id, card_type_id, card_id, card_mount_id, field_key);


--
-- Name: graph_projection_checkpoints graph_projection_checkpoints_batch_id_checkpoint_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.graph_projection_checkpoints
    ADD CONSTRAINT graph_projection_checkpoints_batch_id_checkpoint_key_key UNIQUE (batch_id, checkpoint_key);


--
-- Name: graph_projection_checkpoints graph_projection_checkpoints_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.graph_projection_checkpoints
    ADD CONSTRAINT graph_projection_checkpoints_pkey PRIMARY KEY (id);


--
-- Name: graph_projection_configs graph_projection_configs_graph_name_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.graph_projection_configs
    ADD CONSTRAINT graph_projection_configs_graph_name_key UNIQUE (graph_name);


--
-- Name: graph_projection_configs graph_projection_configs_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.graph_projection_configs
    ADD CONSTRAINT graph_projection_configs_pkey PRIMARY KEY (id);


--
-- Name: graph_projection_runs graph_projection_generations_book_id_generation_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.graph_projection_runs
    ADD CONSTRAINT graph_projection_generations_book_id_generation_key UNIQUE (book_id, generation);


--
-- Name: graph_projection_runs graph_projection_generations_id_book_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.graph_projection_runs
    ADD CONSTRAINT graph_projection_generations_id_book_id_key UNIQUE (id, book_id);


--
-- Name: graph_projection_runs graph_projection_generations_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.graph_projection_runs
    ADD CONSTRAINT graph_projection_generations_pkey PRIMARY KEY (id);


--
-- Name: media_job_attempts media_job_attempts_job_id_attempt_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_job_attempts
    ADD CONSTRAINT media_job_attempts_job_id_attempt_key UNIQUE (job_id, attempt);


--
-- Name: media_job_attempts media_job_attempts_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_job_attempts
    ADD CONSTRAINT media_job_attempts_pkey PRIMARY KEY (id);


--
-- Name: media_jobs media_jobs_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_jobs
    ADD CONSTRAINT media_jobs_pkey PRIMARY KEY (id);


--
-- Name: media_jobs media_jobs_request_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_jobs
    ADD CONSTRAINT media_jobs_request_key_key UNIQUE (request_key);


--
-- Name: media_outputs media_outputs_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_outputs
    ADD CONSTRAINT media_outputs_pkey PRIMARY KEY (id);


--
-- Name: model_credential_refs model_credential_refs_credential_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_credential_refs
    ADD CONSTRAINT model_credential_refs_credential_key_key UNIQUE (credential_key);


--
-- Name: model_credential_refs model_credential_refs_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_credential_refs
    ADD CONSTRAINT model_credential_refs_pkey PRIMARY KEY (id);


--
-- Name: model_route_configs model_route_configs_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_configs
    ADD CONSTRAINT model_route_configs_pkey PRIMARY KEY (id);


--
-- Name: model_route_snapshots model_route_snapshots_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_snapshots
    ADD CONSTRAINT model_route_snapshots_pkey PRIMARY KEY (id);


--
-- Name: model_route_versions model_route_versions_config_id_version_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_versions
    ADD CONSTRAINT model_route_versions_config_id_version_key UNIQUE (config_id, version);


--
-- Name: model_route_versions model_route_versions_id_config_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_versions
    ADD CONSTRAINT model_route_versions_id_config_id_key UNIQUE (id, config_id);


--
-- Name: model_route_versions model_route_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_versions
    ADD CONSTRAINT model_route_versions_pkey PRIMARY KEY (id);


--
-- Name: outbox_aggregate_sequences outbox_aggregate_sequences_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_aggregate_sequences
    ADD CONSTRAINT outbox_aggregate_sequences_pkey PRIMARY KEY (aggregate_kind, aggregate_id);


--
-- Name: outbox_consumers outbox_consumers_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_consumers
    ADD CONSTRAINT outbox_consumers_pkey PRIMARY KEY (consumer_key);


--
-- Name: outbox_events outbox_events_aggregate_kind_aggregate_id_aggregate_sequenc_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_events
    ADD CONSTRAINT outbox_events_aggregate_kind_aggregate_id_aggregate_sequenc_key UNIQUE (aggregate_kind, aggregate_id, aggregate_sequence);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_topic_producer_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_events
    ADD CONSTRAINT outbox_events_topic_producer_idempotency_key_key UNIQUE (topic, producer_idempotency_key);


--
-- Name: outbox_inbox_receipts outbox_inbox_receipts_consumer_key_event_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_inbox_receipts
    ADD CONSTRAINT outbox_inbox_receipts_consumer_key_event_id_key UNIQUE (consumer_key, event_id);


--
-- Name: outbox_inbox_receipts outbox_inbox_receipts_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_inbox_receipts
    ADD CONSTRAINT outbox_inbox_receipts_pkey PRIMARY KEY (id);


--
-- Name: prompt_recipe_versions prompt_recipe_versions_id_recipe_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipe_versions
    ADD CONSTRAINT prompt_recipe_versions_id_recipe_id_key UNIQUE (id, recipe_id);


--
-- Name: prompt_recipe_versions prompt_recipe_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipe_versions
    ADD CONSTRAINT prompt_recipe_versions_pkey PRIMARY KEY (id);


--
-- Name: prompt_recipe_versions prompt_recipe_versions_recipe_id_version_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipe_versions
    ADD CONSTRAINT prompt_recipe_versions_recipe_id_version_key UNIQUE (recipe_id, version);


--
-- Name: prompt_recipes prompt_recipes_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipes
    ADD CONSTRAINT prompt_recipes_pkey PRIMARY KEY (id);


--
-- Name: prompt_recipes prompt_recipes_recipe_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipes
    ADD CONSTRAINT prompt_recipes_recipe_key_key UNIQUE (recipe_key);


--
-- Name: publication_artifacts publication_export_artifacts_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.publication_artifacts
    ADD CONSTRAINT publication_export_artifacts_pkey PRIMARY KEY (id);


--
-- Name: publication_artifacts publication_export_artifacts_request_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.publication_artifacts
    ADD CONSTRAINT publication_export_artifacts_request_id_key UNIQUE (request_id);


--
-- Name: publication_manifests publication_export_manifests_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.publication_manifests
    ADD CONSTRAINT publication_export_manifests_pkey PRIMARY KEY (id);


--
-- Name: relation_types relation_types_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.relation_types
    ADD CONSTRAINT relation_types_pkey PRIMARY KEY (id);


--
-- Name: relation_types relation_types_scope_key_unique; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.relation_types
    ADD CONSTRAINT relation_types_scope_key_unique UNIQUE NULLS NOT DISTINCT (owner_space_id, relation_key);


--
-- Name: release_assessments release_gate_assessments_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.release_assessments
    ADD CONSTRAINT release_gate_assessments_pkey PRIMARY KEY (id);


--
-- Name: release_definitions release_gate_definitions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.release_definitions
    ADD CONSTRAINT release_gate_definitions_pkey PRIMARY KEY (gate_key);


--
-- Name: research_document_versions research_document_versions_document_id_version_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.research_document_versions
    ADD CONSTRAINT research_document_versions_document_id_version_key UNIQUE (document_id, version);


--
-- Name: research_document_versions research_document_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.research_document_versions
    ADD CONSTRAINT research_document_versions_pkey PRIMARY KEY (id);


--
-- Name: research_documents research_documents_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.research_documents
    ADD CONSTRAINT research_documents_pkey PRIMARY KEY (id);


--
-- Name: runtime_snapshots runtime_health_snapshots_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_snapshots
    ADD CONSTRAINT runtime_health_snapshots_pkey PRIMARY KEY (id);


--
-- Name: runtime_installations runtime_installations_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_installations
    ADD CONSTRAINT runtime_installations_pkey PRIMARY KEY (installation_id);


--
-- Name: runtime_events runtime_lifecycle_events_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_events
    ADD CONSTRAINT runtime_lifecycle_events_pkey PRIMARY KEY (id);


--
-- Name: runtime_upgrade_plans runtime_upgrade_plans_installation_id_target_runtime_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_upgrade_plans
    ADD CONSTRAINT runtime_upgrade_plans_installation_id_target_runtime_id_key UNIQUE (installation_id, target_runtime_id);


--
-- Name: runtime_upgrade_plans runtime_upgrade_plans_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_upgrade_plans
    ADD CONSTRAINT runtime_upgrade_plans_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: retrieval_results semantic_retrieval_results_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.retrieval_results
    ADD CONSTRAINT semantic_retrieval_results_pkey PRIMARY KEY (id);


--
-- Name: retrieval_results semantic_retrieval_results_run_id_chunk_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.retrieval_results
    ADD CONSTRAINT semantic_retrieval_results_run_id_chunk_id_key UNIQUE (run_id, chunk_id);


--
-- Name: retrieval_results semantic_retrieval_results_run_id_rank_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.retrieval_results
    ADD CONSTRAINT semantic_retrieval_results_run_id_rank_key UNIQUE (run_id, rank);


--
-- Name: retrieval_runs semantic_retrieval_runs_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.retrieval_runs
    ADD CONSTRAINT semantic_retrieval_runs_pkey PRIMARY KEY (id);


--
-- Name: system_capabilities system_capabilities_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.system_capabilities
    ADD CONSTRAINT system_capabilities_pkey PRIMARY KEY (capability_key);


--
-- Name: task_contract_versions task_contract_versions_contract_id_version_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contract_versions
    ADD CONSTRAINT task_contract_versions_contract_id_version_key UNIQUE (contract_id, version);


--
-- Name: task_contract_versions task_contract_versions_id_contract_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contract_versions
    ADD CONSTRAINT task_contract_versions_id_contract_id_key UNIQUE (id, contract_id);


--
-- Name: task_contract_versions task_contract_versions_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contract_versions
    ADD CONSTRAINT task_contract_versions_pkey PRIMARY KEY (id);


--
-- Name: task_contracts task_contracts_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contracts
    ADD CONSTRAINT task_contracts_pkey PRIMARY KEY (id);


--
-- Name: task_contracts task_contracts_task_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contracts
    ADD CONSTRAINT task_contracts_task_key_key UNIQUE (task_key);


--
-- Name: text_anchors text_anchors_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.text_anchors
    ADD CONSTRAINT text_anchors_pkey PRIMARY KEY (id);


--
-- Name: transfer_entries transfer_archive_entries_artifact_id_normalized_case_path_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_entries
    ADD CONSTRAINT transfer_archive_entries_artifact_id_normalized_case_path_key UNIQUE (artifact_id, normalized_case_path);


--
-- Name: transfer_entries transfer_archive_entries_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_entries
    ADD CONSTRAINT transfer_archive_entries_pkey PRIMARY KEY (id);


--
-- Name: transfer_conflicts transfer_conflicts_operation_id_conflict_kind_entity_kind_p_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_conflicts
    ADD CONSTRAINT transfer_conflicts_operation_id_conflict_kind_entity_kind_p_key UNIQUE (operation_id, conflict_kind, entity_kind, portable_key);


--
-- Name: transfer_conflicts transfer_conflicts_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_conflicts
    ADD CONSTRAINT transfer_conflicts_pkey PRIMARY KEY (id);


--
-- Name: transfer_id_mappings transfer_id_mappings_operation_id_entity_kind_portable_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_id_mappings
    ADD CONSTRAINT transfer_id_mappings_operation_id_entity_kind_portable_key_key UNIQUE (operation_id, entity_kind, portable_key);


--
-- Name: transfer_id_mappings transfer_id_mappings_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_id_mappings
    ADD CONSTRAINT transfer_id_mappings_pkey PRIMARY KEY (id);


--
-- Name: transfer_manifests transfer_manifests_manifest_hash_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_manifests
    ADD CONSTRAINT transfer_manifests_manifest_hash_key UNIQUE (manifest_hash);


--
-- Name: transfer_manifests transfer_manifests_operation_id_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_manifests
    ADD CONSTRAINT transfer_manifests_operation_id_id_key UNIQUE (operation_id, id);


--
-- Name: transfer_manifests transfer_manifests_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_manifests
    ADD CONSTRAINT transfer_manifests_pkey PRIMARY KEY (id);


--
-- Name: transfer_events transfer_operation_events_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_events
    ADD CONSTRAINT transfer_operation_events_pkey PRIMARY KEY (id);


--
-- Name: transfer_operations transfer_operations_id_space_id_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_operations
    ADD CONSTRAINT transfer_operations_id_space_id_key UNIQUE (id, space_id);


--
-- Name: transfer_operations transfer_operations_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_operations
    ADD CONSTRAINT transfer_operations_pkey PRIMARY KEY (id);


--
-- Name: transfer_operations transfer_operations_space_id_idempotency_key_key; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_operations
    ADD CONSTRAINT transfer_operations_space_id_idempotency_key_key UNIQUE (space_id, idempotency_key);


--
-- Name: transfer_validations transfer_validation_results_pkey; Type: CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_validations
    ADD CONSTRAINT transfer_validation_results_pkey PRIMARY KEY (id);


--
-- Name: ProjectedNode ProjectedNode_pkey; Type: CONSTRAINT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection."ProjectedNode"
    ADD CONSTRAINT "ProjectedNode_pkey" PRIMARY KEY (id);


--
-- Name: _ag_label_edge _ag_label_edge_pkey; Type: CONSTRAINT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection._ag_label_edge
    ADD CONSTRAINT _ag_label_edge_pkey PRIMARY KEY (id);


--
-- Name: _ag_label_vertex _ag_label_vertex_pkey; Type: CONSTRAINT; Schema: new_design_projection; Owner: -
--

ALTER TABLE ONLY new_design_projection._ag_label_vertex
    ADD CONSTRAINT _ag_label_vertex_pkey PRIMARY KEY (id);


--
-- Name: ai_attempt_usage_task_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX ai_attempt_usage_task_idx ON new_design.ai_attempt_usage USING btree (task_id, created_at DESC);


--
-- Name: ai_task_attempts_failure_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX ai_task_attempts_failure_idx ON new_design.ai_task_attempts USING btree (error_category, ended_at DESC) WHERE (status = 'failed'::text);


--
-- Name: ai_task_steps_recovery_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX ai_task_steps_recovery_idx ON new_design.ai_task_steps USING btree (status, lease_expires_at) WHERE (status = 'running'::text);


--
-- Name: ai_tasks_book_status_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX ai_tasks_book_status_idx ON new_design.ai_tasks USING btree (book_id, status, created_at DESC, id);


--
-- Name: ai_tasks_space_status_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX ai_tasks_space_status_idx ON new_design.ai_tasks USING btree (space_id, status, created_at DESC, id);


--
-- Name: asset_mounts_active_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX asset_mounts_active_unique ON new_design.asset_links USING btree (book_id, owner_kind, owner_stable_id, owner_exact_version_id, role, asset_version_id) WHERE (status = 'active'::text);


--
-- Name: asset_mounts_asset_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX asset_mounts_asset_idx ON new_design.asset_links USING btree (book_id, asset_id, status, created_at DESC);


--
-- Name: asset_mounts_owner_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX asset_mounts_owner_idx ON new_design.asset_links USING btree (book_id, owner_kind, owner_stable_id, status, created_at DESC);


--
-- Name: asset_versions_asset_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX asset_versions_asset_idx ON new_design.asset_versions USING btree (asset_id, version DESC);


--
-- Name: background_job_attempts_job_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX background_job_attempts_job_idx ON new_design.background_job_attempts USING btree (job_id, attempt_number DESC);


--
-- Name: background_job_attempts_owner_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX background_job_attempts_owner_idx ON new_design.background_job_attempts USING btree (owner, status, heartbeat_at);


--
-- Name: background_jobs_book_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX background_jobs_book_idx ON new_design.background_jobs USING btree (book_id, status, created_at DESC, id);


--
-- Name: background_jobs_claim_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX background_jobs_claim_idx ON new_design.background_jobs USING btree (handler_key, status, priority DESC, next_run_at, created_at, id) WHERE (status = ANY (ARRAY['queued'::text, 'retry_scheduled'::text]));


--
-- Name: background_jobs_lease_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX background_jobs_lease_idx ON new_design.background_jobs USING btree (status, lease_until) WHERE (status = ANY (ARRAY['leased'::text, 'running'::text, 'cancel_requested'::text]));


--
-- Name: background_jobs_order_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX background_jobs_order_idx ON new_design.background_jobs USING btree (ordering_key, aggregate_sequence, status);


--
-- Name: card_action_owner_kind_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_action_owner_kind_idx ON new_design.card_version_actions USING btree (card_id, action_key, created_at, id);


--
-- Name: card_relations_character_pair_active_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX card_relations_character_pair_active_unique ON new_design.card_relations USING btree (space_id, relation_type_id, LEAST(source_card_id, target_card_id), GREATEST(source_card_id, target_card_id)) WHERE (status = 'active'::text);


--
-- Name: card_relations_source_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_relations_source_idx ON new_design.card_relations USING btree (source_card_id);


--
-- Name: card_relations_space_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_relations_space_idx ON new_design.card_relations USING btree (space_id, status);


--
-- Name: card_relations_target_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_relations_target_idx ON new_design.card_relations USING btree (target_card_id);


--
-- Name: card_type_versions_type_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_type_versions_type_idx ON new_design.card_type_versions USING btree (card_type_id, version DESC);


--
-- Name: card_types_category_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_types_category_idx ON new_design.card_types USING btree (category_id, sort_order);


--
-- Name: card_version_actions_card_recent; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_version_actions_card_recent ON new_design.card_version_actions USING btree (card_id, created_at DESC, id DESC);


--
-- Name: card_version_actions_request_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX card_version_actions_request_unique ON new_design.card_version_actions USING btree (request_key) WHERE (request_key IS NOT NULL);


--
-- Name: card_versions_author_request_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX card_versions_author_request_unique ON new_design.card_versions USING btree (author_book_id, author_request_key) WHERE (author_request_key IS NOT NULL);


--
-- Name: card_versions_card_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_versions_card_idx ON new_design.card_versions USING btree (card_id, revision DESC);


--
-- Name: card_versions_form_version_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX card_versions_form_version_idx ON new_design.card_versions USING btree (form_version_id) WHERE (form_version_id IS NOT NULL);


--
-- Name: cards_space_id_id_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX cards_space_id_id_unique ON new_design.cards USING btree (space_id, id);


--
-- Name: cards_type_status_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX cards_type_status_idx ON new_design.cards USING btree (card_type_id, status, updated_at DESC);


--
-- Name: chapter_body_adoptions_document_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX chapter_body_adoptions_document_idx ON new_design.chapter_body_adoptions USING btree (chapter_document_id, created_at DESC);


--
-- Name: chapter_body_versions_document_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX chapter_body_versions_document_idx ON new_design.chapter_body_versions USING btree (chapter_document_id, version DESC);


--
-- Name: chapter_body_versions_provenance_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX chapter_body_versions_provenance_idx ON new_design.chapter_body_versions USING btree (chapter_document_id, planning_version_id, context_manifest_id, created_at DESC);


--
-- Name: chapter_documents_book_order_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX chapter_documents_book_order_idx ON new_design.chapter_documents USING btree (book_id, logical_order);


--
-- Name: chapter_settlement_items_session_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX chapter_settlement_items_session_idx ON new_design.chapter_settlement_items USING btree (session_id, decision, risk_level, category, created_at, id);


--
-- Name: chapter_settlements_active_version_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX chapter_settlements_active_version_unique ON new_design.chapter_settlements USING btree (chapter_document_id, body_version_id) WHERE ((status = 'committed'::text) AND (supplement_base_checkpoint_id IS NULL));


--
-- Name: chapter_settlements_supplement_base_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX chapter_settlements_supplement_base_unique ON new_design.chapter_settlements USING btree (supplement_base_checkpoint_id) WHERE ((status = 'committed'::text) AND (supplement_base_checkpoint_id IS NOT NULL));


--
-- Name: context_manifests_book_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX context_manifests_book_idx ON new_design.context_manifests USING btree (book_id, created_at DESC);


--
-- Name: context_manifests_knowledge_request_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX context_manifests_knowledge_request_unique ON new_design.context_manifests USING btree (book_id, knowledge_request_key) WHERE (knowledge_request_key IS NOT NULL);


--
-- Name: context_manifests_snapshot_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX context_manifests_snapshot_idx ON new_design.context_manifests USING btree (book_id, finalized_at DESC, id DESC) WHERE (status = 'finalized'::text);


--
-- Name: dependency_edges_active_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX dependency_edges_active_unique ON new_design.dependency_edges USING btree (source_resource_id, derived_resource_id, dependency_kind) WHERE (status = 'active'::text);


--
-- Name: dependency_edges_downstream_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX dependency_edges_downstream_idx ON new_design.dependency_edges USING btree (book_id, source_resource_id, status, created_at DESC);


--
-- Name: dependency_edges_idempotency_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX dependency_edges_idempotency_unique ON new_design.dependency_edges USING btree (book_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: dependency_edges_upstream_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX dependency_edges_upstream_idx ON new_design.dependency_edges USING btree (book_id, derived_resource_id, status, created_at DESC);


--
-- Name: embedding_chunks_source_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX embedding_chunks_source_idx ON new_design.embedding_chunks USING btree (source_snapshot_id, status, ordinal);


--
-- Name: embedding_generations_active_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX embedding_generations_active_unique ON new_design.embedding_generations USING btree (book_id, profile_version_id) WHERE (status = 'active'::text);


--
-- Name: embedding_generations_book_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX embedding_generations_book_idx ON new_design.embedding_generations USING btree (book_id, profile_version_id, generation DESC);


--
-- Name: embedding_vectors_filter_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX embedding_vectors_filter_idx ON new_design.embedding_vectors USING btree (book_id, generation_id, status, source_kind);


--
-- Name: embedding_vectors_fts_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX embedding_vectors_fts_idx ON new_design.embedding_vectors USING gin (search_document);


--
-- Name: embedding_vectors_trgm_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX embedding_vectors_trgm_idx ON new_design.embedding_vectors USING gin (content_text public.gin_trgm_ops);


--
-- Name: field_definition_versions_history_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX field_definition_versions_history_idx ON new_design.field_definition_versions USING btree (field_definition_id, version DESC);


--
-- Name: field_definitions_card_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX field_definitions_card_idx ON new_design.field_definitions USING btree (card_id, status) WHERE (card_id IS NOT NULL);


--
-- Name: field_definitions_type_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX field_definitions_type_idx ON new_design.field_definitions USING btree (card_type_id, status, scope);


--
-- Name: graph_projection_generations_active_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX graph_projection_generations_active_unique ON new_design.graph_projection_runs USING btree (book_id) WHERE (status = 'active'::text);


--
-- Name: graph_projection_generations_book_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX graph_projection_generations_book_idx ON new_design.graph_projection_runs USING btree (book_id, generation DESC);


--
-- Name: image_original_reply; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX image_original_reply ON new_design.ai_task_events USING btree (attempt_id) WHERE (reason_code = 'image_generation_reply'::text);


--
-- Name: image_single_dispatch; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX image_single_dispatch ON new_design.ai_task_events USING btree (attempt_id) WHERE (reason_code = 'image_generation_sent'::text);


--
-- Name: kernel_card_type_version_owner; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX kernel_card_type_version_owner ON new_design.card_type_versions USING btree (id, card_type_id);


--
-- Name: kernel_record_logical_identity; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX kernel_record_logical_identity ON new_design.cards USING btree (space_id, card_type_id, (("values" ->> 'id'::text))) WHERE ("values" ? 'id'::text);


--
-- Name: knowledge_semantic_request_key; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX knowledge_semantic_request_key ON new_design.retrieval_runs USING btree (book_id, embedding_request_key) WHERE (embedding_request_key IS NOT NULL);


--
-- Name: model_route_configs_scope_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX model_route_configs_scope_unique ON new_design.model_route_configs USING btree (scope, task_group, task_key, node_key, book_id, override_key) NULLS NOT DISTINCT WHERE (status = 'active'::text);


--
-- Name: model_route_snapshots_book_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX model_route_snapshots_book_idx ON new_design.model_route_snapshots USING btree (book_id, created_at DESC);


--
-- Name: model_route_snapshots_managed_task_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX model_route_snapshots_managed_task_idx ON new_design.model_route_snapshots USING btree (managed_task_key, created_at DESC) WHERE (managed_task_key IS NOT NULL);


--
-- Name: model_route_versions_published_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX model_route_versions_published_unique ON new_design.model_route_versions USING btree (config_id) WHERE (status = 'published'::text);


--
-- Name: outbox_events_aggregate_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX outbox_events_aggregate_idx ON new_design.outbox_events USING btree (aggregate_kind, aggregate_id, aggregate_sequence);


--
-- Name: outbox_events_topic_order_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX outbox_events_topic_order_idx ON new_design.outbox_events USING btree (topic, recorded_at, id);


--
-- Name: outbox_inbox_consumer_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX outbox_inbox_consumer_idx ON new_design.outbox_inbox_receipts USING btree (consumer_key, received_at DESC, id);


--
-- Name: prompt_recipe_versions_published_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX prompt_recipe_versions_published_unique ON new_design.prompt_recipe_versions USING btree (recipe_id) WHERE (status = 'published'::text);


--
-- Name: publication_manifests_book_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX publication_manifests_book_idx ON new_design.publication_manifests USING btree (book_id, created_at DESC, id);


--
-- Name: record_card_logical_id_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX record_card_logical_id_idx ON new_design.cards USING btree (card_type_id, (("values" ->> 'id'::text)));


--
-- Name: record_card_type_current_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX record_card_type_current_idx ON new_design.cards USING btree (card_type_id, current_version_id) WHERE (status = 'active'::text);


--
-- Name: record_card_values_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX record_card_values_idx ON new_design.cards USING gin ("values" jsonb_path_ops);


--
-- Name: release_gate_assessments_latest_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX release_gate_assessments_latest_idx ON new_design.release_assessments USING btree (gate_key, assessed_at DESC, id);


--
-- Name: runtime_events_installation_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX runtime_events_installation_idx ON new_design.runtime_events USING btree (installation_id, created_at, id);


--
-- Name: runtime_health_installation_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX runtime_health_installation_idx ON new_design.runtime_snapshots USING btree (installation_id, checked_at, id);


--
-- Name: runtime_upgrade_status_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX runtime_upgrade_status_idx ON new_design.runtime_upgrade_plans USING btree (installation_id, status, created_at, id);


--
-- Name: semantic_results_run_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX semantic_results_run_idx ON new_design.retrieval_results USING btree (run_id, rank);


--
-- Name: semantic_runs_book_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX semantic_runs_book_idx ON new_design.retrieval_runs USING btree (book_id, created_at DESC, id);


--
-- Name: settlements_chapter_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX settlements_chapter_idx ON new_design.chapter_settlements USING btree (chapter_document_id, committed_at DESC);


--
-- Name: task_contract_versions_published_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX task_contract_versions_published_unique ON new_design.task_contract_versions USING btree (contract_id) WHERE (status = 'published'::text);


--
-- Name: task_contracts_task_key_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX task_contracts_task_key_idx ON new_design.task_contracts USING btree (task_key) WHERE (status = 'active'::text);


--
-- Name: text_anchor_body_subject_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX text_anchor_body_subject_idx ON new_design.text_anchors USING btree (book_id, body_version_id, subject_card_id) WHERE (body_version_id IS NOT NULL);


--
-- Name: text_anchors_subject_role_unique; Type: INDEX; Schema: new_design; Owner: -
--

CREATE UNIQUE INDEX text_anchors_subject_role_unique ON new_design.text_anchors USING btree (space_id, subject_card_id, role) WHERE (body_version_id IS NULL);


--
-- Name: transfer_conflicts_operation_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX transfer_conflicts_operation_idx ON new_design.transfer_conflicts USING btree (operation_id, status, created_at, id);


--
-- Name: transfer_entries_artifact_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX transfer_entries_artifact_idx ON new_design.transfer_entries USING btree (artifact_id, archive_path, id);


--
-- Name: transfer_events_operation_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX transfer_events_operation_idx ON new_design.transfer_events USING btree (operation_id, created_at, id);


--
-- Name: transfer_operations_book_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX transfer_operations_book_idx ON new_design.transfer_operations USING btree (book_id, created_at DESC, id) WHERE (book_id IS NOT NULL);


--
-- Name: transfer_operations_status_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX transfer_operations_status_idx ON new_design.transfer_operations USING btree (status, created_at, id);


--
-- Name: transfer_validation_operation_idx; Type: INDEX; Schema: new_design; Owner: -
--

CREATE INDEX transfer_validation_operation_idx ON new_design.transfer_validations USING btree (operation_id, created_at, id);


--
-- Name: PROJECTED_RELATION_end_id_idx; Type: INDEX; Schema: new_design_projection; Owner: -
--

CREATE INDEX "PROJECTED_RELATION_end_id_idx" ON new_design_projection."PROJECTED_RELATION" USING btree (end_id);


--
-- Name: PROJECTED_RELATION_start_id_idx; Type: INDEX; Schema: new_design_projection; Owner: -
--

CREATE INDEX "PROJECTED_RELATION_start_id_idx" ON new_design_projection."PROJECTED_RELATION" USING btree (start_id);


--
-- Name: _ag_label_edge_end_id_idx; Type: INDEX; Schema: new_design_projection; Owner: -
--

CREATE INDEX _ag_label_edge_end_id_idx ON new_design_projection._ag_label_edge USING btree (end_id);


--
-- Name: _ag_label_edge_start_id_idx; Type: INDEX; Schema: new_design_projection; Owner: -
--

CREATE INDEX _ag_label_edge_start_id_idx ON new_design_projection._ag_label_edge USING btree (start_id);


--
-- Name: ai_attempt_usage ai_attempt_usage_append_only; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER ai_attempt_usage_append_only BEFORE DELETE OR UPDATE ON new_design.ai_attempt_usage FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_ledger_append_only();


--
-- Name: ai_task_attempts ai_task_attempts_update_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER ai_task_attempts_update_guard BEFORE DELETE OR UPDATE ON new_design.ai_task_attempts FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_attempt_update();


--
-- Name: ai_task_events ai_task_state_events_append_only; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER ai_task_state_events_append_only BEFORE DELETE OR UPDATE ON new_design.ai_task_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_ledger_append_only();


--
-- Name: ai_task_steps ai_task_steps_transition_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER ai_task_steps_transition_guard BEFORE UPDATE ON new_design.ai_task_steps FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_step_transition();


--
-- Name: ai_tasks ai_tasks_transition_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER ai_tasks_transition_guard BEFORE UPDATE ON new_design.ai_tasks FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_task_transition();


--
-- Name: card_relation_versions card_relation_versions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER card_relation_versions_immutable BEFORE DELETE OR UPDATE ON new_design.card_relation_versions FOR EACH ROW EXECUTE FUNCTION new_design.kernel_reject_history_change();


--
-- Name: card_type_versions card_type_versions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER card_type_versions_immutable BEFORE DELETE OR UPDATE ON new_design.card_type_versions FOR EACH ROW EXECUTE FUNCTION new_design.kernel_reject_history_change();


--
-- Name: card_type_versions card_type_versions_register_fields; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER card_type_versions_register_fields AFTER INSERT ON new_design.card_type_versions FOR EACH ROW EXECUTE FUNCTION new_design.register_type_version_fields();


--
-- Name: card_version_actions card_version_actions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER card_version_actions_immutable BEFORE DELETE OR UPDATE ON new_design.card_version_actions FOR EACH ROW EXECUTE FUNCTION new_design.kernel_reject_history_change();


--
-- Name: card_versions card_versions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER card_versions_immutable BEFORE DELETE OR UPDATE ON new_design.card_versions FOR EACH ROW EXECUTE FUNCTION new_design.kernel_protect_card_version();


--
-- Name: chapter_body_versions chapter_body_versions_content_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER chapter_body_versions_content_guard BEFORE UPDATE ON new_design.chapter_body_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_chapter_body_version_content();


--
-- Name: context_manifest_items context_manifest_entries_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER context_manifest_entries_immutable BEFORE DELETE OR UPDATE ON new_design.context_manifest_items FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();


--
-- Name: context_manifests context_manifests_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER context_manifests_immutable BEFORE DELETE OR UPDATE ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();


--
-- Name: field_definition_versions field_definition_versions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER field_definition_versions_immutable BEFORE DELETE OR UPDATE ON new_design.field_definition_versions FOR EACH ROW EXECUTE FUNCTION new_design.kernel_reject_history_change();


--
-- Name: field_definitions field_definitions_owner_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER field_definitions_owner_guard BEFORE INSERT OR UPDATE ON new_design.field_definitions FOR EACH ROW EXECUTE FUNCTION new_design.guard_scoped_field_owner();


--
-- Name: model_route_snapshots model_route_snapshots_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER model_route_snapshots_immutable BEFORE DELETE OR UPDATE ON new_design.model_route_snapshots FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();


--
-- Name: model_route_versions model_route_versions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER model_route_versions_immutable BEFORE DELETE OR UPDATE ON new_design.model_route_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();


--
-- Name: ai_task_attempts native_ai_attempt_dependencies; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_ai_attempt_dependencies AFTER UPDATE OF status ON new_design.ai_task_attempts FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_dependency_creation();


--
-- Name: ai_tasks native_ai_task_outbox_bridge; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_ai_task_outbox_bridge AFTER INSERT ON new_design.ai_tasks FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_physical_request();


--
-- Name: asset_versions native_asset_dependency_bridge; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_asset_dependency_bridge AFTER INSERT ON new_design.asset_versions FOR EACH ROW EXECUTE FUNCTION new_design.bridge_asset_version_dependency();


--
-- Name: asset_events native_asset_events_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_asset_events_immutable BEFORE DELETE OR UPDATE ON new_design.asset_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: asset_links native_asset_link_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_asset_link_guard BEFORE DELETE OR UPDATE ON new_design.asset_links FOR EACH ROW EXECUTE FUNCTION new_design.guard_asset_mount_append_only();


--
-- Name: asset_links native_asset_link_scope; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_asset_link_scope BEFORE INSERT ON new_design.asset_links FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_asset_link();


--
-- Name: asset_versions native_asset_version_scope; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_asset_version_scope BEFORE INSERT ON new_design.asset_versions FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_asset_version();


--
-- Name: asset_versions native_asset_versions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_asset_versions_immutable BEFORE DELETE OR UPDATE ON new_design.asset_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: background_job_attempts native_attempt_update_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_attempt_update_guard BEFORE DELETE OR UPDATE ON new_design.background_job_attempts FOR EACH ROW EXECUTE FUNCTION new_design.guard_background_attempt_update();


--
-- Name: background_job_checkpoints native_background_job_checkpoints_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_background_job_checkpoints_immutable BEFORE DELETE OR UPDATE ON new_design.background_job_checkpoints FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: background_job_events native_background_job_events_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_background_job_events_immutable BEFORE DELETE OR UPDATE ON new_design.background_job_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: chapter_body_adoptions native_body_adoption_dependencies; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_body_adoption_dependencies AFTER INSERT ON new_design.chapter_body_adoptions FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_body_adoption();


--
-- Name: embedding_chunks native_chunk_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_chunk_immutable BEFORE DELETE OR UPDATE ON new_design.embedding_chunks FOR EACH ROW EXECUTE FUNCTION new_design.guard_embedding_chunk();


--
-- Name: embedding_chunks native_chunk_insert_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_chunk_insert_guard BEFORE INSERT ON new_design.embedding_chunks FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_embedding_chunk();


--
-- Name: asset_content_objects native_content_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_content_guard BEFORE UPDATE ON new_design.asset_content_objects FOR EACH ROW EXECUTE FUNCTION new_design.guard_asset_content_object();


--
-- Name: asset_content_objects native_content_no_delete; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_content_no_delete BEFORE DELETE ON new_design.asset_content_objects FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: context_manifest_items native_context_item_dependencies; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_context_item_dependencies AFTER INSERT ON new_design.context_manifest_items FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_dependency_creation();


--
-- Name: context_manifest_items native_context_item_scope; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_context_item_scope BEFORE INSERT ON new_design.context_manifest_items FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_context_item();


--
-- Name: context_manifests native_context_manifest_dependencies; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_context_manifest_dependencies AFTER INSERT ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_dependency_creation();


--
-- Name: context_manifests native_context_manifest_scope_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_context_manifest_scope_guard BEFORE INSERT ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_context_manifest();


--
-- Name: cards native_context_no_delete; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_context_no_delete BEFORE DELETE ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_context_delete();


--
-- Name: cards native_context_record_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_context_record_guard AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_context_record();


--
-- Name: dependency_edges native_dependency_edges_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_dependency_edges_guard BEFORE INSERT OR DELETE OR UPDATE ON new_design.dependency_edges FOR EACH ROW EXECUTE FUNCTION new_design.guard_dependency_edge();


--
-- Name: dependency_events native_dependency_events_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_dependency_events_immutable BEFORE DELETE OR UPDATE ON new_design.dependency_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: dependency_resources native_dependency_resources_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_dependency_resources_immutable BEFORE DELETE OR UPDATE ON new_design.dependency_resources FOR EACH ROW EXECUTE FUNCTION new_design.guard_dependency_resource_immutable();


--
-- Name: dependency_resources native_dependency_resources_validate; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_dependency_resources_validate BEFORE INSERT ON new_design.dependency_resources FOR EACH ROW EXECUTE FUNCTION new_design.validate_dependency_resource();


--
-- Name: embedding_generations native_embedding_generation_outbox_bridge; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_embedding_generation_outbox_bridge AFTER INSERT ON new_design.embedding_generations FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_physical_request();


--
-- Name: embedding_profiles native_embedding_profile_archive; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_embedding_profile_archive AFTER UPDATE OF status ON new_design.embedding_profiles FOR EACH ROW EXECUTE FUNCTION new_design.cascade_native_embedding_profile_archive();


--
-- Name: embedding_generations native_generation_insert_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_generation_insert_guard BEFORE INSERT ON new_design.embedding_generations FOR EACH ROW EXECUTE FUNCTION new_design.validate_embedding_generation();


--
-- Name: cards native_history_exact_sources; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_history_exact_sources AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_history_sources();


--
-- Name: background_job_checkpoints native_job_checkpoint_lease; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_job_checkpoint_lease BEFORE INSERT ON new_design.background_job_checkpoints FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_job_evidence();


--
-- Name: background_jobs native_job_reference_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_job_reference_guard BEFORE INSERT ON new_design.background_jobs FOR EACH ROW EXECUTE FUNCTION new_design.validate_background_job_reference();


--
-- Name: background_job_events native_job_result_lease; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_job_result_lease BEFORE INSERT ON new_design.background_job_events FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_job_evidence();


--
-- Name: background_jobs native_job_transition_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_job_transition_guard BEFORE DELETE OR UPDATE ON new_design.background_jobs FOR EACH ROW EXECUTE FUNCTION new_design.guard_background_job_transition();


--
-- Name: outbox_aggregate_sequences native_outbox_aggregate_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_outbox_aggregate_guard BEFORE DELETE OR UPDATE ON new_design.outbox_aggregate_sequences FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_aggregate_sequence();


--
-- Name: outbox_aggregate_sequences native_outbox_aggregate_scope; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_outbox_aggregate_scope BEFORE INSERT ON new_design.outbox_aggregate_sequences FOR EACH ROW EXECUTE FUNCTION new_design.validate_outbox_scope();


--
-- Name: outbox_consumers native_outbox_consumer_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_outbox_consumer_guard BEFORE DELETE OR UPDATE ON new_design.outbox_consumers FOR EACH ROW EXECUTE FUNCTION new_design.guard_consumer_update();


--
-- Name: outbox_events native_outbox_event_scope; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_outbox_event_scope BEFORE INSERT ON new_design.outbox_events FOR EACH ROW EXECUTE FUNCTION new_design.validate_outbox_scope();


--
-- Name: outbox_events native_outbox_events_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_outbox_events_immutable BEFORE DELETE OR UPDATE ON new_design.outbox_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: outbox_inbox_receipts native_outbox_inbox_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_outbox_inbox_guard BEFORE INSERT ON new_design.outbox_inbox_receipts FOR EACH ROW EXECUTE FUNCTION new_design.validate_outbox_inbox_receipt();


--
-- Name: outbox_inbox_receipts native_outbox_inbox_receipts_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_outbox_inbox_receipts_immutable BEFORE DELETE OR UPDATE ON new_design.outbox_inbox_receipts FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: card_version_actions native_professional_action_source; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_professional_action_source BEFORE INSERT ON new_design.card_version_actions FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_professional_action();


--
-- Name: context_manifests native_public_character_manifest_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_public_character_manifest_guard BEFORE INSERT ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_public_character_manifest();


--
-- Name: cards native_public_character_trial_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_public_character_trial_guard AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.native_guard_public_character_trial();


--
-- Name: context_manifests native_public_title_manifest_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_public_title_manifest_guard BEFORE INSERT ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_public_title_manifest();


--
-- Name: cards native_public_title_trial_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_public_title_trial_guard AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.native_guard_public_title_trial();


--
-- Name: publication_artifacts native_publication_artifact_scope; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_publication_artifact_scope BEFORE INSERT ON new_design.publication_artifacts FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_publication_artifact();


--
-- Name: publication_artifacts native_publication_artifacts_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_publication_artifacts_immutable BEFORE DELETE OR UPDATE ON new_design.publication_artifacts FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: publication_manifests native_publication_manifests_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_publication_manifests_immutable BEFORE DELETE OR UPDATE ON new_design.publication_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: publication_manifests native_publication_scope; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_publication_scope BEFORE INSERT ON new_design.publication_manifests FOR EACH ROW EXECUTE FUNCTION new_design.validate_publication_manifest();


--
-- Name: cards native_record_history_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_record_history_guard AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_record_history();


--
-- Name: cards native_record_request_bridge; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_record_request_bridge AFTER UPDATE OF current_version_id ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_request_card();


--
-- Name: retrieval_results native_retrieval_results_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_retrieval_results_immutable BEFORE DELETE OR UPDATE ON new_design.retrieval_results FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: retrieval_runs native_retrieval_vector_scope; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_retrieval_vector_scope BEFORE INSERT OR UPDATE ON new_design.retrieval_runs FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_retrieval_vector();


--
-- Name: model_route_snapshots native_route_snapshot_dependencies; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_route_snapshot_dependencies AFTER INSERT ON new_design.model_route_snapshots FOR EACH ROW EXECUTE FUNCTION new_design.bridge_native_dependency_creation();


--
-- Name: transfer_conflicts native_transfer_conflict_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_conflict_guard BEFORE DELETE OR UPDATE ON new_design.transfer_conflicts FOR EACH ROW EXECUTE FUNCTION new_design.guard_transfer_conflict_update();


--
-- Name: transfer_conflicts native_transfer_conflicts_active; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_conflicts_active BEFORE INSERT ON new_design.transfer_conflicts FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();


--
-- Name: transfer_entries native_transfer_entries_active; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_entries_active BEFORE INSERT ON new_design.transfer_entries FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();


--
-- Name: transfer_entries native_transfer_entries_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_entries_immutable BEFORE DELETE OR UPDATE ON new_design.transfer_entries FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: transfer_events native_transfer_events_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_events_immutable BEFORE DELETE OR UPDATE ON new_design.transfer_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: transfer_id_mappings native_transfer_id_mappings_active; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_id_mappings_active BEFORE INSERT ON new_design.transfer_id_mappings FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();


--
-- Name: transfer_id_mappings native_transfer_id_mappings_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_id_mappings_immutable BEFORE DELETE OR UPDATE ON new_design.transfer_id_mappings FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: transfer_manifests native_transfer_manifests_active; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_manifests_active BEFORE INSERT ON new_design.transfer_manifests FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();


--
-- Name: transfer_manifests native_transfer_manifests_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_manifests_immutable BEFORE DELETE OR UPDATE ON new_design.transfer_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: transfer_operations native_transfer_operation_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_operation_guard BEFORE DELETE OR UPDATE ON new_design.transfer_operations FOR EACH ROW EXECUTE FUNCTION new_design.guard_transfer_operation_update();


--
-- Name: transfer_operations native_transfer_outbox_bridge; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_outbox_bridge AFTER INSERT ON new_design.transfer_operations FOR EACH ROW EXECUTE FUNCTION new_design.bridge_transfer_operation_to_outbox();


--
-- Name: transfer_operations native_transfer_scope_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_scope_guard BEFORE INSERT ON new_design.transfer_operations FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_operation_scope();


--
-- Name: transfer_validations native_transfer_validations_active; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_validations_active BEFORE INSERT ON new_design.transfer_validations FOR EACH ROW EXECUTE FUNCTION new_design.validate_transfer_active_evidence();


--
-- Name: transfer_validations native_transfer_validations_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_transfer_validations_immutable BEFORE DELETE OR UPDATE ON new_design.transfer_validations FOR EACH ROW EXECUTE FUNCTION new_design.guard_outbox_append_only();


--
-- Name: embedding_vectors native_vector_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_vector_immutable BEFORE DELETE OR UPDATE ON new_design.embedding_vectors FOR EACH ROW EXECUTE FUNCTION new_design.guard_native_embedding_vector();


--
-- Name: embedding_vectors native_vector_insert_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER native_vector_insert_guard BEFORE INSERT ON new_design.embedding_vectors FOR EACH ROW EXECUTE FUNCTION new_design.validate_native_embedding_vector();


--
-- Name: prompt_recipe_versions prompt_recipe_versions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER prompt_recipe_versions_immutable BEFORE DELETE OR UPDATE ON new_design.prompt_recipe_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();


--
-- Name: chapter_documents quality_body_switch_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER quality_body_switch_guard AFTER UPDATE OF adopted_version_id ON new_design.chapter_documents FOR EACH ROW EXECUTE FUNCTION new_design.stale_quality_on_body_switch();


--
-- Name: cards quality_record_closure_required; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE CONSTRAINT TRIGGER quality_record_closure_required AFTER UPDATE ON new_design.cards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((old.current_version_id IS DISTINCT FROM new.current_version_id)) EXECUTE FUNCTION new_design.quality_deferred_record_closure();


--
-- Name: cards quality_record_head_changed; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER quality_record_head_changed AFTER UPDATE OF current_version_id, status ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.quality_record_head_changed();


--
-- Name: cards quality_record_removal_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER quality_record_removal_guard BEFORE DELETE OR UPDATE ON new_design.cards FOR EACH ROW EXECUTE FUNCTION new_design.quality_guard_card_removal();


--
-- Name: card_versions quality_record_version_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER quality_record_version_guard BEFORE INSERT ON new_design.card_versions FOR EACH ROW EXECUTE FUNCTION new_design.quality_guard_record_version();


--
-- Name: chapter_settlement_items resource_correction_candidate_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER resource_correction_candidate_guard BEFORE INSERT OR UPDATE ON new_design.chapter_settlement_items FOR EACH ROW EXECUTE FUNCTION new_design.block_unavailable_resource_correction_candidates();


--
-- Name: chapter_settlements resource_supplement_closure_required; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE CONSTRAINT TRIGGER resource_supplement_closure_required AFTER INSERT OR UPDATE ON new_design.chapter_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION new_design.require_resource_supplement_closure();


--
-- Name: chapter_settlement_items resource_supplement_item_scope_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER resource_supplement_item_scope_guard BEFORE INSERT OR UPDATE ON new_design.chapter_settlement_items FOR EACH ROW EXECUTE FUNCTION new_design.guard_resource_supplement_item_scope();


--
-- Name: chapter_settlements resource_supplement_settlement_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER resource_supplement_settlement_guard BEFORE INSERT OR UPDATE ON new_design.chapter_settlements FOR EACH ROW EXECUTE FUNCTION new_design.validate_resource_supplement_settlement();


--
-- Name: card_versions structure_record_history_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER structure_record_history_guard BEFORE INSERT ON new_design.card_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_structure_record_history();


--
-- Name: cards structure_record_scope_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE CONSTRAINT TRIGGER structure_record_scope_guard AFTER INSERT OR UPDATE ON new_design.cards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION new_design.guard_structure_record_scope();


--
-- Name: task_contract_versions task_contract_versions_immutable; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER task_contract_versions_immutable BEFORE DELETE OR UPDATE ON new_design.task_contract_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();


--
-- Name: text_anchors text_anchors_scope_guard; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER text_anchors_scope_guard BEFORE INSERT OR UPDATE ON new_design.text_anchors FOR EACH ROW EXECUTE FUNCTION new_design.kernel_validate_text_anchor();


--
-- Name: card_types world_card_type_specification_stale; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER world_card_type_specification_stale AFTER UPDATE ON new_design.card_types FOR EACH ROW EXECUTE FUNCTION new_design.stale_world_quality_specification();


--
-- Name: field_definitions world_field_specification_stale; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER world_field_specification_stale AFTER INSERT OR UPDATE ON new_design.field_definitions FOR EACH ROW EXECUTE FUNCTION new_design.stale_world_quality_specification();


--
-- Name: card_relations world_relation_source_stale; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER world_relation_source_stale AFTER UPDATE OF current_version_id, status ON new_design.card_relations FOR EACH ROW EXECUTE FUNCTION new_design.stale_world_quality_material();


--
-- Name: relation_types world_relation_type_specification_stale; Type: TRIGGER; Schema: new_design; Owner: -
--

CREATE TRIGGER world_relation_type_specification_stale AFTER UPDATE ON new_design.relation_types FOR EACH ROW EXECUTE FUNCTION new_design.stale_world_quality_specification();


--
-- Name: ai_attempt_usage ai_attempt_usage_attempt_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_attempt_usage
    ADD CONSTRAINT ai_attempt_usage_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES new_design.ai_task_attempts(id) ON DELETE CASCADE;


--
-- Name: ai_attempt_usage ai_attempt_usage_step_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_attempt_usage
    ADD CONSTRAINT ai_attempt_usage_step_id_fkey FOREIGN KEY (step_id) REFERENCES new_design.ai_task_steps(id) ON DELETE CASCADE;


--
-- Name: ai_attempt_usage ai_attempt_usage_task_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_attempt_usage
    ADD CONSTRAINT ai_attempt_usage_task_id_fkey FOREIGN KEY (task_id) REFERENCES new_design.ai_tasks(id) ON DELETE CASCADE;


--
-- Name: ai_task_attempts ai_task_attempts_context_manifest_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_attempts
    ADD CONSTRAINT ai_task_attempts_context_manifest_id_fkey FOREIGN KEY (context_manifest_id) REFERENCES new_design.context_manifests(id);


--
-- Name: ai_task_attempts ai_task_attempts_model_route_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_attempts
    ADD CONSTRAINT ai_task_attempts_model_route_snapshot_id_fkey FOREIGN KEY (model_route_snapshot_id) REFERENCES new_design.model_route_snapshots(id);


--
-- Name: ai_task_attempts ai_task_attempts_prompt_recipe_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_attempts
    ADD CONSTRAINT ai_task_attempts_prompt_recipe_version_id_fkey FOREIGN KEY (prompt_recipe_version_id) REFERENCES new_design.prompt_recipe_versions(id);


--
-- Name: ai_task_attempts ai_task_attempts_step_id_task_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_attempts
    ADD CONSTRAINT ai_task_attempts_step_id_task_id_fkey FOREIGN KEY (step_id, task_id) REFERENCES new_design.ai_task_steps(id, task_id) ON DELETE CASCADE;


--
-- Name: ai_task_attempts ai_task_attempts_task_contract_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_attempts
    ADD CONSTRAINT ai_task_attempts_task_contract_version_id_fkey FOREIGN KEY (task_contract_version_id) REFERENCES new_design.task_contract_versions(id);


--
-- Name: ai_task_events ai_task_state_events_attempt_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_events
    ADD CONSTRAINT ai_task_state_events_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES new_design.ai_task_attempts(id) ON DELETE CASCADE;


--
-- Name: ai_task_events ai_task_state_events_step_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_events
    ADD CONSTRAINT ai_task_state_events_step_id_fkey FOREIGN KEY (step_id) REFERENCES new_design.ai_task_steps(id) ON DELETE CASCADE;


--
-- Name: ai_task_events ai_task_state_events_task_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_events
    ADD CONSTRAINT ai_task_state_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES new_design.ai_tasks(id) ON DELETE CASCADE;


--
-- Name: ai_task_steps ai_task_steps_current_attempt_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_steps
    ADD CONSTRAINT ai_task_steps_current_attempt_fk FOREIGN KEY (current_attempt_id, id) REFERENCES new_design.ai_task_attempts(id, step_id);


--
-- Name: ai_task_steps ai_task_steps_task_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_task_steps
    ADD CONSTRAINT ai_task_steps_task_id_fkey FOREIGN KEY (task_id) REFERENCES new_design.ai_tasks(id) ON DELETE CASCADE;


--
-- Name: ai_tasks ai_tasks_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_tasks
    ADD CONSTRAINT ai_tasks_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: ai_tasks ai_tasks_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_tasks
    ADD CONSTRAINT ai_tasks_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: ai_tasks ai_tasks_task_contract_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.ai_tasks
    ADD CONSTRAINT ai_tasks_task_contract_version_id_fkey FOREIGN KEY (task_contract_version_id) REFERENCES new_design.task_contract_versions(id);


--
-- Name: asset_events asset_events_asset_version_id_asset_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_events
    ADD CONSTRAINT asset_events_asset_version_id_asset_id_fkey FOREIGN KEY (asset_version_id, asset_id) REFERENCES new_design.asset_versions(id, asset_id);


--
-- Name: asset_events asset_events_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_events
    ADD CONSTRAINT asset_events_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: asset_links asset_mounts_asset_version_id_asset_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_links
    ADD CONSTRAINT asset_mounts_asset_version_id_asset_id_fkey FOREIGN KEY (asset_version_id, asset_id) REFERENCES new_design.asset_versions(id, asset_id);


--
-- Name: asset_links asset_mounts_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_links
    ADD CONSTRAINT asset_mounts_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: asset_versions asset_versions_base_version_id_asset_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_versions
    ADD CONSTRAINT asset_versions_base_version_id_asset_id_fkey FOREIGN KEY (base_version_id, asset_id) REFERENCES new_design.asset_versions(id, asset_id);


--
-- Name: asset_versions asset_versions_content_object_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_versions
    ADD CONSTRAINT asset_versions_content_object_id_fkey FOREIGN KEY (content_object_id) REFERENCES new_design.asset_content_objects(id);


--
-- Name: asset_versions asset_versions_derived_from_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_versions
    ADD CONSTRAINT asset_versions_derived_from_version_id_fkey FOREIGN KEY (derived_from_version_id) REFERENCES new_design.asset_versions(id);


--
-- Name: asset_versions asset_versions_source_resource_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.asset_versions
    ADD CONSTRAINT asset_versions_source_resource_id_fkey FOREIGN KEY (source_resource_id) REFERENCES new_design.dependency_resources(id);


--
-- Name: background_job_attempts background_job_attempts_consumer_key_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_attempts
    ADD CONSTRAINT background_job_attempts_consumer_key_fkey FOREIGN KEY (consumer_key) REFERENCES new_design.outbox_consumers(consumer_key);


--
-- Name: background_job_attempts background_job_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_attempts
    ADD CONSTRAINT background_job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES new_design.background_jobs(id);


--
-- Name: background_job_checkpoints background_job_checkpoints_attempt_id_job_id_fencing_token_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_checkpoints
    ADD CONSTRAINT background_job_checkpoints_attempt_id_job_id_fencing_token_fkey FOREIGN KEY (attempt_id, job_id, fencing_token) REFERENCES new_design.background_job_attempts(id, job_id, fencing_token);


--
-- Name: background_job_checkpoints background_job_checkpoints_job_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_checkpoints
    ADD CONSTRAINT background_job_checkpoints_job_id_fkey FOREIGN KEY (job_id) REFERENCES new_design.background_jobs(id);


--
-- Name: background_job_events background_job_results_attempt_id_job_id_fencing_token_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_events
    ADD CONSTRAINT background_job_results_attempt_id_job_id_fencing_token_fkey FOREIGN KEY (attempt_id, job_id, fencing_token) REFERENCES new_design.background_job_attempts(id, job_id, fencing_token);


--
-- Name: background_job_events background_job_results_job_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_job_events
    ADD CONSTRAINT background_job_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES new_design.background_jobs(id);


--
-- Name: background_jobs background_jobs_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_jobs
    ADD CONSTRAINT background_jobs_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: background_jobs background_jobs_current_attempt_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_jobs
    ADD CONSTRAINT background_jobs_current_attempt_fk FOREIGN KEY (current_attempt_id, id, fencing_token) REFERENCES new_design.background_job_attempts(id, job_id, fencing_token);


--
-- Name: background_jobs background_jobs_outbox_event_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_jobs
    ADD CONSTRAINT background_jobs_outbox_event_id_fkey FOREIGN KEY (outbox_event_id) REFERENCES new_design.outbox_events(id);


--
-- Name: background_jobs background_jobs_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.background_jobs
    ADD CONSTRAINT background_jobs_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: books books_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.books
    ADD CONSTRAINT books_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: card_relation_versions card_relation_versions_card_relation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relation_versions
    ADD CONSTRAINT card_relation_versions_card_relation_id_fkey FOREIGN KEY (card_relation_id) REFERENCES new_design.card_relations(id);


--
-- Name: card_relation_versions card_relation_versions_source_card_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relation_versions
    ADD CONSTRAINT card_relation_versions_source_card_version_id_fkey FOREIGN KEY (source_card_version_id) REFERENCES new_design.card_versions(id);


--
-- Name: card_relation_versions card_relation_versions_target_card_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relation_versions
    ADD CONSTRAINT card_relation_versions_target_card_version_id_fkey FOREIGN KEY (target_card_version_id) REFERENCES new_design.card_versions(id);


--
-- Name: card_relations card_relations_current_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relations
    ADD CONSTRAINT card_relations_current_version_fk FOREIGN KEY (current_version_id) REFERENCES new_design.card_relation_versions(id);


--
-- Name: card_relations card_relations_relation_type_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relations
    ADD CONSTRAINT card_relations_relation_type_id_fkey FOREIGN KEY (relation_type_id) REFERENCES new_design.relation_types(id);


--
-- Name: card_relations card_relations_source_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relations
    ADD CONSTRAINT card_relations_source_card_id_fkey FOREIGN KEY (source_card_id) REFERENCES new_design.cards(id);


--
-- Name: card_relations card_relations_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relations
    ADD CONSTRAINT card_relations_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: card_relations card_relations_target_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_relations
    ADD CONSTRAINT card_relations_target_card_id_fkey FOREIGN KEY (target_card_id) REFERENCES new_design.cards(id);


--
-- Name: card_type_versions card_type_versions_card_type_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_type_versions
    ADD CONSTRAINT card_type_versions_card_type_id_fkey FOREIGN KEY (card_type_id) REFERENCES new_design.card_types(id);


--
-- Name: card_types card_types_current_version_owner_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_types
    ADD CONSTRAINT card_types_current_version_owner_fk FOREIGN KEY (current_version_id, id) REFERENCES new_design.card_type_versions(id, card_type_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: card_types card_types_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_types
    ADD CONSTRAINT card_types_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: card_version_actions card_version_actions_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_version_actions
    ADD CONSTRAINT card_version_actions_card_id_fkey FOREIGN KEY (card_id) REFERENCES new_design.cards(id);


--
-- Name: card_version_actions card_version_actions_card_version_id_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_version_actions
    ADD CONSTRAINT card_version_actions_card_version_id_card_id_fkey FOREIGN KEY (card_version_id, card_id) REFERENCES new_design.card_versions(id, card_id);


--
-- Name: card_versions card_versions_author_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_versions
    ADD CONSTRAINT card_versions_author_book_id_fkey FOREIGN KEY (author_book_id) REFERENCES new_design.books(id);


--
-- Name: card_versions card_versions_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_versions
    ADD CONSTRAINT card_versions_card_id_fkey FOREIGN KEY (card_id) REFERENCES new_design.cards(id);


--
-- Name: card_versions card_versions_type_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.card_versions
    ADD CONSTRAINT card_versions_type_version_id_fkey FOREIGN KEY (type_version_id) REFERENCES new_design.card_type_versions(id);


--
-- Name: cards cards_card_type_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.cards
    ADD CONSTRAINT cards_card_type_id_fkey FOREIGN KEY (card_type_id) REFERENCES new_design.card_types(id);


--
-- Name: cards cards_current_version_owner_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.cards
    ADD CONSTRAINT cards_current_version_owner_fk FOREIGN KEY (current_version_id, id) REFERENCES new_design.card_versions(id, card_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: cards cards_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.cards
    ADD CONSTRAINT cards_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: cards cards_type_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.cards
    ADD CONSTRAINT cards_type_version_id_fkey FOREIGN KEY (type_version_id) REFERENCES new_design.card_type_versions(id);


--
-- Name: cards cards_type_version_owner_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.cards
    ADD CONSTRAINT cards_type_version_owner_fk FOREIGN KEY (type_version_id, card_type_id) REFERENCES new_design.card_type_versions(id, card_type_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: chapter_body_adoptions chapter_body_adoptions_chapter_document_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_adoptions
    ADD CONSTRAINT chapter_body_adoptions_chapter_document_id_fkey FOREIGN KEY (chapter_document_id) REFERENCES new_design.chapter_documents(id) ON DELETE CASCADE;


--
-- Name: chapter_body_adoptions chapter_body_adoptions_from_version_id_chapter_document_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_adoptions
    ADD CONSTRAINT chapter_body_adoptions_from_version_id_chapter_document_id_fkey FOREIGN KEY (from_version_id, chapter_document_id) REFERENCES new_design.chapter_body_versions(id, chapter_document_id);


--
-- Name: chapter_body_adoptions chapter_body_adoptions_to_version_id_chapter_document_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_adoptions
    ADD CONSTRAINT chapter_body_adoptions_to_version_id_chapter_document_id_fkey FOREIGN KEY (to_version_id, chapter_document_id) REFERENCES new_design.chapter_body_versions(id, chapter_document_id);


--
-- Name: chapter_body_versions chapter_body_versions_ai_attempt_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_ai_attempt_id_fkey FOREIGN KEY (ai_attempt_id) REFERENCES new_design.ai_task_attempts(id);


--
-- Name: chapter_body_versions chapter_body_versions_ai_task_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_ai_task_id_fkey FOREIGN KEY (ai_task_id) REFERENCES new_design.ai_tasks(id);


--
-- Name: chapter_body_versions chapter_body_versions_base_version_id_chapter_document_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_base_version_id_chapter_document_id_fkey FOREIGN KEY (base_version_id, chapter_document_id) REFERENCES new_design.chapter_body_versions(id, chapter_document_id);


--
-- Name: chapter_body_versions chapter_body_versions_chapter_document_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_chapter_document_id_fkey FOREIGN KEY (chapter_document_id) REFERENCES new_design.chapter_documents(id) ON DELETE CASCADE;


--
-- Name: chapter_body_versions chapter_body_versions_context_manifest_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_context_manifest_id_fkey FOREIGN KEY (context_manifest_id) REFERENCES new_design.context_manifests(id);


--
-- Name: chapter_body_versions chapter_body_versions_input_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_input_fk FOREIGN KEY (input_body_version_id, chapter_document_id) REFERENCES new_design.chapter_body_versions(id, chapter_document_id);


--
-- Name: chapter_body_versions chapter_body_versions_model_route_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_model_route_snapshot_id_fkey FOREIGN KEY (model_route_snapshot_id) REFERENCES new_design.model_route_snapshots(id);


--
-- Name: chapter_body_versions chapter_body_versions_parent_version_id_chapter_document_i_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_parent_version_id_chapter_document_i_fkey FOREIGN KEY (parent_version_id, chapter_document_id) REFERENCES new_design.chapter_body_versions(id, chapter_document_id);


--
-- Name: chapter_body_versions chapter_body_versions_prompt_recipe_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_prompt_recipe_version_id_fkey FOREIGN KEY (prompt_recipe_version_id) REFERENCES new_design.prompt_recipe_versions(id);


--
-- Name: chapter_body_versions chapter_body_versions_task_contract_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_body_versions
    ADD CONSTRAINT chapter_body_versions_task_contract_version_id_fkey FOREIGN KEY (task_contract_version_id) REFERENCES new_design.task_contract_versions(id);


--
-- Name: chapter_documents chapter_documents_adopted_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_documents
    ADD CONSTRAINT chapter_documents_adopted_version_fk FOREIGN KEY (adopted_version_id, id) REFERENCES new_design.chapter_body_versions(id, chapter_document_id);


--
-- Name: chapter_documents chapter_documents_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_documents
    ADD CONSTRAINT chapter_documents_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: chapter_documents chapter_documents_chapter_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_documents
    ADD CONSTRAINT chapter_documents_chapter_card_id_fkey FOREIGN KEY (chapter_card_id) REFERENCES new_design.cards(id);


--
-- Name: chapter_settlement_items chapter_settlement_items_source_attempt_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlement_items
    ADD CONSTRAINT chapter_settlement_items_source_attempt_id_fkey FOREIGN KEY (source_attempt_id) REFERENCES new_design.ai_task_attempts(id);


--
-- Name: chapter_settlement_items chapter_settlement_items_source_task_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlement_items
    ADD CONSTRAINT chapter_settlement_items_source_task_id_fkey FOREIGN KEY (source_task_id) REFERENCES new_design.ai_tasks(id);


--
-- Name: chapter_settlements chapter_settlements_body_version_id_chapter_document_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlements
    ADD CONSTRAINT chapter_settlements_body_version_id_chapter_document_id_fkey FOREIGN KEY (body_version_id, chapter_document_id) REFERENCES new_design.chapter_body_versions(id, chapter_document_id);


--
-- Name: chapter_settlements chapter_settlements_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlements
    ADD CONSTRAINT chapter_settlements_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: chapter_settlements chapter_settlements_chapter_document_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.chapter_settlements
    ADD CONSTRAINT chapter_settlements_chapter_document_id_fkey FOREIGN KEY (chapter_document_id) REFERENCES new_design.chapter_documents(id) ON DELETE CASCADE;


--
-- Name: context_manifests context_manifests_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifests
    ADD CONSTRAINT context_manifests_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: context_manifests context_manifests_model_route_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifests
    ADD CONSTRAINT context_manifests_model_route_snapshot_id_fkey FOREIGN KEY (model_route_snapshot_id) REFERENCES new_design.model_route_snapshots(id);


--
-- Name: context_manifests context_manifests_prompt_recipe_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifests
    ADD CONSTRAINT context_manifests_prompt_recipe_version_id_fkey FOREIGN KEY (prompt_recipe_version_id) REFERENCES new_design.prompt_recipe_versions(id);


--
-- Name: context_manifests context_manifests_public_character_scope_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifests
    ADD CONSTRAINT context_manifests_public_character_scope_fkey FOREIGN KEY (public_character_scope) REFERENCES new_design.cards(id);


--
-- Name: context_manifests context_manifests_public_title_scope_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifests
    ADD CONSTRAINT context_manifests_public_title_scope_fkey FOREIGN KEY (public_title_scope) REFERENCES new_design.cards(id);


--
-- Name: context_manifests context_manifests_task_contract_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.context_manifests
    ADD CONSTRAINT context_manifests_task_contract_version_id_fkey FOREIGN KEY (task_contract_version_id) REFERENCES new_design.task_contract_versions(id);


--
-- Name: dependency_edges dependency_edges_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_edges
    ADD CONSTRAINT dependency_edges_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: dependency_edges dependency_edges_derived_resource_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_edges
    ADD CONSTRAINT dependency_edges_derived_resource_id_fkey FOREIGN KEY (derived_resource_id) REFERENCES new_design.dependency_resources(id);


--
-- Name: dependency_edges dependency_edges_source_resource_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_edges
    ADD CONSTRAINT dependency_edges_source_resource_id_fkey FOREIGN KEY (source_resource_id) REFERENCES new_design.dependency_resources(id);


--
-- Name: dependency_edges dependency_edges_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_edges
    ADD CONSTRAINT dependency_edges_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: dependency_resources dependency_resources_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_resources
    ADD CONSTRAINT dependency_resources_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: dependency_resources dependency_resources_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_resources
    ADD CONSTRAINT dependency_resources_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: dependency_events dependency_state_events_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_events
    ADD CONSTRAINT dependency_state_events_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: dependency_events dependency_state_events_resource_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.dependency_events
    ADD CONSTRAINT dependency_state_events_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES new_design.dependency_resources(id);


--
-- Name: embedding_chunks embedding_chunks_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_chunks
    ADD CONSTRAINT embedding_chunks_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: embedding_generations embedding_index_generations_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_generations
    ADD CONSTRAINT embedding_index_generations_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: embedding_vectors embedding_vectors_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_vectors
    ADD CONSTRAINT embedding_vectors_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: embedding_vectors embedding_vectors_chunk_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_vectors
    ADD CONSTRAINT embedding_vectors_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES new_design.embedding_chunks(id);


--
-- Name: embedding_vectors embedding_vectors_generation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.embedding_vectors
    ADD CONSTRAINT embedding_vectors_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES new_design.embedding_generations(id);


--
-- Name: field_definition_versions field_definition_versions_field_definition_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definition_versions
    ADD CONSTRAINT field_definition_versions_field_definition_id_fkey FOREIGN KEY (field_definition_id) REFERENCES new_design.field_definitions(id);


--
-- Name: field_definitions field_definitions_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definitions
    ADD CONSTRAINT field_definitions_card_id_fkey FOREIGN KEY (card_id) REFERENCES new_design.cards(id);


--
-- Name: field_definitions field_definitions_card_type_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definitions
    ADD CONSTRAINT field_definitions_card_type_id_fkey FOREIGN KEY (card_type_id) REFERENCES new_design.card_types(id);


--
-- Name: field_definitions field_definitions_current_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definitions
    ADD CONSTRAINT field_definitions_current_version_fk FOREIGN KEY (current_version_id) REFERENCES new_design.field_definition_versions(id);


--
-- Name: field_definitions field_definitions_source_type_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definitions
    ADD CONSTRAINT field_definitions_source_type_version_id_fkey FOREIGN KEY (source_type_version_id) REFERENCES new_design.card_type_versions(id);


--
-- Name: field_definitions field_definitions_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.field_definitions
    ADD CONSTRAINT field_definitions_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: graph_projection_runs graph_projection_generations_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.graph_projection_runs
    ADD CONSTRAINT graph_projection_generations_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: media_job_attempts media_job_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_job_attempts
    ADD CONSTRAINT media_job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES new_design.media_jobs(id);


--
-- Name: media_jobs media_jobs_subject_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_jobs
    ADD CONSTRAINT media_jobs_subject_card_id_fkey FOREIGN KEY (subject_card_id) REFERENCES new_design.cards(id);


--
-- Name: media_outputs media_outputs_asset_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_outputs
    ADD CONSTRAINT media_outputs_asset_version_id_fkey FOREIGN KEY (asset_version_id) REFERENCES new_design.asset_versions(id);


--
-- Name: media_outputs media_outputs_attempt_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_outputs
    ADD CONSTRAINT media_outputs_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES new_design.media_job_attempts(id);


--
-- Name: media_outputs media_outputs_job_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.media_outputs
    ADD CONSTRAINT media_outputs_job_id_fkey FOREIGN KEY (job_id) REFERENCES new_design.media_jobs(id);


--
-- Name: model_route_configs model_route_configs_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_configs
    ADD CONSTRAINT model_route_configs_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: model_route_configs model_route_configs_current_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_configs
    ADD CONSTRAINT model_route_configs_current_version_fk FOREIGN KEY (current_version_id, id) REFERENCES new_design.model_route_versions(id, config_id);


--
-- Name: model_route_configs model_route_configs_published_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_configs
    ADD CONSTRAINT model_route_configs_published_version_fk FOREIGN KEY (published_version_id, id) REFERENCES new_design.model_route_versions(id, config_id);


--
-- Name: model_route_snapshots model_route_snapshots_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_snapshots
    ADD CONSTRAINT model_route_snapshots_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: model_route_snapshots model_route_snapshots_credential_ref_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_snapshots
    ADD CONSTRAINT model_route_snapshots_credential_ref_id_fkey FOREIGN KEY (credential_ref_id) REFERENCES new_design.model_credential_refs(id);


--
-- Name: model_route_snapshots model_route_snapshots_task_contract_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_snapshots
    ADD CONSTRAINT model_route_snapshots_task_contract_version_id_fkey FOREIGN KEY (task_contract_version_id) REFERENCES new_design.task_contract_versions(id);


--
-- Name: model_route_versions model_route_versions_base_version_id_config_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_versions
    ADD CONSTRAINT model_route_versions_base_version_id_config_id_fkey FOREIGN KEY (base_version_id, config_id) REFERENCES new_design.model_route_versions(id, config_id);


--
-- Name: model_route_versions model_route_versions_config_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_versions
    ADD CONSTRAINT model_route_versions_config_id_fkey FOREIGN KEY (config_id) REFERENCES new_design.model_route_configs(id) ON DELETE CASCADE;


--
-- Name: model_route_versions model_route_versions_credential_ref_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.model_route_versions
    ADD CONSTRAINT model_route_versions_credential_ref_id_fkey FOREIGN KEY (credential_ref_id) REFERENCES new_design.model_credential_refs(id);


--
-- Name: outbox_aggregate_sequences outbox_aggregate_sequences_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_aggregate_sequences
    ADD CONSTRAINT outbox_aggregate_sequences_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: outbox_aggregate_sequences outbox_aggregate_sequences_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_aggregate_sequences
    ADD CONSTRAINT outbox_aggregate_sequences_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: outbox_events outbox_events_aggregate_kind_aggregate_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_events
    ADD CONSTRAINT outbox_events_aggregate_kind_aggregate_id_fkey FOREIGN KEY (aggregate_kind, aggregate_id) REFERENCES new_design.outbox_aggregate_sequences(aggregate_kind, aggregate_id);


--
-- Name: outbox_events outbox_events_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_events
    ADD CONSTRAINT outbox_events_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: outbox_events outbox_events_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_events
    ADD CONSTRAINT outbox_events_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: outbox_inbox_receipts outbox_inbox_receipts_attempt_id_job_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_inbox_receipts
    ADD CONSTRAINT outbox_inbox_receipts_attempt_id_job_id_fkey FOREIGN KEY (attempt_id, job_id) REFERENCES new_design.background_job_attempts(id, job_id);


--
-- Name: outbox_inbox_receipts outbox_inbox_receipts_consumer_key_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_inbox_receipts
    ADD CONSTRAINT outbox_inbox_receipts_consumer_key_fkey FOREIGN KEY (consumer_key) REFERENCES new_design.outbox_consumers(consumer_key);


--
-- Name: outbox_inbox_receipts outbox_inbox_receipts_job_id_event_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_inbox_receipts
    ADD CONSTRAINT outbox_inbox_receipts_job_id_event_id_fkey FOREIGN KEY (job_id, event_id) REFERENCES new_design.background_jobs(id, outbox_event_id);


--
-- Name: outbox_inbox_receipts outbox_inbox_receipts_result_id_job_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.outbox_inbox_receipts
    ADD CONSTRAINT outbox_inbox_receipts_result_id_job_id_fkey FOREIGN KEY (result_id, job_id) REFERENCES new_design.background_job_events(id, job_id);


--
-- Name: prompt_recipe_versions prompt_recipe_versions_base_version_id_recipe_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipe_versions
    ADD CONSTRAINT prompt_recipe_versions_base_version_id_recipe_id_fkey FOREIGN KEY (base_version_id, recipe_id) REFERENCES new_design.prompt_recipe_versions(id, recipe_id);


--
-- Name: prompt_recipe_versions prompt_recipe_versions_recipe_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipe_versions
    ADD CONSTRAINT prompt_recipe_versions_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES new_design.prompt_recipes(id) ON DELETE CASCADE;


--
-- Name: prompt_recipes prompt_recipes_current_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipes
    ADD CONSTRAINT prompt_recipes_current_version_fk FOREIGN KEY (current_version_id, id) REFERENCES new_design.prompt_recipe_versions(id, recipe_id);


--
-- Name: prompt_recipes prompt_recipes_published_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.prompt_recipes
    ADD CONSTRAINT prompt_recipes_published_version_fk FOREIGN KEY (published_version_id, id) REFERENCES new_design.prompt_recipe_versions(id, recipe_id);


--
-- Name: publication_artifacts publication_export_artifacts_manifest_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.publication_artifacts
    ADD CONSTRAINT publication_export_artifacts_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES new_design.publication_manifests(id);


--
-- Name: publication_manifests publication_export_manifests_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.publication_manifests
    ADD CONSTRAINT publication_export_manifests_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: relation_types relation_types_owner_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.relation_types
    ADD CONSTRAINT relation_types_owner_space_id_fkey FOREIGN KEY (owner_space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: release_assessments release_gate_assessments_gate_key_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.release_assessments
    ADD CONSTRAINT release_gate_assessments_gate_key_fkey FOREIGN KEY (gate_key) REFERENCES new_design.release_definitions(gate_key);


--
-- Name: research_document_versions research_document_versions_document_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.research_document_versions
    ADD CONSTRAINT research_document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES new_design.research_documents(id) ON DELETE CASCADE;


--
-- Name: research_documents research_documents_current_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.research_documents
    ADD CONSTRAINT research_documents_current_version_fk FOREIGN KEY (current_version_id) REFERENCES new_design.research_document_versions(id);


--
-- Name: runtime_snapshots runtime_health_snapshots_installation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_snapshots
    ADD CONSTRAINT runtime_health_snapshots_installation_id_fkey FOREIGN KEY (installation_id) REFERENCES new_design.runtime_installations(installation_id);


--
-- Name: runtime_events runtime_lifecycle_events_installation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_events
    ADD CONSTRAINT runtime_lifecycle_events_installation_id_fkey FOREIGN KEY (installation_id) REFERENCES new_design.runtime_installations(installation_id);


--
-- Name: runtime_upgrade_plans runtime_upgrade_plans_backup_operation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_upgrade_plans
    ADD CONSTRAINT runtime_upgrade_plans_backup_operation_id_fkey FOREIGN KEY (backup_operation_id) REFERENCES new_design.transfer_operations(id);


--
-- Name: runtime_upgrade_plans runtime_upgrade_plans_compatibility_operation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_upgrade_plans
    ADD CONSTRAINT runtime_upgrade_plans_compatibility_operation_id_fkey FOREIGN KEY (compatibility_operation_id) REFERENCES new_design.transfer_operations(id);


--
-- Name: runtime_upgrade_plans runtime_upgrade_plans_installation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.runtime_upgrade_plans
    ADD CONSTRAINT runtime_upgrade_plans_installation_id_fkey FOREIGN KEY (installation_id) REFERENCES new_design.runtime_installations(installation_id);


--
-- Name: retrieval_results semantic_retrieval_results_chunk_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.retrieval_results
    ADD CONSTRAINT semantic_retrieval_results_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES new_design.embedding_chunks(id);


--
-- Name: retrieval_results semantic_retrieval_results_run_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.retrieval_results
    ADD CONSTRAINT semantic_retrieval_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES new_design.retrieval_runs(id) ON DELETE CASCADE;


--
-- Name: retrieval_runs semantic_retrieval_runs_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.retrieval_runs
    ADD CONSTRAINT semantic_retrieval_runs_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE CASCADE;


--
-- Name: retrieval_runs semantic_retrieval_runs_generation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.retrieval_runs
    ADD CONSTRAINT semantic_retrieval_runs_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES new_design.embedding_generations(id);


--
-- Name: task_contract_versions task_contract_versions_base_version_id_contract_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contract_versions
    ADD CONSTRAINT task_contract_versions_base_version_id_contract_id_fkey FOREIGN KEY (base_version_id, contract_id) REFERENCES new_design.task_contract_versions(id, contract_id);


--
-- Name: task_contract_versions task_contract_versions_contract_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contract_versions
    ADD CONSTRAINT task_contract_versions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES new_design.task_contracts(id) ON DELETE CASCADE;


--
-- Name: task_contract_versions task_contract_versions_prompt_recipe_version_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contract_versions
    ADD CONSTRAINT task_contract_versions_prompt_recipe_version_id_fkey FOREIGN KEY (prompt_recipe_version_id) REFERENCES new_design.prompt_recipe_versions(id);


--
-- Name: task_contracts task_contracts_current_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contracts
    ADD CONSTRAINT task_contracts_current_version_fk FOREIGN KEY (current_version_id, id) REFERENCES new_design.task_contract_versions(id, contract_id);


--
-- Name: task_contracts task_contracts_published_version_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.task_contracts
    ADD CONSTRAINT task_contracts_published_version_fk FOREIGN KEY (published_version_id, id) REFERENCES new_design.task_contract_versions(id, contract_id);


--
-- Name: text_anchors text_anchor_body_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.text_anchors
    ADD CONSTRAINT text_anchor_body_fkey FOREIGN KEY (body_version_id) REFERENCES new_design.chapter_body_versions(id);


--
-- Name: text_anchors text_anchor_book_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.text_anchors
    ADD CONSTRAINT text_anchor_book_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id);


--
-- Name: text_anchors text_anchor_document_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.text_anchors
    ADD CONSTRAINT text_anchor_document_fkey FOREIGN KEY (chapter_document_id) REFERENCES new_design.chapter_documents(id);


--
-- Name: text_anchors text_anchors_chapter_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.text_anchors
    ADD CONSTRAINT text_anchors_chapter_card_id_fkey FOREIGN KEY (chapter_card_id) REFERENCES new_design.cards(id) ON DELETE CASCADE;


--
-- Name: text_anchors text_anchors_scene_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.text_anchors
    ADD CONSTRAINT text_anchors_scene_card_id_fkey FOREIGN KEY (scene_card_id) REFERENCES new_design.cards(id) ON DELETE SET NULL;


--
-- Name: text_anchors text_anchors_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.text_anchors
    ADD CONSTRAINT text_anchors_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id) ON DELETE CASCADE;


--
-- Name: text_anchors text_anchors_subject_card_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.text_anchors
    ADD CONSTRAINT text_anchors_subject_card_id_fkey FOREIGN KEY (subject_card_id) REFERENCES new_design.cards(id) ON DELETE CASCADE;


--
-- Name: transfer_conflicts transfer_conflicts_operation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_conflicts
    ADD CONSTRAINT transfer_conflicts_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES new_design.transfer_operations(id);


--
-- Name: transfer_id_mappings transfer_id_mappings_operation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_id_mappings
    ADD CONSTRAINT transfer_id_mappings_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES new_design.transfer_operations(id);


--
-- Name: transfer_manifests transfer_manifests_operation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_manifests
    ADD CONSTRAINT transfer_manifests_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES new_design.transfer_operations(id);


--
-- Name: transfer_events transfer_operation_events_operation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_events
    ADD CONSTRAINT transfer_operation_events_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES new_design.transfer_operations(id);


--
-- Name: transfer_operations transfer_operations_book_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_operations
    ADD CONSTRAINT transfer_operations_book_id_fkey FOREIGN KEY (book_id) REFERENCES new_design.books(id) ON DELETE RESTRICT;


--
-- Name: transfer_operations transfer_operations_manifest_fk; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_operations
    ADD CONSTRAINT transfer_operations_manifest_fk FOREIGN KEY (ready_manifest_id, id) REFERENCES new_design.transfer_manifests(id, operation_id);


--
-- Name: transfer_operations transfer_operations_source_operation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_operations
    ADD CONSTRAINT transfer_operations_source_operation_id_fkey FOREIGN KEY (source_operation_id) REFERENCES new_design.transfer_operations(id);


--
-- Name: transfer_operations transfer_operations_space_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_operations
    ADD CONSTRAINT transfer_operations_space_id_fkey FOREIGN KEY (space_id) REFERENCES new_design.card_spaces(id);


--
-- Name: transfer_validations transfer_validation_results_operation_id_fkey; Type: FK CONSTRAINT; Schema: new_design; Owner: -
--

ALTER TABLE ONLY new_design.transfer_validations
    ADD CONSTRAINT transfer_validation_results_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES new_design.transfer_operations(id);


--
-- PostgreSQL database dump complete
--

\unrestrict G9toatltgRhx3O9KmGJsgMyYrR6vFq3jHGQt1aPUw4aCNj7sL1phXBomDVb0AJ5
