-- Additive schema for the three-level card assembly. Apply only through the
-- project's reviewed migration workflow; this file does not mutate a database by itself.
SET search_path TO new_design,public;

DO $types$
DECLARE record_key text; type_id uuid; version_id uuid;
BEGIN
  FOREACH record_key IN ARRAY ARRAY[
    'meta_card','meta_card_version','card_template','card_template_version',
    'book_assembly_snapshot','book_template_module_instance',
    'book_template_slot','book_template_pending_relation'
  ]::text[] LOOP
    type_id := md5('card-kernel:internal-type:'||record_key)::uuid;
    version_id := md5('card-kernel:internal-type-version:'||record_key||':1')::uuid;
    INSERT INTO card_types(id,space_id,type_key,name,description,status,is_internal,is_system,draft_fields)
      VALUES(type_id,'00000000-0000-4000-8000-000000000001',record_key,record_key,
        '卡片装配内部记录','published',true,true,'[]'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO card_type_versions(id,card_type_id,version,fields)
      VALUES(version_id,type_id,1,'[]'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    UPDATE card_types SET current_version_id=version_id,status='published' WHERE id=type_id;
  END LOOP;
END;
$types$;

ALTER TABLE books ADD COLUMN IF NOT EXISTS root_card_id uuid;
ALTER TABLE books ADD COLUMN IF NOT EXISTS root_node_id uuid;
DO $root_reference$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='books_root_card_reference' AND conrelid='new_design.books'::regclass) THEN
    ALTER TABLE books ADD CONSTRAINT books_root_card_reference FOREIGN KEY(root_card_id) REFERENCES cards(id) ON DELETE RESTRICT;
  END IF;
END;
$root_reference$;
CREATE UNIQUE INDEX IF NOT EXISTS books_root_card_id_unique ON books(root_card_id) WHERE root_card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS books_root_node_id_index ON books(root_node_id) WHERE root_node_id IS NOT NULL;

ALTER TABLE card_versions ADD COLUMN IF NOT EXISTS book_slot_spec_version_id uuid;
DO $slot_reference$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='card_versions_book_slot_spec_reference' AND conrelid='new_design.card_versions'::regclass) THEN
    ALTER TABLE card_versions ADD CONSTRAINT card_versions_book_slot_spec_reference FOREIGN KEY(book_slot_spec_version_id) REFERENCES card_versions(id);
  END IF;
END;
$slot_reference$;
CREATE INDEX IF NOT EXISTS card_versions_book_slot_spec_version_id_index
  ON card_versions(book_slot_spec_version_id) WHERE book_slot_spec_version_id IS NOT NULL;

-- Only the current physical card row participates in these identities;
-- historical card_versions remain append-only and may retain older values.
CREATE UNIQUE INDEX IF NOT EXISTS meta_card_definition_key_unique
  ON cards ((values->>'definition_key'))
  WHERE card_type_id=md5('card-kernel:internal-type:meta_card')::uuid AND status='active';
CREATE UNIQUE INDEX IF NOT EXISTS card_template_definition_key_unique
  ON cards ((values->>'definition_key'))
  WHERE card_type_id=md5('card-kernel:internal-type:card_template')::uuid AND status='active';
CREATE UNIQUE INDEX IF NOT EXISTS meta_card_version_number_unique
  ON cards ((values->>'meta_id'),((values->>'version')::integer))
  WHERE card_type_id=md5('card-kernel:internal-type:meta_card_version')::uuid AND status='active';
CREATE UNIQUE INDEX IF NOT EXISTS card_template_version_number_unique
  ON cards ((values->>'template_id'),((values->>'version')::integer))
  WHERE card_type_id=md5('card-kernel:internal-type:card_template_version')::uuid AND status='active';
CREATE UNIQUE INDEX IF NOT EXISTS book_assembly_snapshot_book_unique
  ON cards ((values->>'book_id'))
  WHERE card_type_id=md5('card-kernel:internal-type:book_assembly_snapshot')::uuid AND status='active';
CREATE UNIQUE INDEX IF NOT EXISTS book_module_instance_ordinal_unique
  ON cards ((values->>'book_id'),(values->>'module_ref_node_id'),((values->>'ordinal')::integer))
  WHERE card_type_id=md5('card-kernel:internal-type:book_template_module_instance')::uuid AND status='active';
CREATE UNIQUE INDEX IF NOT EXISTS book_template_slot_node_unique
  ON cards ((values->>'book_id'),(values->>'node_id'))
  WHERE card_type_id=md5('card-kernel:internal-type:book_template_slot')::uuid AND status='active';
