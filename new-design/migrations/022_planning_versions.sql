SET search_path TO new_design, public;

CREATE TABLE planning_objects (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('story','volume','chapter','scene')),
  parent_object_id uuid,
  card_id uuid REFERENCES cards(id),
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  current_version_id uuid,
  adopted_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,book_id),
  FOREIGN KEY(parent_object_id,book_id) REFERENCES planning_objects(id,book_id),
  CHECK ((level='story' AND parent_object_id IS NULL AND card_id IS NULL) OR (level<>'story' AND parent_object_id IS NOT NULL AND card_id IS NOT NULL))
);

CREATE UNIQUE INDEX planning_objects_story_unique ON planning_objects(book_id) WHERE level='story';
CREATE UNIQUE INDEX planning_objects_card_unique ON planning_objects(book_id,card_id) WHERE card_id IS NOT NULL;
CREATE UNIQUE INDEX planning_objects_sibling_order_unique ON planning_objects(book_id,parent_object_id,level,sort_order) NULLS NOT DISTINCT;
CREATE INDEX planning_objects_tree_idx ON planning_objects(book_id,parent_object_id,sort_order,id) WHERE status='active';

CREATE FUNCTION validate_planning_object_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_level text; card_level text;
BEGIN
  IF NEW.level='story' THEN RETURN NEW; END IF;
  SELECT level INTO parent_level FROM new_design.planning_objects WHERE id=NEW.parent_object_id AND book_id=NEW.book_id;
  IF parent_level IS NULL OR (NEW.level='volume' AND parent_level<>'story') OR (NEW.level='chapter' AND parent_level<>'volume') OR (NEW.level='scene' AND parent_level<>'chapter') THEN
    RAISE EXCEPTION 'invalid planning hierarchy' USING ERRCODE='23514';
  END IF;
  SELECT type.type_key INTO card_level FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id AND card.id=NEW.card_id JOIN new_design.card_types type ON type.id=card.card_type_id WHERE book.id=NEW.book_id;
  IF card_level IS DISTINCT FROM NEW.level THEN RAISE EXCEPTION 'planning card type mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER planning_objects_hierarchy_guard BEFORE INSERT OR UPDATE OF book_id,level,parent_object_id,card_id ON planning_objects FOR EACH ROW EXECUTE FUNCTION validate_planning_object_hierarchy();

CREATE TABLE planning_versions (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL,
  book_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  base_version_id uuid,
  based_on_parent_version_id uuid REFERENCES planning_versions(id),
  source text NOT NULL CHECK (source IN ('manual','ai','import','system','body_revision')),
  status text NOT NULL CHECK (status IN ('draft','proposed','adopted','superseded','rejected')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
  content_hash char(64) NOT NULL,
  source_body_version_id uuid REFERENCES chapter_body_versions(id),
  created_by text NOT NULL DEFAULT '',
  stale_at timestamptz,
  stale_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(object_id,version),
  UNIQUE(id,object_id),
  FOREIGN KEY(object_id,book_id) REFERENCES planning_objects(id,book_id) ON DELETE CASCADE,
  FOREIGN KEY(base_version_id,object_id) REFERENCES planning_versions(id,object_id),
  CHECK ((source='body_revision' AND source_body_version_id IS NOT NULL) OR (source<>'body_revision' AND source_body_version_id IS NULL))
);

ALTER TABLE planning_objects ADD CONSTRAINT planning_objects_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES planning_versions(id,object_id);
ALTER TABLE planning_objects ADD CONSTRAINT planning_objects_adopted_version_fk FOREIGN KEY(adopted_version_id,id) REFERENCES planning_versions(id,object_id);

CREATE INDEX planning_versions_object_idx ON planning_versions(object_id,version DESC);
CREATE INDEX planning_versions_parent_basis_idx ON planning_versions(based_on_parent_version_id) WHERE based_on_parent_version_id IS NOT NULL;
CREATE INDEX planning_versions_stale_idx ON planning_versions(book_id,stale_at) WHERE stale_at IS NOT NULL;
CREATE UNIQUE INDEX planning_versions_adopted_unique ON planning_versions(object_id) WHERE status='adopted';

CREATE FUNCTION guard_planning_version_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','stale_at','stale_reason']::text[]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','stale_at','stale_reason']::text[]) THEN
    RAISE EXCEPTION 'planning version content is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='rejected' AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'rejected planning version is final' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER planning_versions_immutable_guard BEFORE UPDATE ON planning_versions FOR EACH ROW EXECUTE FUNCTION guard_planning_version_immutability();

CREATE TABLE planning_adoptions (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL,
  book_id uuid NOT NULL,
  from_version_id uuid,
  to_version_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('adopt','rollback','readopt')),
  object_revision integer NOT NULL CHECK (object_revision > 0),
  source text NOT NULL CHECK (source IN ('user','system','import')),
  actor text NOT NULL,
  content_hash char(64) NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(object_id,book_id) REFERENCES planning_objects(id,book_id) ON DELETE CASCADE,
  FOREIGN KEY(from_version_id,object_id) REFERENCES planning_versions(id,object_id),
  FOREIGN KEY(to_version_id,object_id) REFERENCES planning_versions(id,object_id)
);

CREATE INDEX planning_adoptions_object_idx ON planning_adoptions(object_id,created_at DESC,id DESC);

CREATE TABLE planning_version_actions (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL REFERENCES planning_objects(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES planning_versions(id),
  action text NOT NULL CHECK (action IN ('create','edit','reject','mark_stale')),
  actor text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planning_version_actions_object_idx ON planning_version_actions(object_id,created_at,id);

CREATE TABLE planning_impacts (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  adoption_id uuid NOT NULL REFERENCES planning_adoptions(id) ON DELETE CASCADE,
  source_object_id uuid NOT NULL REFERENCES planning_objects(id),
  source_from_version_id uuid NOT NULL REFERENCES planning_versions(id),
  source_to_version_id uuid NOT NULL REFERENCES planning_versions(id),
  target_kind text NOT NULL CHECK (target_kind IN ('plan_version','chapter_body','story_time','story_relation','context','generation_task','analysis')),
  target_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','resolved','dismissed')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(adoption_id,target_kind,target_id)
);

CREATE INDEX planning_impacts_book_status_idx ON planning_impacts(book_id,status,created_at DESC);

ALTER TABLE story_time_proposal_versions ADD CONSTRAINT story_time_proposal_versions_plan_version_fk FOREIGN KEY(plan_version_id) REFERENCES planning_versions(id) NOT VALID;
ALTER TABLE story_event_timings ADD CONSTRAINT story_event_timings_plan_version_fk FOREIGN KEY(plan_version_id) REFERENCES planning_versions(id) NOT VALID;
ALTER TABLE story_relation_proposal_versions ADD CONSTRAINT story_relation_proposal_versions_plan_version_fk FOREIGN KEY(plan_version_id) REFERENCES planning_versions(id) NOT VALID;
