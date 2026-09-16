SET search_path TO new_design, public;

CREATE TABLE settlement_relation_configuration_drafts (
 id uuid PRIMARY KEY, book_id uuid NOT NULL REFERENCES books(id), revision integer NOT NULL CHECK(revision>0),
 current_version_id uuid, relation_type_id uuid REFERENCES relation_types(id), source_relation_type_id uuid REFERENCES relation_types(id),
 expected_relation_type_revision integer CHECK(expected_relation_type_revision>0),
 status text NOT NULL CHECK(status IN ('draft','published')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settlement_relation_configuration_versions (
 id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES settlement_relation_configuration_drafts(id), version integer NOT NULL CHECK(version>0),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'), relation_type_id uuid REFERENCES relation_types(id),
 source_relation_type_id uuid REFERENCES relation_types(id), expected_relation_type_revision integer CHECK(expected_relation_type_revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(draft_id,version)
);
ALTER TABLE settlement_relation_configuration_drafts ADD CONSTRAINT settlement_relation_configuration_current_version_fk FOREIGN KEY(current_version_id) REFERENCES settlement_relation_configuration_versions(id);
CREATE TABLE settlement_relation_configuration_receipts (
 id uuid PRIMARY KEY, book_id uuid NOT NULL REFERENCES books(id), request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 160),
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'), receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(book_id,request_key)
);
CREATE FUNCTION guard_settlement_relation_configuration_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
BEGIN RAISE EXCEPTION '关系规格版本和回执不可修改或删除'; END;
$$;
CREATE TRIGGER settlement_relation_configuration_versions_immutable BEFORE UPDATE OR DELETE ON settlement_relation_configuration_versions FOR EACH ROW EXECUTE FUNCTION guard_settlement_relation_configuration_append_only();
CREATE TRIGGER settlement_relation_configuration_receipts_immutable BEFORE UPDATE OR DELETE ON settlement_relation_configuration_receipts FOR EACH ROW EXECUTE FUNCTION guard_settlement_relation_configuration_append_only();
CREATE INDEX settlement_relation_configuration_book_drafts ON settlement_relation_configuration_drafts(book_id,updated_at);
