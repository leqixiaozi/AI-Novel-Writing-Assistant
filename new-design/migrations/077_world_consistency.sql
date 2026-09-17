SET search_path TO new_design,public;
-- Exact quality sources, not a second problem ledger or second material fact.
CREATE TABLE quality_report_material_versions (
 report_id uuid NOT NULL REFERENCES quality_audit_reports(id),
 subject_kind text NOT NULL CHECK(subject_kind IN('card','relation')),
 subject_id uuid NOT NULL,
 card_version_id uuid REFERENCES card_versions(id),
 relation_version_id uuid REFERENCES card_relation_versions(id),
 snapshot_hash char(64) NOT NULL CHECK(snapshot_hash ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(report_id,subject_kind,subject_id),
 CHECK((subject_kind='card' AND card_version_id IS NOT NULL AND relation_version_id IS NULL) OR (subject_kind='relation' AND relation_version_id IS NOT NULL AND card_version_id IS NULL))
);
CREATE TRIGGER quality_material_binding_append_only BEFORE UPDATE OR DELETE ON quality_report_material_versions FOR EACH ROW EXECUTE FUNCTION guard_quality_append_only();
ALTER TABLE quality_issue_evidence ADD COLUMN material_kind text CHECK(material_kind IN('card','relation')),
 ADD COLUMN material_id uuid, ADD COLUMN card_version_id uuid REFERENCES card_versions(id),
 ADD COLUMN relation_version_id uuid REFERENCES card_relation_versions(id), ADD COLUMN field_key text,
 ADD COLUMN field_spec_version_id uuid, ADD COLUMN field_spec_hash char(64), ADD COLUMN observed_value_hash char(64);
-- Preserve every original evidence expression for old kinds; only the precise material arm is added.
DO $$ DECLARE c record; expression text; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='quality_issue_evidence'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%evidence_kind%' LOOP
  expression:=regexp_replace(c.definition,'^CHECK \((.*)\)$','\1','s');
  EXECUTE format('ALTER TABLE quality_issue_evidence DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE quality_issue_evidence ADD CONSTRAINT %I CHECK ((%s) OR (evidence_kind IN (''card_field'',''relation_field'') AND material_id IS NOT NULL AND field_key IS NOT NULL AND field_spec_hash IS NOT NULL AND observed_value_hash IS NOT NULL AND NOT is_unverified_observation AND num_nonnulls(text_anchor_id,fact_id,state_change_id,story_timing_id,story_relation_id,planning_version_id,rule_key,rule_version)=0))',c.conname,expression);
 END LOOP;
END $$;
ALTER TABLE quality_issue_evidence ADD CONSTRAINT world_evidence_exact_shape CHECK(
 (evidence_kind='card_field' AND num_nonnulls(material_kind,material_id,card_version_id,field_key,field_spec_version_id,field_spec_hash,observed_value_hash)=7 AND material_kind='card' AND relation_version_id IS NULL AND field_spec_hash ~ '^[0-9a-f]{64}$' AND observed_value_hash ~ '^[0-9a-f]{64}$') OR
 (evidence_kind='relation_field' AND num_nonnulls(material_kind,material_id,relation_version_id,field_key,field_spec_hash,observed_value_hash)=6 AND material_kind='relation' AND card_version_id IS NULL AND field_spec_version_id IS NULL AND field_spec_hash ~ '^[0-9a-f]{64}$' AND observed_value_hash ~ '^[0-9a-f]{64}$') OR
 (evidence_kind NOT IN('card_field','relation_field') AND num_nonnulls(material_kind,material_id,card_version_id,relation_version_id,field_key,field_spec_version_id,field_spec_hash,observed_value_hash)=0));
ALTER TABLE quality_fix_candidate_versions ALTER COLUMN target_chapter_document_id DROP NOT NULL,
 ALTER COLUMN target_body_version_id DROP NOT NULL,
 ADD COLUMN target_card_id uuid REFERENCES cards(id), ADD COLUMN target_card_version_id uuid REFERENCES card_versions(id),
 ADD COLUMN target_field_key text, ADD COLUMN target_field_spec_version_id uuid, ADD COLUMN target_field_spec_hash char(64), ADD COLUMN target_before_hash char(64);
ALTER TABLE quality_fix_candidate_versions ADD CONSTRAINT world_fix_target_shape CHECK(
 (target_chapter_document_id IS NOT NULL AND target_body_version_id IS NOT NULL AND num_nonnulls(target_card_id,target_card_version_id,target_field_key,target_field_spec_version_id,target_field_spec_hash,target_before_hash)=0) OR
 (target_chapter_document_id IS NULL AND target_body_version_id IS NULL AND target_anchor_id IS NULL AND num_nonnulls(target_card_id,target_card_version_id,target_field_key,target_field_spec_version_id,target_field_spec_hash,target_before_hash)=6 AND target_field_spec_hash ~ '^[0-9a-f]{64}$' AND target_before_hash ~ '^[0-9a-f]{64}$'));
ALTER TABLE quality_rechecks ALTER COLUMN checked_body_version_id DROP NOT NULL,
 ADD COLUMN checked_material_versions jsonb;
ALTER TABLE quality_rechecks ADD CONSTRAINT world_recheck_exact_shape CHECK(
 (checked_body_version_id IS NOT NULL AND checked_material_versions IS NULL) OR
 (checked_body_version_id IS NULL AND checked_material_versions IS NOT NULL AND jsonb_typeof(checked_material_versions)='array' AND jsonb_array_length(checked_material_versions)>0));
ALTER TABLE quality_fix_adoptions ALTER COLUMN chapter_body_adoption_id DROP NOT NULL, ALTER COLUMN adopted_body_version_id DROP NOT NULL,
 ADD COLUMN adopted_card_version_id uuid REFERENCES card_versions(id), ADD COLUMN author_write_request_key uuid,
 ADD COLUMN world_repair_request_hash char(64), ADD COLUMN world_repair_input jsonb;
ALTER TABLE quality_fix_adoptions ADD CONSTRAINT world_fix_adoption_shape CHECK(
 (chapter_body_adoption_id IS NOT NULL AND adopted_body_version_id IS NOT NULL AND adopted_card_version_id IS NULL AND num_nonnulls(author_write_request_key,world_repair_request_hash,world_repair_input)=0) OR
 (chapter_body_adoption_id IS NULL AND adopted_body_version_id IS NULL AND adopted_card_version_id IS NOT NULL AND num_nonnulls(author_write_request_key,world_repair_request_hash,world_repair_input)=3 AND world_repair_request_hash ~ '^[0-9a-f]{64}$' AND jsonb_typeof(world_repair_input)='object' AND world_repair_input->>'authorWriteRequestKey' IS NOT NULL AND world_repair_input->>'requestKey' IS NOT NULL AND world_repair_input->>'authorWriteRequestKey'=author_write_request_key::text AND world_repair_input->>'requestKey'=idempotency_key));
CREATE TABLE world_consistency_requests (
 id uuid PRIMARY KEY,book_id uuid NOT NULL REFERENCES books(id),request_key uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'), input_hash char(64) NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 input_payload jsonb NOT NULL,frozen_plan jsonb NOT NULL,
 ai_task_id uuid NOT NULL REFERENCES ai_tasks(id),step_id uuid NOT NULL REFERENCES ai_task_steps(id),attempt_id uuid NOT NULL REFERENCES ai_task_attempts(id),
 report_id uuid UNIQUE REFERENCES quality_audit_reports(id),
 status text NOT NULL DEFAULT 'running' CHECK(status IN('running','failed','succeeded','stale','ended_unknown')),
 model_request_state text NOT NULL DEFAULT 'not_sent' CHECK(model_request_state IN('not_sent','sent_unknown','completed')),
 generated_output jsonb,generated_execution jsonb,failure jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(book_id,request_key));
CREATE FUNCTION guard_world_consistency_request() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'world consistency evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (OLD.book_id,OLD.request_key,OLD.request_hash,OLD.input_hash,OLD.input_payload,OLD.frozen_plan,OLD.ai_task_id,OLD.step_id,OLD.attempt_id) IS DISTINCT FROM (NEW.book_id,NEW.request_key,NEW.request_hash,NEW.input_hash,NEW.input_payload,NEW.frozen_plan,NEW.ai_task_id,NEW.step_id,NEW.attempt_id) THEN RAISE EXCEPTION 'world consistency freeze is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.generated_output IS NOT NULL AND (OLD.generated_output,OLD.generated_execution) IS DISTINCT FROM (NEW.generated_output,NEW.generated_execution) THEN RAISE EXCEPTION 'world consistency original reply is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'running' AND (OLD.status,OLD.report_id) IS DISTINCT FROM (NEW.status,NEW.report_id) THEN RAISE EXCEPTION 'terminal world check cannot be revived' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_tasks task JOIN ai_task_steps step ON step.task_id=task.id JOIN ai_task_attempts attempt ON attempt.task_id=task.id AND attempt.step_id=step.id WHERE task.id=NEW.ai_task_id AND task.book_id=NEW.book_id AND task.source_kind='world_consistency' AND task.source_id=NEW.id AND step.id=NEW.step_id AND attempt.id=NEW.attempt_id AND attempt.input_hash=NEW.input_hash AND attempt.attempt_number=1 AND step.max_attempts=1) THEN RAISE EXCEPTION 'world check task attempt provenance mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.status='succeeded' AND NEW.report_id IS NULL THEN RAISE EXCEPTION 'world check success requires original quality report' USING ERRCODE='23514'; END IF;
 IF NEW.report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quality_audit_reports report WHERE report.id=NEW.report_id AND report.book_id=NEW.book_id AND report.task_id=NEW.ai_task_id AND report.step_id=NEW.step_id AND report.attempt_id=NEW.attempt_id AND report.input_hash=NEW.input_hash AND report.rule_set_key='world_consistency' AND report.rule_set_version='v1') THEN RAISE EXCEPTION 'world report does not match original request' USING ERRCODE='23514'; END IF;
 IF NEW.generated_output IS NOT NULL AND (jsonb_typeof(NEW.generated_output)<>'object' OR NEW.generated_execution IS NULL OR jsonb_typeof(NEW.generated_execution)<>'object' OR NEW.model_request_state<>'completed' OR NEW.generated_execution->>'routeSnapshotId' IS DISTINCT FROM NEW.frozen_plan->>'snapshotId' OR NEW.generated_execution->>'routeSnapshotHash' IS DISTINCT FROM NEW.frozen_plan->>'snapshotHash' OR NEW.generated_execution->>'provider' IS DISTINCT FROM NEW.frozen_plan->'route'->'primary'->>'provider' OR NEW.generated_execution->>'model' IS DISTINCT FROM NEW.frozen_plan->'route'->'primary'->>'model' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.generated_execution->'attempts','[]'::jsonb)) attempt WHERE attempt->>'status'='succeeded' AND attempt->>'responseReceived'='true' AND attempt->>'requestSent'='true')) THEN RAISE EXCEPTION 'world reply requires original received execution proof' USING ERRCODE='23514'; END IF;
 IF NEW.status='ended_unknown' AND NEW.generated_output IS NOT NULL THEN RAISE EXCEPTION 'saved world reply cannot become unknown' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_consistency_request_guard BEFORE INSERT OR UPDATE OR DELETE ON world_consistency_requests FOR EACH ROW EXECUTE FUNCTION guard_world_consistency_request();
