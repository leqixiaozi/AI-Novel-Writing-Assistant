SET search_path TO new_design, public;

CREATE TABLE field_definitions (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  card_type_id uuid REFERENCES card_types(id),
  card_id uuid REFERENCES cards(id),
  card_mount_id uuid REFERENCES card_mounts(id),
  field_key text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('core','template','book_extension','local_supplement')),
  scope text NOT NULL CHECK (scope IN ('book_type','card','card_mount')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  current_version_id uuid,
  source_template_version_id uuid REFERENCES template_group_versions(id),
  source_type_version_id uuid REFERENCES card_type_versions(id),
  source_form_version_id uuid REFERENCES card_group_form_versions(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope='book_type' AND card_type_id IS NOT NULL AND card_id IS NULL AND card_mount_id IS NULL) OR
    (scope='card' AND card_type_id IS NOT NULL AND card_id IS NOT NULL AND card_mount_id IS NULL) OR
    (scope='card_mount' AND card_type_id IS NOT NULL AND card_id IS NULL AND card_mount_id IS NOT NULL)
  ),
  UNIQUE NULLS NOT DISTINCT (space_id,card_type_id,card_id,card_mount_id,field_key)
);

CREATE TABLE field_definition_versions (
  id uuid PRIMARY KEY,
  field_definition_id uuid NOT NULL REFERENCES field_definitions(id),
  version integer NOT NULL CHECK (version > 0),
  field_schema jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (field_definition_id,version)
);

ALTER TABLE field_definitions ADD CONSTRAINT field_definitions_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES field_definition_versions(id);

CREATE TABLE field_option_definitions (
  id uuid PRIMARY KEY,
  field_definition_id uuid NOT NULL REFERENCES field_definitions(id),
  option_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (field_definition_id,option_key)
);

CREATE TABLE field_option_versions (
  id uuid PRIMARY KEY,
  option_definition_id uuid NOT NULL REFERENCES field_option_definitions(id),
  version integer NOT NULL CHECK (version > 0),
  label text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (option_definition_id,version)
);

ALTER TABLE field_option_definitions ADD CONSTRAINT field_option_definitions_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES field_option_versions(id);

CREATE TABLE field_scope_adoptions (
  id uuid PRIMARY KEY,
  field_definition_id uuid NOT NULL REFERENCES field_definitions(id),
  action text NOT NULL CHECK (action IN ('create','revise','archive','template_addition')),
  idempotency_key text NOT NULL UNIQUE,
  from_version_id uuid REFERENCES field_definition_versions(id),
  to_version_id uuid REFERENCES field_definition_versions(id),
  expected_type_revision integer,
  expected_subject_revision integer,
  impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_version_local_values (
  card_version_id uuid NOT NULL REFERENCES card_versions(id),
  field_definition_id uuid NOT NULL REFERENCES field_definitions(id),
  field_definition_version_id uuid NOT NULL REFERENCES field_definition_versions(id),
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_version_id,field_definition_id)
);

-- U4 will expose relation-local editing. U3 reserves its immutable persistence contract only.
CREATE TABLE card_mount_local_value_versions (
  id uuid PRIMARY KEY,
  card_mount_id uuid NOT NULL REFERENCES card_mounts(id),
  mount_revision integer NOT NULL CHECK (mount_revision > 0),
  field_definition_id uuid NOT NULL REFERENCES field_definitions(id),
  field_definition_version_id uuid NOT NULL REFERENCES field_definition_versions(id),
  value jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_mount_id,mount_revision,field_definition_id)
);

CREATE INDEX field_definitions_type_idx ON field_definitions(card_type_id,status,scope);
CREATE INDEX field_definitions_card_idx ON field_definitions(card_id,status) WHERE card_id IS NOT NULL;
CREATE INDEX field_definition_versions_history_idx ON field_definition_versions(field_definition_id,version DESC);
CREATE INDEX card_version_local_values_field_idx ON card_version_local_values(field_definition_id);

CREATE FUNCTION scoped_field_uuid(seed text) RETURNS uuid LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (substr(md5(seed),1,8)||'-'||substr(md5(seed),9,4)||'-4'||substr(md5(seed),14,3)||'-8'||substr(md5(seed),18,3)||'-'||substr(md5(seed),21,12))::uuid
$$;

