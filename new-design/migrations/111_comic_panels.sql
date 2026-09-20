-- Versioned whole-episode comic panel scripts. Manual migration after 110.
SET search_path TO new_design, public;

ALTER TABLE comic_episodes ADD COLUMN script_revision integer NOT NULL DEFAULT 0 CHECK (script_revision>=0);
ALTER TABLE comic_episodes ADD COLUMN adopted_panel_set_id uuid;
CREATE TABLE comic_panel_sets (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 episode_id uuid NOT NULL,
 version integer NOT NULL CHECK (version>0),
 episode_version_id uuid NOT NULL,
 density_mode text NOT NULL CHECK (density_mode IN ('relaxed','balanced','compact')),
 source_kind text NOT NULL CHECK (source_kind IN ('manual','ai_candidate')),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(episode_id,version),
 UNIQUE(episode_id,id),
 FOREIGN KEY(project_id,episode_id) REFERENCES comic_episodes(project_id,id),
 FOREIGN KEY(episode_id,episode_version_id) REFERENCES comic_episode_versions(episode_id,id)
);
CREATE TABLE comic_panels (
 id uuid PRIMARY KEY,
 panel_set_id uuid NOT NULL REFERENCES comic_panel_sets(id),
 panel_order integer NOT NULL CHECK (panel_order BETWEEN 1 AND 80),
 panel_type text NOT NULL,
 action text NOT NULL,
 dialogues jsonb NOT NULL CHECK (jsonb_typeof(dialogues)='array'),
 character_refs jsonb NOT NULL CHECK (jsonb_typeof(character_refs)='array'),
 scene_ref text,
 visual_prompt text NOT NULL,
 density_level text CHECK (density_level IN ('low','medium','high')),
 focus text,
 layout_data jsonb,
 UNIQUE(panel_set_id,panel_order)
);
ALTER TABLE comic_episodes ADD CONSTRAINT comic_episode_adopted_panel_set_fk
 FOREIGN KEY(id,adopted_panel_set_id) REFERENCES comic_panel_sets(episode_id,id);
CREATE TABLE comic_panel_set_adoptions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 episode_id uuid NOT NULL,
 set_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision>0),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(episode_id,revision),
 FOREIGN KEY(project_id,episode_id) REFERENCES comic_episodes(project_id,id),
 FOREIGN KEY(episode_id,set_id) REFERENCES comic_panel_sets(episode_id,id)
);
CREATE TRIGGER comic_panel_sets_immutable BEFORE UPDATE OR DELETE ON comic_panel_sets FOR EACH ROW EXECUTE FUNCTION guard_comic_episode_event_immutable();
CREATE TRIGGER comic_panels_immutable BEFORE UPDATE OR DELETE ON comic_panels FOR EACH ROW EXECUTE FUNCTION guard_comic_episode_event_immutable();
CREATE TRIGGER comic_panel_set_adoptions_immutable BEFORE UPDATE OR DELETE ON comic_panel_set_adoptions FOR EACH ROW EXECUTE FUNCTION guard_comic_episode_event_immutable();
