SET search_path TO new_design, public;

ALTER TABLE card_mounts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS source_card_version_id uuid REFERENCES card_versions(id),
  ADD COLUMN IF NOT EXISTS current_version_id uuid,
  ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'migration',
  ADD COLUMN IF NOT EXISTS ended_by text,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

ALTER TABLE card_mounts DROP CONSTRAINT IF EXISTS card_mounts_form_instance_id_slot_key_card_id_key;
ALTER TABLE card_mounts ADD CONSTRAINT card_mounts_status_check CHECK(status IN ('active','ended'));
CREATE UNIQUE INDEX card_mounts_active_slot_card_unique ON card_mounts(form_instance_id,slot_key,card_id) WHERE status='active';

UPDATE card_mounts mount SET source_card_version_id=card.current_version_id
FROM cards card WHERE card.id=mount.card_id AND mount.source_card_version_id IS NULL;
ALTER TABLE card_mounts ALTER COLUMN source_card_version_id SET NOT NULL;

CREATE TABLE card_mount_versions (
  id uuid PRIMARY KEY,
  card_mount_id uuid NOT NULL REFERENCES card_mounts(id),
  revision integer NOT NULL CHECK(revision>0),
  form_version_id uuid NOT NULL REFERENCES card_group_form_versions(id),
  source_card_version_id uuid NOT NULL REFERENCES card_versions(id),
  slot_key text NOT NULL,
  card_id uuid NOT NULL REFERENCES cards(id),
  sort_order integer NOT NULL DEFAULT 0,
  local_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK(status IN ('active','ended')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_mount_id,revision)
);

ALTER TABLE card_mounts ADD CONSTRAINT card_mounts_current_version_fk FOREIGN KEY(current_version_id) REFERENCES card_mount_versions(id);

INSERT INTO card_mount_versions(id,card_mount_id,revision,form_version_id,source_card_version_id,slot_key,card_id,sort_order,local_values,status,created_by,created_at)
SELECT scoped_field_uuid(mount.id::text||':mount-version:1'),mount.id,mount.revision,instance.form_version_id,mount.source_card_version_id,mount.slot_key,mount.card_id,mount.sort_order,mount.local_values,mount.status,'migration',mount.created_at
FROM card_mounts mount JOIN card_group_form_instances instance ON instance.id=mount.form_instance_id
ON CONFLICT(card_mount_id,revision) DO NOTHING;

UPDATE card_mounts mount SET current_version_id=version.id FROM card_mount_versions version
WHERE version.card_mount_id=mount.id AND version.revision=mount.revision AND mount.current_version_id IS NULL;

CREATE TABLE association_actions (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  form_instance_id uuid NOT NULL REFERENCES card_group_form_instances(id),
  card_mount_id uuid REFERENCES card_mounts(id),
  action text NOT NULL CHECK(action IN ('add_existing','create_and_add','remove','restore','reorder','save_local','add_local_field','refresh_source')),
  idempotency_key text NOT NULL,
  expected_revision integer,
  result_version_id uuid REFERENCES card_mount_versions(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE card_relation_versions (
  id uuid PRIMARY KEY,
  card_relation_id uuid NOT NULL REFERENCES card_relations(id),
  revision integer NOT NULL CHECK(revision>0),
  source_card_version_id uuid NOT NULL REFERENCES card_versions(id),
  target_card_version_id uuid NOT NULL REFERENCES card_versions(id),
  status text NOT NULL CHECK(status IN ('active','inactive','archived')),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_relation_id,revision)
);

ALTER TABLE card_relations
  ADD COLUMN IF NOT EXISTS current_version_id uuid,
  ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'migration';

INSERT INTO card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by,created_at)
SELECT scoped_field_uuid(relation.id::text||':relation-version:'||relation.revision),relation.id,relation.revision,source.current_version_id,target.current_version_id,relation.status,relation.properties,'migration',relation.created_at
FROM card_relations relation JOIN cards source ON source.id=relation.source_card_id JOIN cards target ON target.id=relation.target_card_id
ON CONFLICT(card_relation_id,revision) DO NOTHING;

UPDATE card_relations relation SET current_version_id=version.id FROM card_relation_versions version
WHERE version.card_relation_id=relation.id AND version.revision=relation.revision AND relation.current_version_id IS NULL;
ALTER TABLE card_relations ADD CONSTRAINT card_relations_current_version_fk FOREIGN KEY(current_version_id) REFERENCES card_relation_versions(id);

CREATE FUNCTION guard_association_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'association history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER card_mount_versions_immutable BEFORE UPDATE OR DELETE ON card_mount_versions FOR EACH ROW EXECUTE FUNCTION guard_association_history();
CREATE TRIGGER association_actions_immutable BEFORE UPDATE OR DELETE ON association_actions FOR EACH ROW EXECUTE FUNCTION guard_association_history();
CREATE TRIGGER card_relation_versions_immutable BEFORE UPDATE OR DELETE ON card_relation_versions FOR EACH ROW EXECUTE FUNCTION guard_association_history();