CREATE FUNCTION validate_world_quality_material() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ DECLARE actual_book uuid; BEGIN
 IF NEW.subject_kind='card' THEN SELECT book.id INTO actual_book FROM card_versions version JOIN cards card ON card.id=version.card_id JOIN books book ON book.space_id=card.space_id WHERE version.id=NEW.card_version_id AND card.id=NEW.subject_id;
 ELSE SELECT book.id INTO actual_book FROM card_relation_versions version JOIN card_relations relation ON relation.id=version.card_relation_id JOIN books book ON book.space_id=relation.space_id WHERE version.id=NEW.relation_version_id AND relation.id=NEW.subject_id; END IF;
 IF actual_book IS NULL OR NOT EXISTS(SELECT 1 FROM quality_audit_reports WHERE id=NEW.report_id AND book_id=actual_book) THEN RAISE EXCEPTION 'world quality source belongs to another book' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER world_quality_material_binding_guard BEFORE INSERT ON quality_report_material_versions FOR EACH ROW EXECUTE FUNCTION validate_world_quality_material();
CREATE FUNCTION world_quality_evidence_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF NEW.evidence_kind IN('card_field','relation_field') AND NOT EXISTS(
 SELECT 1 FROM quality_issue_versions version JOIN quality_issues issue ON issue.id=version.issue_id JOIN quality_report_material_versions binding ON binding.report_id=issue.report_id
 WHERE version.id=NEW.issue_version_id AND binding.subject_kind=NEW.material_kind AND binding.subject_id=NEW.material_id
 AND binding.card_version_id IS NOT DISTINCT FROM NEW.card_version_id AND binding.relation_version_id IS NOT DISTINCT FROM NEW.relation_version_id
 AND EXISTS(SELECT 1 FROM world_consistency_requests request JOIN quality_audit_reports report ON report.task_id=request.ai_task_id AND report.attempt_id=request.attempt_id AND report.book_id=request.book_id CROSS JOIN LATERAL jsonb_array_elements(request.generated_output->'findings') finding CROSS JOIN LATERAL jsonb_array_elements(finding->'evidence') evidence
  WHERE report.id=issue.report_id AND finding->>'stableKey'=issue.stable_key AND evidence->>'kind'=NEW.material_kind AND evidence->>'id'=NEW.material_id::text AND evidence->>'versionId'=COALESCE(NEW.card_version_id,NEW.relation_version_id)::text AND evidence->>'fieldKey'=NEW.field_key AND evidence->>'specVersionId' IS NOT DISTINCT FROM NEW.field_spec_version_id::text AND evidence->>'specHash'=NEW.field_spec_hash AND evidence->>'valueHash'=NEW.observed_value_hash))
 THEN RAISE EXCEPTION 'world issue evidence must bind exact original report material' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER world_quality_evidence_binding BEFORE INSERT ON quality_issue_evidence FOR EACH ROW EXECUTE FUNCTION world_quality_evidence_binding_guard();
