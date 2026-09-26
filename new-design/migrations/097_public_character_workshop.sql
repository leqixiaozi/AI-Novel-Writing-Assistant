-- Manual extension only; never register in ordinary startup migrations.
SET search_path TO new_design, public;
CREATE TABLE public_character_workshop_capability (
 contract text PRIMARY KEY CHECK(contract='public_character_trial_v1'),
 operational boolean NOT NULL DEFAULT false
);
INSERT INTO public_character_workshop_capability(contract) VALUES('public_character_trial_v1');

-- Preserve every existing book scope. The only new NULL-book manifest is a
-- controlled public character request, with a real original card identity.
ALTER TABLE context_manifests ADD COLUMN public_character_scope uuid REFERENCES cards(id);
ALTER TABLE context_manifests ALTER COLUMN book_id DROP NOT NULL;
ALTER TABLE context_manifests ADD CONSTRAINT context_manifests_public_character_scope_check CHECK(
 (book_id IS NOT NULL AND public_character_scope IS NULL) OR
 (book_id IS NULL AND public_character_scope IS NOT NULL AND
  COALESCE(decision_summary->>'contract'='public_character_trial_v1',false))
);
CREATE FUNCTION guard_public_character_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.public_character_scope IS NOT NULL THEN RAISE EXCEPTION 'public character manifest immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.public_character_scope IS NOT NULL OR NEW.public_character_scope IS NOT NULL) THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'public character manifest immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.book_id IS NULL AND NOT EXISTS(SELECT 1 FROM public_character_workshop_capability WHERE contract='public_character_trial_v1' AND operational) THEN RAISE EXCEPTION 'public character workshop not enabled' USING ERRCODE='23514'; END IF;
 IF NEW.book_id IS NULL AND NOT EXISTS(
  SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id
  JOIN task_contract_versions contract ON contract.id=NEW.task_contract_version_id
  JOIN prompt_recipe_versions recipe ON recipe.id=NEW.prompt_recipe_version_id AND recipe.id=contract.prompt_recipe_version_id
  WHERE card.id=NEW.public_character_scope AND card.space_id='60000000-0000-4000-8000-000000000001'
   AND type.type_key='character' AND card.status='active' AND type.status='published'
   AND recipe.variables_schema->'x-public-character'->>'contract'='public_character_trial_v1'
   AND recipe.variables_schema->'x-public-character'->>'resourceId'=card.id::text
   AND recipe.variables_schema->'const'=contract.input_schema->'const'
   AND contract.task_group IN ('character_dialogue','image_generation')
 ) THEN RAISE EXCEPTION 'invalid public character manifest' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_character_manifest_guard BEFORE INSERT OR UPDATE OR DELETE ON context_manifests FOR EACH ROW EXECUTE FUNCTION guard_public_character_manifest();

-- Extend the installed constraint, including any separately installed manual cases.
DO $$ DECLARE prior_check text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT prior_check FROM pg_constraint
 WHERE conrelid='new_design.model_route_snapshots'::regclass AND conname='model_route_snapshots_managed_scope_check' AND contype='c';
 IF left(prior_check,6)<>'CHECK ' THEN RAISE EXCEPTION 'unexpected managed scope constraint'; END IF;
 ALTER TABLE model_route_snapshots DROP CONSTRAINT model_route_snapshots_managed_scope_check;
 EXECUTE 'ALTER TABLE new_design.model_route_snapshots ADD CONSTRAINT model_route_snapshots_managed_scope_check CHECK ('||substr(prior_check,7)||
  ' OR (book_id IS NULL AND task_contract_version_id IS NULL AND managed_task_key IS NOT NULL AND managed_task_key=''image_generation''))';
END $$;
-- Copy the current resolver as the fallback so installed world extensions and
-- later fact cases remain intact. Replace the public entry in place: same OID.
DO $$ DECLARE original text; BEGIN
 original:=pg_get_functiondef('new_design.resolve_dependency_resource(text,uuid,uuid)'::regprocedure);
 IF strpos(original,'FUNCTION new_design.resolve_dependency_resource(')=0 THEN RAISE EXCEPTION 'unexpected resolver definition'; END IF;
 EXECUTE replace(original,'FUNCTION new_design.resolve_dependency_resource(','FUNCTION new_design.resolve_dependency_resource_pre097(');
