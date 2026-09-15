SET search_path TO new_design, public;

CREATE TABLE story_time_proposals (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  event_card_id uuid NOT NULL REFERENCES cards(id),
  proposal_source text NOT NULL CHECK (proposal_source IN ('ai','manual','import','system')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected','stale','invalidated')),
  current_version_id uuid,
  confirmed_timing_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,book_id)
);

CREATE TABLE story_time_proposal_versions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES story_time_proposals(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  lifecycle text NOT NULL CHECK (lifecycle IN ('planned','occurred','cancelled','invalidated')),
  time_mode text NOT NULL CHECK (time_mode IN ('absolute','custom_calendar','relative','partial','unknown')),
  start_certainty text NOT NULL CHECK (start_certainty IN ('known','partial','unknown')),
  end_certainty text NOT NULL CHECK (end_certainty IN ('known','partial','unknown')),
  start_instant timestamptz,
  end_instant timestamptz,
  timezone_name text,
  calendar_key text,
  start_label text,
  end_label text,
  normalized_start numeric,
  normalized_end numeric,
  duration_value numeric,
  duration_unit text,
  relative_to_event_card_id uuid REFERENCES cards(id),
  relative_relation text CHECK (relative_relation IS NULL OR relative_relation IN ('before','after','simultaneous')),
  relative_offset numeric,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('manual','body','fact','plan_version','state_proposal')),
  chapter_document_id uuid REFERENCES chapter_documents(id),
  body_version_id uuid,
  text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  fact_id uuid REFERENCES canonical_facts(id),
  plan_version_id uuid,
  state_proposal_id uuid REFERENCES state_change_proposals(id),
  replaces_timing_id uuid,
  reason text NOT NULL,
  editor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  UNIQUE(proposal_id,version),
  UNIQUE(id,proposal_id),
  CHECK (end_instant IS NULL OR start_instant IS NULL OR end_instant >= start_instant),
  CHECK (normalized_end IS NULL OR normalized_start IS NULL OR normalized_end >= normalized_start),
  CHECK (duration_value IS NULL OR duration_value > 0)
);

ALTER TABLE story_time_proposals ADD CONSTRAINT story_time_proposals_current_version_fk
  FOREIGN KEY(current_version_id,id) REFERENCES story_time_proposal_versions(id,proposal_id);

CREATE TABLE story_event_timings (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  event_card_id uuid NOT NULL REFERENCES cards(id),
  proposal_id uuid UNIQUE REFERENCES story_time_proposals(id),
  proposal_version_id uuid REFERENCES story_time_proposal_versions(id),
  lifecycle text NOT NULL CHECK (lifecycle IN ('planned','occurred','cancelled','invalidated')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','stale','invalidated')),
  time_mode text NOT NULL CHECK (time_mode IN ('absolute','custom_calendar','relative','partial','unknown')),
  start_certainty text NOT NULL CHECK (start_certainty IN ('known','partial','unknown')),
  end_certainty text NOT NULL CHECK (end_certainty IN ('known','partial','unknown')),
  start_instant timestamptz,
  end_instant timestamptz,
  timezone_name text,
  calendar_key text,
  start_label text,
  end_label text,
  normalized_start numeric,
  normalized_end numeric,
  duration_value numeric,
  duration_unit text,
  relative_to_event_card_id uuid REFERENCES cards(id),
  relative_relation text CHECK (relative_relation IS NULL OR relative_relation IN ('before','after','simultaneous')),
  relative_offset numeric,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('manual','body','fact','plan_version','state_proposal','migration')),
  chapter_document_id uuid REFERENCES chapter_documents(id),
  body_version_id uuid,
  text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  fact_id uuid REFERENCES canonical_facts(id),
  plan_version_id uuid,
  state_proposal_id uuid REFERENCES state_change_proposals(id),
  replaces_timing_id uuid REFERENCES story_event_timings(id),
  confirmed_by text NOT NULL,
  reason text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  CHECK (relative_to_event_card_id IS NULL OR relative_to_event_card_id <> event_card_id),
  CHECK (end_instant IS NULL OR start_instant IS NULL OR end_instant >= start_instant),
  CHECK (normalized_end IS NULL OR normalized_start IS NULL OR normalized_end >= normalized_start),
  CHECK (duration_value IS NULL OR duration_value > 0)
);