CREATE FUNCTION guard_world_quality_recheck_binding() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF NEW.checked_material_versions IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM quality_issues issue JOIN quality_audit_reports report ON report.id=NEW.recheck_report_id WHERE issue.id=NEW.issue_id AND issue.book_id=NEW.book_id AND issue.report_id=NEW.source_report_id AND report.book_id=NEW.book_id AND report.stale_at IS NULL AND (NEW.outcome<>'supports_verified' OR issue.current_status='fixed')) OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(NEW.checked_material_versions) subject WHERE jsonb_typeof(subject)<>'object' OR NOT EXISTS(
   SELECT 1 FROM quality_report_material_versions binding WHERE binding.report_id=NEW.recheck_report_id AND binding.subject_kind=subject->>'kind' AND binding.subject_id::text=subject->>'id' AND COALESCE(binding.card_version_id,binding.relation_version_id)::text=subject->>'versionId' AND binding.snapshot_hash=subject->>'snapshotHash'))
 THEN RAISE EXCEPTION 'world recheck must bind exact current report materials and original issue' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_quality_recheck_binding BEFORE INSERT ON quality_rechecks FOR EACH ROW EXECUTE FUNCTION guard_world_quality_recheck_binding();
CREATE FUNCTION guard_world_quality_fix_binding() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF NEW.target_card_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM quality_fix_candidates candidate JOIN quality_issues issue ON issue.id=candidate.issue_id JOIN quality_audit_reports report ON report.id=issue.report_id JOIN quality_report_material_versions binding ON binding.report_id=report.id
 WHERE candidate.id=NEW.candidate_id AND candidate.book_id=issue.book_id AND candidate.book_id=report.book_id AND binding.subject_kind='card' AND binding.subject_id=NEW.target_card_id AND binding.card_version_id=NEW.target_card_version_id)
 THEN RAISE EXCEPTION 'world fix target must bind original issue report material' USING ERRCODE='23514'; END IF;
 IF NEW.base_version_id IS NULL THEN
  IF NEW.source<>'ai' OR NOT EXISTS(SELECT 1 FROM world_consistency_requests request JOIN quality_audit_reports report ON report.task_id=request.ai_task_id AND report.attempt_id=request.attempt_id AND report.book_id=request.book_id JOIN quality_issues issue ON issue.report_id=report.id JOIN quality_fix_candidates candidate ON candidate.issue_id=issue.id CROSS JOIN LATERAL jsonb_array_elements(request.generated_output->'findings') finding CROSS JOIN LATERAL jsonb_array_elements(finding->'fixes') fix
   WHERE candidate.id=NEW.candidate_id AND finding->>'stableKey'=issue.stable_key AND fix->>'cardId'=NEW.target_card_id::text AND fix->>'cardVersionId'=NEW.target_card_version_id::text AND fix->>'fieldKey'=NEW.target_field_key AND fix->>'specVersionId'=NEW.target_field_spec_version_id::text AND fix->>'specHash'=NEW.target_field_spec_hash AND fix->>'beforeHash'=NEW.target_before_hash AND fix->'after' IS NOT DISTINCT FROM NEW.patch->'after')
  THEN RAISE EXCEPTION 'world initial fix must be an exact original received proposal' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM quality_fix_candidate_versions base WHERE base.id=NEW.base_version_id AND base.candidate_id=NEW.candidate_id AND (base.target_card_id,base.target_card_version_id,base.target_field_key,base.target_field_spec_version_id,base.target_field_spec_hash,base.target_before_hash) IS NOT DISTINCT FROM (NEW.target_card_id,NEW.target_card_version_id,NEW.target_field_key,NEW.target_field_spec_version_id,NEW.target_field_spec_hash,NEW.target_before_hash)) THEN RAISE EXCEPTION 'world fix revision cannot change its exact original target' USING ERRCODE='23514'; END IF;
  IF NEW.source<>'user' OR NOT EXISTS(SELECT 1 FROM quality_fix_candidates candidate JOIN card_versions saved ON saved.card_id=NEW.target_card_id AND saved.author_book_id=candidate.book_id JOIN card_versions baseline ON baseline.id=NEW.target_card_version_id AND baseline.card_id=NEW.target_card_id JOIN cards card ON card.id=NEW.target_card_id
   WHERE candidate.id=NEW.candidate_id AND saved.id::text=NEW.patch->>'cardVersionId' AND saved.author_request_key::text=NEW.patch->>'authorWriteRequestKey' AND card.current_version_id=saved.id AND saved.revision=baseline.revision+1 AND saved.author_write_receipt->>'operation'='update' AND COALESCE(saved.author_write_receipt->'localValues'->NEW.target_field_key,saved.values->NEW.target_field_key,'null'::jsonb) IS NOT DISTINCT FROM NEW.patch->'after')
  THEN RAISE EXCEPTION 'world user revision requires exact original normal save value' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER world_quality_fix_binding BEFORE INSERT ON quality_fix_candidate_versions FOR EACH ROW EXECUTE FUNCTION guard_world_quality_fix_binding();
