SET search_path TO new_design, public;
-- Technical freeze and immutable original reply evidence, not new image/asset facts.
ALTER TABLE ai_task_attempts ADD COLUMN image_freeze jsonb CHECK(image_freeze IS NULL OR jsonb_typeof(image_freeze)='object');
ALTER TABLE ai_task_state_events ADD COLUMN image_reply jsonb CHECK(image_reply IS NULL OR jsonb_typeof(image_reply)='object');
CREATE UNIQUE INDEX image_single_dispatch ON ai_task_state_events(attempt_id) WHERE reason_code='image_generation_sent';
CREATE UNIQUE INDEX image_original_reply ON ai_task_state_events(attempt_id) WHERE reason_code='image_generation_reply';
CREATE FUNCTION validate_image_generation_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE original_task ai_tasks; connection model_route_versions; config model_route_configs; contract task_contract_versions; recipe prompt_recipe_versions; snapshot model_route_snapshots;
BEGIN
 SELECT * INTO original_task FROM ai_tasks WHERE id=NEW.task_id;
 IF original_task.source_kind<>'image_generation' THEN
  IF NEW.image_freeze IS NOT NULL THEN RAISE EXCEPTION 'image freeze on unrelated attempt' USING ERRCODE='23514'; END IF; RETURN NEW;
 END IF;
 SELECT * INTO connection FROM model_route_versions WHERE id=(NEW.image_freeze->>'connectionVersionId')::uuid;
 SELECT * INTO config FROM model_route_configs WHERE id=connection.config_id;
 SELECT * INTO contract FROM task_contract_versions WHERE id=NEW.task_contract_version_id;
 SELECT * INTO recipe FROM prompt_recipe_versions WHERE id=NEW.prompt_recipe_version_id;
 SELECT * INTO snapshot FROM model_route_snapshots WHERE id=NEW.model_route_snapshot_id;
 IF NEW.image_freeze IS NULL OR NEW.attempt_number<>1 OR NEW.trigger_kind<>'initial' OR NEW.status<>'running' OR
    NEW.image_freeze->>'protocol' IS DISTINCT FROM 'openai_images_b64_v1' OR NEW.image_freeze->>'connectionHash' IS DISTINCT FROM connection.content_hash::text OR NEW.image_freeze->'input'->>'connectionVersionId' IS DISTINCT FROM connection.id::text OR
    config.scope IS DISTINCT FROM 'task_group' OR config.task_group IS DISTINCT FROM 'image_generation' OR config.task_key IS NOT NULL OR
    connection.status NOT IN ('published','superseded') OR connection.provider IS DISTINCT FROM 'openai-compatible' OR
    connection.required_capabilities IS DISTINCT FROM ARRAY['image_generation','image_base64']::text[] OR connection.parameters->>'imageProtocol' IS DISTINCT FROM 'openai_images_b64_v1' OR
    contract.task_group IS DISTINCT FROM 'image_generation' OR contract.budget_policy->>'assetId' IS DISTINCT FROM 'new_design.image.generate' OR contract.budget_policy->>'assetVersion' IS DISTINCT FROM 'v1' OR
    recipe.variables_schema->'const' IS DISTINCT FROM NEW.image_freeze->'input' OR contract.input_schema->'const' IS DISTINCT FROM NEW.image_freeze->'input' OR
    NEW.image_freeze->'input'->>'bookId' IS DISTINCT FROM original_task.book_id::text OR NEW.image_freeze->'input'->>'requestKey' IS DISTINCT FROM original_task.request_idempotency_key OR
    NEW.input_hash IS DISTINCT FROM original_task.request_hash OR snapshot.book_id IS DISTINCT FROM original_task.book_id OR snapshot.task_contract_version_id IS DISTINCT FROM contract.id OR
    snapshot.required_capabilities IS DISTINCT FROM ARRAY['image_generation','image_base64']::text[] OR snapshot.provider IS DISTINCT FROM connection.provider OR snapshot.model IS DISTINCT FROM connection.model OR
    snapshot.parameters IS DISTINCT FROM connection.parameters OR snapshot.credential_ref_id IS DISTINCT FROM connection.credential_ref_id OR snapshot.retry_policy IS DISTINCT FROM '{"maxRetries":0,"retryDelayMs":0}'::jsonb OR snapshot.budget_policy IS DISTINCT FROM '{"maxImages":1}'::jsonb OR
    recipe.variables_schema->'x-image-generation'->>'requestId' IS DISTINCT FROM original_task.id::text OR
    NOT EXISTS(SELECT 1 FROM task_contracts c WHERE c.id=contract.contract_id AND c.task_key='image_generation_'||original_task.id::text) OR
    snapshot.source_layers IS DISTINCT FROM jsonb_build_array(jsonb_build_object('scope','task_group','configId',config.id,'versionId',connection.id)) OR
    NOT EXISTS(SELECT 1 FROM ai_task_steps s WHERE s.id=NEW.step_id AND s.task_id=original_task.id AND s.max_attempts=1) OR
    NOT EXISTS(SELECT 1 FROM context_manifests m WHERE m.id=NEW.context_manifest_id AND m.book_id=original_task.book_id AND m.model_route_snapshot_id=snapshot.id AND m.task_contract_version_id=contract.id AND m.prompt_recipe_version_id=recipe.id) OR
    EXISTS(SELECT 1 FROM model_route_fallbacks f WHERE f.route_version_id=connection.id) THEN
  RAISE EXCEPTION 'image generation requires exact original connection and frozen single attempt' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER image_generation_attempt_freeze BEFORE INSERT ON ai_task_attempts FOR EACH ROW EXECUTE FUNCTION validate_image_generation_attempt();
