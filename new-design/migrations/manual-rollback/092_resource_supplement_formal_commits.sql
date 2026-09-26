-- Deactivate new formal writes, retain committed effects and complete originals.
CREATE OR REPLACE FUNCTION new_design.validate_resource_supplement_formal_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'formal supplement writes deactivated; all originals retained' USING ERRCODE='23514'; END $$;
-- Restore the exact closed confirmation guard without dropping/recreating its OID.
CREATE OR REPLACE FUNCTION new_design.require_resource_supplement_closure() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE child chapter_adoption_sessions%ROWTYPE; base chapter_stable_checkpoints%ROWTYPE; next_checkpoint chapter_stable_checkpoints%ROWTYPE;
  confirmation_kind text; expected jsonb; actual jsonb;
BEGIN
  IF NEW.supplement_base_checkpoint_id IS NULL OR NEW.status<>'committed' THEN RETURN NEW; END IF;
  SELECT * INTO child FROM chapter_adoption_sessions WHERE settlement_id=NEW.id AND adoption_kind='resource_supplement';
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=NEW.supplement_base_checkpoint_id;
  SELECT * INTO next_checkpoint FROM chapter_stable_checkpoints WHERE settlement_id=NEW.id AND session_id=child.id;
  IF child.status IS DISTINCT FROM 'stable' OR base.status IS DISTINCT FROM 'superseded'
    OR next_checkpoint.status IS DISTINCT FROM 'stable' OR next_checkpoint.previous_checkpoint_id IS DISTINCT FROM base.id
    OR next_checkpoint.book_id IS DISTINCT FROM base.book_id OR next_checkpoint.chapter_document_id IS DISTINCT FROM base.chapter_document_id
    OR next_checkpoint.body_version_id IS DISTINCT FROM base.body_version_id OR next_checkpoint.chapter_order IS DISTINCT FROM base.chapter_order
    OR next_checkpoint.summary->>'supplementBaseCheckpointId' IS DISTINCT FROM base.id::text
    OR NOT EXISTS(SELECT 1 FROM chapter_adoption_sessions original JOIN chapter_settlements original_settlement ON original_settlement.id=original.settlement_id
      WHERE original.id=base.session_id AND original.status='stable' AND original.settlement_id=base.settlement_id AND original_settlement.status='committed') THEN
    RAISE EXCEPTION 'supplement must retain original settlement and atomically replace only its active checkpoint' USING ERRCODE='23514';
  END IF;
  FOREACH confirmation_kind IN ARRAY ARRAY['facts','knowledge','states'] LOOP
    IF jsonb_typeof(base.summary->'confirmed'->confirmation_kind) IS DISTINCT FROM 'array'
      OR jsonb_typeof(next_checkpoint.summary->'confirmed'->confirmation_kind) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'supplement requires complete original and merged confirmation lists' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO expected FROM (
      SELECT value id FROM jsonb_array_elements_text(base.summary->'confirmed'->confirmation_kind)
      UNION
      SELECT fact.id::text FROM canonical_facts fact JOIN chapter_settlement_items item ON item.canonical_fact_id=fact.id
        WHERE confirmation_kind='facts' AND item.session_id=child.id AND item.decision='confirm' AND fact.status='confirmed'
      UNION
      SELECT change.id::text FROM knowledge_state_changes change JOIN chapter_settlement_items item ON item.knowledge_proposal_id=change.proposal_id
        WHERE confirmation_kind='knowledge' AND item.session_id=child.id AND item.decision='confirm' AND change.status='active'
      UNION
      SELECT change.id::text FROM state_changes change WHERE confirmation_kind='states' AND change.settlement_id=NEW.id AND change.status='active'
    ) merged;
    SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO actual FROM jsonb_array_elements_text(next_checkpoint.summary->'confirmed'->confirmation_kind);
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'supplement cannot omit, duplicate or invent confirmation sources' USING ERRCODE='23514'; END IF;
  END LOOP;
  -- Explicit closure proof is owned by the future downstream-review module.
  -- An empty/fake list cannot enable this unfinished workflow.
  -- Requires an explicit later contract replacing this guard with real downstream
  -- integrity checks. Flipping a capability flag cannot bypass this boundary.
  RAISE EXCEPTION 'resource supplement downstream closure is not operational' USING ERRCODE='23514';
END $$;
