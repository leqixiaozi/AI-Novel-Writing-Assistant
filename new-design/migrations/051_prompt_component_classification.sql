SET search_path TO new_design, public;

-- Organization metadata only. Existing prompt bodies and memberships remain intact.
ALTER TABLE material_group_memberships ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE material_group_membership_versions ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
CREATE TABLE prompt_command_receipts (
  idempotency_key text PRIMARY KEY,
  input_hash text NOT NULL,
  card_id uuid NOT NULL REFERENCES cards(id),
  card_version_id uuid NOT NULL REFERENCES card_versions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER prompt_command_receipts_immutable BEFORE UPDATE OR DELETE ON prompt_command_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_material_history();
CREATE UNIQUE INDEX prompt_component_one_primary_group ON material_group_memberships(card_id)
  WHERE status='active' AND is_primary;

CREATE FUNCTION guard_prompt_primary_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_primary AND NOT EXISTS (
    SELECT 1 FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE card.id=NEW.card_id AND card.space_id='63000000-0000-4000-8000-000000000001'
      AND type.type_key='prompt_component'
  ) THEN RAISE EXCEPTION 'primary prompt classification requires the prompt resource space' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prompt_primary_classification_guard BEFORE INSERT OR UPDATE ON material_group_memberships
  FOR EACH ROW EXECUTE FUNCTION guard_prompt_primary_classification();

DO $$
DECLARE seed record; group_id uuid; version_id uuid;
BEGIN
  FOR seed IN SELECT * FROM (VALUES
    ('prompt_roles','角色与职责',1000),('prompt_tasks','任务指令',2000),
    ('prompt_writing','写作要求',3000),('prompt_quality','约束与质量',4000),
    ('prompt_examples','示例',5000),('prompt_context','上下文组织',6000),
    ('prompt_custom','用户自定义',7000)
  ) AS categories(key,name,ordering) LOOP
    IF NOT EXISTS(SELECT 1 FROM material_groups WHERE space_id='63000000-0000-4000-8000-000000000001' AND group_key=seed.key) THEN
      group_id:=gen_random_uuid();version_id:=gen_random_uuid();
      INSERT INTO material_groups(id,space_id,group_key,sort_order) VALUES(group_id,'63000000-0000-4000-8000-000000000001',seed.key,seed.ordering);
      INSERT INTO material_group_versions(id,group_id,version,name,sort_order,status,created_by) VALUES(version_id,group_id,1,seed.name,seed.ordering,'active','system');
      UPDATE material_groups SET current_version_id=version_id WHERE id=group_id;
      PERFORM new_design.register_dependency_resource('material_group_version',group_id,version_id);
    END IF;
  END LOOP;
END;
$$;
