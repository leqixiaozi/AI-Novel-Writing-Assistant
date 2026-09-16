SET search_path TO new_design, public;

ALTER TABLE book_creation_sessions ADD COLUMN director_control_receipts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(director_control_receipts)='array');
ALTER TABLE book_creation_sessions ADD COLUMN director_active_command_key text CHECK(director_active_command_key IS NULL OR length(director_active_command_key) BETWEEN 8 AND 160);
ALTER TABLE book_creation_sessions ADD COLUMN director_command_failure jsonb CHECK(director_command_failure IS NULL OR jsonb_typeof(director_command_failure)='object');
ALTER TABLE ai_generation_batches
 ADD COLUMN preparation_contract text CHECK(preparation_contract IS NULL OR preparation_contract='creation_preparation_v1'),
 ADD COLUMN preparation_request_key text CHECK(preparation_request_key IS NULL OR length(preparation_request_key) BETWEEN 8 AND 160),
 ADD COLUMN preparation_request_hash text CHECK(preparation_request_hash IS NULL OR preparation_request_hash ~ '^[0-9a-f]{64}$'),
 ADD COLUMN frozen_plan jsonb CHECK(frozen_plan IS NULL OR jsonb_typeof(frozen_plan)='object'),
 ADD COLUMN model_route_snapshot_id uuid REFERENCES model_route_snapshots(id),
 ADD COLUMN preparation_lease_until timestamptz,
 ADD COLUMN preparation_generated_output jsonb CHECK(preparation_generated_output IS NULL OR jsonb_typeof(preparation_generated_output)='object'),
 ADD COLUMN preparation_execution jsonb CHECK(preparation_execution IS NULL OR jsonb_typeof(preparation_execution)='object'),
 ADD COLUMN preparation_failure jsonb CHECK(preparation_failure IS NULL OR jsonb_typeof(preparation_failure)='object'),
 ADD COLUMN preparation_terminal text CHECK(preparation_terminal IS NULL OR preparation_terminal IN('released','ended_unknown')),
 ADD COLUMN preparation_superseded_by uuid REFERENCES ai_generation_batches(id),
 ADD COLUMN preparation_adoption_receipts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(preparation_adoption_receipts)='array'),
 ADD CONSTRAINT creation_preparation_complete CHECK(
  (preparation_contract IS NULL AND num_nonnulls(preparation_request_key,preparation_request_hash,frozen_plan,model_route_snapshot_id,preparation_lease_until,preparation_generated_output,preparation_execution,preparation_failure,preparation_terminal,preparation_superseded_by)=0)
  OR (preparation_contract='creation_preparation_v1' AND session_id IS NOT NULL AND book_id IS NULL AND card_id IS NULL AND base_revision IS NOT NULL AND num_nonnulls(preparation_request_key,preparation_request_hash,frozen_plan,model_route_snapshot_id,preparation_lease_until)=5));
CREATE UNIQUE INDEX creation_preparation_key_unique ON ai_generation_batches(session_id,preparation_request_key) WHERE preparation_contract IS NOT NULL;

CREATE FUNCTION guard_creation_director_control_receipts() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE entry jsonb;
BEGIN
 IF TG_OP='DELETE' THEN IF jsonb_array_length(OLD.director_control_receipts)>0 THEN RAISE EXCEPTION '导演原控制回执不可删除' USING ERRCODE='23514'; END IF; RETURN OLD; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(OLD.director_control_receipts) LOOP
  IF NOT NEW.director_control_receipts @> jsonb_build_array(entry) THEN RAISE EXCEPTION '导演原控制回执不可改写' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER creation_director_control_receipts_guard BEFORE UPDATE OR DELETE ON book_creation_sessions FOR EACH ROW EXECUTE FUNCTION guard_creation_director_control_receipts();