CREATE FUNCTION guard_world_quality_adoption_binding() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF NEW.adopted_card_version_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM quality_fix_candidates candidate JOIN quality_fix_candidate_versions version ON version.candidate_id=candidate.id AND version.id=NEW.candidate_version_id JOIN card_versions baseline ON baseline.id=version.target_card_version_id AND baseline.card_id=version.target_card_id JOIN cards card ON card.id=version.target_card_id JOIN card_versions saved ON saved.id=NEW.adopted_card_version_id AND saved.card_id=card.id
  WHERE candidate.id=NEW.candidate_id AND saved.author_book_id=candidate.book_id AND saved.author_request_key=NEW.author_write_request_key AND card.current_version_id=saved.id AND saved.revision=baseline.revision+1 AND saved.author_write_receipt->>'operation'='update' AND saved.author_write_receipt->>'bookId'=candidate.book_id::text AND saved.author_write_receipt->>'cardVersionId'=saved.id::text AND (version.source='ai' OR NEW.world_repair_input->>'allowManualRevision'='true') AND COALESCE(saved.author_write_receipt->'localValues'->version.target_field_key,saved.values->version.target_field_key,'null'::jsonb) IS NOT DISTINCT FROM version.patch->'after')
 THEN RAISE EXCEPTION 'world fix adoption must be exact original normal form save' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER world_quality_adoption_binding BEFORE INSERT ON quality_fix_adoptions FOR EACH ROW EXECUTE FUNCTION guard_world_quality_adoption_binding();
