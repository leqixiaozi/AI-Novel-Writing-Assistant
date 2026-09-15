SET search_path TO new_design, public;

ALTER TABLE card_types ADD COLUMN IF NOT EXISTS source_card_type_id uuid;
ALTER TABLE card_types ADD COLUMN IF NOT EXISTS source_type_version_id uuid;
ALTER TABLE dictionary_definitions ADD COLUMN IF NOT EXISTS source_dictionary_id uuid;
ALTER TABLE relation_types ADD COLUMN IF NOT EXISTS source_relation_type_id uuid;
ALTER TABLE card_group_forms ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES card_spaces(id);
ALTER TABLE card_group_forms ADD COLUMN IF NOT EXISTS source_form_id uuid;
ALTER TABLE card_group_forms ADD COLUMN IF NOT EXISTS source_form_version_id uuid;

ALTER TABLE dictionary_definitions DROP CONSTRAINT IF EXISTS dictionary_definitions_dictionary_key_key;
ALTER TABLE dictionary_definitions ADD CONSTRAINT dictionary_definitions_scope_key_unique UNIQUE NULLS NOT DISTINCT (owner_space_id, dictionary_key);
ALTER TABLE relation_types DROP CONSTRAINT IF EXISTS relation_types_relation_key_key;
ALTER TABLE relation_types ADD CONSTRAINT relation_types_scope_key_unique UNIQUE NULLS NOT DISTINCT (owner_space_id, relation_key);
ALTER TABLE card_group_forms DROP CONSTRAINT IF EXISTS card_group_forms_form_key_key;
ALTER TABLE card_group_forms ADD CONSTRAINT card_group_forms_scope_key_unique UNIQUE NULLS NOT DISTINCT (space_id, form_key);

CREATE TABLE template_groups (
  id uuid PRIMARY KEY,
  template_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  current_version_id uuid,
  draft_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE template_group_versions (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES template_groups(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

ALTER TABLE template_groups ADD CONSTRAINT template_groups_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES template_group_versions(id);

CREATE TABLE books (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL UNIQUE REFERENCES card_spaces(id),
  book_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  template_id uuid NOT NULL REFERENCES template_groups(id),
  template_version_id uuid NOT NULL REFERENCES template_group_versions(id),
  installed_payload jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE book_template_syncs (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  from_template_version_id uuid NOT NULL REFERENCES template_group_versions(id),
  to_template_version_id uuid NOT NULL REFERENCES template_group_versions(id),
  additions jsonb NOT NULL,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('previewed', 'applied', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE TEMP TABLE initial_template_payload AS
SELECT jsonb_build_object(
  'cardTypes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sourceId', type.id, 'sourceVersionId', version.id, 'key', type.type_key,
    'name', type.name, 'description', type.description, 'capabilities', type.semantic_capabilities,
    'fields', version.fields, 'sortOrder', type.sort_order
  ) ORDER BY type.sort_order) FROM card_types type JOIN card_type_versions version ON version.id=type.current_version_id
    WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.is_system AND type.status='published'), '[]'::jsonb),
  'dictionaries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sourceId', dictionary.id, 'key', dictionary.dictionary_key, 'name', dictionary.name,
    'description', dictionary.description, 'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sourceId', item.id, 'key', item.item_key, 'label', item.label, 'value', item.value, 'sortOrder', item.sort_order
    ) ORDER BY item.sort_order), '[]'::jsonb) FROM dictionary_items item WHERE item.dictionary_id=dictionary.id AND item.status='active')
  )) FROM dictionary_definitions dictionary WHERE dictionary.scope='system' AND dictionary.status='published'), '[]'::jsonb),
  'relationTypes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sourceId', relation.id, 'key', relation.relation_key, 'name', relation.name,
    'description', relation.description, 'direction', relation.direction,
    'sourceTypeKeys', relation.source_type_keys, 'targetTypeKeys', relation.target_type_keys,
    'sourceMax', relation.source_max, 'targetMax', relation.target_max, 'propertiesSchema', relation.properties_schema
  )) FROM relation_types relation WHERE relation.scope='system' AND relation.status='published'), '[]'::jsonb),
  'forms', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sourceId', form.id, 'sourceVersionId', version.id, 'key', form.form_key,
    'name', form.name, 'description', form.description, 'definition', version.definition
  )) FROM card_group_forms form JOIN card_group_form_versions version ON version.id=form.current_version_id
    WHERE form.is_system AND form.status='published'), '[]'::jsonb),
  'seedCards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sourceId', card.id, 'typeKey', type.type_key,
    'title', regexp_replace(card.title, '^《照骨山河》', ''), 'values', card.values
  )) FROM cards card JOIN card_types type ON type.id=card.card_type_id
    WHERE card.id::text LIKE '22000000-0000-4000-8000-%'), '[]'::jsonb),
  'menu', jsonb_build_object('defaultPage','creative-forms','pages',jsonb_build_array('creative-forms','all-cards'))
) AS payload;

