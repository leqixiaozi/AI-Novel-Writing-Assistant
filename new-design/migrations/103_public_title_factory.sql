-- Manual opt-in, requires 097. Never register with ordinary startup migrations.
SET search_path TO new_design,public;
CREATE TABLE public_title_factory_capability(contract text PRIMARY KEY CHECK(contract='public_title_factory_v1'),operational boolean NOT NULL DEFAULT false);
INSERT INTO public_title_factory_capability(contract) VALUES('public_title_factory_v1');
ALTER TABLE context_manifests ADD COLUMN public_title_scope uuid REFERENCES cards(id);
ALTER TABLE context_manifests DROP CONSTRAINT context_manifests_public_character_scope_check;
ALTER TABLE context_manifests ADD CONSTRAINT context_manifests_public_creative_scope_check CHECK(
 (book_id IS NOT NULL AND public_character_scope IS NULL AND public_title_scope IS NULL) OR
 (book_id IS NULL AND public_character_scope IS NOT NULL AND public_title_scope IS NULL AND COALESCE(decision_summary->>'contract'='public_character_trial_v1',false)) OR
 (book_id IS NULL AND public_character_scope IS NULL AND public_title_scope IS NOT NULL AND COALESCE(decision_summary->>'contract'='public_title_factory_v1',false))
);
CREATE TABLE public_title_factory_trials(
 id uuid PRIMARY KEY REFERENCES ai_tasks(id),request_key uuid NOT NULL UNIQUE,request_hash char(64) NOT NULL,intent_hash char(64) NOT NULL,
 source_id uuid NOT NULL REFERENCES cards(id),source_version_id uuid NOT NULL REFERENCES card_versions(id),source_hash char(64) NOT NULL,
 input_payload jsonb NOT NULL,source_snapshot jsonb NOT NULL,frozen_plan jsonb NOT NULL,
 step_id uuid NOT NULL REFERENCES ai_task_steps(id),attempt_id uuid NOT NULL REFERENCES ai_task_attempts(id),
 status text NOT NULL DEFAULT 'running' CHECK(status IN('running','succeeded','failed','ended_unknown')),reply jsonb,output jsonb,summary text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX public_title_one_original_running ON public_title_factory_trials(intent_hash) WHERE status='running';
CREATE TABLE public_title_factory_choices(request_key uuid PRIMARY KEY,input_hash char(64) NOT NULL,trial_id uuid NOT NULL REFERENCES public_title_factory_trials(id),input_payload jsonb NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION guard_public_title_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.public_title_scope IS NOT NULL THEN RAISE EXCEPTION 'public title manifest immutable' USING ERRCODE='23514'; END IF; RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (OLD.public_title_scope IS NOT NULL OR NEW.public_title_scope IS NOT NULL) THEN IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'public title manifest immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END IF;
 IF NEW.public_title_scope IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public_title_factory_capability WHERE operational) OR NOT EXISTS(
  SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN card_versions source ON source.id=card.current_version_id AND source.card_id=card.id
  JOIN task_contract_versions contract ON contract.id=NEW.task_contract_version_id JOIN prompt_recipe_versions recipe ON recipe.id=NEW.prompt_recipe_version_id AND recipe.id=contract.prompt_recipe_version_id
  WHERE card.id=NEW.public_title_scope AND card.space_id='60000000-0000-4000-8000-000000000001' AND card.status='active' AND type.type_key='public_title_brief' AND type.status='published'
  AND contract.status='published' AND recipe.status='published' AND contract.task_group='creative_extraction' AND contract.budget_policy->>'assetId'='new_design.public.title_factory' AND contract.budget_policy->>'assetVersion'='v1'
  AND contract.input_schema->'const'=recipe.variables_schema->'const' AND contract.input_schema->'const'->>'contract'='public_title_factory_v1'
  AND contract.input_schema->'const'->'source'->>'id'=card.id::text AND contract.input_schema->'const'->'source'->>'versionId'=source.id::text AND contract.input_schema->'const'->'source'->'values'=source.values
  AND NEW.source_set_hash=contract.input_schema->'const'->'source'->>'hash'
 ) THEN RAISE EXCEPTION 'public title requires original public source and independent exact contract' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_title_manifest_guard BEFORE INSERT OR UPDATE OR DELETE ON context_manifests FOR EACH ROW EXECUTE FUNCTION guard_public_title_manifest();

-- Extend only genuine title scope; all previous book/public-character paths stay intact.
DO $$ DECLARE definition text; boundary integer; injection text; BEGIN
 definition:=pg_get_functiondef('new_design.guard_public_character_manifest()'::regprocedure);boundary:=strpos(definition,'BEGIN');
 IF boundary=0 THEN RAISE EXCEPTION 'original public manifest guard unavailable'; END IF;
 injection:=' IF TG_OP <> ''DELETE'' THEN IF NEW.public_title_scope IS NOT NULL THEN RETURN NEW; END IF; ELSE IF OLD.public_title_scope IS NOT NULL THEN RETURN OLD; END IF; END IF; ';
 EXECUTE substr(definition,1,boundary+4)||injection||substr(definition,boundary+5);
 definition:=pg_get_functiondef('new_design.resolve_dependency_resource(text,uuid,uuid)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION new_design.resolve_dependency_resource(','FUNCTION new_design.resolve_dependency_resource_pre103(');
END $$;
CREATE OR REPLACE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE SET search_path TO pg_catalog,new_design,ag_catalog,public,pg_temp AS $$
BEGIN
 IF requested_kind='context_manifest' AND EXISTS(SELECT 1 FROM context_manifests WHERE id=requested_stable_id AND id=requested_version_id AND book_id IS NULL AND public_title_scope IS NOT NULL) THEN
  RETURN QUERY SELECT card.space_id,NULL::uuid,manifest.manifest_hash FROM context_manifests manifest JOIN cards card ON card.id=manifest.public_title_scope WHERE manifest.id=requested_stable_id AND manifest.id=requested_version_id;
 ELSE RETURN QUERY SELECT * FROM resolve_dependency_resource_pre103(requested_kind,requested_stable_id,requested_version_id); END IF;
END $$;
DO $$ DECLARE definition text; boundary integer; injection text; BEGIN
 definition:=pg_get_functiondef('new_design.bridge_dependency_creation()'::regprocedure);boundary:=strpos(definition,'BEGIN');
 IF boundary=0 THEN RAISE EXCEPTION 'original dependency bridge unavailable'; END IF;
 injection:=$patch$
 IF TG_TABLE_NAME='context_manifests' THEN
  IF NEW.book_id IS NULL AND NEW.public_title_scope IS NOT NULL THEN PERFORM register_dependency_resource('context_manifest',NEW.id,NEW.id); RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='context_manifest_entries' THEN
  IF EXISTS(SELECT 1 FROM context_manifests WHERE id=NEW.manifest_id AND book_id IS NULL AND public_title_scope IS NOT NULL) THEN PERFORM register_dependency_resource(NEW.source_type,NEW.stable_object_id,COALESCE(NEW.exact_version_id,NEW.stable_object_id)); RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='ai_task_attempts' THEN
  IF EXISTS(SELECT 1 FROM context_manifests WHERE id=NEW.context_manifest_id AND book_id IS NULL AND public_title_scope IS NOT NULL) THEN IF NEW.status='succeeded' AND OLD.status IS DISTINCT FROM NEW.status THEN PERFORM register_dependency_resource('ai_task_attempt',NEW.task_id,NEW.id); END IF; RETURN NEW; END IF;
 END IF;
 $patch$;
 EXECUTE substr(definition,1,boundary+4)||injection||substr(definition,boundary+5);
 definition:=pg_get_functiondef('new_design.initialize_new_complete_context_state()'::regprocedure);boundary:=strpos(definition,'BEGIN');
 IF boundary=0 THEN RAISE EXCEPTION 'original context state bridge unavailable'; END IF;
 EXECUTE substr(definition,1,boundary+4)||' IF NEW.book_id IS NULL AND NEW.public_title_scope IS NOT NULL THEN RETURN NEW; END IF; '||substr(definition,boundary+5);
END $$;

CREATE FUNCTION guard_public_title_trial() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE task ai_tasks%ROWTYPE;step ai_task_steps%ROWTYPE;attempt ai_task_attempts%ROWTYPE;contract task_contract_versions%ROWTYPE;manifest context_manifests%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'original public title trial immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'running' OR NEW.reply IS NOT NULL OR NEW.output IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public_title_factory_capability WHERE operational) THEN RAISE EXCEPTION 'public title not enabled' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','reply','output','summary']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reply','output','summary']) OR OLD.status<>'running' OR OLD.reply IS NOT NULL AND NEW.reply IS DISTINCT FROM OLD.reply THEN RAISE EXCEPTION 'original title input/reply immutable' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO STRICT task FROM ai_tasks WHERE id=NEW.id;SELECT * INTO STRICT step FROM ai_task_steps WHERE id=NEW.step_id AND task_id=NEW.id;SELECT * INTO STRICT attempt FROM ai_task_attempts WHERE id=NEW.attempt_id AND step_id=NEW.step_id AND task_id=NEW.id;
 SELECT * INTO STRICT contract FROM task_contract_versions WHERE id=task.task_contract_version_id;SELECT * INTO STRICT manifest FROM context_manifests WHERE id=attempt.context_manifest_id;
 IF NOT COALESCE(task.book_id IS NULL AND task.space_id='60000000-0000-4000-8000-000000000001' AND task.source_kind='public_title_factory' AND task.source_id=NEW.id AND task.request_hash=NEW.request_hash AND task.request_idempotency_key=NEW.request_key::text AND contract.task_group='creative_extraction' AND contract.budget_policy->>'assetId'='new_design.public.title_factory' AND contract.budget_policy->>'assetVersion'='v1' AND contract.retry_policy='{"maxAttempts":1,"automaticRetry":false}'::jsonb AND contract.input_schema->'const'=NEW.frozen_plan->'promptInput' AND contract.input_schema->'const'->'input'=NEW.input_payload AND contract.input_schema->'const'->'source'=NEW.source_snapshot AND NEW.source_snapshot->>'id'=NEW.source_id::text AND NEW.source_snapshot->>'versionId'=NEW.source_version_id::text AND NEW.source_snapshot->>'hash'=NEW.source_hash AND manifest.book_id IS NULL AND manifest.public_title_scope=NEW.source_id AND manifest.task_contract_version_id=contract.id AND step.max_attempts=1 AND attempt.attempt_number=1 AND attempt.input_hash=NEW.frozen_plan->>'inputHash' AND attempt.output_schema_version=NEW.frozen_plan->>'outputSchemaVersion' AND attempt.model_route_snapshot_id=(NEW.frozen_plan->>'snapshotId')::uuid,false) THEN RAISE EXCEPTION 'original title frozen execution mismatch' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM card_versions version JOIN cards card ON card.id=version.card_id JOIN card_types type ON type.id=card.card_type_id WHERE version.id=NEW.source_version_id AND card.id=NEW.source_id AND card.space_id=task.space_id AND type.type_key='public_title_brief' AND version.values=NEW.source_snapshot->'values') OR NOT EXISTS(SELECT 1 FROM context_manifest_entries entry WHERE entry.manifest_id=manifest.id AND entry.source_type='card_version' AND entry.stable_object_id=NEW.source_id AND entry.exact_version_id=NEW.source_version_id AND entry.transform_status='full') THEN RAISE EXCEPTION 'original title source version unavailable' USING ERRCODE='23514'; END IF;
 IF NEW.reply IS NOT NULL AND NOT COALESCE(NEW.reply->'output'->>'sourceId'=NEW.source_id::text AND NEW.reply->'output'->>'sourceVersionId'=NEW.source_version_id::text AND NEW.reply->'output'->>'sourceHash'=NEW.source_hash AND NEW.reply->'execution'->>'routeSnapshotId'=NEW.frozen_plan->>'snapshotId' AND NEW.reply->'execution'->>'routeSnapshotHash'=NEW.frozen_plan->>'snapshotHash' AND jsonb_array_length(NEW.reply->'output'->'groups')=(NEW.input_payload->>'groupCount')::integer AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reply->'output'->'groups') item WHERE jsonb_array_length(item->'titles')<>(NEW.input_payload->>'candidatesPerGroup')::integer) AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reply->'execution'->'attempts') trace WHERE trace->>'status'='succeeded' AND trace->>'requestSent'='true' AND trace->>'responseReceived'='true'),false) THEN RAISE EXCEPTION 'original title reply execution mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='succeeded' AND (NEW.reply IS NULL OR NEW.output IS DISTINCT FROM NEW.reply->'output' OR task.status<>'succeeded' OR step.status<>'succeeded' OR attempt.status<>'succeeded') THEN RAISE EXCEPTION 'original successful title requires original reply and ledger' USING ERRCODE='23514'; END IF;
 IF NEW.status IN('failed','ended_unknown') AND (NEW.output IS NOT NULL OR task.status<>CASE WHEN NEW.status='failed' THEN 'failed' ELSE 'cancelled' END OR attempt.status<>CASE WHEN NEW.status='failed' THEN 'failed' ELSE 'discarded' END) THEN RAISE EXCEPTION 'original title failure ledger mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_title_trial_guard BEFORE INSERT OR UPDATE OR DELETE ON public_title_factory_trials FOR EACH ROW EXECUTE FUNCTION guard_public_title_trial();
