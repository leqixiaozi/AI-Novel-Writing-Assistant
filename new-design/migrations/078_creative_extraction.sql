SET search_path TO new_design,public;
-- Candidate snapshots and receipts are workflow evidence; resources, books and
-- chapter body versions remain the only adopted author facts.
CREATE TABLE creative_extraction_previews (
 id uuid PRIMARY KEY, request_key text NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 8 AND 160),
 book_id uuid NOT NULL REFERENCES books(id), mode text NOT NULL CHECK(mode IN ('writing_resource','style_cleaning','title_groups')),
 input_hash char(64) NOT NULL, original_input jsonb NOT NULL CHECK(jsonb_typeof(original_input)='object'), input_payload jsonb NOT NULL CHECK(jsonb_typeof(input_payload)='object'),
 frozen_plan jsonb, status text NOT NULL CHECK(status IN ('ready','blocked','running','succeeded','failed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), run_key text UNIQUE, run_hash char(64), run_input jsonb,
 task_id uuid REFERENCES ai_tasks(id), step_id uuid REFERENCES ai_task_steps(id), attempt_id uuid REFERENCES ai_task_attempts(id),
 output_payload jsonb, execution jsonb, failure jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((run_key IS NULL AND run_hash IS NULL AND run_input IS NULL AND task_id IS NULL AND step_id IS NULL AND attempt_id IS NULL) OR (run_key IS NOT NULL AND run_hash IS NOT NULL AND run_input IS NOT NULL AND task_id IS NOT NULL AND step_id IS NOT NULL AND attempt_id IS NOT NULL)),
 CHECK(status NOT IN ('running','succeeded','failed') OR task_id IS NOT NULL),
 CHECK(status<>'succeeded' OR output_payload IS NOT NULL),
 CHECK(status NOT IN ('ready','running','succeeded','failed') OR frozen_plan IS NOT NULL)
);
CREATE TABLE creative_extraction_write_receipts (
 request_key text PRIMARY KEY CHECK(length(request_key) BETWEEN 8 AND 160), input_hash char(64) NOT NULL,
 preview_id uuid NOT NULL REFERENCES creative_extraction_previews(id), operation text NOT NULL CHECK(operation IN ('save_resource','save_body_candidate','adopt_title')),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_creative_extraction_preview() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'creative evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW.request_key,NEW.book_id,NEW.mode,NEW.input_hash,NEW.original_input,NEW.input_payload,NEW.frozen_plan,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.request_key,OLD.book_id,OLD.mode,OLD.input_hash,OLD.original_input,OLD.input_payload,OLD.frozen_plan,OLD.created_at) THEN RAISE EXCEPTION 'creative frozen input is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.run_key IS NOT NULL AND ROW(NEW.run_key,NEW.run_hash,NEW.run_input,NEW.task_id,NEW.step_id,NEW.attempt_id) IS DISTINCT FROM ROW(OLD.run_key,OLD.run_hash,OLD.run_input,OLD.task_id,OLD.step_id,OLD.attempt_id) THEN RAISE EXCEPTION 'creative claim is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.output_payload IS NOT NULL AND ROW(NEW.output_payload,NEW.execution) IS DISTINCT FROM ROW(OLD.output_payload,OLD.execution) THEN RAISE EXCEPTION 'creative reply is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('succeeded','failed','blocked') THEN RAISE EXCEPTION 'creative terminal preview is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT ((OLD.status='ready' AND NEW.status='running') OR (OLD.status='running' AND NEW.status IN ('succeeded','failed'))) THEN RAISE EXCEPTION 'illegal creative transition' USING ERRCODE='23514'; END IF;
 IF NEW.output_payload IS NOT NULL AND NEW.status NOT IN ('running','succeeded') THEN RAISE EXCEPTION 'creative reply requires original live attempt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER creative_extraction_preview_guard BEFORE UPDATE OR DELETE ON creative_extraction_previews FOR EACH ROW EXECUTE FUNCTION guard_creative_extraction_preview();
CREATE TRIGGER creative_extraction_receipt_guard BEFORE UPDATE OR DELETE ON creative_extraction_write_receipts FOR EACH ROW EXECUTE FUNCTION guard_dependency_ledger_append_only();
