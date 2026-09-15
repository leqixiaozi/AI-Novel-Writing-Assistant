SET search_path TO new_design, public;

CREATE TABLE epistemic_claims (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  subject_card_id uuid REFERENCES cards(id),
  predicate text NOT NULL,
  value_kind text NOT NULL CHECK (value_kind IN ('text','number','boolean','json','card_reference')),
  value_json jsonb NOT NULL,
  object_card_id uuid REFERENCES cards(id),
  value_hash char(64) NOT NULL,
  truth_fact_id uuid REFERENCES canonical_facts(id),
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((value_kind='card_reference' AND object_card_id IS NOT NULL) OR (value_kind<>'card_reference' AND object_card_id IS NULL)),
  UNIQUE(book_id,id),
  UNIQUE NULLS NOT DISTINCT(book_id,subject_card_id,predicate,value_hash)
);

CREATE TABLE knowledge_state_proposals (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL,
  holder_kind text NOT NULL CHECK (holder_kind IN ('character','reader')),
  holder_key text NOT NULL,
  holder_card_id uuid REFERENCES cards(id),
  current_version_id uuid,
  source text NOT NULL CHECK (source IN ('ai','manual','import','system')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected','invalidated')),
  confirmed_change_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((holder_kind='character' AND holder_card_id IS NOT NULL) OR (holder_kind='reader' AND holder_card_id IS NULL)),
  FOREIGN KEY(book_id,claim_id) REFERENCES epistemic_claims(book_id,id),
  UNIQUE(id,book_id)
);

CREATE TABLE knowledge_state_proposal_versions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES knowledge_state_proposals(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  stance text NOT NULL CHECK (stance IN ('knows','believes','suspects','misunderstands','unknown')),
  confidence numeric CHECK (confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  acquisition_method text NOT NULL CHECK (acquisition_method IN ('witnessed','told','inferred','read','narration','assumed','forgotten','manual')),
  source_character_card_id uuid REFERENCES cards(id),
  source_event_card_id uuid REFERENCES cards(id),
  chapter_document_id uuid REFERENCES chapter_documents(id),
  body_version_id uuid,
  text_anchor_id uuid REFERENCES chapter_text_anchors(id),
  effective_story_order numeric,
  effective_narrative_order numeric,
  reason text NOT NULL,
  editor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  UNIQUE(proposal_id,version),
  UNIQUE(id,proposal_id),
  CHECK ((body_version_id IS NULL AND text_anchor_id IS NULL) OR body_version_id IS NOT NULL)
);

ALTER TABLE knowledge_state_proposals ADD CONSTRAINT knowledge_state_proposals_current_version_fk
  FOREIGN KEY(current_version_id,id) REFERENCES knowledge_state_proposal_versions(id,proposal_id);

CREATE TABLE knowledge_state_changes (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL UNIQUE,
  proposal_version_id uuid NOT NULL REFERENCES knowledge_state_proposal_versions(id),
  claim_id uuid NOT NULL,
  holder_kind text NOT NULL CHECK (holder_kind IN ('character','reader')),
  holder_key text NOT NULL,
  holder_card_id uuid REFERENCES cards(id),
  stance text NOT NULL CHECK (stance IN ('knows','believes','suspects','misunderstands','unknown')),
  confidence numeric CHECK (confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  effective_story_order numeric,
  effective_narrative_order numeric,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reverted','invalidated')),
  confirmed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(proposal_id,book_id) REFERENCES knowledge_state_proposals(id,book_id),
  FOREIGN KEY(book_id,claim_id) REFERENCES epistemic_claims(book_id,id),
  CHECK ((holder_kind='character' AND holder_card_id IS NOT NULL) OR (holder_kind='reader' AND holder_card_id IS NULL))
);

ALTER TABLE knowledge_state_proposals ADD CONSTRAINT knowledge_state_proposals_confirmed_change_fk
  FOREIGN KEY(confirmed_change_id) REFERENCES knowledge_state_changes(id);

CREATE TABLE knowledge_state_review_actions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES knowledge_state_proposals(id) ON DELETE CASCADE,
  proposal_version_id uuid NOT NULL REFERENCES knowledge_state_proposal_versions(id),
  action text NOT NULL CHECK (action IN ('propose','edit','confirm','reject','invalidate')),
  actor text NOT NULL,
  note text NOT NULL DEFAULT '',
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE current_knowledge_state_projections (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  holder_kind text NOT NULL CHECK (holder_kind IN ('character','reader')),
  holder_key text NOT NULL,
  holder_card_id uuid REFERENCES cards(id),
  claim_id uuid NOT NULL,
  source_change_id uuid NOT NULL REFERENCES knowledge_state_changes(id),
  stance text NOT NULL CHECK (stance IN ('knows','believes','suspects','misunderstands','unknown')),
  confidence numeric CHECK (confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  effective_story_order numeric,
  effective_narrative_order numeric,
  projection_revision bigint NOT NULL DEFAULT 1 CHECK (projection_revision > 0),
  rebuilt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(book_id,holder_kind,holder_key,claim_id),
  FOREIGN KEY(book_id,claim_id) REFERENCES epistemic_claims(book_id,id),
  CHECK ((holder_kind='character' AND holder_card_id IS NOT NULL) OR (holder_kind='reader' AND holder_card_id IS NULL))
);

CREATE TABLE state_change_proposal_versions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES state_change_proposals(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  before_json jsonb NOT NULL,
  after_json jsonb NOT NULL,
  delta_json jsonb,
  reason text NOT NULL,
  effective_story_order numeric,
  editor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(proposal_id,version)
);

INSERT INTO state_change_proposal_versions(id,proposal_id,version,before_json,after_json,delta_json,reason,effective_story_order,editor,created_at)
SELECT gen_random_uuid(),id,1,before_json,after_json,delta_json,reason,effective_story_order,source,created_at
FROM state_change_proposals
WHERE before_known;

CREATE TABLE research_candidate_versions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES research_candidates(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  title text NOT NULL,
  values jsonb NOT NULL,
  editor text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id,revision)
);

INSERT INTO research_candidate_versions(id,candidate_id,revision,title,values,editor,note,created_at)
SELECT gen_random_uuid(),id,revision,title,values,'system','AI 提案自动入库时的初始版本。',created_at
FROM research_candidates;

CREATE INDEX epistemic_claims_book_idx ON epistemic_claims(book_id,subject_card_id,predicate);
CREATE INDEX knowledge_proposals_book_idx ON knowledge_state_proposals(book_id,status,holder_kind,holder_key);
CREATE INDEX knowledge_proposal_versions_body_idx ON knowledge_state_proposal_versions(chapter_document_id,body_version_id);
CREATE INDEX knowledge_changes_time_idx ON knowledge_state_changes(book_id,holder_kind,holder_key,effective_narrative_order,sequence);
CREATE INDEX knowledge_review_proposal_idx ON knowledge_state_review_actions(proposal_id,created_at);
CREATE INDEX research_candidate_versions_candidate_idx ON research_candidate_versions(candidate_id,revision DESC);
