SET search_path TO new_design, public;

CREATE TABLE state_type_capabilities (
  space_id uuid NOT NULL REFERENCES card_spaces(id) ON DELETE CASCADE,
  type_key text NOT NULL,
  settlement_capability text NOT NULL CHECK (settlement_capability IN ('disabled','optional','required')),
  state_mode text NOT NULL CHECK (state_mode IN ('none','field_state','lifecycle')),
  default_field_policy text NOT NULL CHECK (default_field_policy IN ('none','tracked','derived','lifecycle_only')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(space_id,type_key)
);

CREATE TABLE state_field_policies (
  space_id uuid NOT NULL,
  type_key text NOT NULL,
  field_key text NOT NULL,
  settlement_policy text NOT NULL CHECK (settlement_policy IN ('none','tracked','derived','lifecycle_only')),
  state_mode text NOT NULL DEFAULT 'absolute' CHECK (state_mode IN ('absolute','delta','derived','lifecycle')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(space_id,type_key,field_key),
  FOREIGN KEY(space_id,type_key) REFERENCES state_type_capabilities(space_id,type_key) ON DELETE CASCADE
);

CREATE TABLE state_relation_capabilities (
  space_id uuid NOT NULL REFERENCES card_spaces(id) ON DELETE CASCADE,
  relation_key text NOT NULL,
  settlement_capability text NOT NULL CHECK (settlement_capability IN ('disabled','optional','required')),
  state_mode text NOT NULL CHECK (state_mode IN ('none','relation_state','lifecycle')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(space_id,relation_key)
);

CREATE TABLE state_relation_dimensions (
  space_id uuid NOT NULL,
  relation_key text NOT NULL,
  dimension_key text NOT NULL,
  label text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('forward','inverse','bidirectional')),
  settlement_policy text NOT NULL CHECK (settlement_policy IN ('tracked','derived','lifecycle_only')),
  state_mode text NOT NULL CHECK (state_mode IN ('absolute','delta','derived','lifecycle')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(space_id,relation_key,dimension_key),
  FOREIGN KEY(space_id,relation_key) REFERENCES state_relation_capabilities(space_id,relation_key) ON DELETE CASCADE
);

CREATE TABLE entity_initial_states (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  subject_kind text NOT NULL CHECK (subject_kind IN ('card','relation')),
  subject_id uuid NOT NULL,
  state_key text NOT NULL,
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,subject_kind,subject_id,state_key)
);

CREATE TABLE entity_initial_state_versions (
  id uuid PRIMARY KEY,
  initial_state_id uuid NOT NULL REFERENCES entity_initial_states(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  value_json jsonb NOT NULL,
  value_hash char(64) NOT NULL,
  source_fact_id uuid REFERENCES canonical_facts(id),
  actor text NOT NULL DEFAULT 'user',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(initial_state_id,version),
  UNIQUE(id,initial_state_id)
);

ALTER TABLE entity_initial_states ADD CONSTRAINT entity_initial_states_current_version_fk
  FOREIGN KEY(current_version_id,id) REFERENCES entity_initial_state_versions(id,initial_state_id);

CREATE TABLE state_change_proposals (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  body_version_id uuid NOT NULL,
  text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  cause_event_card_id uuid REFERENCES cards(id),
  subject_kind text NOT NULL CHECK (subject_kind IN ('card','relation')),
  subject_id uuid NOT NULL,
  state_key text NOT NULL,
  before_json jsonb,
  after_json jsonb NOT NULL,
  delta_json jsonb,
  reason text NOT NULL,
  effective_story_order numeric,
  source text NOT NULL CHECK (source IN ('ai','manual','import','system')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected','invalidated')),
  confirmed_state_change_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE TABLE chapter_settlements (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  body_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('committed','reverted','superseded')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  idempotency_key text NOT NULL UNIQUE,
  revert_idempotency_key text UNIQUE,
  actor text NOT NULL DEFAULT 'user',
  note text NOT NULL DEFAULT '',
  committed_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE UNIQUE INDEX chapter_settlements_active_version_unique
  ON chapter_settlements(chapter_document_id,body_version_id) WHERE status='committed';

CREATE TABLE state_changes (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  settlement_id uuid NOT NULL REFERENCES chapter_settlements(id),
  proposal_id uuid NOT NULL UNIQUE REFERENCES state_change_proposals(id),
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id),
  body_version_id uuid NOT NULL,
  text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  cause_event_card_id uuid REFERENCES cards(id),
  subject_kind text NOT NULL CHECK (subject_kind IN ('card','relation')),
  subject_id uuid NOT NULL,
  state_key text NOT NULL,
  before_json jsonb,
  after_json jsonb NOT NULL,
  delta_json jsonb,
  reason text NOT NULL,
  effective_story_order numeric,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reverted','invalidated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

ALTER TABLE state_change_proposals ADD CONSTRAINT state_change_proposals_confirmed_change_fk
  FOREIGN KEY(confirmed_state_change_id) REFERENCES state_changes(id);

CREATE TABLE current_state_projections (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  subject_kind text NOT NULL CHECK (subject_kind IN ('card','relation')),
  subject_id uuid NOT NULL,
  state_key text NOT NULL,
  value_json jsonb NOT NULL,
  source_initial_version_id uuid REFERENCES entity_initial_state_versions(id),
  source_state_change_id uuid REFERENCES state_changes(id),
  projection_revision bigint NOT NULL DEFAULT 1 CHECK (projection_revision > 0),
  is_stale boolean NOT NULL DEFAULT false,
  rebuilt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(book_id,subject_kind,subject_id,state_key),
  CHECK (num_nonnulls(source_initial_version_id,source_state_change_id)=1)
);

CREATE TABLE state_milestone_snapshots (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('initial','volume_end','major_revision','body_switch','manual')),
  label text NOT NULL,
  chapter_document_id uuid REFERENCES chapter_documents(id),
  body_version_id uuid REFERENCES chapter_body_versions(id),
  source_settlement_id uuid REFERENCES chapter_settlements(id),
  projection_revision bigint NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE state_value_mappings (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id) ON DELETE CASCADE,
  type_key text NOT NULL,
  field_key text NOT NULL,
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id,type_key,field_key)
);

CREATE TABLE state_value_mapping_versions (
  id uuid PRIMARY KEY,
  mapping_id uuid NOT NULL REFERENCES state_value_mappings(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  ranges jsonb NOT NULL,
  prompt_component_version_id uuid REFERENCES card_versions(id),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(mapping_id,version),
  UNIQUE(id,mapping_id)
);

ALTER TABLE state_value_mappings ADD CONSTRAINT state_value_mappings_current_version_fk
  FOREIGN KEY(current_version_id,id) REFERENCES state_value_mapping_versions(id,mapping_id);

INSERT INTO state_type_capabilities(space_id,type_key,settlement_capability,state_mode,default_field_policy)
SELECT DISTINCT type.space_id,type.type_key,
  CASE WHEN type.type_key IN ('character','organization','prop') THEN 'required'
       WHEN type.type_key='location' THEN 'optional'
       WHEN type.type_key IN ('goal_task','conflict','secret_truth','clue_evidence','foreshadow','suspense_question','plotline','arc') THEN 'optional'
       WHEN type.semantic_capabilities @> '["state_change"]'::jsonb THEN 'optional'
       ELSE 'disabled' END,
  CASE WHEN type.type_key IN ('goal_task','conflict','secret_truth','clue_evidence','foreshadow','suspense_question','plotline','arc') THEN 'lifecycle'
       WHEN type.type_key IN ('character','organization','prop','location') OR type.semantic_capabilities @> '["state_change"]'::jsonb THEN 'field_state'
       ELSE 'none' END,
  CASE WHEN type.type_key IN ('goal_task','conflict','secret_truth','clue_evidence','foreshadow','suspense_question','plotline','arc') THEN 'lifecycle_only'
       WHEN type.type_key IN ('character','organization','prop','location') OR type.semantic_capabilities @> '["state_change"]'::jsonb THEN 'tracked'
       ELSE 'none' END
FROM card_types type
ON CONFLICT DO NOTHING;

INSERT INTO state_relation_capabilities(space_id,relation_key,settlement_capability,state_mode)
SELECT DISTINCT COALESCE(relation.owner_space_id,'00000000-0000-4000-8000-000000000001'::uuid),relation.relation_key,
  CASE WHEN relation.relation_key IN ('character_relationship','event_prop') THEN 'required' ELSE 'disabled' END,
  CASE WHEN relation.relation_key IN ('character_relationship','event_prop') THEN 'relation_state' ELSE 'none' END
FROM relation_types relation
ON CONFLICT DO NOTHING;

INSERT INTO state_relation_dimensions(space_id,relation_key,dimension_key,label,direction,settlement_policy,state_mode)
SELECT space_id,relation_key,
  CASE relation_key WHEN 'character_relationship' THEN 'relationship_state' ELSE 'holding_state' END,
  CASE relation_key WHEN 'character_relationship' THEN '关系状态' ELSE '持有与损耗' END,
  CASE relation_key WHEN 'character_relationship' THEN 'bidirectional' ELSE 'forward' END,
  'tracked','absolute'
FROM state_relation_capabilities
WHERE relation_key IN ('character_relationship','event_prop')
ON CONFLICT DO NOTHING;

CREATE INDEX initial_states_book_idx ON entity_initial_states(book_id,subject_kind,subject_id);
CREATE INDEX state_proposals_chapter_idx ON state_change_proposals(chapter_document_id,body_version_id,status);
CREATE INDEX settlements_chapter_idx ON chapter_settlements(chapter_document_id,committed_at DESC);
CREATE INDEX state_changes_projection_idx ON state_changes(book_id,subject_kind,subject_id,state_key,status,sequence DESC);
CREATE INDEX milestone_snapshots_book_idx ON state_milestone_snapshots(book_id,created_at DESC);