CREATE FUNCTION guard_public_title_choice() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE trial public_title_factory_trials%ROWTYPE; chosen text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'original title selection immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT trial FROM public_title_factory_trials WHERE id=NEW.trial_id AND status='succeeded';chosen:=trial.output->'groups'->((NEW.input_payload->>'groupIndex')::integer)->'titles'->((NEW.input_payload->>'titleIndex')::integer)->>'title';
 IF NOT COALESCE(NEW.input_payload->>'requestKey'=NEW.request_key::text AND NEW.input_payload->>'trialId'=NEW.trial_id::text AND NEW.input_payload->>'sourceVersionId'=trial.source_version_id::text AND NEW.input_payload->>'sourceHash'=trial.source_hash AND chosen IS NOT NULL AND NEW.receipt->>'title'=chosen AND NEW.receipt->>'requestKey'=NEW.request_key::text AND NEW.receipt->>'inputHash'=NEW.input_hash AND NEW.receipt->'command'=NEW.input_payload,false) THEN RAISE EXCEPTION 'original title choice mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.input_payload->>'action' IN('save_library','archive_library') THEN
  IF NOT EXISTS(SELECT 1 FROM card_versions version JOIN cards card ON card.id=version.card_id JOIN card_types type ON type.id=card.card_type_id WHERE card.id=(NEW.receipt->>'resourceId')::uuid AND version.id=(NEW.receipt->>'versionId')::uuid AND version.card_id=card.id AND version.id=card.current_version_id AND card.space_id='60000000-0000-4000-8000-000000000001' AND type.type_key='public_title_resource' AND version.values->>'source_trial_id'=trial.id::text AND version.values->>'source_version_id'=trial.source_version_id::text AND version.values->>'source_hash'=trial.source_hash AND version.values->>'name'=chosen AND (NEW.input_payload->>'action'='save_library' AND card.status='active' AND version.source='create' OR NEW.input_payload->>'action'='archive_library' AND card.status='archived' AND version.source='archive' AND NEW.input_payload->>'resourceId'=card.id::text AND (NEW.input_payload->>'expectedRevision')::integer+1=card.revision AND NEW.input_payload->>'confirm'='true')) OR NEW.receipt->'bookRevision'<>'null'::jsonb THEN RAISE EXCEPTION 'original title library version mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.input_payload->>'action'='adopt_book_title' THEN
  IF NOT EXISTS(SELECT 1 FROM books WHERE id=(NEW.input_payload->>'bookId')::uuid AND status='active' AND name=chosen AND revision=(NEW.input_payload->>'expectedBookRevision')::integer+1 AND revision=(NEW.receipt->>'bookRevision')::integer AND NEW.input_payload->>'confirm'='true') OR NEW.receipt->'resourceId'<>'null'::jsonb OR NEW.receipt->'versionId'<>'null'::jsonb THEN RAISE EXCEPTION 'original explicit book title adoption mismatch' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'unknown public title action' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_title_choice_guard BEFORE INSERT OR UPDATE OR DELETE ON public_title_factory_choices FOR EACH ROW EXECUTE FUNCTION guard_public_title_choice();
