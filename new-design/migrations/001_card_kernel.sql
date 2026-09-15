CREATE SCHEMA IF NOT EXISTS new_design;
SET search_path TO new_design, public;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_spaces (
  id uuid PRIMARY KEY,
  space_key text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_types (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  type_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  current_version_id uuid,
  draft_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, type_key)
);

CREATE TABLE IF NOT EXISTS card_type_versions (
  id uuid PRIMARY KEY,
  card_type_id uuid NOT NULL REFERENCES card_types(id),
  version integer NOT NULL CHECK (version > 0),
  fields jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_type_id, version)
);

CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  card_type_id uuid NOT NULL REFERENCES card_types(id),
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  revision integer NOT NULL CHECK (revision > 0),
  type_version_id uuid NOT NULL REFERENCES card_type_versions(id),
  current_version_id uuid,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS card_versions (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id),
  revision integer NOT NULL CHECK (revision > 0),
  type_version_id uuid NOT NULL REFERENCES card_type_versions(id),
  title text NOT NULL,
  values jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('create', 'edit', 'archive', 'restore')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, revision)
);

CREATE INDEX IF NOT EXISTS cards_type_status_idx ON cards (card_type_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS card_versions_card_idx ON card_versions (card_id, revision DESC);
CREATE INDEX IF NOT EXISTS card_type_versions_type_idx ON card_type_versions (card_type_id, version DESC);

INSERT INTO card_spaces (id, space_key, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'default', '新设计默认空间')
ON CONFLICT (space_key) DO NOTHING;
