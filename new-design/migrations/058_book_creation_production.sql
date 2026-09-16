SET search_path TO new_design, public;

ALTER TABLE book_creation_sessions
 ADD COLUMN creation_request_key text CHECK(creation_request_key IS NULL OR length(creation_request_key) BETWEEN 8 AND 160),
 ADD COLUMN creation_request_hash text CHECK(creation_request_hash IS NULL OR creation_request_hash ~ '^[0-9a-f]{64}$'),
 ADD COLUMN formal_review jsonb CHECK(formal_review IS NULL OR jsonb_typeof(formal_review)='object'),
 ADD COLUMN production_receipts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(production_receipts)='array'),
 ADD CONSTRAINT book_creation_request_complete CHECK(num_nonnulls(creation_request_key,creation_request_hash) IN(0,2));
CREATE UNIQUE INDEX book_creation_request_key_unique ON book_creation_sessions(creation_request_key) WHERE creation_request_key IS NOT NULL;
CREATE FUNCTION guard_book_creation_production_receipts() RETURNS trigger LANGUAGE plpgsql
SET search_path TO new_design, public AS $$
DECLARE receipt_entry jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF jsonb_array_length(OLD.production_receipts)>0 THEN RAISE EXCEPTION '开书回执不可删除' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.creation_request_key IS DISTINCT FROM NEW.creation_request_key OR OLD.creation_request_hash IS DISTINCT FROM NEW.creation_request_hash THEN RAISE EXCEPTION '开书原请求不可改写' USING ERRCODE='23514'; END IF;
 FOR receipt_entry IN SELECT value FROM jsonb_array_elements(OLD.production_receipts) LOOP
  IF NOT NEW.production_receipts @> jsonb_build_array(receipt_entry) THEN RAISE EXCEPTION '已保存的开书回执不可改写' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER book_creation_production_receipts_guard BEFORE UPDATE OR DELETE ON book_creation_sessions FOR EACH ROW EXECUTE FUNCTION guard_book_creation_production_receipts();
