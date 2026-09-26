SET search_path TO new_design, public;

-- Original execution receipts only. Body versions and quality reports remain canonical.
CREATE TABLE chapter_quality_requests (
 id uuid PRIMARY KEY,
 book_id uuid NOT NULL REFERENCES books(id),
 request_key uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 input_payload jsonb NOT NULL,
 frozen_snapshot jsonb NOT NULL,
 ai_task_id uuid NOT NULL UNIQUE REFERENCES ai_tasks(id),
 step_id uuid NOT NULL UNIQUE REFERENCES ai_task_steps(id),
 attempt_id uuid NOT NULL UNIQUE REFERENCES ai_task_attempts(id),
 report_id uuid UNIQUE REFERENCES quality_audit_reports(id),
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed','stale','ended_unknown')),
 model_request_state text NOT NULL DEFAULT 'not_sent' CHECK(model_request_state IN ('not_sent','sent_unknown','completed')),
 generated_output jsonb,
 generated_execution jsonb,
 failure text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(book_id,request_key),
 CHECK(status<>'succeeded' OR (report_id IS NOT NULL AND generated_output IS NOT NULL)),
 CHECK(generated_output IS NULL OR (generated_execution IS NOT NULL AND model_request_state='completed')),
 CHECK(status<>'ended_unknown' OR generated_output IS NULL)
);
CREATE UNIQUE INDEX chapter_quality_one_running ON chapter_quality_requests(book_id,((input_payload->>'chapterDocumentId'))) WHERE status='running';

CREATE FUNCTION guard_chapter_quality_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter quality original receipt is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (
  (to_jsonb(NEW)-ARRAY['status','model_request_state','generated_output','generated_execution','report_id','failure']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','model_request_state','generated_output','generated_execution','report_id','failure']::text[])
  OR OLD.status<>'running'
  OR (OLD.generated_output IS NOT NULL AND (NEW.generated_output IS DISTINCT FROM OLD.generated_output OR NEW.generated_execution IS DISTINCT FROM OLD.generated_execution))
  OR (OLD.model_request_state<>'not_sent' AND NEW.model_request_state='not_sent')
 ) THEN RAISE EXCEPTION 'chapter quality original source and result are immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM new_design.chapter_documents document JOIN new_design.chapter_body_versions body ON body.chapter_document_id=document.id WHERE document.id=(NEW.input_payload->>'chapterDocumentId')::uuid AND document.book_id=NEW.book_id AND body.id=(NEW.input_payload->>'bodyVersionId')::uuid)
 OR NEW.frozen_snapshot->'input'->>'bookId' IS DISTINCT FROM NEW.book_id::text
 OR NEW.frozen_snapshot->'input'->>'chapterDocumentId' IS DISTINCT FROM NEW.input_payload->>'chapterDocumentId'
 OR NEW.frozen_snapshot->'input'->'body'->>'versionId' IS DISTINCT FROM NEW.input_payload->>'bodyVersionId'
 OR NOT EXISTS(SELECT 1 FROM new_design.ai_task_attempts attempt JOIN new_design.ai_task_steps step ON step.id=attempt.step_id JOIN new_design.ai_tasks task ON task.id=attempt.task_id WHERE attempt.id=NEW.attempt_id AND step.id=NEW.step_id AND task.id=NEW.ai_task_id AND task.book_id=NEW.book_id AND attempt.task_contract_version_id=(NEW.frozen_snapshot->>'taskContractVersionId')::uuid AND attempt.context_manifest_id=(NEW.frozen_snapshot->>'contextManifestId')::uuid AND attempt.model_route_snapshot_id=(NEW.frozen_snapshot->>'snapshotId')::uuid)
 THEN RAISE EXCEPTION 'chapter quality exact source mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.generated_output IS NOT NULL AND (
  NEW.generated_execution->>'routeSnapshotId' IS DISTINCT FROM NEW.frozen_snapshot->>'snapshotId'
  OR NEW.generated_execution->>'routeSnapshotHash' IS DISTINCT FROM NEW.frozen_snapshot->>'snapshotHash'
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.generated_execution->'attempts','[]'::jsonb)) attempt WHERE attempt->>'status'='succeeded' AND attempt->>'requestSent'='true' AND attempt->>'responseReceived'='true')
 ) THEN RAISE EXCEPTION 'chapter quality received execution proof missing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER chapter_quality_request_guard BEFORE INSERT OR UPDATE OR DELETE ON chapter_quality_requests FOR EACH ROW EXECUTE FUNCTION guard_chapter_quality_request();