END $$;
CREATE OR REPLACE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE
SET search_path TO pg_catalog,new_design,ag_catalog,public,pg_temp AS $$ BEGIN
 IF requested_kind='context_manifest' AND EXISTS(SELECT 1 FROM context_manifests WHERE id=requested_stable_id AND id=requested_version_id AND book_id IS NULL AND public_character_scope IS NOT NULL) THEN
  RETURN QUERY SELECT card.space_id,NULL::uuid,manifest.manifest_hash FROM context_manifests manifest JOIN cards card ON card.id=manifest.public_character_scope WHERE manifest.id=requested_stable_id AND manifest.id=requested_version_id;
 ELSIF requested_kind='model_route_snapshot' AND EXISTS(SELECT 1 FROM model_route_snapshots WHERE id=requested_stable_id AND id=requested_version_id AND book_id IS NULL AND task_contract_version_id IS NULL AND managed_task_key='image_generation') THEN
  RETURN QUERY SELECT NULL::uuid,NULL::uuid,snapshot_hash FROM model_route_snapshots WHERE id=requested_stable_id AND id=requested_version_id;
 ELSE RETURN QUERY SELECT * FROM resolve_dependency_resource_pre097(requested_kind,requested_stable_id,requested_version_id);
 END IF;
END $$;

-- Public resources have no book invalidation state/edge. Keep the installed
-- bridge and knowledge-state function bodies unchanged for all other resources,
-- and preserve their OIDs and attached triggers. Exact public sources remain
-- itemized in the original immutable manifest/attempt ledgers.
DO $patch$ DECLARE definition text; boundary integer; injection text; BEGIN
 definition:=pg_get_functiondef('new_design.bridge_dependency_creation()'::regprocedure);
 boundary:=strpos(definition,'BEGIN');
 IF boundary=0 THEN RAISE EXCEPTION 'unexpected dependency bridge definition'; END IF;
 injection:=$guard$
  IF TG_TABLE_NAME='context_manifests' THEN
   IF NEW.book_id IS NULL AND NEW.public_character_scope IS NOT NULL THEN
    PERFORM register_dependency_resource('context_manifest',NEW.id,NEW.id);
    RETURN NEW;
   END IF;
  ELSIF TG_TABLE_NAME='context_manifest_entries' THEN
   IF EXISTS(SELECT 1 FROM context_manifests WHERE id=NEW.manifest_id AND public_character_scope IS NOT NULL AND book_id IS NULL) THEN
    PERFORM register_dependency_resource(NEW.source_type,NEW.stable_object_id,COALESCE(NEW.exact_version_id,NEW.stable_object_id));
    RETURN NEW;
   END IF;
  ELSIF TG_TABLE_NAME='ai_task_attempts' THEN
   IF EXISTS(SELECT 1 FROM context_manifests WHERE id=NEW.context_manifest_id AND public_character_scope IS NOT NULL AND book_id IS NULL) THEN
    IF NEW.status='succeeded' AND OLD.status IS DISTINCT FROM NEW.status THEN
     PERFORM register_dependency_resource('ai_task_attempt',NEW.task_id,NEW.id);
    END IF;
    RETURN NEW;
   END IF;
  END IF;
 $guard$;
 EXECUTE substr(definition,1,boundary+4)||injection||substr(definition,boundary+5);
 definition:=pg_get_functiondef('new_design.initialize_new_complete_context_state()'::regprocedure);
 boundary:=strpos(definition,'BEGIN');
 IF boundary=0 THEN RAISE EXCEPTION 'unexpected knowledge state definition'; END IF;
 EXECUTE substr(definition,1,boundary+4)||' IF NEW.book_id IS NULL AND NEW.public_character_scope IS NOT NULL THEN RETURN NEW; END IF; '||substr(definition,boundary+5);
END $patch$;