INSERT INTO template_groups (id,template_key,name,description,status,revision,current_version_id,draft_config)
VALUES ('40000000-0000-4000-8000-000000000001','long_novel_core','通用长篇小说模板','包含 19 类核心卡片、稳定字典、事件关系和事件规划表单。','published',1,NULL,'{"includeSystemCatalog":true}')
ON CONFLICT DO NOTHING;

INSERT INTO template_group_versions (id,template_id,version,payload)
SELECT '40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',1,payload FROM initial_template_payload
ON CONFLICT DO NOTHING;

UPDATE template_groups SET current_version_id='40000000-0000-4000-8000-000000000002'
WHERE id='40000000-0000-4000-8000-000000000001' AND current_version_id IS NULL;

INSERT INTO card_spaces (id,space_key,name)
VALUES ('41000000-0000-4000-8000-000000000001','book_zhaogu_shanhe','照骨山河')
ON CONFLICT DO NOTHING;

INSERT INTO books (id,space_id,book_key,name,description,template_id,template_version_id,installed_payload)
SELECT '41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','zhaogu_shanhe','照骨山河',
  '以记忆为代价的仙侠长篇生产样例。','40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',payload
FROM initial_template_payload
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE book_type_map AS
SELECT type.id AS source_type_id, type.current_version_id AS source_version_id, type.type_key,
  (substr(md5('zhaogu-type-'||type.id::text),1,8)||'-'||substr(md5('zhaogu-type-'||type.id::text),9,4)||'-4'||substr(md5('zhaogu-type-'||type.id::text),14,3)||'-8'||substr(md5('zhaogu-type-'||type.id::text),18,3)||'-'||substr(md5('zhaogu-type-'||type.id::text),21,12))::uuid AS type_id,
  (substr(md5('zhaogu-version-'||type.id::text),1,8)||'-'||substr(md5('zhaogu-version-'||type.id::text),9,4)||'-4'||substr(md5('zhaogu-version-'||type.id::text),14,3)||'-8'||substr(md5('zhaogu-version-'||type.id::text),18,3)||'-'||substr(md5('zhaogu-version-'||type.id::text),21,12))::uuid AS version_id
FROM card_types type
WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.is_system AND type.status='published';

INSERT INTO card_types (id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields,is_system,sort_order,semantic_capabilities,source_card_type_id,source_type_version_id)
SELECT map.type_id,'41000000-0000-4000-8000-000000000001',type.type_key,type.name,type.description,'published',1,NULL,
  version.fields,false,type.sort_order,type.semantic_capabilities,type.id,version.id
FROM book_type_map map JOIN card_types type ON type.id=map.source_type_id JOIN card_type_versions version ON version.id=map.source_version_id
ON CONFLICT DO NOTHING;

INSERT INTO card_type_versions (id,card_type_id,version,fields)
SELECT map.version_id,map.type_id,1,version.fields FROM book_type_map map JOIN card_type_versions version ON version.id=map.source_version_id
ON CONFLICT DO NOTHING;

UPDATE card_types type SET current_version_id=map.version_id FROM book_type_map map WHERE type.id=map.type_id AND type.current_version_id IS NULL;

UPDATE card_versions version SET type_version_id=map.version_id,title=regexp_replace(version.title,'^《照骨山河》','')
FROM cards card JOIN book_type_map map ON map.source_type_id=card.card_type_id
WHERE version.card_id=card.id AND card.id::text LIKE '22000000-0000-4000-8000-%';

UPDATE cards card SET space_id='41000000-0000-4000-8000-000000000001',card_type_id=map.type_id,type_version_id=map.version_id,
  title=regexp_replace(card.title,'^《照骨山河》',''),updated_at=now()
FROM book_type_map map WHERE card.card_type_id=map.source_type_id AND card.id::text LIKE '22000000-0000-4000-8000-%';

