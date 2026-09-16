SET search_path TO new_design, public;

-- Dictionaries keep their existing identities while gaining hierarchy and immutable display snapshots.
ALTER TABLE dictionary_definitions ADD COLUMN read_only boolean NOT NULL DEFAULT false;
ALTER TABLE dictionary_items ADD COLUMN parent_id uuid REFERENCES dictionary_items(id);
ALTER TABLE dictionary_items ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE dictionary_items ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision > 0);
ALTER TABLE dictionary_items ADD COLUMN current_version_id uuid;
ALTER TABLE dictionary_items ADD COLUMN source_item_id uuid REFERENCES dictionary_items(id);
ALTER TABLE dictionary_items ADD CONSTRAINT dictionary_item_not_self_parent CHECK(parent_id IS NULL OR parent_id <> id);
CREATE INDEX dictionary_items_parent_idx ON dictionary_items(dictionary_id,parent_id,status,sort_order);

CREATE TABLE dictionary_item_versions (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES dictionary_items(id),
  version integer NOT NULL CHECK(version > 0),
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  parent_id uuid REFERENCES dictionary_items(id),
  sort_order integer NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(value)='object'),
  status text NOT NULL CHECK(status IN ('active','archived')),
  path_node_ids uuid[] NOT NULL DEFAULT '{}',
  path_labels text[] NOT NULL DEFAULT '{}',
  created_by text NOT NULL DEFAULT 'migration',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id,version)
);

WITH RECURSIVE item_paths AS (
  SELECT item.id,item.parent_id,ARRAY[item.id]::uuid[] path_node_ids,ARRAY[item.label]::text[] path_labels
  FROM dictionary_items item WHERE item.parent_id IS NULL
  UNION ALL
  SELECT child.id,child.parent_id,parent.path_node_ids||child.id,parent.path_labels||child.label
  FROM dictionary_items child JOIN item_paths parent ON parent.id=child.parent_id
), inserted AS (
  INSERT INTO dictionary_item_versions(id,item_id,version,label,description,parent_id,sort_order,value,status,path_node_ids,path_labels)
  SELECT gen_random_uuid(),item.id,1,item.label,item.description,item.parent_id,item.sort_order,item.value,item.status,
    COALESCE(path.path_node_ids,ARRAY[item.id]::uuid[]),COALESCE(path.path_labels,ARRAY[item.label]::text[])
  FROM dictionary_items item LEFT JOIN item_paths path ON path.id=item.id
  RETURNING id,item_id
)
UPDATE dictionary_items item SET current_version_id=inserted.id FROM inserted WHERE inserted.item_id=item.id;

ALTER TABLE dictionary_items ADD CONSTRAINT dictionary_items_current_version_fk FOREIGN KEY(current_version_id) REFERENCES dictionary_item_versions(id);

CREATE FUNCTION guard_dictionary_item_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_dictionary uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  SELECT dictionary_id INTO parent_dictionary FROM dictionary_items WHERE id=NEW.parent_id;
  IF parent_dictionary IS NULL OR parent_dictionary<>NEW.dictionary_id THEN RAISE EXCEPTION '字典节点的上级必须在同一字典中'; END IF;
  IF NEW.parent_id=NEW.id OR EXISTS(
    WITH RECURSIVE descendants AS (
      SELECT id FROM dictionary_items WHERE parent_id=NEW.id
      UNION ALL SELECT item.id FROM dictionary_items item JOIN descendants parent ON item.parent_id=parent.id
    ) SELECT 1 FROM descendants WHERE id=NEW.parent_id
  ) THEN RAISE EXCEPTION '字典树不能形成循环'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dictionary_item_tree_guard BEFORE INSERT OR UPDATE OF parent_id,dictionary_id ON dictionary_items FOR EACH ROW EXECUTE FUNCTION guard_dictionary_item_tree();