CREATE FUNCTION stale_world_quality_material() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$ BEGIN
 IF OLD.current_version_id IS NOT DISTINCT FROM NEW.current_version_id AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
 UPDATE quality_audit_reports report SET stale_at=now(),stale_reason='正式资料或关系版本已变化；旧报告仅为历史证据'
 WHERE report.stale_at IS NULL AND EXISTS(SELECT 1 FROM quality_report_material_versions binding WHERE binding.report_id=report.id AND binding.subject_id=NEW.id AND binding.subject_kind=CASE WHEN TG_TABLE_NAME='cards' THEN 'card' ELSE 'relation' END);
 UPDATE quality_rechecks recheck SET status='stale',stale_at=now(),stale_reason='复查的正式来源版本已变化'
 WHERE recheck.status='active' AND recheck.checked_material_versions IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(recheck.checked_material_versions) material WHERE material->>'id'=NEW.id::text AND material->>'kind'=CASE WHEN TG_TABLE_NAME='cards' THEN 'card' ELSE 'relation' END);
 RETURN NEW;
END $$;
CREATE TRIGGER world_card_source_stale AFTER UPDATE OF current_version_id,status ON cards FOR EACH ROW EXECUTE FUNCTION stale_world_quality_material();
CREATE TRIGGER world_relation_source_stale AFTER UPDATE OF current_version_id,status ON card_relations FOR EACH ROW EXECUTE FUNCTION stale_world_quality_material();

