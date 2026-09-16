SET search_path TO new_design, public;
ALTER TABLE card_versions ADD COLUMN author_book_id uuid REFERENCES books(id),
 ADD COLUMN author_request_key uuid, ADD COLUMN author_input_hash char(64), ADD COLUMN author_write_receipt jsonb,
 ADD CONSTRAINT card_versions_author_receipt_complete CHECK (
  (author_book_id IS NULL AND author_request_key IS NULL AND author_input_hash IS NULL AND author_write_receipt IS NULL)
  OR (author_book_id IS NOT NULL AND author_request_key IS NOT NULL AND author_input_hash IS NOT NULL AND author_write_receipt IS NOT NULL AND author_input_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(author_write_receipt)='object'));
CREATE UNIQUE INDEX card_versions_author_request_unique ON card_versions(author_book_id,author_request_key) WHERE author_request_key IS NOT NULL;
CREATE FUNCTION protect_author_material_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
 IF TG_OP='DELETE' AND OLD.author_request_key IS NOT NULL THEN RAISE EXCEPTION 'author material receipt is immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.author_request_key IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'author material receipt is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER card_versions_author_receipt_immutable BEFORE UPDATE OR DELETE ON card_versions FOR EACH ROW EXECUTE FUNCTION protect_author_material_receipt();
COMMENT ON COLUMN card_versions.author_write_receipt IS 'Immutable original-request acknowledgement; metadata on canonical card version, not a second material fact.';