-- Request/reply evidence only. Character content stays in original card versions;
-- images reuse original content objects. No book, state, knowledge or body copy.
CREATE TABLE public_character_trials (
 id uuid PRIMARY KEY REFERENCES ai_tasks(id),
 request_key uuid NOT NULL UNIQUE,
 request_hash char(64) NOT NULL,
 resource_id uuid NOT NULL REFERENCES cards(id),
 resource_version_id uuid NOT NULL REFERENCES card_versions(id),
 input_payload jsonb NOT NULL,
 source_snapshot jsonb NOT NULL,
 frozen_plan jsonb NOT NULL,
 step_id uuid NOT NULL REFERENCES ai_task_steps(id),
 attempt_id uuid NOT NULL REFERENCES ai_task_attempts(id),
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed','ended_unknown')),
 request_state text NOT NULL DEFAULT 'not_sent' CHECK(request_state IN ('not_sent','sending','sent_unknown','completed')),
 reply jsonb,
 execution jsonb,
 output jsonb,
 summary text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_public_character_trial() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'public character original reply cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public_character_workshop_capability WHERE contract='public_character_trial_v1' AND operational) THEN RAISE EXCEPTION 'public character workshop not enabled' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','request_state','reply','execution','output','summary']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','request_state','reply','execution','output','summary']::text[]) THEN RAISE EXCEPTION 'public character freeze immutable' USING ERRCODE='23514'; END IF;
  IF OLD.reply IS NOT NULL AND (OLD.reply,OLD.execution) IS DISTINCT FROM (NEW.reply,NEW.execution) THEN RAISE EXCEPTION 'public character received reply immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'running' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'public character terminal request immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN card_versions version ON version.card_id=card.id
  JOIN ai_tasks task ON task.id=NEW.id JOIN ai_task_steps step ON step.task_id=task.id JOIN ai_task_attempts attempt ON attempt.task_id=task.id AND attempt.step_id=step.id
  JOIN card_type_versions spec ON spec.id=version.type_version_id AND spec.card_type_id=type.id
  JOIN task_contract_versions contract ON contract.id=attempt.task_contract_version_id AND contract.id=task.task_contract_version_id
  JOIN prompt_recipe_versions recipe ON recipe.id=attempt.prompt_recipe_version_id AND recipe.id=contract.prompt_recipe_version_id
  JOIN context_manifests manifest ON manifest.id=attempt.context_manifest_id
  JOIN model_route_snapshots route ON route.id=attempt.model_route_snapshot_id
  WHERE card.id=NEW.resource_id AND version.id=NEW.resource_version_id AND type.type_key='character'
   AND card.space_id='60000000-0000-4000-8000-000000000001' AND task.space_id=card.space_id AND task.book_id IS NULL
   AND task.source_kind='public_character_trial' AND task.source_id=NEW.id AND task.request_idempotency_key=NEW.request_key::text AND task.request_hash=NEW.request_hash
   AND step.id=NEW.step_id AND step.max_attempts=1 AND step.current_attempt_id=attempt.id AND attempt.id=NEW.attempt_id AND attempt.attempt_number=1
   AND manifest.book_id IS NULL AND manifest.public_character_scope=card.id AND route.book_id IS NULL
   AND manifest.task_contract_version_id=contract.id AND manifest.prompt_recipe_version_id=recipe.id AND manifest.model_route_snapshot_id=route.id
   AND NEW.frozen_plan->>'contractVersionId'=contract.id::text AND NEW.frozen_plan->>'recipeVersionId'=recipe.id::text
   AND NEW.frozen_plan->>'manifestId'=manifest.id::text AND NEW.frozen_plan->>'inputHash'=attempt.input_hash::text
   AND NEW.frozen_plan->>'outputSchemaVersion'=attempt.output_schema_version AND attempt.output_schema_version=contract.output_schema_version
   AND contract.retry_policy->'maxAttempts'='1'::jsonb AND contract.retry_policy->'automaticRetry'='false'::jsonb
   AND manifest.source_set_hash::text=NEW.source_snapshot->>'hash' AND manifest.manifest_hash::text=NEW.frozen_plan->>'inputHash'
   AND recipe.variables_schema->'const'=NEW.frozen_plan->'promptInput' AND contract.input_schema->'const'=NEW.frozen_plan->'promptInput'
   AND ((NEW.input_payload->>'kind'='dialogue' AND contract.task_group='character_dialogue' AND contract.budget_policy->>'assetId'='new_design.character.public_dialogue' AND contract.budget_policy->>'assetVersion'='v1')
    OR (NEW.input_payload->>'kind'='portrait' AND contract.task_group='image_generation' AND contract.budget_policy->>'assetId'='new_design.character.public_portrait' AND contract.budget_policy->>'assetVersion'='v1'))
   AND NEW.input_payload->>'requestKey'=NEW.request_key::text AND NEW.input_payload->>'resourceId'=card.id::text AND NEW.input_payload->>'resourceVersionId'=version.id::text
   AND NEW.source_snapshot->>'id'=card.id::text AND NEW.source_snapshot->>'versionId'=version.id::text AND NEW.source_snapshot->>'typeVersionId'=version.type_version_id::text
   AND NEW.source_snapshot->>'title'=version.title AND NEW.source_snapshot->>'revision'=version.revision::text
   AND NEW.source_snapshot->'values'=version.values||COALESCE((SELECT jsonb_object_agg(definition.field_key,local.value) FROM card_version_local_values local JOIN field_definitions definition ON definition.id=local.field_definition_id WHERE local.card_version_id=version.id),'{}'::jsonb)
   AND NEW.source_snapshot->'fields'=spec.fields||COALESCE((SELECT jsonb_agg(field.field_schema ORDER BY definition.field_key) FROM card_version_local_values local JOIN field_definitions definition ON definition.id=local.field_definition_id JOIN field_definition_versions field ON field.id=local.field_definition_version_id AND field.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)
   AND NEW.source_snapshot->'localFields'=COALESCE((SELECT jsonb_agg(jsonb_build_object('definitionId',definition.id::text,'versionId',field.id::text,'field',field.field_schema,'value',local.value) ORDER BY definition.field_key) FROM card_version_local_values local JOIN field_definitions definition ON definition.id=local.field_definition_id JOIN field_definition_versions field ON field.id=local.field_definition_version_id AND field.field_definition_id=definition.id WHERE local.card_version_id=version.id),'[]'::jsonb)
   AND NEW.input_payload->>'sourceHash'=NEW.source_snapshot->>'hash'
   AND NEW.frozen_plan->'source'=NEW.source_snapshot AND NEW.frozen_plan->'input'=NEW.input_payload
   AND ((NEW.input_payload->>'kind'='dialogue' AND NEW.frozen_plan->'promptInput'->'source'=NEW.source_snapshot AND NEW.frozen_plan->'promptInput'->>'message'=NEW.input_payload->>'message')
    OR (NEW.input_payload->>'kind'='portrait' AND NEW.frozen_plan->'promptInput'->'portraitSource'=NEW.source_snapshot AND NEW.frozen_plan->'promptInput'->>'prompt'=NEW.input_payload->>'prompt' AND NEW.frozen_plan->'promptInput'->>'description'=NEW.input_payload->>'description' AND NEW.frozen_plan->'promptInput'->>'size'=NEW.input_payload->>'size'))
   AND ((NEW.input_payload->>'kind'='dialogue' AND route.managed_task_key='character_dialogue'
     AND NEW.frozen_plan->'route'->'sourceLayers'=route.source_layers AND NEW.frozen_plan->'route'->'primary'->>'provider'=route.provider AND NEW.frozen_plan->'route'->'primary'->>'model'=route.model)
    OR (NEW.input_payload->>'kind'='portrait' AND route.managed_task_key='image_generation'
     AND NEW.input_payload->>'connectionVersionId'=route.source_layers->0->>'versionId'
     AND NEW.frozen_plan->'connection'->>'id'=NEW.input_payload->>'connectionVersionId'
     AND EXISTS(SELECT 1 FROM model_route_versions connection JOIN model_route_configs config ON config.id=connection.config_id WHERE connection.id::text=NEW.input_payload->>'connectionVersionId' AND config.scope='task_group' AND config.task_group='image_generation' AND connection.provider=route.provider AND connection.model=route.model AND connection.content_hash::text=NEW.frozen_plan->'connection'->>'connectionHash')))
   AND NEW.frozen_plan->>'snapshotId'=route.id::text AND NEW.frozen_plan->>'snapshotHash'=route.snapshot_hash::text
 ) THEN RAISE EXCEPTION 'public character exact source and original attempt mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.reply IS NOT NULL AND (NEW.execution IS NULL OR NEW.request_state<>'completed' OR NOT EXISTS(
  SELECT 1 FROM model_route_snapshots route WHERE route.id::text=NEW.frozen_plan->>'snapshotId'
   AND NEW.execution->>'routeSnapshotId'=route.id::text AND NEW.execution->>'routeSnapshotHash'=route.snapshot_hash::text
   AND NEW.execution->>'provider'=route.provider AND NEW.execution->>'model'=route.model
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.execution->'attempts')='array' THEN NEW.execution->'attempts' ELSE '[]'::jsonb END) trace WHERE trace->>'status'='succeeded' AND trace->'requestSent'='true'::jsonb AND trace->'responseReceived'='true'::jsonb)
 )) THEN RAISE EXCEPTION 'public character reply requires actual frozen execution' USING ERRCODE='23514'; END IF;
 IF NEW.status='succeeded' AND (NEW.reply IS NULL OR NEW.output IS NULL OR NOT EXISTS(SELECT 1 FROM ai_task_attempts WHERE id=NEW.attempt_id AND status='succeeded')) THEN RAISE EXCEPTION 'public character success requires saved original reply' USING ERRCODE='23514'; END IF;
 IF NEW.status='succeeded' AND NEW.input_payload->>'kind'='dialogue' AND
  (NEW.output IS DISTINCT FROM NEW.reply OR NEW.output->>'resourceId' IS DISTINCT FROM NEW.resource_id::text OR NEW.output->>'resourceVersionId' IS DISTINCT FROM NEW.resource_version_id::text) THEN RAISE EXCEPTION 'public dialogue output source mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='succeeded' AND NEW.input_payload->>'kind'='portrait' AND NOT EXISTS(
  SELECT 1 FROM asset_content_objects content WHERE content.id::text=NEW.output->>'contentObjectId' AND content.storage_kind='managed_file' AND content.storage_provider='local' AND content.integrity_state='verified'
   AND content.checksum::text=NEW.output->>'checksum' AND content.byte_size::text=NEW.output->>'byteSize' AND content.mime_type=NEW.output->>'mimeType'
   AND NEW.output->>'checksum'=NEW.reply->>'checksum' AND NEW.output->>'byteSize'=NEW.reply->>'byteSize' AND NEW.output->>'mimeType'=NEW.reply->>'mimeType'
   AND NEW.output->>'title'=NEW.input_payload->>'title' AND NEW.output->>'description'=NEW.input_payload->>'description'
 ) THEN RAISE EXCEPTION 'public portrait output content mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='ended_unknown'  AND NEW.reply IS NOT NULL THEN RAISE EXCEPTION 'received reply cannot be ended as unknown' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_character_trial_guard BEFORE INSERT OR UPDATE OR DELETE ON public_character_trials FOR EACH ROW EXECUTE FUNCTION guard_public_character_trial();

