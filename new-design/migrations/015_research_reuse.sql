SET search_path TO new_design, public;

CREATE TABLE book_creation_research_selections (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES book_creation_sessions(id) ON DELETE CASCADE,
  research_version_id uuid REFERENCES research_record_versions(id),
  pack_version_id uuid REFERENCES research_reference_pack_versions(id),
  purpose text NOT NULL DEFAULT 'book_creation',
  sort_order integer NOT NULL DEFAULT 0,
  compiled_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((research_version_id IS NOT NULL) <> (pack_version_id IS NOT NULL))
);

CREATE UNIQUE INDEX book_creation_research_version_unique
  ON book_creation_research_selections(session_id,research_version_id)
  WHERE research_version_id IS NOT NULL;

CREATE UNIQUE INDEX book_creation_pack_version_unique
  ON book_creation_research_selections(session_id,pack_version_id)
  WHERE pack_version_id IS NOT NULL;

CREATE UNIQUE INDEX book_research_reference_version_unique
  ON book_research_references(book_id,research_version_id)
  WHERE research_version_id IS NOT NULL;

CREATE UNIQUE INDEX book_research_pack_version_unique
  ON book_research_references(book_id,pack_version_id)
  WHERE pack_version_id IS NOT NULL;

CREATE INDEX book_creation_research_session_idx
  ON book_creation_research_selections(session_id,sort_order);
