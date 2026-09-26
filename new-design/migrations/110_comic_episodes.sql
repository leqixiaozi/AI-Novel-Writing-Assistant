-- Comic episode candidates and explicit adoptions; manual migration after 109.
SET search_path TO new_design, public;

CREATE TABLE comic_episodes (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES comic_projects(id),
 episode_order integer NOT NULL CHECK (episode_order BETWEEN 1 AND 1000),
 revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
 adopted_version_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,episode_order),
 UNIQUE(project_id,id)
);
CREATE TABLE comic_episode_versions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 episode_id uuid NOT NULL,
 version integer NOT NULL CHECK (version>0),
 source_kind text NOT NULL CHECK (source_kind IN ('manual','ai_candidate')),
 source_version_id uuid NOT NULL,
 content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(episode_id,version),
 UNIQUE(episode_id,id),
 FOREIGN KEY(project_id,episode_id) REFERENCES comic_episodes(project_id,id),
 FOREIGN KEY(project_id,source_version_id) REFERENCES comic_source_versions(project_id,id)
);
ALTER TABLE comic_episodes ADD CONSTRAINT comic_episode_adopted_version_fk
 FOREIGN KEY(id,adopted_version_id) REFERENCES comic_episode_versions(episode_id,id);
CREATE TABLE comic_episode_adoptions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 episode_id uuid NOT NULL,
 version_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision>0),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(episode_id,revision),
 FOREIGN KEY(project_id,episode_id) REFERENCES comic_episodes(project_id,id),
 FOREIGN KEY(episode_id,version_id) REFERENCES comic_episode_versions(episode_id,id)
);
CREATE FUNCTION guard_comic_episode_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'comic episode history is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER comic_episode_versions_immutable BEFORE UPDATE OR DELETE ON comic_episode_versions FOR EACH ROW EXECUTE FUNCTION guard_comic_episode_event_immutable();
CREATE TRIGGER comic_episode_adoptions_immutable BEFORE UPDATE OR DELETE ON comic_episode_adoptions FOR EACH ROW EXECUTE FUNCTION guard_comic_episode_event_immutable();