ALTER FUNCTION resolve_dependency_resource(text,uuid,uuid) RENAME TO resolve_dependency_resource_pre035;
ALTER TABLE dependency_resources DROP CONSTRAINT dependency_resources_resource_kind_check;
ALTER TABLE dependency_resources ADD CONSTRAINT dependency_resources_resource_kind_check CHECK(resource_kind IN (
  'card_type_version','template_group_version','card_version','card_relation','card_mount',
  'research_document_version','research_record_version','research_reference_pack_version','chapter_body_version','chapter_text_anchor','canonical_fact','chapter_settlement',
  'state_change','knowledge_state_change','story_event_timing','story_event_relation','planning_version','prompt_recipe_version','task_contract_version','context_manifest',
  'model_route_snapshot','ai_task_attempt','quality_audit_report','asset_version','embedding_source_snapshot','embedding_chunk','embedding_result','embedding_index_generation'
));

CREATE FUNCTION resolve_dependency_resource(requested_kind text,requested_stable_id uuid,requested_version_id uuid)
RETURNS TABLE(resolved_space_id uuid,resolved_book_id uuid,resolved_hash char(64)) LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF requested_kind='card_mount' THEN
    RETURN QUERY SELECT instance.space_id,book.id,dependency_content_hash(to_jsonb(version)::text)
    FROM card_mount_versions version JOIN card_mounts mount ON mount.id=version.card_mount_id
    JOIN card_group_form_instances instance ON instance.id=mount.form_instance_id LEFT JOIN books book ON book.space_id=instance.space_id
    WHERE mount.id=requested_stable_id AND version.id=requested_version_id;
  ELSIF requested_kind='card_relation' THEN
    RETURN QUERY SELECT relation.space_id,book.id,dependency_content_hash(to_jsonb(version)::text)
    FROM card_relations relation JOIN card_relation_versions version ON version.card_relation_id=relation.id
    LEFT JOIN books book ON book.space_id=relation.space_id
    WHERE relation.id=requested_stable_id AND version.id=CASE WHEN requested_version_id=relation.id THEN relation.current_version_id ELSE requested_version_id END;
  ELSE
    RETURN QUERY SELECT * FROM resolve_dependency_resource_pre035(requested_kind,requested_stable_id,requested_version_id);
  END IF;
END $$;

CREATE FUNCTION register_mount_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM add_registered_dependency('card_version',NEW.card_id,NEW.source_card_version_id,'card_mount',NEW.card_mount_id,NEW.id,'context_included','soft','manual',NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER card_mount_versions_dependency AFTER INSERT ON card_mount_versions FOR EACH ROW EXECUTE FUNCTION register_mount_dependency();

CREATE FUNCTION register_relation_dependencies() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE relation_row card_relations%ROWTYPE;
BEGIN
  SELECT * INTO relation_row FROM card_relations WHERE id=NEW.card_relation_id;
  PERFORM add_registered_dependency('card_version',relation_row.source_card_id,NEW.source_card_version_id,'card_relation',NEW.card_relation_id,NEW.id,'context_included','soft','manual',NEW.id);
  PERFORM add_registered_dependency('card_version',relation_row.target_card_id,NEW.target_card_version_id,'card_relation',NEW.card_relation_id,NEW.id,'context_included','soft','manual',NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER card_relation_versions_dependency AFTER INSERT ON card_relation_versions FOR EACH ROW EXECUTE FUNCTION register_relation_dependencies();

DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM card_mount_versions LOOP
    PERFORM add_registered_dependency('card_version',item.card_id,item.source_card_version_id,'card_mount',item.card_mount_id,item.id,'context_included','soft','manual',item.id);
  END LOOP;
  FOR item IN SELECT version.*,relation.source_card_id,relation.target_card_id FROM card_relation_versions version JOIN card_relations relation ON relation.id=version.card_relation_id LOOP
    PERFORM add_registered_dependency('card_version',item.source_card_id,item.source_card_version_id,'card_relation',item.card_relation_id,item.id,'context_included','soft','manual',item.id);
    PERFORM add_registered_dependency('card_version',item.target_card_id,item.target_card_version_id,'card_relation',item.card_relation_id,item.id,'context_included','soft','manual',item.id);
  END LOOP;
END $$;

CREATE VIEW card_reverse_references AS
SELECT card.id card_id,
  (SELECT count(*) FROM card_mounts mount WHERE mount.card_id=card.id AND mount.status='active') active_mount_count,
  (SELECT count(*) FROM card_relations relation WHERE (relation.source_card_id=card.id OR relation.target_card_id=card.id) AND relation.status='active') active_relation_count
FROM cards card;

COMMENT ON TABLE card_mount_versions IS 'Immutable form-context association snapshots. Source cards remain the only content owners.';
COMMENT ON TABLE card_relation_versions IS 'Immutable snapshots for independent business relations; form composition does not also write these relations.';