-- A formal specification or tree change invalidates only reports that froze that source.
-- Revision/timestamp-only no-ops do not rewrite any report or recheck history.
CREATE FUNCTION stale_world_quality_specification() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE old_data jsonb; new_data jsonb; report_ids uuid[];
BEGIN
 new_data:=to_jsonb(NEW);old_data:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 IF TG_OP='UPDATE' AND (old_data-ARRAY['revision','updated_at','updated_by']::text[]) IS NOT DISTINCT FROM (new_data-ARRAY['revision','updated_at','updated_by']::text[]) THEN RETURN NEW; END IF;
 SELECT array_agg(request.report_id) INTO report_ids FROM world_consistency_requests request
 WHERE request.report_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(request.frozen_plan->'catalog'->'subjects') subject
  WHERE
   (TG_TABLE_NAME='field_definitions' AND new_data->>'scope' IN('book_type','card') AND subject->>'kind'='card' AND subject->>'typeId'=new_data->>'card_type_id' AND (new_data->>'scope'='book_type' OR subject->>'id'=new_data->>'card_id') AND EXISTS(SELECT 1 FROM books WHERE id=request.book_id AND space_id::text=new_data->>'space_id')) OR
   (TG_TABLE_NAME='card_types' AND subject->>'kind'='card' AND subject->>'typeId'=new_data->>'id' AND (old_data->>'name' IS DISTINCT FROM new_data->>'name' OR old_data->>'status' IS DISTINCT FROM new_data->>'status')) OR
   (TG_TABLE_NAME='relation_types' AND subject->>'kind'='relation' AND subject->>'typeId'=new_data->>'id') OR
   (TG_TABLE_NAME IN('dictionary_items','dictionary_definitions') AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(subject->'fields') field
    WHERE field->'specification'->'optionSource'->>'kind'='dictionary_tree' AND field->'specification'->'optionSource'->>'dictionaryId'=CASE WHEN TG_TABLE_NAME='dictionary_items' THEN new_data->>'dictionary_id' ELSE new_data->>'id' END))
 );
 IF report_ids IS NULL THEN RETURN NEW; END IF;
 UPDATE quality_audit_reports SET stale_at=now(),stale_reason='正式字段／关系规格或字典树已变化；原检查仅为历史证据' WHERE id=ANY(report_ids) AND stale_at IS NULL;
 UPDATE quality_rechecks SET status='stale',stale_at=now(),stale_reason='复查的正式规格或字典树已变化' WHERE recheck_report_id=ANY(report_ids) AND status='active';
 RETURN NEW;
END $$;
CREATE TRIGGER world_field_specification_stale AFTER INSERT OR UPDATE ON field_definitions FOR EACH ROW EXECUTE FUNCTION stale_world_quality_specification();
CREATE TRIGGER world_card_type_specification_stale AFTER UPDATE ON card_types FOR EACH ROW EXECUTE FUNCTION stale_world_quality_specification();
CREATE TRIGGER world_relation_type_specification_stale AFTER UPDATE ON relation_types FOR EACH ROW EXECUTE FUNCTION stale_world_quality_specification();
CREATE TRIGGER world_dictionary_specification_stale AFTER UPDATE ON dictionary_definitions FOR EACH ROW EXECUTE FUNCTION stale_world_quality_specification();
CREATE TRIGGER world_dictionary_item_specification_stale AFTER INSERT OR UPDATE ON dictionary_items FOR EACH ROW EXECUTE FUNCTION stale_world_quality_specification();