CREATE FUNCTION validate_image_generation_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF NEW.reason_code NOT IN ('image_generation_sent','image_generation_reply') THEN
  IF NEW.image_reply IS NOT NULL THEN RAISE EXCEPTION 'unexpected image reply evidence' USING ERRCODE='23514'; END IF; RETURN NEW;
 END IF;
 IF NEW.entity_kind<>'attempt' OR NEW.to_status<>'running' OR NOT EXISTS(
  SELECT 1 FROM ai_tasks t JOIN ai_task_attempts a ON a.task_id=t.id JOIN ai_task_steps s ON s.id=a.step_id
  WHERE t.id=NEW.task_id AND t.source_kind='image_generation' AND t.status='running' AND a.id=NEW.attempt_id AND a.step_id=NEW.step_id AND a.status='running' AND a.image_freeze IS NOT NULL AND s.current_attempt_id=a.id AND s.status='running' AND (NEW.reason_code='image_generation_reply' OR s.lease_expires_at>now())
 ) THEN RAISE EXCEPTION 'image evidence requires original active attempt lease' USING ERRCODE='23514'; END IF;
 IF NEW.reason_code='image_generation_sent' AND NEW.image_reply IS NOT NULL THEN RAISE EXCEPTION 'dispatch evidence cannot invent a reply' USING ERRCODE='23514'; END IF;
 IF NEW.reason_code='image_generation_reply' AND (NEW.image_reply IS NULL OR NOT EXISTS(SELECT 1 FROM ai_task_state_events e WHERE e.attempt_id=NEW.attempt_id AND e.reason_code='image_generation_sent') OR
  jsonb_typeof(NEW.image_reply->'base64') IS DISTINCT FROM 'string' OR length(NEW.image_reply->>'base64') NOT BETWEEN 4 AND 13981016 OR jsonb_typeof(NEW.image_reply->'mimeType') IS DISTINCT FROM 'string' OR NEW.image_reply->>'mimeType' NOT IN ('image/png','image/jpeg','image/webp') OR
  jsonb_typeof(NEW.image_reply->'checksum') IS DISTINCT FROM 'string' OR NEW.image_reply->>'checksum' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(NEW.image_reply->'byteSize') IS DISTINCT FROM 'number' OR (NEW.image_reply->>'byteSize')::bigint NOT BETWEEN 1 AND 10485760) THEN RAISE EXCEPTION 'image reply requires bounded original base64 evidence' USING ERRCODE='23514'; END IF;
 IF NEW.reason_code='image_generation_reply' AND (NEW.image_reply->>'base64' !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' OR
  octet_length(decode(NEW.image_reply->>'base64','base64')) IS DISTINCT FROM (NEW.image_reply->>'byteSize')::bigint OR
  encode(digest(decode(NEW.image_reply->>'base64','base64'),'sha256'),'hex') IS DISTINCT FROM NEW.image_reply->>'checksum') THEN
  RAISE EXCEPTION 'image reply bytes require exact checksum and size' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER image_generation_evidence BEFORE INSERT ON ai_task_state_events FOR EACH ROW EXECUTE FUNCTION validate_image_generation_evidence();
COMMENT ON COLUMN ai_task_attempts.image_freeze IS 'Exact dedicated image connection version and contract; original ledger attempt, no text fallback.';
COMMENT ON COLUMN ai_task_state_events.image_reply IS 'Original model base64 reply retained once; resulting image facts remain asset_versions.';