CREATE UNIQUE INDEX story_event_timings_active_event_unique
  ON story_event_timings(book_id,event_card_id) WHERE status='active';
CREATE INDEX story_event_timings_range_idx
  ON story_event_timings(book_id,normalized_start,normalized_end) WHERE status='active';
CREATE INDEX story_event_timings_absolute_idx
  ON story_event_timings(book_id,start_instant,end_instant) WHERE status='active';

ALTER TABLE story_time_proposal_versions ADD CONSTRAINT story_time_proposal_versions_replaces_timing_fk
  FOREIGN KEY(replaces_timing_id) REFERENCES story_event_timings(id);

ALTER TABLE story_time_proposals ADD CONSTRAINT story_time_proposals_confirmed_timing_fk
  FOREIGN KEY(confirmed_timing_id) REFERENCES story_event_timings(id);

CREATE TABLE story_time_review_actions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES story_time_proposals(id) ON DELETE CASCADE,
  proposal_version_id uuid NOT NULL REFERENCES story_time_proposal_versions(id),
  action text NOT NULL CHECK (action IN ('propose','edit','confirm','reject','mark_stale','invalidate')),
  actor text NOT NULL,
  note text NOT NULL DEFAULT '',
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE story_event_narrative_occurrences (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  event_card_id uuid NOT NULL REFERENCES cards(id),
  chapter_card_id uuid NOT NULL REFERENCES cards(id),
  scene_card_id uuid REFERENCES cards(id),
  chapter_document_id uuid REFERENCES chapter_documents(id),
  body_version_id uuid,
  text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  source_time_proposal_version_id uuid REFERENCES story_time_proposal_versions(id),
  role text NOT NULL CHECK (role IN ('mention','scene','reveal','retell','flashback','flashforward')),
  narrative_order numeric,
  source_kind text NOT NULL CHECK (source_kind IN ('manual','body','system')),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE UNIQUE INDEX story_occurrence_active_unique ON story_event_narrative_occurrences(
  book_id,event_card_id,chapter_card_id,role,
  COALESCE(scene_card_id,'00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(body_version_id,'00000000-0000-0000-0000-000000000000'::uuid)
) WHERE status='active';
CREATE INDEX story_occurrence_chapter_idx ON story_event_narrative_occurrences(book_id,chapter_card_id,narrative_order) WHERE status='active';

CREATE TABLE story_relation_proposals (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  proposal_source text NOT NULL CHECK (proposal_source IN ('ai','manual','import','system')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected','stale','invalidated')),
  current_version_id uuid,
  confirmed_relation_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,book_id)
);

CREATE TABLE story_relation_proposal_versions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES story_relation_proposals(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  relation_family text NOT NULL CHECK (relation_family IN ('temporal','causal')),
  relation_type text NOT NULL CHECK (relation_type IN ('before','after','simultaneous','overlaps','contains','causes','enables','blocks','depends_on')),
  source_event_card_id uuid NOT NULL REFERENCES cards(id),
  target_event_card_id uuid NOT NULL REFERENCES cards(id),
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('manual','body','fact','plan_version','state_proposal')),
  chapter_document_id uuid REFERENCES chapter_documents(id),
  body_version_id uuid,
  text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  fact_id uuid REFERENCES canonical_facts(id),
  plan_version_id uuid,
  state_proposal_id uuid REFERENCES state_change_proposals(id),
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reason text NOT NULL,
  editor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  UNIQUE(proposal_id,version),
  UNIQUE(id,proposal_id),
  CHECK (source_event_card_id <> target_event_card_id),
  CHECK ((relation_family='temporal' AND relation_type IN ('before','after','simultaneous','overlaps','contains')) OR (relation_family='causal' AND relation_type IN ('causes','enables','blocks','depends_on')))
);

ALTER TABLE story_relation_proposals ADD CONSTRAINT story_relation_proposals_current_version_fk
  FOREIGN KEY(current_version_id,id) REFERENCES story_relation_proposal_versions(id,proposal_id);

CREATE TABLE story_event_relations (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL UNIQUE REFERENCES story_relation_proposals(id),
  proposal_version_id uuid NOT NULL REFERENCES story_relation_proposal_versions(id),
  relation_family text NOT NULL CHECK (relation_family IN ('temporal','causal')),
  relation_type text NOT NULL CHECK (relation_type IN ('before','simultaneous','overlaps','contains','causes','enables','blocks','depends_on')),
  source_event_card_id uuid NOT NULL REFERENCES cards(id),
  target_event_card_id uuid NOT NULL REFERENCES cards(id),
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','invalidated')),
  confirmed_by text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_event_card_id <> target_event_card_id),
  CHECK ((relation_family='temporal' AND relation_type IN ('before','simultaneous','overlaps','contains')) OR (relation_family='causal' AND relation_type IN ('causes','enables','blocks','depends_on')))
);

