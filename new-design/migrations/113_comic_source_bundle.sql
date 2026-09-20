-- Versioned, manually reviewed source digest for independent comic projects.
SET search_path TO new_design, public;

CREATE TABLE comic_source_bundle_state (
 project_id uuid PRIMARY KEY REFERENCES comic_projects(id),
 revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
 adopted_version_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comic_source_bundle_versions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES comic_projects(id),
 version integer NOT NULL CHECK (version>0),
 source_version_id uuid NOT NULL,
 source_kind text NOT NULL CHECK (source_kind IN ('manual','ai_candidate')),
 content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,version),
 UNIQUE(project_id,id),
 FOREIGN KEY(project_id,source_version_id) REFERENCES comic_source_versions(project_id,id)
);
ALTER TABLE comic_source_bundle_state ADD CONSTRAINT comic_source_bundle_adopted_version_fk
 FOREIGN KEY(project_id,adopted_version_id) REFERENCES comic_source_bundle_versions(project_id,id);
CREATE TABLE comic_source_bundle_adoptions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES comic_source_bundle_state(project_id),
 version_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision>0),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,revision),
 FOREIGN KEY(project_id,version_id) REFERENCES comic_source_bundle_versions(project_id,id)
);
CREATE FUNCTION guard_comic_source_bundle_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'comic source bundle history is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER comic_source_bundle_versions_immutable BEFORE UPDATE OR DELETE ON comic_source_bundle_versions FOR EACH ROW EXECUTE FUNCTION guard_comic_source_bundle_event_immutable();
CREATE TRIGGER comic_source_bundle_adoptions_immutable BEFORE UPDATE OR DELETE ON comic_source_bundle_adoptions FOR EACH ROW EXECUTE FUNCTION guard_comic_source_bundle_event_immutable();
