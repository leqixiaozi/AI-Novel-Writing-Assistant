SET search_path TO new_design, public;

CREATE TABLE story_time_positions (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  start_order numeric(14,3),
  end_order numeric(14,3),
  start_label text NOT NULL DEFAULT '',
  end_label text NOT NULL DEFAULT '',
  uncertainty text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, card_id),
  CHECK (end_order IS NULL OR start_order IS NULL OR end_order >= start_order)
);

CREATE TABLE narrative_placements (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id) ON DELETE CASCADE,
  subject_card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  chapter_card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  scene_card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('appears','plant','reinforce','misdirect','reveal','recover')),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX narrative_placements_subject_role_active_unique
  ON narrative_placements(space_id, subject_card_id, role) WHERE status='active';
CREATE INDEX narrative_placements_chapter_idx ON narrative_placements(space_id, chapter_card_id, role) WHERE status='active';

CREATE TABLE text_anchors (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id) ON DELETE CASCADE,
  subject_card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  chapter_card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  scene_card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('plant','reveal','evidence','mention')),
  anchor_label text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX text_anchors_subject_role_unique ON text_anchors(space_id, subject_card_id, role);

CREATE TABLE book_view_configs (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  view_key text NOT NULL CHECK (view_key IN ('chapters','clues','characters','events','world','resources')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, view_key)
);

INSERT INTO relation_types (
  id,relation_key,name,description,direction,source_type_keys,target_type_keys,
  source_max,target_max,scope,owner_space_id,properties_schema,status,revision
) VALUES (
  '64000000-0000-4000-8000-000000000001','character_relationship','人物关系',
  '一条关系事实按查看方向显示正向或反向称谓，不为双方复制两条记录。','undirected',
  ARRAY['character'],ARRAY['character'],NULL,NULL,'system',NULL,
  '[{"key":"source_label","name":"正向称谓","type":"short_text","required":true},{"key":"inverse_label","name":"反向称谓","type":"short_text","required":true},{"key":"note","name":"关系说明","type":"long_text","required":false}]'::jsonb,
  'published',1
) ON CONFLICT (owner_space_id,relation_key) DO NOTHING;

INSERT INTO relation_types (
  id,relation_key,name,description,direction,source_type_keys,target_type_keys,
  source_max,target_max,scope,owner_space_id,properties_schema,status,revision,source_relation_type_id
)
SELECT (
  substr(md5('book-character-relation-'||book.space_id::text),1,8)||'-'||substr(md5('book-character-relation-'||book.space_id::text),9,4)||'-4'||
  substr(md5('book-character-relation-'||book.space_id::text),14,3)||'-8'||substr(md5('book-character-relation-'||book.space_id::text),18,3)||'-'||
  substr(md5('book-character-relation-'||book.space_id::text),21,12)
)::uuid,source.relation_key,source.name,source.description,source.direction,source.source_type_keys,source.target_type_keys,
source.source_max,source.target_max,'book',book.space_id,source.properties_schema,'published',1,source.id
FROM books book CROSS JOIN relation_types source
WHERE source.id='64000000-0000-4000-8000-000000000001'
ON CONFLICT (owner_space_id,relation_key) DO NOTHING;

CREATE UNIQUE INDEX card_relations_character_pair_active_unique
  ON card_relations(space_id, relation_type_id, LEAST(source_card_id,target_card_id), GREATEST(source_card_id,target_card_id))
  WHERE status='active';

WITH defaults(view_key,config) AS (VALUES
  ('chapters','{"groupBy":"chapter","sort":"chapter_order","display":"list","expanded":[]}'::jsonb),
  ('clues','{"groupBy":"lifecycle","sort":"updated_desc","display":"list","expanded":[]}'::jsonb),
  ('characters','{"groupBy":"story_role","sort":"title","display":"list","expanded":[]}'::jsonb),
  ('events','{"groupBy":"story_time","sort":"start_order","display":"list","defaultRange":"all","expanded":[]}'::jsonb),
  ('world','{"groupBy":"card_type","sort":"title","display":"list","expanded":[]}'::jsonb),
  ('resources','{"groupBy":"card_type","sort":"updated_desc","display":"list","expanded":[]}'::jsonb)
)
INSERT INTO book_view_configs(id,book_id,view_key,config)
SELECT (
  substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),1,8)||'-'||substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),9,4)||'-4'||
  substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),14,3)||'-8'||substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),18,3)||'-'||
  substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),21,12)
)::uuid,book.id,defaults.view_key,defaults.config
FROM books book CROSS JOIN defaults ON CONFLICT (book_id,view_key) DO NOTHING;

WITH current_template AS (
  SELECT template.id AS template_id,version.payload,
    (SELECT COALESCE(MAX(candidate.version),0)+1 FROM template_group_versions candidate WHERE candidate.template_id=template.id) AS next_version
  FROM template_groups template JOIN template_group_versions version ON version.id=template.current_version_id
  WHERE template.template_key='long_novel_core'
), relation_payload AS (
  SELECT jsonb_build_object(
    'sourceId',id,'key',relation_key,'name',name,'description',description,'direction',direction,
    'sourceTypeKeys',source_type_keys,'targetTypeKeys',target_type_keys,'sourceMax',source_max,'targetMax',target_max,
    'propertiesSchema',properties_schema
  ) AS item FROM relation_types WHERE id='64000000-0000-4000-8000-000000000001'
), view_payload AS (
  SELECT '[
    {"key":"chapters","name":"章节","config":{"groupBy":"chapter","sort":"chapter_order","display":"list","expanded":[]}},
    {"key":"clues","name":"线索／伏笔","config":{"groupBy":"lifecycle","sort":"updated_desc","display":"list","expanded":[]}},
    {"key":"characters","name":"角色","config":{"groupBy":"story_role","sort":"title","display":"list","expanded":[]}},
    {"key":"events","name":"事件／时间","config":{"groupBy":"story_time","sort":"start_order","display":"list","defaultRange":"all","expanded":[]}},
    {"key":"world","name":"世界","config":{"groupBy":"card_type","sort":"title","display":"list","expanded":[]}},
    {"key":"resources","name":"资源","config":{"groupBy":"card_type","sort":"updated_desc","display":"list","expanded":[]}}
  ]'::jsonb AS items
), inserted AS (
  INSERT INTO template_group_versions(id,template_id,version,payload)
  SELECT '64000000-0000-4000-8000-000000000002',current_template.template_id,current_template.next_version,
    jsonb_set(
      jsonb_set(current_template.payload,'{relationTypes}',
        CASE WHEN current_template.payload->'relationTypes' @> jsonb_build_array(relation_payload.item)
          THEN current_template.payload->'relationTypes'
          ELSE (current_template.payload->'relationTypes') || jsonb_build_array(relation_payload.item) END,true),
      '{viewConfigs}',view_payload.items,true
    )
  FROM current_template CROSS JOIN relation_payload CROSS JOIN view_payload
  ON CONFLICT DO NOTHING RETURNING id,template_id
)
UPDATE template_groups SET current_version_id=inserted.id,revision=revision+1,updated_at=now()
FROM inserted WHERE template_groups.id=inserted.template_id;
