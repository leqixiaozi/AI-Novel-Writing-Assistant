-- Independent comic workspace. Manual migration; no old comic tables are read or copied.
SET search_path TO new_design, public;

CREATE TABLE comic_projects (
 id uuid PRIMARY KEY,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
 source_type text NOT NULL CHECK (source_type IN ('novel_import','original','text_import')),
 comic_format text NOT NULL CHECK (comic_format IN ('webtoon','4koma','single_page','cinematic','chat_comic','chibi_comic','ink_comic','drama_screenshot')),
 style_preset text NOT NULL CHECK (style_preset IN ('webtoon_color','bl_manga','shounen_bw','ink_traditional','chibi','realistic')),
 status text NOT NULL DEFAULT 'draft' CHECK (status='draft'),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 adopted_source_version_id uuid,
 create_request_key uuid NOT NULL UNIQUE,
 create_input_hash text NOT NULL CHECK (create_input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comic_source_versions (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES comic_projects(id),
 version integer NOT NULL CHECK (version>0),
 source_type text NOT NULL CHECK (source_type IN ('novel_import','original','text_import')),
 source_book_id uuid REFERENCES books(id),
 source_book_name text,
 content text NOT NULL CHECK (length(btrim(content))>0 AND octet_length(content)<=4000000),
 content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,version),
 UNIQUE(project_id,id),
 CHECK ((source_type='novel_import')=(source_book_id IS NOT NULL))
);
ALTER TABLE comic_projects ADD CONSTRAINT comic_project_adopted_source_fk
 FOREIGN KEY (id,adopted_source_version_id) REFERENCES comic_source_versions(project_id,id);
CREATE INDEX comic_projects_recent ON comic_projects(created_at DESC,id DESC);

CREATE FUNCTION guard_comic_source_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'comic source snapshots are immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER comic_source_versions_immutable BEFORE UPDATE OR DELETE ON comic_source_versions
 FOR EACH ROW EXECUTE FUNCTION guard_comic_source_version_immutable();