INSERT INTO dictionary_definitions (id,dictionary_key,name,description,scope,owner_space_id,status,revision,source_dictionary_id)
SELECT (substr(md5('zhaogu-dict-'||dictionary.id::text),1,8)||'-'||substr(md5('zhaogu-dict-'||dictionary.id::text),9,4)||'-4'||substr(md5('zhaogu-dict-'||dictionary.id::text),14,3)||'-8'||substr(md5('zhaogu-dict-'||dictionary.id::text),18,3)||'-'||substr(md5('zhaogu-dict-'||dictionary.id::text),21,12))::uuid,
  dictionary.dictionary_key,dictionary.name,dictionary.description,'book','41000000-0000-4000-8000-000000000001','published',1,dictionary.id
FROM dictionary_definitions dictionary WHERE dictionary.scope='system' AND dictionary.status='published'
ON CONFLICT DO NOTHING;

INSERT INTO dictionary_items (id,dictionary_id,item_key,label,value,sort_order,status)
SELECT (substr(md5('zhaogu-item-'||item.id::text),1,8)||'-'||substr(md5('zhaogu-item-'||item.id::text),9,4)||'-4'||substr(md5('zhaogu-item-'||item.id::text),14,3)||'-8'||substr(md5('zhaogu-item-'||item.id::text),18,3)||'-'||substr(md5('zhaogu-item-'||item.id::text),21,12))::uuid,
  target.id,item.item_key,item.label,item.value,item.sort_order,item.status
FROM dictionary_items item JOIN dictionary_definitions source ON source.id=item.dictionary_id
JOIN dictionary_definitions target ON target.owner_space_id='41000000-0000-4000-8000-000000000001' AND target.source_dictionary_id=source.id
WHERE source.scope='system'
ON CONFLICT DO NOTHING;

INSERT INTO relation_types (id,relation_key,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,scope,owner_space_id,properties_schema,status,revision,source_relation_type_id)
SELECT (substr(md5('zhaogu-rel-'||relation.id::text),1,8)||'-'||substr(md5('zhaogu-rel-'||relation.id::text),9,4)||'-4'||substr(md5('zhaogu-rel-'||relation.id::text),14,3)||'-8'||substr(md5('zhaogu-rel-'||relation.id::text),18,3)||'-'||substr(md5('zhaogu-rel-'||relation.id::text),21,12))::uuid,
  relation.relation_key,relation.name,relation.description,relation.direction,relation.source_type_keys,relation.target_type_keys,relation.source_max,relation.target_max,
  'book','41000000-0000-4000-8000-000000000001',relation.properties_schema,'published',1,relation.id
FROM relation_types relation WHERE relation.scope='system' AND relation.status='published'
ON CONFLICT DO NOTHING;

INSERT INTO card_group_forms (id,space_id,form_key,name,description,status,revision,current_version_id,draft_definition,is_system,source_form_id,source_form_version_id)
SELECT (substr(md5('zhaogu-form-'||form.id::text),1,8)||'-'||substr(md5('zhaogu-form-'||form.id::text),9,4)||'-4'||substr(md5('zhaogu-form-'||form.id::text),14,3)||'-8'||substr(md5('zhaogu-form-'||form.id::text),18,3)||'-'||substr(md5('zhaogu-form-'||form.id::text),21,12))::uuid,
  '41000000-0000-4000-8000-000000000001',form.form_key,form.name,form.description,'published',1,NULL,version.definition,false,form.id,version.id
FROM card_group_forms form JOIN card_group_form_versions version ON version.id=form.current_version_id
WHERE form.is_system AND form.status='published'
ON CONFLICT DO NOTHING;

INSERT INTO card_group_form_versions (id,form_id,version,definition)
SELECT (substr(md5('zhaogu-form-version-'||form.id::text),1,8)||'-'||substr(md5('zhaogu-form-version-'||form.id::text),9,4)||'-4'||substr(md5('zhaogu-form-version-'||form.id::text),14,3)||'-8'||substr(md5('zhaogu-form-version-'||form.id::text),18,3)||'-'||substr(md5('zhaogu-form-version-'||form.id::text),21,12))::uuid,
  target.id,1,version.definition
FROM card_group_forms form JOIN card_group_form_versions version ON version.id=form.current_version_id
JOIN card_group_forms target ON target.space_id='41000000-0000-4000-8000-000000000001' AND target.source_form_id=form.id
WHERE form.is_system AND form.status='published'
ON CONFLICT DO NOTHING;

UPDATE card_group_forms form SET current_version_id=version.id
FROM card_group_form_versions version WHERE version.form_id=form.id AND form.space_id='41000000-0000-4000-8000-000000000001' AND form.current_version_id IS NULL;
