SET search_path TO new_design, public;

CREATE TABLE research_documents (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('paste','file','public_url','book_export')),
  source_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research_document_versions (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content text NOT NULL,
  content_hash text NOT NULL,
  character_count integer NOT NULL CHECK (character_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id,version)
);

ALTER TABLE research_documents ADD CONSTRAINT research_documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES research_document_versions(id);

CREATE TABLE research_records (
  id uuid PRIMARY KEY,
  record_type text NOT NULL CHECK (record_type IN ('market_scan','market_analysis','book_analysis','diagnosis')),
  title text NOT NULL,
  source_document_version_id uuid REFERENCES research_document_versions(id),
  current_version_id uuid,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  favorite boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research_record_versions (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES research_records(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  parent_version_id uuid REFERENCES research_record_versions(id),
  source_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_key text NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  run_status text NOT NULL CHECK (run_status IN ('queued','running','completed','partial','failed','cancelled')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  budget_tokens integer CHECK (budget_tokens IS NULL OR budget_tokens > 0),
  used_tokens integer NOT NULL DEFAULT 0 CHECK (used_tokens >= 0),
  prompt_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  structured_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  report text NOT NULL DEFAULT '',
  last_error text NOT NULL DEFAULT '',
  cancel_requested boolean NOT NULL DEFAULT false,
  run_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(record_id,version)
);

ALTER TABLE research_records ADD CONSTRAINT research_records_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES research_record_versions(id);

CREATE TABLE research_evidence (
  id uuid PRIMARY KEY,
  research_version_id uuid NOT NULL REFERENCES research_record_versions(id) ON DELETE CASCADE,
  source_document_version_id uuid REFERENCES research_document_versions(id),
  field_path text NOT NULL,
  excerpt text NOT NULL,
  start_offset integer CHECK (start_offset IS NULL OR start_offset >= 0),
  end_offset integer CHECK (end_offset IS NULL OR end_offset >= 0),
  certainty text NOT NULL CHECK (certainty IN ('explicit','inferred','low_confidence')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research_candidate_batches (
  id uuid PRIMARY KEY,
  research_version_id uuid NOT NULL REFERENCES research_record_versions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('draft','ready','partially_adopted','adopted','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research_candidates (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES research_candidate_batches(id) ON DELETE CASCADE,
  target_type_key text NOT NULL,
  title text NOT NULL,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  relation_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  merge_key text NOT NULL DEFAULT '',
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','reference_only','ignored','adopted')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research_candidate_adoptions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES research_candidates(id),
  action text NOT NULL CHECK (action IN ('create_card','merge_card','save_resource','reference_only','ignore')),
  target_space_id uuid REFERENCES card_spaces(id),
  target_card_id uuid REFERENCES cards(id),
  applied_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research_reference_packs (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  current_version_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research_reference_pack_versions (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES research_reference_packs(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pack_id,version)
);

ALTER TABLE research_reference_packs ADD CONSTRAINT research_reference_packs_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES research_reference_pack_versions(id);

CREATE TABLE research_reference_pack_items (
  id uuid PRIMARY KEY,
  pack_version_id uuid NOT NULL REFERENCES research_reference_pack_versions(id) ON DELETE CASCADE,
  research_version_id uuid NOT NULL REFERENCES research_record_versions(id),
  purpose text NOT NULL,
  weight numeric(5,4) NOT NULL DEFAULT 1 CHECK (weight > 0),
  sort_order integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  UNIQUE(pack_version_id,research_version_id)
);

CREATE TABLE book_research_references (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  research_version_id uuid REFERENCES research_record_versions(id),
  pack_version_id uuid REFERENCES research_reference_pack_versions(id),
  purpose text NOT NULL,
  compiled_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((research_version_id IS NOT NULL) <> (pack_version_id IS NOT NULL))
);

CREATE TABLE market_source_snapshots (
  id uuid PRIMARY KEY,
  research_version_id uuid NOT NULL REFERENCES research_record_versions(id) ON DELETE CASCADE,
  platform text NOT NULL,
  list_key text NOT NULL,
  list_label text NOT NULL,
  source_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded','failed','stale')),
  error text NOT NULL DEFAULT '',
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(research_version_id,platform,list_key)
);

CREATE TABLE market_ranking_items (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES market_source_snapshots(id) ON DELETE CASCADE,
  rank integer NOT NULL CHECK (rank > 0),
  title text NOT NULL,
  author text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  synopsis text NOT NULL DEFAULT '',
  heat_label text NOT NULL DEFAULT '',
  serial_status text NOT NULL DEFAULT '',
  source_url text NOT NULL,
  UNIQUE(snapshot_id,rank)
);

CREATE INDEX research_records_type_status_idx ON research_records(record_type,status,updated_at DESC);
CREATE INDEX research_versions_record_idx ON research_record_versions(record_id,version DESC);
CREATE INDEX research_evidence_version_idx ON research_evidence(research_version_id,field_path);
CREATE INDEX research_candidates_batch_idx ON research_candidates(batch_id,status);
CREATE INDEX book_research_references_book_idx ON book_research_references(book_id,created_at DESC);
CREATE INDEX market_items_snapshot_idx ON market_ranking_items(snapshot_id,rank);
