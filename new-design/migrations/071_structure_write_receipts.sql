SET search_path TO new_design, public;
-- Technical acknowledgements only; definitions and immutable versions remain in their original tables.
CREATE TABLE structure_write_receipts (
  kind text NOT NULL CHECK(kind IN('form','template')),
  request_key uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN('save','publish')),
  input_hash text NOT NULL CHECK(length(input_hash)=64),
  result_summary jsonb NOT NULL CHECK(jsonb_typeof(result_summary)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind,request_key)
);
CREATE FUNCTION guard_structure_write_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'structure write receipts are immutable';
END;
$$;
CREATE TRIGGER structure_write_receipts_immutable BEFORE UPDATE OR DELETE ON structure_write_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_structure_write_receipt();