CREATE FUNCTION sync_type_version_fields(target_version_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  version_row card_type_versions%rowtype;
  type_row record;
  source_template uuid;
  source_form uuid;
  item jsonb;
  option_item jsonb;
  definition_id uuid;
  definition_version_id uuid;
  option_id uuid;
  option_version_id uuid;
  resolved_origin text;
BEGIN
  SELECT * INTO version_row FROM card_type_versions WHERE id=target_version_id;
  SELECT * INTO type_row FROM card_types WHERE id=version_row.card_type_id;
  SELECT book.template_version_id INTO source_template FROM books book WHERE book.space_id=type_row.space_id;
  SELECT form.current_version_id INTO source_form
  FROM card_group_forms form JOIN card_group_form_versions version ON version.id=form.current_version_id
  WHERE form.space_id=type_row.space_id AND version.definition->>'primaryTypeKey'=type_row.type_key
  ORDER BY form.updated_at DESC LIMIT 1;

  FOR item IN SELECT value FROM jsonb_array_elements(version_row.fields) LOOP
    definition_id:=scoped_field_uuid(version_row.card_type_id::text||':'||(item->>'key'));
    SELECT origin INTO resolved_origin FROM field_definitions WHERE id=definition_id;
    IF resolved_origin IS NULL THEN
      resolved_origin:=CASE
        WHEN type_row.space_id='00000000-0000-4000-8000-000000000001'::uuid THEN 'core'
        WHEN type_row.source_type_version_id IS NOT NULL AND version_row.version=1 THEN 'template'
        ELSE 'book_extension'
      END;
    END IF;
    INSERT INTO field_definitions(id,space_id,card_type_id,field_key,origin,scope,status,source_template_version_id,source_type_version_id,source_form_version_id,created_by)
    VALUES(definition_id,type_row.space_id,version_row.card_type_id,item->>'key',resolved_origin,'book_type',CASE WHEN COALESCE((item->>'hidden')::boolean,false) THEN 'archived' ELSE 'active' END,source_template,version_row.id,source_form,'system:type-version')
    ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,source_type_version_id=EXCLUDED.source_type_version_id,source_form_version_id=COALESCE(EXCLUDED.source_form_version_id,field_definitions.source_form_version_id),revision=field_definitions.revision+1,updated_at=now();

    definition_version_id:=scoped_field_uuid(definition_id::text||':version:'||version_row.id::text);
    INSERT INTO field_definition_versions(id,field_definition_id,version,field_schema,created_by)
    VALUES(definition_version_id,definition_id,version_row.version,item,'system:type-version') ON CONFLICT DO NOTHING;
    UPDATE field_definitions SET current_version_id=definition_version_id WHERE id=definition_id;

    FOR option_item IN SELECT value FROM jsonb_array_elements(COALESCE(item->'options','[]'::jsonb)) LOOP
      option_id:=CASE WHEN COALESCE(option_item->>'id','') ~* '^[0-9a-f-]{36}$' THEN (option_item->>'id')::uuid ELSE scoped_field_uuid(definition_id::text||':option:'||(option_item->>'value')) END;
      INSERT INTO field_option_definitions(id,field_definition_id,option_key,status)
      VALUES(option_id,definition_id,option_item->>'value','active') ON CONFLICT(id) DO UPDATE SET status='active',revision=field_option_definitions.revision+1,updated_at=now();
      option_version_id:=scoped_field_uuid(option_id::text||':version:'||version_row.id::text);
      INSERT INTO field_option_versions(id,option_definition_id,version,label,created_by)
      VALUES(option_version_id,option_id,version_row.version,option_item->>'label','system:type-version') ON CONFLICT DO NOTHING;
      UPDATE field_option_definitions SET current_version_id=option_version_id WHERE id=option_id;
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION register_type_version_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sync_type_version_fields(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER card_type_versions_register_fields AFTER INSERT ON card_type_versions
  FOR EACH ROW EXECUTE FUNCTION register_type_version_fields();

DO $$ DECLARE version_row record; BEGIN
  FOR version_row IN
    SELECT version.* FROM card_type_versions version JOIN card_types type ON type.current_version_id=version.id
  LOOP
    PERFORM sync_type_version_fields(version_row.id);
  END LOOP;
END $$;

CREATE FUNCTION guard_scoped_field_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'scoped field history is immutable' USING ERRCODE='23514'; END $$;

CREATE TRIGGER field_definition_versions_immutable BEFORE UPDATE OR DELETE ON field_definition_versions FOR EACH ROW EXECUTE FUNCTION guard_scoped_field_history();
CREATE TRIGGER field_option_versions_immutable BEFORE UPDATE OR DELETE ON field_option_versions FOR EACH ROW EXECUTE FUNCTION guard_scoped_field_history();
CREATE TRIGGER field_scope_adoptions_immutable BEFORE UPDATE OR DELETE ON field_scope_adoptions FOR EACH ROW EXECUTE FUNCTION guard_scoped_field_history();
CREATE TRIGGER card_version_local_values_immutable BEFORE UPDATE OR DELETE ON card_version_local_values FOR EACH ROW EXECUTE FUNCTION guard_scoped_field_history();
CREATE TRIGGER card_mount_local_values_immutable BEFORE UPDATE OR DELETE ON card_mount_local_value_versions FOR EACH ROW EXECUTE FUNCTION guard_scoped_field_history();

COMMENT ON COLUMN field_definitions.field_key IS 'Server-generated stable key. Renaming a customer-facing label never changes this key.';
COMMENT ON TABLE card_mount_local_value_versions IS 'Reserved U4 contract; U3 does not expose relation-local selection or editing.';