CREATE UNIQUE INDEX story_event_relations_active_unique
  ON story_event_relations(book_id,relation_type,source_event_card_id,target_event_card_id) WHERE status='active';
CREATE INDEX story_event_relations_source_idx ON story_event_relations(book_id,source_event_card_id,relation_family) WHERE status='active';
CREATE INDEX story_event_relations_target_idx ON story_event_relations(book_id,target_event_card_id,relation_family) WHERE status='active';

ALTER TABLE story_relation_proposals ADD CONSTRAINT story_relation_proposals_confirmed_relation_fk
  FOREIGN KEY(confirmed_relation_id) REFERENCES story_event_relations(id);

CREATE TABLE story_relation_review_actions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES story_relation_proposals(id) ON DELETE CASCADE,
  proposal_version_id uuid NOT NULL REFERENCES story_relation_proposal_versions(id),
  action text NOT NULL CHECK (action IN ('propose','edit','confirm','reject','mark_stale','invalidate')),
  actor text NOT NULL,
  note text NOT NULL DEFAULT '',
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE story_time_positions ADD COLUMN canonical_timing_id uuid REFERENCES story_event_timings(id);

INSERT INTO story_event_timings(
  id,book_id,event_card_id,lifecycle,status,time_mode,start_certainty,end_certainty,
  calendar_key,start_label,end_label,normalized_start,normalized_end,evidence_kind,confirmed_by,reason,confirmed_at
)
SELECT
  gen_random_uuid(),book.id,position.card_id,
  CASE WHEN card.values->>'event_status'='completed' THEN 'occurred' ELSE 'planned' END,
  'active',
  CASE WHEN position.start_order IS NOT NULL OR position.end_order IS NOT NULL THEN 'custom_calendar' WHEN position.start_label<>'' OR position.end_label<>'' THEN 'partial' ELSE 'unknown' END,
  CASE WHEN position.start_order IS NOT NULL THEN 'known' WHEN position.start_label<>'' THEN 'partial' ELSE 'unknown' END,
  CASE WHEN position.end_order IS NOT NULL THEN 'known' WHEN position.end_label<>'' THEN 'partial' ELSE 'unknown' END,
  CASE WHEN position.start_order IS NOT NULL OR position.end_order IS NOT NULL THEN 'legacy-order' ELSE NULL END,
  NULLIF(position.start_label,''),NULLIF(position.end_label,''),position.start_order,position.end_order,
  'migration','migration','从旧轻量故事时间投影迁入完整时间正本。',position.updated_at
FROM story_time_positions position
JOIN books book ON book.space_id=position.space_id
JOIN cards card ON card.id=position.card_id;

UPDATE story_time_positions position
SET canonical_timing_id=timing.id
FROM story_event_timings timing,books book
WHERE book.space_id=position.space_id AND timing.book_id=book.id AND timing.event_card_id=position.card_id AND timing.status='active';

CREATE INDEX story_time_review_proposal_idx ON story_time_review_actions(proposal_id,created_at);
CREATE INDEX story_relation_review_proposal_idx ON story_relation_review_actions(proposal_id,created_at);