-- Tag dimensions separate independent classification questions while preserving existing versioned tags.
CREATE TABLE material_tag_dimensions (
  id uuid PRIMARY KEY,
  dimension_key text NOT NULL CHECK(dimension_key ~ '^[a-z][a-z0-9_-]{1,62}$'),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '',
  scope text NOT NULL CHECK(scope IN ('system','template','book')),
  owner_space_id uuid REFERENCES card_spaces(id),
  source_dimension_id uuid REFERENCES material_tag_dimensions(id),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  read_only boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT 'user',
  updated_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(owner_space_id,dimension_key)
);

CREATE TABLE material_tag_dimension_versions (
  id uuid PRIMARY KEY,
  dimension_id uuid NOT NULL REFERENCES material_tag_dimensions(id),
  version integer NOT NULL CHECK(version>0),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK(status IN ('active','archived')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dimension_id,version)
);
ALTER TABLE material_tag_dimensions ADD CONSTRAINT material_tag_dimensions_current_version_fk FOREIGN KEY(current_version_id) REFERENCES material_tag_dimension_versions(id);

INSERT INTO material_tag_dimensions(id,dimension_key,name,description,scope,owner_space_id,created_by,updated_by)
SELECT scoped_field_uuid('default-tag-dimension:'||space_id::text),'default_tags','通用标签','兼容原有平级标签的默认维度。','book',space_id,'migration','migration'
FROM (SELECT DISTINCT space_id FROM material_tags) spaces ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO material_tag_dimension_versions(id,dimension_id,version,name,description,status,created_by)
  SELECT gen_random_uuid(),id,1,name,description,status,'migration' FROM material_tag_dimensions WHERE current_version_id IS NULL
  RETURNING id,dimension_id
)
UPDATE material_tag_dimensions dimension SET current_version_id=inserted.id FROM inserted WHERE inserted.dimension_id=dimension.id;

ALTER TABLE material_tags ADD COLUMN dimension_id uuid REFERENCES material_tag_dimensions(id);
ALTER TABLE material_tags ADD COLUMN parent_id uuid REFERENCES material_tags(id);
ALTER TABLE material_tags ADD COLUMN sort_order integer NOT NULL DEFAULT 1000 CHECK(sort_order BETWEEN 0 AND 100000);
ALTER TABLE material_tags ADD COLUMN source_tag_id uuid REFERENCES material_tags(id);
UPDATE material_tags tag SET dimension_id=scoped_field_uuid('default-tag-dimension:'||tag.space_id::text) WHERE dimension_id IS NULL;
ALTER TABLE material_tags ALTER COLUMN dimension_id SET NOT NULL;
ALTER TABLE material_tags ADD CONSTRAINT material_tag_not_self_parent CHECK(parent_id IS NULL OR parent_id<>id);
CREATE INDEX material_tags_tree_idx ON material_tags(dimension_id,parent_id,status,sort_order);

ALTER TABLE material_tag_versions ADD COLUMN parent_id uuid REFERENCES material_tags(id);
ALTER TABLE material_tag_versions ADD COLUMN sort_order integer NOT NULL DEFAULT 1000;
ALTER TABLE material_tag_versions ADD COLUMN path_node_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE material_tag_versions ADD COLUMN path_names text[] NOT NULL DEFAULT '{}';
UPDATE material_tag_versions version SET parent_id=tag.parent_id,sort_order=tag.sort_order,path_node_ids=ARRAY[tag.id],path_names=ARRAY[version.name]
FROM material_tags tag WHERE tag.id=version.tag_id AND cardinality(version.path_node_ids)=0;

