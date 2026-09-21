-- Versioned visual assets for independent comic character and scene bibles. Manual after 109 and 112.
SET search_path TO new_design, public;

CREATE TABLE comic_visual_assets (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 bible_entity_id uuid NOT NULL,
 asset_type text NOT NULL CHECK (asset_type IN ('portrait','three_view','expression','costume','prop','scene_sheet')),
 revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
 adopted_version_id uuid,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),
 FOREIGN KEY(project_id,bible_entity_id) REFERENCES comic_bible_entities(project_id,id)
);
CREATE INDEX comic_visual_assets_entity ON comic_visual_assets(project_id,bible_entity_id,status,created_at,id);

CREATE TABLE comic_visual_asset_versions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 asset_id uuid NOT NULL,
 bible_entity_id uuid NOT NULL,
 source_bible_version_id uuid NOT NULL,
 version integer NOT NULL CHECK (version>0),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 240),
 description text NOT NULL DEFAULT '' CHECK (length(description)<=4000),
 filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 240),
 mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp','image/gif')),
 byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
 checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
 image_data bytea NOT NULL,
 source_kind text NOT NULL DEFAULT 'upload' CHECK (source_kind IN ('upload','ai_candidate')),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(asset_id,version),
 UNIQUE(asset_id,id),
 FOREIGN KEY(project_id,asset_id) REFERENCES comic_visual_assets(project_id,id),
 FOREIGN KEY(bible_entity_id,source_bible_version_id) REFERENCES comic_bible_versions(entity_id,id),
 CHECK (octet_length(image_data)=byte_size)
);
CREATE INDEX comic_visual_asset_versions_recent ON comic_visual_asset_versions(asset_id,version DESC,id DESC);

ALTER TABLE comic_visual_assets ADD CONSTRAINT comic_visual_asset_adopted_version_fk
 FOREIGN KEY(id,adopted_version_id) REFERENCES comic_visual_asset_versions(asset_id,id);

CREATE TABLE comic_visual_asset_adoptions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 asset_id uuid NOT NULL,
 version_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision>0),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(asset_id,revision),
 FOREIGN KEY(project_id,asset_id) REFERENCES comic_visual_assets(project_id,id),
 FOREIGN KEY(asset_id,version_id) REFERENCES comic_visual_asset_versions(asset_id,id)
);

CREATE FUNCTION guard_comic_visual_asset_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'comic visual asset history is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER comic_visual_asset_versions_immutable BEFORE UPDATE OR DELETE ON comic_visual_asset_versions FOR EACH ROW EXECUTE FUNCTION guard_comic_visual_asset_event_immutable();
CREATE TRIGGER comic_visual_asset_adoptions_immutable BEFORE UPDATE OR DELETE ON comic_visual_asset_adoptions FOR EACH ROW EXECUTE FUNCTION guard_comic_visual_asset_event_immutable();
