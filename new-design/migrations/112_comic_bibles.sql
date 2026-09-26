-- Versioned text bibles for independent comic characters and scenes. Manual after 109.
SET search_path TO new_design, public;

CREATE TABLE comic_bible_entities (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES comic_projects(id),
 kind text NOT NULL CHECK (kind IN ('character','scene')),
 revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
 adopted_version_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id)
);
CREATE TABLE comic_bible_versions (
 id uuid PRIMARY KEY,
 entity_id uuid NOT NULL REFERENCES comic_bible_entities(id),
 version integer NOT NULL CHECK (version>0),
 content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
 source_kind text NOT NULL CHECK (source_kind IN ('manual','ai_candidate')),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(entity_id,version),
 UNIQUE(entity_id,id)
);
ALTER TABLE comic_bible_entities ADD CONSTRAINT comic_bible_adopted_version_fk
 FOREIGN KEY(id,adopted_version_id) REFERENCES comic_bible_versions(entity_id,id);
CREATE TABLE comic_bible_adoptions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 version_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision>0),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(entity_id,revision),
 FOREIGN KEY(project_id,entity_id) REFERENCES comic_bible_entities(project_id,id),
 FOREIGN KEY(entity_id,version_id) REFERENCES comic_bible_versions(entity_id,id)
);
CREATE FUNCTION guard_comic_bible_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'comic bible history is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER comic_bible_versions_immutable BEFORE UPDATE OR DELETE ON comic_bible_versions FOR EACH ROW EXECUTE FUNCTION guard_comic_bible_event_immutable();
CREATE TRIGGER comic_bible_adoptions_immutable BEFORE UPDATE OR DELETE ON comic_bible_adoptions FOR EACH ROW EXECUTE FUNCTION guard_comic_bible_event_immutable();
