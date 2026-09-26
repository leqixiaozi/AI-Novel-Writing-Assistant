-- Managed comic rendering batches, explicit adoptions and immutable exports. Manual after 027, 109-114.
SET search_path TO new_design, public;

CREATE TABLE comic_render_batches (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES comic_projects(id), episode_id uuid, panel_set_id uuid,
 request_key uuid NOT NULL UNIQUE, input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 connection_version_id uuid NOT NULL REFERENCES model_route_versions(id), image_size text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','succeeded','failed')), total_count integer NOT NULL CHECK(total_count>0),
 completed_count integer NOT NULL DEFAULT 0 CHECK(completed_count>=0), stop_position integer, last_error text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(project_id,episode_id) REFERENCES comic_episodes(project_id,id), FOREIGN KEY(episode_id,panel_set_id) REFERENCES comic_panel_sets(episode_id,id)
);
CREATE TABLE comic_fact_snapshots (
 id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES comic_render_batches(id), project_id uuid NOT NULL REFERENCES comic_projects(id),
 target_kind text NOT NULL CHECK(target_kind IN ('panel','bible')), target_id uuid NOT NULL, source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
 source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(batch_id,target_kind,target_id)
);
CREATE TABLE comic_render_versions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES comic_projects(id), episode_id uuid, panel_id uuid, bible_entity_id uuid, asset_type text,
 version integer NOT NULL CHECK(version>0), fact_snapshot_id uuid NOT NULL REFERENCES comic_fact_snapshots(id), content_object_id uuid NOT NULL REFERENCES asset_content_objects(id),
 source_kind text NOT NULL DEFAULT 'ai_candidate' CHECK(source_kind='ai_candidate'), prompt text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((panel_id IS NOT NULL)::integer+(bible_entity_id IS NOT NULL)::integer=1),
 UNIQUE(project_id,panel_id,version), UNIQUE(project_id,bible_entity_id,asset_type,version), UNIQUE(project_id,id)
);
CREATE TABLE comic_render_target_state (
 project_id uuid NOT NULL REFERENCES comic_projects(id), target_kind text NOT NULL CHECK(target_kind IN ('panel','bible')), target_id uuid NOT NULL,
 asset_type text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), adopted_version_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,target_kind,target_id,asset_type), FOREIGN KEY(project_id,adopted_version_id) REFERENCES comic_render_versions(project_id,id)
);
CREATE TABLE comic_render_adoptions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, target_kind text NOT NULL, target_id uuid NOT NULL, asset_type text NOT NULL DEFAULT '', version_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), request_key uuid NOT NULL UNIQUE, input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,target_kind,target_id,asset_type,revision), FOREIGN KEY(project_id,version_id) REFERENCES comic_render_versions(project_id,id)
);
CREATE TABLE comic_bubble_outputs (
 id uuid PRIMARY KEY, render_version_id uuid NOT NULL REFERENCES comic_render_versions(id), dialogue_snapshot jsonb NOT NULL CHECK(jsonb_typeof(dialogue_snapshot)='array'),
 layout_snapshot jsonb NOT NULL CHECK(jsonb_typeof(layout_snapshot)='object'), source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(render_version_id,source_hash)
);
CREATE TABLE comic_export_manifests (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES comic_projects(id), variant text NOT NULL CHECK(variant IN ('original_images','bubble_preview','project_manifest')),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'), source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 request_key uuid NOT NULL UNIQUE, input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comic_export_artifacts (
 id uuid PRIMARY KEY, manifest_id uuid NOT NULL UNIQUE REFERENCES comic_export_manifests(id), variant text NOT NULL,
 storage_locator text NOT NULL CHECK(storage_locator ~ '^comic/[A-Za-z0-9._/-]+$' AND storage_locator !~ '(^|/)\.\.(/|$)|//'),
 display_filename text NOT NULL CHECK(display_filename !~ '[\\/]'), media_type text NOT NULL, checksum char(64) NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
 byte_size bigint NOT NULL CHECK(byte_size>0), request_key uuid NOT NULL UNIQUE, input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_comic_render_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'comic render history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER comic_fact_snapshots_immutable BEFORE UPDATE OR DELETE ON comic_fact_snapshots FOR EACH ROW EXECUTE FUNCTION guard_comic_render_history();
CREATE TRIGGER comic_render_versions_immutable BEFORE UPDATE OR DELETE ON comic_render_versions FOR EACH ROW EXECUTE FUNCTION guard_comic_render_history();
CREATE TRIGGER comic_render_adoptions_immutable BEFORE UPDATE OR DELETE ON comic_render_adoptions FOR EACH ROW EXECUTE FUNCTION guard_comic_render_history();
CREATE TRIGGER comic_bubble_outputs_immutable BEFORE UPDATE OR DELETE ON comic_bubble_outputs FOR EACH ROW EXECUTE FUNCTION guard_comic_render_history();
CREATE TRIGGER comic_export_manifests_immutable BEFORE UPDATE OR DELETE ON comic_export_manifests FOR EACH ROW EXECUTE FUNCTION guard_comic_render_history();
CREATE TRIGGER comic_export_artifacts_immutable BEFORE UPDATE OR DELETE ON comic_export_artifacts FOR EACH ROW EXECUTE FUNCTION guard_comic_render_history();
CREATE INDEX comic_render_batches_project ON comic_render_batches(project_id,created_at DESC,id);
CREATE INDEX comic_render_versions_panel ON comic_render_versions(project_id,panel_id,version DESC,id);
