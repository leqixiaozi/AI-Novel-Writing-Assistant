-- Optional manual extension. No startup registration; no database rewind or model call.
SET search_path TO new_design,public;
CREATE TABLE book_content_history_capability(contract text PRIMARY KEY CHECK(contract='book_content_history_v1'),operational boolean NOT NULL DEFAULT false);
INSERT INTO book_content_history_capability(contract) VALUES('book_content_history_v1');
CREATE TABLE book_content_history_snapshots(id uuid PRIMARY KEY,book_id uuid NOT NULL REFERENCES books(id),request_key uuid NOT NULL,request_hash char(64) NOT NULL,kind text NOT NULL CHECK(kind IN('manual','before_restore','auto_milestone','before_pipeline')),label text NOT NULL,source_id uuid,source_hash char(64) NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(book_id,request_key));
CREATE TABLE book_content_history_restores(book_id uuid NOT NULL REFERENCES books(id),request_key uuid NOT NULL,input_hash char(64) NOT NULL,input_payload jsonb NOT NULL,before_snapshot_id uuid NOT NULL REFERENCES book_content_history_snapshots(id),receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(book_id,request_key));
CREATE FUNCTION guard_book_content_history_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE item jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'book content history immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM book_content_history_capability WHERE operational) OR NOT COALESCE(NEW.payload->>'bookId'=NEW.book_id::text AND jsonb_typeof(NEW.payload->'plans')='array' AND jsonb_typeof(NEW.payload->'chapters')='array',false) THEN RAISE EXCEPTION 'book history scope/capability unavailable' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.payload->'plans') LOOP
  IF NOT EXISTS(SELECT 1 FROM planning_objects object JOIN planning_versions version ON version.object_id=object.id WHERE object.book_id=NEW.book_id AND object.id=(item->>'id')::uuid AND version.id=(item->>'versionId')::uuid AND version.content=item->'content') THEN RAISE EXCEPTION 'history plan exact source unavailable' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.payload->'chapters') LOOP
  IF NOT EXISTS(SELECT 1 FROM chapter_documents document JOIN chapter_body_versions version ON version.chapter_document_id=document.id WHERE document.book_id=NEW.book_id AND document.id=(item->>'id')::uuid AND version.id=(item->>'bodyVersionId')::uuid AND version.content=item->>'content' AND version.content_hash=item->>'contentHash') THEN RAISE EXCEPTION 'history chapter exact source unavailable' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER book_content_history_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON book_content_history_snapshots FOR EACH ROW EXECUTE FUNCTION guard_book_content_history_snapshot();
CREATE FUNCTION guard_book_content_history_restore() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE item jsonb; snapshot book_content_history_snapshots%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'original history restore receipt immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT snapshot FROM book_content_history_snapshots WHERE book_id=NEW.book_id AND id=(NEW.input_payload->>'snapshotId')::uuid;
 IF NOT COALESCE(snapshot.source_hash=NEW.input_payload->>'sourceHash' AND NEW.input_payload->>'requestKey'=NEW.request_key::text AND NEW.input_payload->>'confirm'='true' AND NEW.receipt->>'requestKey'=NEW.request_key::text AND NEW.receipt->>'bookId'=NEW.book_id::text AND NEW.receipt->>'inputHash'=NEW.input_hash AND NEW.receipt->'input'=NEW.input_payload AND NEW.receipt->>'beforeSnapshotId'=NEW.before_snapshot_id::text AND jsonb_array_length(NEW.receipt->'items')=jsonb_array_length(NEW.input_payload->'items'),false) OR NOT EXISTS(SELECT 1 FROM book_content_history_snapshots WHERE id=NEW.before_snapshot_id AND book_id=NEW.book_id AND kind='before_restore') THEN RAISE EXCEPTION 'original history receipt scope mismatch' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.receipt->'items') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.input_payload->'items') selected WHERE selected->>'kind'=item->>'kind' AND selected->>'id'=item->>'id') THEN RAISE EXCEPTION 'history result selection mismatch' USING ERRCODE='23514'; END IF;
  IF item->>'kind'='plan' THEN
   IF NOT EXISTS(SELECT 1 FROM planning_operation_events operation JOIN planning_versions version ON version.id=operation.version_id JOIN planning_adoptions adoption ON adoption.to_version_id=version.id WHERE operation.book_id=NEW.book_id AND operation.object_id=(item->>'id')::uuid AND version.id=(item->>'resultVersionId')::uuid AND operation.idempotency_key=NEW.request_key::text||':plan:'||(item->>'id') AND adoption.idempotency_key=NEW.request_key::text||':adopt:'||(item->>'id')) THEN RAISE EXCEPTION 'history requires normal planning writes/adoption' USING ERRCODE='23514'; END IF;
  ELSIF item->>'kind'='body' THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot.payload->'chapters') original WHERE original->>'id'=item->>'id' AND original->>'bodyVersionId'=item->>'sourceVersionId' AND original->>'title'=item->>'targetTitle' AND original->>'logicalOrder'=item->>'targetOrder') THEN RAISE EXCEPTION 'history directory exact source mismatch' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM chapter_body_operations operation JOIN chapter_body_versions version ON version.id=operation.result_body_version_id WHERE operation.book_id=NEW.book_id AND operation.chapter_document_id=(item->>'id')::uuid AND version.id=(item->>'resultVersionId')::uuid AND operation.idempotency_key=NEW.request_key::text||':body:'||(item->>'id') AND version.base_version_id=(item->>'sourceVersionId')::uuid AND version.source='revision') THEN RAISE EXCEPTION 'history requires normal body copy candidate writer' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'unknown history restore source' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER book_content_history_restore_guard BEFORE INSERT OR UPDATE OR DELETE ON book_content_history_restores FOR EACH ROW EXECUTE FUNCTION guard_book_content_history_restore();
