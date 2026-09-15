SET search_path TO new_design, public;

CREATE TABLE dictionary_definitions (
  id uuid PRIMARY KEY,
  dictionary_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  scope text NOT NULL CHECK (scope IN ('system', 'template', 'book')),
  owner_space_id uuid REFERENCES card_spaces(id),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dictionary_items (
  id uuid PRIMARY KEY,
  dictionary_id uuid NOT NULL REFERENCES dictionary_definitions(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  label text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 1000,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dictionary_id, item_key)
);

CREATE TABLE relation_types (
  id uuid PRIMARY KEY,
  relation_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT 'directed' CHECK (direction IN ('directed', 'undirected')),
  source_type_keys text[] NOT NULL DEFAULT '{}',
  target_type_keys text[] NOT NULL DEFAULT '{}',
  source_max integer CHECK (source_max IS NULL OR source_max > 0),
  target_max integer CHECK (target_max IS NULL OR target_max > 0),
  scope text NOT NULL CHECK (scope IN ('system', 'template', 'book')),
  owner_space_id uuid REFERENCES card_spaces(id),
  properties_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_relations (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  relation_type_id uuid NOT NULL REFERENCES relation_types(id),
  source_card_id uuid NOT NULL REFERENCES cards(id),
  target_card_id uuid NOT NULL REFERENCES cards(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  valid_from text,
  valid_to text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_card_id <> target_card_id)
);

CREATE INDEX card_relations_space_idx ON card_relations(space_id, status);
CREATE INDEX card_relations_source_idx ON card_relations(source_card_id);
CREATE INDEX card_relations_target_idx ON card_relations(target_card_id);

CREATE TABLE card_group_forms (
  id uuid PRIMARY KEY,
  form_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  current_version_id uuid,
  draft_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_group_form_versions (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES card_group_forms(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);

ALTER TABLE card_group_forms
  ADD CONSTRAINT card_group_forms_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES card_group_form_versions(id);

CREATE TABLE card_group_form_instances (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  form_version_id uuid NOT NULL REFERENCES card_group_form_versions(id),
  primary_card_id uuid NOT NULL REFERENCES cards(id),
  title text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, form_version_id, primary_card_id)
);

CREATE TABLE card_mounts (
  id uuid PRIMARY KEY,
  form_instance_id uuid NOT NULL REFERENCES card_group_form_instances(id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  card_id uuid NOT NULL REFERENCES cards(id),
  relation_id uuid REFERENCES card_relations(id),
  sort_order integer NOT NULL DEFAULT 0,
  local_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_instance_id, slot_key, card_id)
);

INSERT INTO dictionary_definitions (id, dictionary_key, name, description, scope) VALUES
('31000000-0000-4000-8000-000000000001', 'story_role', '故事职责', '人物在当前故事中的结构职责。', 'system'),
('31000000-0000-4000-8000-000000000002', 'lifecycle_status', '创作生命周期', '计划、推进、完成和归档等稳定状态。', 'system'),
('31000000-0000-4000-8000-000000000003', 'evidence_reliability', '证据可靠性', '线索与证据的可信程度。', 'system')
ON CONFLICT DO NOTHING;

INSERT INTO dictionary_items (id, dictionary_id, item_key, label, value, sort_order) VALUES
('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'protagonist', '主角', '{"value":"protagonist"}', 10),
('32000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', 'antagonist', '反派', '{"value":"antagonist"}', 20),
('32000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000001', 'mentor', '导师', '{"value":"mentor"}', 30),
('32000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000001', 'supporting', '重要配角', '{"value":"supporting"}', 40),
('32000000-0000-4000-8000-000000000005', '31000000-0000-4000-8000-000000000002', 'planned', '计划中', '{"value":"planned"}', 10),
('32000000-0000-4000-8000-000000000006', '31000000-0000-4000-8000-000000000002', 'active', '进行中', '{"value":"active"}', 20),
('32000000-0000-4000-8000-000000000007', '31000000-0000-4000-8000-000000000002', 'completed', '已完成', '{"value":"completed"}', 30),
('32000000-0000-4000-8000-000000000008', '31000000-0000-4000-8000-000000000002', 'archived', '已归档', '{"value":"archived"}', 40),
('32000000-0000-4000-8000-000000000009', '31000000-0000-4000-8000-000000000003', 'verified', '可信', '{"value":"verified"}', 10),
('32000000-0000-4000-8000-000000000010', '31000000-0000-4000-8000-000000000003', 'questionable', '存疑', '{"value":"questionable"}', 20),
('32000000-0000-4000-8000-000000000011', '31000000-0000-4000-8000-000000000003', 'false', '伪造', '{"value":"false"}', 30)
ON CONFLICT DO NOTHING;

INSERT INTO relation_types (
  id, relation_key, name, description, direction, source_type_keys,
  target_type_keys, source_max, target_max, scope, properties_schema
) VALUES
('33000000-0000-4000-8000-000000000001', 'event_participant', '事件参与者', '人物参与某一事件。', 'directed', ARRAY['event'], ARRAY['character'], NULL, NULL, 'system', $json$[
  {"key":"goal","name":"本事件目标","type":"long_text","required":false},
  {"key":"stance","name":"本事件立场","type":"long_text","required":false},
  {"key":"result","name":"本事件结果","type":"long_text","required":false}
]$json$::jsonb),
('33000000-0000-4000-8000-000000000002', 'event_location', '事件发生地点', '事件在一个主要地点发生。', 'directed', ARRAY['event'], ARRAY['location'], 1, NULL, 'system', '[]'),
('33000000-0000-4000-8000-000000000003', 'event_prop', '事件涉及道具', '事件使用、争夺或改变某件道具。', 'directed', ARRAY['event'], ARRAY['prop'], NULL, NULL, 'system', $json$[
  {"key":"usage","name":"事件中的用途","type":"long_text","required":false}
]$json$::jsonb),
('33000000-0000-4000-8000-000000000004', 'event_plotline', '事件所属剧情线', '事件推进一条主要剧情线。', 'directed', ARRAY['event'], ARRAY['plotline'], 1, NULL, 'system', '[]')
ON CONFLICT DO NOTHING;

INSERT INTO card_group_forms (
  id, form_key, name, description, status, revision, current_version_id,
  draft_definition, is_system
) VALUES (
  '34000000-0000-4000-8000-000000000001',
  'event_planning',
  '事件规划表单',
  '把事件主卡与人物、地点、道具和剧情线装配为可恢复的生产单。',
  'published',
  1,
  NULL,
  $json${
    "primaryTypeKey":"event",
    "groups":[
      {"key":"event_core","name":"事件主卡","order":10,"sections":[{"key":"primary","name":"发生什么","order":10,"slots":[{"key":"primary_event","name":"事件","kind":"primary_card","allowedTypeKeys":["event"],"min":1,"max":1,"localFields":[]}]}]},
      {"key":"event_cast","name":"参与者与立场","order":20,"sections":[{"key":"participants","name":"参与人物","order":10,"slots":[{"key":"participants","name":"参与人物","kind":"card_reference","relationTypeKey":"event_participant","allowedTypeKeys":["character"],"min":1,"max":20,"localFields":[{"key":"goal","name":"本事件目标","type":"long_text","required":false},{"key":"stance","name":"本事件立场","type":"long_text","required":false},{"key":"result","name":"本事件结果","type":"long_text","required":false}]}]}]},
      {"key":"event_context","name":"场景装配","order":30,"sections":[{"key":"context","name":"地点、道具与剧情线","order":10,"slots":[{"key":"location","name":"主要地点","kind":"card_reference","relationTypeKey":"event_location","allowedTypeKeys":["location"],"min":1,"max":1,"localFields":[]},{"key":"props","name":"涉及道具","kind":"card_reference","relationTypeKey":"event_prop","allowedTypeKeys":["prop"],"min":0,"max":20,"localFields":[{"key":"usage","name":"事件中的用途","type":"long_text","required":false}]},{"key":"plotline","name":"所属剧情线","kind":"card_reference","relationTypeKey":"event_plotline","allowedTypeKeys":["plotline"],"min":1,"max":1,"localFields":[]}]}]}
    ]
  }$json$::jsonb,
  true
) ON CONFLICT DO NOTHING;

INSERT INTO card_group_form_versions (id, form_id, version, definition)
SELECT '35000000-0000-4000-8000-000000000001', id, 1, draft_definition
FROM card_group_forms
WHERE form_key = 'event_planning'
ON CONFLICT DO NOTHING;

UPDATE card_group_forms
SET current_version_id = '35000000-0000-4000-8000-000000000001'
WHERE form_key = 'event_planning' AND current_version_id IS NULL;
