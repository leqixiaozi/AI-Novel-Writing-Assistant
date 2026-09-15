SET search_path TO new_design, public;

CREATE TABLE canonical_facts (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  subject_card_id uuid NOT NULL REFERENCES cards(id),
  predicate text NOT NULL,
  value_kind text NOT NULL CHECK (value_kind IN ('text','number','boolean','json','card_reference')),
  value_json jsonb NOT NULL,
  value_hash char(64) NOT NULL,
  object_card_id uuid REFERENCES cards(id),
  valid_story_start numeric,
  valid_story_end numeric,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected','superseded','stale')),
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_method text NOT NULL CHECK (source_method IN ('manual','ai_extract','import','system')),
  supersedes_fact_id uuid REFERENCES canonical_facts(id),
  superseded_by_fact_id uuid REFERENCES canonical_facts(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_story_end IS NULL OR valid_story_start IS NULL OR valid_story_end >= valid_story_start),
  CHECK ((value_kind = 'card_reference' AND object_card_id IS NOT NULL) OR (value_kind <> 'card_reference' AND object_card_id IS NULL)),
  CHECK (supersedes_fact_id IS NULL OR supersedes_fact_id <> id),
  CHECK (superseded_by_fact_id IS NULL OR superseded_by_fact_id <> id)
);

CREATE TABLE canonical_fact_evidence (
  id uuid PRIMARY KEY,
  fact_id uuid NOT NULL REFERENCES canonical_facts(id) ON DELETE CASCADE,
  chapter_text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  card_version_id uuid REFERENCES card_versions(id),
  research_evidence_id uuid REFERENCES research_evidence(id),
  extraction_method text NOT NULL CHECK (extraction_method IN ('manual','ai_extract','import','system')),
  note text NOT NULL DEFAULT '',
  stale_at timestamptz,
  stale_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(chapter_text_anchor_id,card_version_id,research_evidence_id) = 1)
);

CREATE TABLE canonical_fact_conflicts (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  fact_a_id uuid NOT NULL REFERENCES canonical_facts(id) ON DELETE CASCADE,
  fact_b_id uuid NOT NULL REFERENCES canonical_facts(id) ON DELETE CASCADE,
  predicate text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolution_fact_id uuid REFERENCES canonical_facts(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (fact_a_id < fact_b_id),
  UNIQUE(book_id,fact_a_id,fact_b_id)
);

CREATE TABLE canonical_fact_review_actions (
  id uuid PRIMARY KEY,
  fact_id uuid NOT NULL REFERENCES canonical_facts(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('propose','confirm','reject','supersede','mark_stale')),
  from_status text,
  to_status text NOT NULL,
  idempotency_key text UNIQUE,
  actor text NOT NULL DEFAULT 'user',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX canonical_facts_book_subject_idx ON canonical_facts(book_id,subject_card_id,predicate,status);
CREATE INDEX canonical_facts_correction_idx ON canonical_facts(supersedes_fact_id) WHERE supersedes_fact_id IS NOT NULL;
CREATE INDEX canonical_fact_evidence_fact_idx ON canonical_fact_evidence(fact_id);
CREATE INDEX canonical_fact_evidence_anchor_idx ON canonical_fact_evidence(chapter_text_anchor_id) WHERE chapter_text_anchor_id IS NOT NULL;
CREATE INDEX canonical_fact_conflicts_book_idx ON canonical_fact_conflicts(book_id,status,created_at DESC);
CREATE INDEX canonical_fact_reviews_fact_idx ON canonical_fact_review_actions(fact_id,created_at DESC);