CREATE FUNCTION guard_material_tag_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_dimension uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  SELECT dimension_id INTO parent_dimension FROM material_tags WHERE id=NEW.parent_id;
  IF parent_dimension IS NULL OR parent_dimension<>NEW.dimension_id THEN RAISE EXCEPTION '标签节点的上级必须在同一维度中'; END IF;
  IF NEW.parent_id=NEW.id OR EXISTS(
    WITH RECURSIVE descendants AS (
      SELECT id FROM material_tags WHERE parent_id=NEW.id
      UNION ALL SELECT tag.id FROM material_tags tag JOIN descendants parent ON tag.parent_id=parent.id
    ) SELECT 1 FROM descendants WHERE id=NEW.parent_id
  ) THEN RAISE EXCEPTION '标签树不能形成循环'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_tag_tree_guard BEFORE INSERT OR UPDATE OF parent_id,dimension_id ON material_tags FOR EACH ROW EXECUTE FUNCTION guard_material_tag_tree();

CREATE TABLE card_type_tag_bindings (
  id uuid PRIMARY KEY,
  card_type_id uuid NOT NULL REFERENCES card_types(id),
  dimension_id uuid NOT NULL REFERENCES material_tag_dimensions(id),
  config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_type_id,dimension_id)
);
CREATE TABLE card_type_tag_binding_versions (
  id uuid PRIMARY KEY,
  binding_id uuid NOT NULL REFERENCES card_type_tag_bindings(id),
  version integer NOT NULL CHECK(version>0),
  config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
  status text NOT NULL CHECK(status IN ('active','archived')),
  created_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(binding_id,version)
);
ALTER TABLE card_type_tag_bindings ADD CONSTRAINT card_type_tag_bindings_current_version_fk FOREIGN KEY(current_version_id) REFERENCES card_type_tag_binding_versions(id);

-- Non-card objects can use the same tag identities without weakening the existing card membership ledger.
CREATE TABLE material_tag_target_memberships (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  tag_id uuid NOT NULL REFERENCES material_tags(id),
  target_kind text NOT NULL CHECK(target_kind IN ('task','planning','chapter','resource')),
  target_id uuid NOT NULL,
  target_version_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  created_by text NOT NULL DEFAULT 'user',
  updated_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX material_tag_target_memberships_active_unique ON material_tag_target_memberships(tag_id,target_kind,target_id) WHERE status='active';
CREATE TABLE material_tag_target_membership_versions (
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL REFERENCES material_tag_target_memberships(id),
  revision integer NOT NULL CHECK(revision>0),
  tag_version_id uuid NOT NULL REFERENCES material_tag_versions(id),
  target_version_id uuid,
  status text NOT NULL CHECK(status IN ('active','ended')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(membership_id,revision)
);
ALTER TABLE material_tag_target_memberships ADD CONSTRAINT material_tag_target_memberships_current_version_fk FOREIGN KEY(current_version_id) REFERENCES material_tag_target_membership_versions(id);

CREATE TABLE standard_field_semantics (
  id uuid PRIMARY KEY,
  semantic_key text NOT NULL UNIQUE CHECK(semantic_key ~ '^[a-z][a-z0-9_-]{1,62}$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  data_type text NOT NULL CHECK(data_type IN ('short_text','long_text','number','boolean','select','multi_select','date')),
  recommended_dictionary_id uuid REFERENCES dictionary_definitions(id),
  applicable_type_keys text[] NOT NULL DEFAULT '{}',
  allowed_selection_modes text[] NOT NULL DEFAULT '{}',
  settlement_suggestion text NOT NULL DEFAULT 'none' CHECK(settlement_suggestion IN ('none','tracked','lifecycle')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_tree_value_snapshots (
  id uuid PRIMARY KEY,
  card_version_id uuid NOT NULL REFERENCES card_versions(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  tree_kind text NOT NULL CHECK(tree_kind IN ('dictionary','tag')),
  node_ids uuid[] NOT NULL,
  display_paths text[][] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_version_id,field_key,tree_kind)
);

COMMENT ON TABLE dictionary_item_versions IS '字典节点的不可变中文名称、层级和完整路径快照。';
COMMENT ON TABLE material_tag_dimensions IS '标签维度：每个维度表达一个独立分类问题，不与资料分组树混用。';
COMMENT ON TABLE standard_field_semantics IS '跨内容类型复用的字段业务语义，不是第三棵树。';

