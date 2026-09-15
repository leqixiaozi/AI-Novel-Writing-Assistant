SET search_path TO new_design, public;

CREATE TABLE material_tags (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  tag_key text NOT NULL CHECK(tag_key ~ '^[a-z][a-z0-9_-]{1,62}$'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  visibility text NOT NULL DEFAULT 'space' CHECK(visibility IN ('space','private')),
  created_by text NOT NULL DEFAULT 'user',
  updated_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id,tag_key)
);

CREATE TABLE material_tag_versions (
  id uuid PRIMARY KEY,
  tag_id uuid NOT NULL REFERENCES material_tags(id),
  version integer NOT NULL CHECK(version>0),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
  aliases text[] NOT NULL DEFAULT '{}',
  color text CHECK(color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  status text NOT NULL CHECK(status IN ('active','archived')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tag_id,version)
);
ALTER TABLE material_tags ADD CONSTRAINT material_tags_current_version_fk FOREIGN KEY(current_version_id) REFERENCES material_tag_versions(id);

CREATE TABLE material_tag_memberships (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  tag_id uuid NOT NULL REFERENCES material_tags(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  created_by text NOT NULL DEFAULT 'user',
  updated_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX material_tag_memberships_active_unique ON material_tag_memberships(tag_id,card_id) WHERE status='active';

CREATE TABLE material_tag_membership_versions (
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL REFERENCES material_tag_memberships(id),
  revision integer NOT NULL CHECK(revision>0),
  tag_version_id uuid NOT NULL REFERENCES material_tag_versions(id),
  card_version_id uuid NOT NULL REFERENCES card_versions(id),
  status text NOT NULL CHECK(status IN ('active','ended')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(membership_id,revision)
);
ALTER TABLE material_tag_memberships ADD CONSTRAINT material_tag_memberships_current_version_fk FOREIGN KEY(current_version_id) REFERENCES material_tag_membership_versions(id);

CREATE TABLE material_groups (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id),
  group_key text NOT NULL CHECK(group_key ~ '^[a-z][a-z0-9_-]{1,62}$'),
  parent_id uuid REFERENCES material_groups(id),
  sort_order integer NOT NULL DEFAULT 1000 CHECK(sort_order BETWEEN 0 AND 100000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  visibility text NOT NULL DEFAULT 'space' CHECK(visibility IN ('space','private')),
  created_by text NOT NULL DEFAULT 'user',
  updated_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(parent_id IS NULL OR parent_id<>id),
  UNIQUE(space_id,group_key)
);

CREATE TABLE material_group_versions (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES material_groups(id),
  version integer NOT NULL CHECK(version>0),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  parent_id uuid REFERENCES material_groups(id),
  sort_order integer NOT NULL CHECK(sort_order BETWEEN 0 AND 100000),
  status text NOT NULL CHECK(status IN ('active','archived')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id,version)
);
ALTER TABLE material_groups ADD CONSTRAINT material_groups_current_version_fk FOREIGN KEY(current_version_id) REFERENCES material_group_versions(id);

CREATE TABLE material_group_memberships (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  group_id uuid NOT NULL REFERENCES material_groups(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  sort_order integer NOT NULL DEFAULT 1000 CHECK(sort_order BETWEEN 0 AND 100000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  created_by text NOT NULL DEFAULT 'user',
  updated_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX material_group_memberships_active_unique ON material_group_memberships(group_id,card_id) WHERE status='active';

CREATE TABLE material_group_membership_versions (
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL REFERENCES material_group_memberships(id),
  revision integer NOT NULL CHECK(revision>0),
  group_version_id uuid NOT NULL REFERENCES material_group_versions(id),
  card_version_id uuid NOT NULL REFERENCES card_versions(id),
  sort_order integer NOT NULL,
  status text NOT NULL CHECK(status IN ('active','ended')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(membership_id,revision)
);
ALTER TABLE material_group_memberships ADD CONSTRAINT material_group_memberships_current_version_fk FOREIGN KEY(current_version_id) REFERENCES material_group_membership_versions(id);

CREATE TABLE material_management_events (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id),
  subject_kind text NOT NULL CHECK(subject_kind IN ('tag','tag_membership','group','group_membership','smart_view')),
  subject_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('create','revise','move','reorder','archive','restore','promote_children','archive_tree','add_member','remove_member','copy')),
  expected_revision integer,
  result_version_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  idempotency_key text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id,idempotency_key)
);

CREATE TABLE smart_views (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id),
  view_key text NOT NULL CHECK(view_key ~ '^[a-z][a-z0-9_-]{1,62}$'),
  base_view_key text CHECK(base_view_key IS NULL OR base_view_key IN ('chapters','clues','characters','events','world','resources')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id uuid,
  visibility text NOT NULL DEFAULT 'space' CHECK(visibility IN ('space','private')),
  created_by text NOT NULL DEFAULT 'user',
  updated_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id,view_key)
);

CREATE TABLE smart_view_versions (
  id uuid PRIMARY KEY,
  smart_view_id uuid NOT NULL REFERENCES smart_views(id),
  version integer NOT NULL CHECK(version>0),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '',
  filter_ast jsonb NOT NULL DEFAULT '{"kind":"group","operator":"and","items":[]}'::jsonb CHECK(jsonb_typeof(filter_ast)='object'),
  sort_config jsonb NOT NULL DEFAULT '[{"field":"updated_at","direction":"desc"}]'::jsonb CHECK(jsonb_typeof(sort_config)='array'),
  grouping jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(grouping)='object'),
  display_columns text[] NOT NULL DEFAULT ARRAY['title','content_type','updated_at'],
  layout jsonb NOT NULL DEFAULT '{"mode":"list"}'::jsonb CHECK(jsonb_typeof(layout)='object'),
  copied_from_version_id uuid REFERENCES smart_view_versions(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(smart_view_id,version)
);
ALTER TABLE smart_views ADD CONSTRAINT smart_views_current_version_fk FOREIGN KEY(current_version_id) REFERENCES smart_view_versions(id);
ALTER TABLE book_view_configs ADD COLUMN smart_view_id uuid REFERENCES smart_views(id);

CREATE TABLE card_archive_previews (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  expected_revision integer NOT NULL CHECK(expected_revision>0),
  dependency_snapshot jsonb NOT NULL CHECK(jsonb_typeof(dependency_snapshot)='object'),
  snapshot_hash char(64) NOT NULL,
  confirmation_token_hash char(64) NOT NULL,
  decision text NOT NULL CHECK(decision IN ('ready','risk_confirmation','blocked')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_archive_previews_lookup ON card_archive_previews(card_id,created_at DESC);

CREATE TABLE card_archive_events (
  id uuid PRIMARY KEY,
  preview_id uuid REFERENCES card_archive_previews(id),
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid REFERENCES books(id),
  card_id uuid NOT NULL REFERENCES cards(id),
  from_status text NOT NULL CHECK(from_status IN ('active','archived')),
  to_status text NOT NULL CHECK(to_status IN ('active','archived')),
  from_revision integer NOT NULL,
  to_revision integer NOT NULL,
  snapshot_hash char(64),
  risk_accepted boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(from_status<>to_status),
  UNIQUE(space_id,idempotency_key)
);

CREATE FUNCTION guard_material_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'material management history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER material_tag_versions_immutable BEFORE UPDATE OR DELETE ON material_tag_versions FOR EACH ROW EXECUTE FUNCTION guard_material_history();
CREATE TRIGGER material_tag_membership_versions_immutable BEFORE UPDATE OR DELETE ON material_tag_membership_versions FOR EACH ROW EXECUTE FUNCTION guard_material_history();
CREATE TRIGGER material_group_versions_immutable BEFORE UPDATE OR DELETE ON material_group_versions FOR EACH ROW EXECUTE FUNCTION guard_material_history();
CREATE TRIGGER material_group_membership_versions_immutable BEFORE UPDATE OR DELETE ON material_group_membership_versions FOR EACH ROW EXECUTE FUNCTION guard_material_history();
CREATE TRIGGER material_management_events_immutable BEFORE UPDATE OR DELETE ON material_management_events FOR EACH ROW EXECUTE FUNCTION guard_material_history();
CREATE TRIGGER smart_view_versions_immutable BEFORE UPDATE OR DELETE ON smart_view_versions FOR EACH ROW EXECUTE FUNCTION guard_material_history();
CREATE TRIGGER card_archive_events_immutable BEFORE UPDATE OR DELETE ON card_archive_events FOR EACH ROW EXECUTE FUNCTION guard_material_history();

CREATE FUNCTION guard_material_group_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_row material_groups%ROWTYPE;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id=NEW.id THEN RAISE EXCEPTION 'a material group cannot be its own parent' USING ERRCODE='23514'; END IF;
  SELECT * INTO parent_row FROM material_groups WHERE id=NEW.parent_id;
  IF parent_row.id IS NULL THEN RAISE EXCEPTION 'material group parent not found' USING ERRCODE='23503'; END IF;
  IF parent_row.space_id<>NEW.space_id OR parent_row.book_id IS DISTINCT FROM NEW.book_id THEN
    RAISE EXCEPTION 'cross-space or cross-book material group parent is forbidden' USING ERRCODE='23514';
  END IF;
  IF parent_row.status<>'active' THEN RAISE EXCEPTION 'archived material group cannot be a parent' USING ERRCODE='23514'; END IF;
  IF EXISTS(
    WITH RECURSIVE ancestors(id,parent_id,path) AS (
      SELECT parent.id,parent.parent_id,ARRAY[parent.id] FROM material_groups parent WHERE parent.id=NEW.parent_id
      UNION ALL
      SELECT parent.id,parent.parent_id,ancestors.path||parent.id FROM ancestors
      JOIN material_groups parent ON parent.id=ancestors.parent_id
      WHERE NOT parent.id=ANY(ancestors.path)
    ) SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN RAISE EXCEPTION 'material group cycle is forbidden' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_groups_tree_guard BEFORE INSERT OR UPDATE OF parent_id,space_id,book_id ON material_groups FOR EACH ROW EXECUTE FUNCTION guard_material_group_tree();

CREATE FUNCTION guard_material_membership_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_space uuid; card_space uuid;
BEGIN
  SELECT space_id INTO card_space FROM cards WHERE id=NEW.card_id;
  IF TG_TABLE_NAME='material_tag_memberships' THEN SELECT space_id INTO owner_space FROM material_tags WHERE id=NEW.tag_id;
  ELSE SELECT space_id INTO owner_space FROM material_groups WHERE id=NEW.group_id; END IF;
  IF owner_space IS NULL OR card_space IS NULL THEN RAISE EXCEPTION 'material membership reference not found' USING ERRCODE='23503'; END IF;
  IF owner_space<>NEW.space_id OR card_space<>NEW.space_id THEN RAISE EXCEPTION 'cross-space material membership is forbidden' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_tag_memberships_scope_guard BEFORE INSERT OR UPDATE ON material_tag_memberships FOR EACH ROW EXECUTE FUNCTION guard_material_membership_scope();
CREATE TRIGGER material_group_memberships_scope_guard BEFORE INSERT OR UPDATE ON material_group_memberships FOR EACH ROW EXECUTE FUNCTION guard_material_membership_scope();

ALTER FUNCTION resolve_dependency_resource(text,uuid,uuid) RENAME TO resolve_dependency_resource_pre036;
ALTER TABLE dependency_resources DROP CONSTRAINT dependency_resources_resource_kind_check;
ALTER TABLE dependency_resources ADD CONSTRAINT dependency_resources_resource_kind_check CHECK(resource_kind IN (
  'card_type_version','template_group_version','card_version','card_relation','card_mount',
  'tag_version','tag_membership','material_group_version','group_membership','smart_view_version',
  'research_document_version','research_record_version','research_reference_pack_version','chapter_body_version','chapter_text_anchor','canonical_fact','chapter_settlement',
  'state_change','knowledge_state_change','story_event_timing','story_event_relation','planning_version','prompt_recipe_version','task_contract_version','context_manifest',
  'model_route_snapshot','ai_task_attempt','quality_audit_report','asset_version','embedding_source_snapshot','embedding_chunk','embedding_result','embedding_index_generation'
));

CREATE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF requested_kind='tag_version' THEN
    RETURN QUERY SELECT tag.space_id,book.id,dependency_content_hash(to_jsonb(version)::text)
    FROM material_tags tag JOIN material_tag_versions version ON version.tag_id=tag.id LEFT JOIN books book ON book.space_id=tag.space_id
    WHERE tag.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='tag_membership' THEN
    RETURN QUERY SELECT membership.space_id,book.id,dependency_content_hash(to_jsonb(version)::text)
    FROM material_tag_memberships membership JOIN material_tag_membership_versions version ON version.membership_id=membership.id LEFT JOIN books book ON book.space_id=membership.space_id
    WHERE membership.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='material_group_version' THEN
    RETURN QUERY SELECT group_row.space_id,group_row.book_id,dependency_content_hash(to_jsonb(version)::text)
    FROM material_groups group_row JOIN material_group_versions version ON version.group_id=group_row.id
    WHERE group_row.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='group_membership' THEN
    RETURN QUERY SELECT membership.space_id,book.id,dependency_content_hash(to_jsonb(version)::text)
    FROM material_group_memberships membership JOIN material_group_membership_versions version ON version.membership_id=membership.id LEFT JOIN books book ON book.space_id=membership.space_id
    WHERE membership.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='smart_view_version' THEN
    RETURN QUERY SELECT view_row.space_id,view_row.book_id,dependency_content_hash(to_jsonb(version)::text)
    FROM smart_views view_row JOIN smart_view_versions version ON version.smart_view_id=view_row.id
    WHERE view_row.id=requested_stable_id AND version.id=requested_version_id;
  ELSE
    RETURN QUERY SELECT * FROM resolve_dependency_resource_pre036(requested_kind,requested_stable_id,requested_version_id);
  END IF;
END $$;

CREATE FUNCTION register_material_membership_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE membership_card_id uuid; membership_owner_id uuid; owner_kind text; owner_version_id uuid; membership_book_id uuid;
BEGIN
  IF TG_TABLE_NAME='material_tag_membership_versions' THEN
    SELECT membership.card_id,membership.tag_id,book.id INTO membership_card_id,membership_owner_id,membership_book_id FROM material_tag_memberships membership LEFT JOIN books book ON book.space_id=membership.space_id WHERE membership.id=NEW.membership_id;
    owner_kind:='tag_version'; owner_version_id:=NEW.tag_version_id;
  ELSE
    SELECT membership.card_id,membership.group_id,book.id INTO membership_card_id,membership_owner_id,membership_book_id FROM material_group_memberships membership LEFT JOIN books book ON book.space_id=membership.space_id WHERE membership.id=NEW.membership_id;
    owner_kind:='material_group_version'; owner_version_id:=NEW.group_version_id;
  END IF;
  IF membership_book_id IS NULL THEN
    PERFORM register_dependency_resource(owner_kind,membership_owner_id,owner_version_id);
    PERFORM register_dependency_resource('card_version',membership_card_id,NEW.card_version_id);
    PERFORM register_dependency_resource(CASE WHEN owner_kind='tag_version' THEN 'tag_membership' ELSE 'group_membership' END,NEW.membership_id,NEW.id);
  ELSIF owner_kind='tag_version' THEN
    PERFORM add_registered_dependency(owner_kind,membership_owner_id,owner_version_id,'tag_membership',NEW.membership_id,NEW.id,'configured_by','soft','manual',NEW.id);
    PERFORM add_registered_dependency('card_version',membership_card_id,NEW.card_version_id,'tag_membership',NEW.membership_id,NEW.id,'configured_by','soft','manual',NEW.id);
  ELSE
    PERFORM add_registered_dependency(owner_kind,membership_owner_id,owner_version_id,'group_membership',NEW.membership_id,NEW.id,'configured_by','soft','manual',NEW.id);
    PERFORM add_registered_dependency('card_version',membership_card_id,NEW.card_version_id,'group_membership',NEW.membership_id,NEW.id,'configured_by','soft','manual',NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_tag_membership_dependency AFTER INSERT ON material_tag_membership_versions FOR EACH ROW EXECUTE FUNCTION register_material_membership_dependency();
CREATE TRIGGER material_group_membership_dependency AFTER INSERT ON material_group_membership_versions FOR EACH ROW EXECUTE FUNCTION register_material_membership_dependency();

WITH inserted_views AS (
  INSERT INTO smart_views(id,space_id,book_id,view_key,base_view_key,status,revision,created_by,updated_by)
  SELECT scoped_field_uuid('smart-view:'||config.id::text),book.space_id,config.book_id,config.view_key,config.view_key,'active',1,'migration','migration'
  FROM book_view_configs config JOIN books book ON book.id=config.book_id
  ON CONFLICT(space_id,view_key) DO NOTHING RETURNING id,book_id,view_key
)
SELECT count(*) FROM inserted_views;

WITH base_names(view_key,name) AS (VALUES
  ('chapters','章节'),('clues','线索／伏笔'),('characters','角色'),('events','事件／时间'),('world','世界'),('resources','资源')
), inserted_versions AS (
  INSERT INTO smart_view_versions(id,smart_view_id,version,name,filter_ast,sort_config,grouping,display_columns,layout,created_by)
  SELECT scoped_field_uuid('smart-view-version:'||view_row.id::text),view_row.id,1,base_names.name,
    '{"kind":"group","operator":"and","items":[]}'::jsonb,
    jsonb_build_array(jsonb_build_object('field',CASE config.config->>'sort' WHEN 'title' THEN 'title' WHEN 'start_order' THEN 'story_time' ELSE 'updated_at' END,'direction',CASE WHEN config.config->>'sort'='updated_desc' THEN 'desc' ELSE 'asc' END)),
    jsonb_build_object('field',COALESCE(config.config->>'groupBy','content_type')),
    ARRAY['title','content_type','updated_at'],
    jsonb_build_object('mode',COALESCE(config.config->>'display','list'),'legacyConfig',config.config),
    'migration'
  FROM smart_views view_row JOIN book_view_configs config ON config.book_id=view_row.book_id AND config.view_key=view_row.base_view_key
  JOIN base_names ON base_names.view_key=view_row.view_key
  WHERE view_row.current_version_id IS NULL
  ON CONFLICT(smart_view_id,version) DO NOTHING RETURNING id,smart_view_id
)
UPDATE smart_views SET current_version_id=inserted_versions.id FROM inserted_versions WHERE smart_views.id=inserted_versions.smart_view_id;

UPDATE book_view_configs config SET smart_view_id=view_row.id
FROM smart_views view_row WHERE view_row.book_id=config.book_id AND view_row.base_view_key=config.view_key AND config.smart_view_id IS NULL;

INSERT INTO dependency_resources(id,resource_kind,stable_object_id,exact_version_id,content_hash)
SELECT scoped_field_uuid('dependency:smart-view:'||view_row.id::text||':'||version.id::text),'smart_view_version',view_row.id,version.id,''::char(64)
FROM smart_views view_row JOIN smart_view_versions version ON version.smart_view_id=view_row.id
ON CONFLICT(resource_kind,stable_object_id,exact_version_id) DO NOTHING;

CREATE VIEW material_card_organization AS
SELECT card.id card_id,card.space_id,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',tag.id,'key',tag.tag_key,'name',version.name,'color',version.color) ORDER BY version.name)
    FROM material_tag_memberships membership JOIN material_tags tag ON tag.id=membership.tag_id JOIN material_tag_versions version ON version.id=tag.current_version_id
    WHERE membership.card_id=card.id AND membership.status='active' AND tag.status='active'),'[]'::jsonb) tags,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',group_row.id,'key',group_row.group_key,'name',version.name,'parentId',group_row.parent_id) ORDER BY group_row.sort_order,version.name)
    FROM material_group_memberships membership JOIN material_groups group_row ON group_row.id=membership.group_id JOIN material_group_versions version ON version.id=group_row.current_version_id
    WHERE membership.card_id=card.id AND membership.status='active' AND group_row.status='active'),'[]'::jsonb) groups
FROM cards card;

COMMENT ON TABLE material_tags IS 'Space-scoped stable tag identities. Names, aliases, colors and metadata live in immutable versions.';
COMMENT ON TABLE material_groups IS 'Space-scoped organization tree. Cards may belong to many groups and group archival never archives cards.';
COMMENT ON TABLE smart_view_versions IS 'Immutable safe-query definitions only; view result rows and card content are never copied.';
COMMENT ON TABLE card_archive_previews IS 'Frozen archive impact evidence with expiring confirmation token hash. A confirm must recompute and match the snapshot.';