CREATE TABLE public_character_portrait_events (
 id uuid PRIMARY KEY,
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_key uuid NOT NULL UNIQUE,
 request_hash char(64) NOT NULL,
 resource_id uuid NOT NULL REFERENCES cards(id),
 trial_id uuid NOT NULL REFERENCES public_character_trials(id),
 operation text NOT NULL CHECK(operation IN ('primary','archive')),
 input_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_public_character_portrait_event() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'public portrait history immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public_character_workshop_capability WHERE contract='public_character_trial_v1' AND operational) THEN RAISE EXCEPTION 'public character workshop not enabled' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('public-character-source:'||NEW.resource_id::text,0));
 IF NEW.input_payload->>'expectedLatestEventId' IS DISTINCT FROM (SELECT id::text FROM public_character_portrait_events WHERE resource_id=NEW.resource_id ORDER BY sequence DESC LIMIT 1) THEN RAISE EXCEPTION 'public portrait latest event changed' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public_character_portrait_events WHERE trial_id=NEW.trial_id AND operation='archive') THEN RAISE EXCEPTION 'public portrait already archived' USING ERRCODE='23514'; END IF;
 IF NEW.input_payload->>'requestKey' IS DISTINCT FROM NEW.request_key::text OR NEW.input_payload->>'resourceId' IS DISTINCT FROM NEW.resource_id::text OR NEW.input_payload->>'trialId' IS DISTINCT FROM NEW.trial_id::text OR NEW.input_payload->>'operation' IS DISTINCT FROM NEW.operation THEN RAISE EXCEPTION 'public portrait command identity mismatch' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public_character_trials trial JOIN cards card ON card.id=trial.resource_id WHERE trial.id=NEW.trial_id AND trial.resource_id=NEW.resource_id AND trial.status='succeeded' AND trial.input_payload->>'kind'='portrait' AND trial.output->>'contentObjectId' IS NOT NULL AND card.status='active') THEN RAISE EXCEPTION 'public portrait requires original saved image' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_character_portrait_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public_character_portrait_events FOR EACH ROW EXECUTE FUNCTION guard_public_character_portrait_event();
CREATE INDEX public_character_trials_resource_idx ON public_character_trials(resource_id,created_at,id);
CREATE INDEX public_character_portrait_events_resource_idx ON public_character_portrait_events(resource_id,sequence);
