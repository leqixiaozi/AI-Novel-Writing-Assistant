SET search_path TO new_design, public;

CREATE TABLE chapter_documents (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_card_id uuid NOT NULL REFERENCES cards(id),
  logical_order integer NOT NULL CHECK (logical_order > 0),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  adopted_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,chapter_card_id),
  UNIQUE(book_id,logical_order),
  UNIQUE(id,book_id)
);

CREATE TABLE chapter_body_versions (
  id uuid PRIMARY KEY,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  parent_version_id uuid,
  base_version_id uuid,
  source text NOT NULL CHECK (source IN ('manual','ai_candidate','revision','import')),
  source_run_id uuid REFERENCES ai_generation_batches(id),
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('user','ai','system','import')),
  created_by text NOT NULL DEFAULT '',
  content text NOT NULL CHECK (length(content) > 0),
  content_hash char(64) NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chapter_document_id,version),
  UNIQUE(id,chapter_document_id),
  FOREIGN KEY (parent_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  FOREIGN KEY (base_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

ALTER TABLE chapter_documents ADD CONSTRAINT chapter_documents_adopted_version_fk
  FOREIGN KEY (adopted_version_id,id) REFERENCES chapter_body_versions(id,chapter_document_id);

CREATE TABLE chapter_body_adoptions (
  id uuid PRIMARY KEY,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  from_version_id uuid,
  to_version_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('adopt','rollback','readopt')),
  document_revision integer NOT NULL CHECK (document_revision > 0),
  idempotency_key text NOT NULL UNIQUE,
  actor text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (from_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  FOREIGN KEY (to_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE TABLE chapter_text_anchors (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  body_version_id uuid NOT NULL,
  subject_card_id uuid REFERENCES cards(id),
  role text NOT NULL DEFAULT 'reference',
  label text NOT NULL,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  excerpt text NOT NULL,
  fragment_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE INDEX chapter_documents_book_order_idx ON chapter_documents(book_id,logical_order);
CREATE INDEX chapter_body_versions_document_idx ON chapter_body_versions(chapter_document_id,version DESC);
CREATE INDEX chapter_body_adoptions_document_idx ON chapter_body_adoptions(chapter_document_id,created_at DESC);
CREATE INDEX chapter_text_anchors_version_idx ON chapter_text_anchors(body_version_id,start_offset);
CREATE INDEX chapter_text_anchors_subject_idx ON chapter_text_anchors(subject_card_id) WHERE subject_card_id IS NOT NULL;