CREATE UNIQUE INDEX IF NOT EXISTS book_template_slot_card_unique
  ON cards ((values->>'book_id'),(values->>'card_id'))
  WHERE card_type_id=md5('card-kernel:internal-type:book_template_slot')::uuid
    AND status='active' AND values->>'card_id' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS book_template_instance_relation_edge_unique
  ON cards ((values->>'book_id'),(values->>'module_instance_id'),(values->>'source_edge_id'))
  WHERE card_type_id=md5('card-kernel:internal-type:book_template_pending_relation')::uuid
    AND status='active' AND values->>'module_instance_id' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS book_template_standalone_relation_edge_unique
  ON cards ((values->>'book_id'),(values->>'source_edge_id'))
  WHERE card_type_id=md5('card-kernel:internal-type:book_template_pending_relation')::uuid
    AND status='active' AND values->>'module_instance_id' IS NULL;

-- These are explicit author-selectable relation types, separate from the
-- membership/group edge used to assemble a book template.
INSERT INTO relation_types(id,relation_key,name,description,direction,scope,owner_space_id,properties_schema,status)
VALUES
  (md5('card-assembly:relation:belongs-to')::uuid,'assembly_belongs_to','归属','例如战力卡归属于人物卡。','directed','system',NULL,'[]'::jsonb,'published'),
  (md5('card-assembly:relation:owns')::uuid,'assembly_owns','拥有','例如人物拥有一张能力卡。','directed','system',NULL,'[]'::jsonb,'published'),
  (md5('card-assembly:relation:related')::uuid,'assembly_related','关联','为两张资料卡建立明确的关联。','directed','system',NULL,'[]'::jsonb,'published')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS relation_type_versions (
  id uuid PRIMARY KEY,
  relation_type_id uuid NOT NULL REFERENCES relation_types(id),
  version integer NOT NULL CHECK (version > 0),
  relation_key text NOT NULL,
  name text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('directed','undirected')),
  source_type_keys text[] NOT NULL,
  target_type_keys text[] NOT NULL,
  source_max integer,
  target_max integer,
  properties_schema jsonb NOT NULL,
  definition_hash text,
  status text NOT NULL DEFAULT 'published',
  source_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(relation_type_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS relation_type_versions_owner_identity_unique
  ON relation_type_versions(relation_type_id,id);
ALTER TABLE relation_types ADD COLUMN IF NOT EXISTS current_version_id uuid;
ALTER TABLE card_relations ADD COLUMN IF NOT EXISTS relation_type_version_id uuid;
DO $relation_reference$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='relation_types_current_assembly_version' AND conrelid='new_design.relation_types'::regclass) THEN
    ALTER TABLE relation_types ADD CONSTRAINT relation_types_current_assembly_version FOREIGN KEY(current_version_id) REFERENCES relation_type_versions(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='card_relations_assembly_type_version' AND conrelid='new_design.card_relations'::regclass) THEN
    ALTER TABLE card_relations ADD CONSTRAINT card_relations_assembly_type_version FOREIGN KEY(relation_type_version_id) REFERENCES relation_type_versions(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='relation_types_current_version_ownership' AND conrelid='new_design.relation_types'::regclass) THEN
    ALTER TABLE relation_types ADD CONSTRAINT relation_types_current_version_ownership FOREIGN KEY(id,current_version_id) REFERENCES relation_type_versions(relation_type_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='card_relations_type_version_ownership' AND conrelid='new_design.card_relations'::regclass) THEN
    ALTER TABLE card_relations ADD CONSTRAINT card_relations_type_version_ownership FOREIGN KEY(relation_type_id,relation_type_version_id) REFERENCES relation_type_versions(relation_type_id,id);
  END IF;
END;
$relation_reference$;
INSERT INTO relation_type_versions(id,relation_type_id,version,relation_key,name,direction,
  source_type_keys,target_type_keys,source_max,target_max,properties_schema)
SELECT md5('card-assembly:relation-type-version:'||id::text||':1')::uuid,id,1,
  relation_key,name,direction,source_type_keys,target_type_keys,source_max,target_max,properties_schema
FROM relation_types WHERE scope IN ('system','template') AND status='published'
ON CONFLICT (relation_type_id,version) DO NOTHING;
UPDATE relation_types type SET current_version_id=version.id
  FROM relation_type_versions version
  WHERE version.relation_type_id=type.id AND version.version=1
    AND type.current_version_id IS NULL;