CREATE FUNCTION guard_creation_preparation_ai() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE entry jsonb; snapshot model_route_snapshots%ROWTYPE; source_batch ai_generation_batches%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.preparation_contract IS NOT NULL THEN RAISE EXCEPTION '受控开书准备原记录不可删除' USING ERRCODE='23514'; END IF; RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND OLD.preparation_contract IS DISTINCT FROM NEW.preparation_contract THEN RAISE EXCEPTION '原批次不能伪装为新受控开书准备' USING ERRCODE='23514'; END IF;
 IF NEW.preparation_contract IS NULL THEN RETURN NEW; END IF;
 IF NEW.frozen_plan->>'format' IS DISTINCT FROM '1' OR NEW.frozen_plan->'input'->>'contract' IS DISTINCT FROM 'creation_preparation_v1'
  OR NEW.frozen_plan->'input'->>'sessionId' IS DISTINCT FROM NEW.session_id::text
  OR NEW.frozen_plan->'input'->>'sessionRevision' IS DISTINCT FROM NEW.base_revision::text
  OR NEW.frozen_plan->>'taskType' IS DISTINCT FROM NEW.operation OR NEW.frozen_plan->>'assetId' IS DISTINCT FROM NEW.prompt_id
  OR NEW.frozen_plan->>'assetVersion' IS DISTINCT FROM NEW.prompt_version
  OR NEW.prompt_id IS DISTINCT FROM (CASE NEW.operation WHEN 'directions' THEN 'new_design.creation.directions' WHEN 'initial_content' THEN 'new_design.creation.initial_content' WHEN 'form_assist' THEN 'new_design.forms.assist' END)
  OR NEW.prompt_version IS DISTINCT FROM 'v1' OR jsonb_typeof(NEW.frozen_plan->'sourceBatches') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.frozen_plan->'input'->'targets') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.frozen_plan->'outputSchema') IS DISTINCT FROM 'object'
  OR jsonb_typeof(NEW.frozen_plan->'messages') IS DISTINCT FROM 'array'
  OR COALESCE(NEW.frozen_plan->>'inputHash','') !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION '受控开书准备必须冻结准确来源与自有提示合同' USING ERRCODE='23514';
 END IF;
 SELECT * INTO snapshot FROM model_route_snapshots WHERE id=NEW.model_route_snapshot_id;
 IF NOT FOUND OR snapshot.managed_task_key IS DISTINCT FROM NEW.operation
  OR NEW.frozen_plan->'modelSnapshot'->>'id' IS DISTINCT FROM snapshot.id::text
  OR NEW.frozen_plan->'modelSnapshot'->>'snapshotHash' IS DISTINCT FROM snapshot.snapshot_hash THEN
  RAISE EXCEPTION '开书准备必须引用真实本任务模型快照' USING ERRCODE='23514';
 END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(NEW.frozen_plan->'sourceBatches') LOOP
  SELECT * INTO source_batch FROM ai_generation_batches WHERE id=(entry->>'id')::uuid;
  IF NOT FOUND OR source_batch.id=NEW.id OR source_batch.session_id IS DISTINCT FROM NEW.session_id OR source_batch.preparation_contract IS DISTINCT FROM NEW.preparation_contract
   OR source_batch.frozen_plan->>'inputHash' IS DISTINCT FROM entry->>'inputHash'
   OR COALESCE(entry->>'outputHash','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(source_batch.output_payload->'candidates') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION '累计候选必须引用同一开书原批次精确输出' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'running' OR NEW.preparation_generated_output IS NOT NULL OR NEW.preparation_execution IS NOT NULL OR NEW.preparation_terminal IS NOT NULL OR NEW.preparation_superseded_by IS NOT NULL OR jsonb_array_length(NEW.preparation_adoption_receipts)<>0 THEN RAISE EXCEPTION '新开书准备必须从未执行的冻结运行开始' USING ERRCODE='23514'; END IF;
 ELSE
  IF (OLD.session_id,OLD.operation,OLD.base_revision,OLD.prompt_id,OLD.prompt_version,OLD.preparation_request_key,OLD.preparation_request_hash,OLD.frozen_plan,OLD.model_route_snapshot_id,OLD.preparation_lease_until) IS DISTINCT FROM (NEW.session_id,NEW.operation,NEW.base_revision,NEW.prompt_id,NEW.prompt_version,NEW.preparation_request_key,NEW.preparation_request_hash,NEW.frozen_plan,NEW.model_route_snapshot_id,NEW.preparation_lease_until) THEN RAISE EXCEPTION '已领取开书来源与请求不可换版' USING ERRCODE='23514'; END IF;
  IF OLD.preparation_generated_output IS NOT NULL AND (OLD.preparation_generated_output IS DISTINCT FROM NEW.preparation_generated_output OR OLD.preparation_execution IS DISTINCT FROM NEW.preparation_execution) THEN RAISE EXCEPTION '已保存原模型输出与真实用量不可改写' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(OLD.output_payload->'candidates')='array' AND OLD.output_payload IS DISTINCT FROM NEW.output_payload THEN RAISE EXCEPTION '已保存累计候选不可改写' USING ERRCODE='23514'; END IF;
  IF OLD.preparation_terminal IS NOT NULL AND (OLD.preparation_terminal IS DISTINCT FROM NEW.preparation_terminal OR OLD.status IS DISTINCT FROM NEW.status OR OLD.preparation_generated_output IS DISTINCT FROM NEW.preparation_generated_output) THEN RAISE EXCEPTION '已结束原准备不可复活或接受迟到结果' USING ERRCODE='23514'; END IF;
  IF OLD.status<>NEW.status AND NOT ((OLD.status='running' AND NEW.status IN('review','failed','discarded')) OR (OLD.status='review' AND NEW.status IN('applied','discarded'))) THEN RAISE EXCEPTION '开书准备状态迁移非法' USING ERRCODE='23514'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(OLD.preparation_adoption_receipts) LOOP
   IF NOT NEW.preparation_adoption_receipts @> jsonb_build_array(entry) THEN RAISE EXCEPTION '原候选采用回执不可改写' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 IF NEW.preparation_generated_output IS NOT NULL THEN
  IF jsonb_typeof(NEW.preparation_generated_output->'candidates') IS DISTINCT FROM 'array' OR NEW.preparation_execution IS NULL
   OR NEW.preparation_execution->'modelSnapshot'->>'routeSnapshotId' IS DISTINCT FROM snapshot.id::text
   OR NEW.preparation_execution->'modelSnapshot'->>'routeSnapshotHash' IS DISTINCT FROM snapshot.snapshot_hash
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.preparation_execution->'modelSnapshot'->'attempts') attempt WHERE attempt->>'requestSent'='true' AND attempt->>'status'='succeeded') THEN RAISE EXCEPTION '保存模型输出必须附真实已发送执行与快照回执' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status IN('review','applied') AND (NEW.preparation_generated_output IS NULL OR jsonb_typeof(NEW.output_payload->'candidates') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION '候选审阅与采用必须已有真实保存的模型输出' USING ERRCODE='23514'; END IF;
 IF NEW.preparation_terminal IS NOT NULL AND NEW.status<>'discarded' THEN RAISE EXCEPTION '已结束准备必须保留终止状态' USING ERRCODE='23514'; END IF;
 IF NEW.preparation_terminal='released' AND NEW.preparation_generated_output IS NULL THEN RAISE EXCEPTION '保留旧结果结束必须已有原输出' USING ERRCODE='23514'; END IF;
 IF NEW.preparation_terminal='ended_unknown' AND NEW.preparation_generated_output IS NOT NULL THEN RAISE EXCEPTION '真实已保存输出不能称为未知未返回' USING ERRCODE='23514'; END IF;
 IF NEW.preparation_superseded_by IS NOT NULL THEN
  SELECT * INTO source_batch FROM ai_generation_batches WHERE id=NEW.preparation_superseded_by;
  IF NOT FOUND OR source_batch.id=NEW.id OR source_batch.session_id IS DISTINCT FROM NEW.session_id OR source_batch.preparation_contract IS DISTINCT FROM NEW.preparation_contract OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_batch.frozen_plan->'sourceBatches') source WHERE source->>'id'=NEW.id::text) THEN RAISE EXCEPTION '前阶段只读来源必须指向真实累计后批次' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER creation_preparation_ai_guard BEFORE INSERT OR UPDATE OR DELETE ON ai_generation_batches FOR EACH ROW EXECUTE FUNCTION guard_creation_preparation_ai();
