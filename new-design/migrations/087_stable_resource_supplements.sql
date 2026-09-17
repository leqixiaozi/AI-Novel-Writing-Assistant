-- Manual contract only. Not registered by normal startup. Install in an explicit
-- transaction after backup/restore validation; retains every original source.
SET search_path TO new_design,public;

ALTER TABLE chapter_adoption_preparations ADD COLUMN supplement_base_checkpoint_id uuid REFERENCES chapter_stable_checkpoints(id);
ALTER TABLE chapter_adoption_sessions ADD COLUMN supplement_base_checkpoint_id uuid REFERENCES chapter_stable_checkpoints(id);
ALTER TABLE chapter_settlements ADD COLUMN supplement_base_checkpoint_id uuid REFERENCES chapter_stable_checkpoints(id);

ALTER TABLE chapter_adoption_sessions DROP CONSTRAINT chapter_adoption_sessions_adoption_kind_check;
ALTER TABLE chapter_adoption_sessions ADD CONSTRAINT chapter_adoption_sessions_adoption_kind_check
  CHECK(adoption_kind IN ('first_adoption','body_switch','resource_supplement'));
ALTER TABLE chapter_adoption_sessions DROP CONSTRAINT chapter_adoption_sessions_adoption_id_key;
CREATE UNIQUE INDEX chapter_adoption_sessions_primary_adoption_unique ON chapter_adoption_sessions(adoption_id)
  WHERE supplement_base_checkpoint_id IS NULL;
CREATE UNIQUE INDEX chapter_adoption_sessions_supplement_adoption_unique ON chapter_adoption_sessions(adoption_id,supplement_base_checkpoint_id)
  WHERE supplement_base_checkpoint_id IS NOT NULL AND status NOT IN ('cancelled');
DROP INDEX chapter_settlements_active_version_unique;
CREATE UNIQUE INDEX chapter_settlements_active_version_unique ON chapter_settlements(chapter_document_id,body_version_id)
  WHERE status='committed' AND supplement_base_checkpoint_id IS NULL;
CREATE UNIQUE INDEX chapter_settlements_supplement_base_unique ON chapter_settlements(supplement_base_checkpoint_id)
  WHERE status='committed' AND supplement_base_checkpoint_id IS NOT NULL;

CREATE TABLE chapter_resource_supplements (
  session_id uuid PRIMARY KEY REFERENCES chapter_adoption_sessions(id),
  book_id uuid NOT NULL REFERENCES books(id),
  base_checkpoint_id uuid NOT NULL REFERENCES chapter_stable_checkpoints(id),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 160),
  full_input jsonb NOT NULL CHECK(jsonb_typeof(full_input)='object'),
  input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
  source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
  source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  original_receipt jsonb NOT NULL CHECK(jsonb_typeof(original_receipt)='object'),
  actor text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,request_key)
);

CREATE TABLE resource_supplement_capabilities (
  contract_key text PRIMARY KEY CHECK(contract_key='stable_resource_supplements_v1'),
  operational boolean NOT NULL DEFAULT false CHECK(NOT operational),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Presence is a storage contract. It does not enable an unfinished model/UI flow.
INSERT INTO resource_supplement_capabilities(contract_key,operational) VALUES('stable_resource_supplements_v1',false);

CREATE OR REPLACE FUNCTION validate_chapter_adoption_preparation() RETURNS trigger LANGUAGE plpgsql
  SET search_path TO new_design,public AS $$
BEGIN
  IF NEW.supplement_base_checkpoint_id IS NULL THEN
    IF NOT EXISTS(
      SELECT 1 FROM chapter_documents document
      JOIN chapter_body_versions body ON body.id=NEW.body_version_id AND body.chapter_document_id=document.id
      JOIN planning_objects object ON object.id=NEW.planning_object_id
      WHERE document.id=NEW.chapter_document_id AND document.book_id=NEW.book_id AND document.revision=NEW.expected_document_revision
        AND body.archived_at IS NULL AND body.planning_version_id=NEW.planning_version_id
        AND body.context_manifest_id IS NOT DISTINCT FROM NEW.context_manifest_id
        AND object.book_id=NEW.book_id AND object.card_id=document.chapter_card_id AND object.level='chapter'
        AND object.adopted_version_id=NEW.planning_version_id
    ) THEN RAISE EXCEPTION 'chapter adoption preparation dependencies mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    IF NOT EXISTS(
      SELECT 1 FROM chapter_stable_checkpoints base
      JOIN chapter_adoption_sessions original ON original.id=base.session_id AND original.status='stable'
      JOIN chapter_settlements settlement ON settlement.id=base.settlement_id AND settlement.status='committed'
      JOIN chapter_documents document ON document.id=base.chapter_document_id AND document.book_id=base.book_id
        AND document.status='active' AND document.adopted_version_id=base.body_version_id
      JOIN books book ON book.id=base.book_id AND book.status='active'
      JOIN chapter_body_versions body ON body.id=base.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      JOIN planning_versions plan ON plan.id=original.planning_version_id AND plan.object_id=original.planning_object_id AND plan.book_id=base.book_id
      WHERE base.id=NEW.supplement_base_checkpoint_id AND base.status='stable'
        AND base.book_id=NEW.book_id AND base.chapter_document_id=NEW.chapter_document_id AND base.body_version_id=NEW.body_version_id
        AND document.revision=NEW.expected_document_revision AND base.chapter_order=document.logical_order
        AND original.book_id=base.book_id AND original.chapter_document_id=document.id AND original.body_version_id=body.id
        AND original.settlement_id=settlement.id AND settlement.book_id=base.book_id
        AND settlement.chapter_document_id=document.id AND settlement.body_version_id=body.id
        AND NEW.planning_object_id=original.planning_object_id AND NEW.planning_version_id=original.planning_version_id
        AND NEW.planning_content_hash=plan.content_hash AND body.planning_version_id=plan.id
        AND NEW.context_manifest_id IS NOT DISTINCT FROM body.context_manifest_id
        AND NEW.context_manifest_id IS NOT DISTINCT FROM original.context_manifest_id
    ) THEN RAISE EXCEPTION 'supplement requires the exact active stable origin' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION guard_resource_supplement_session() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE base chapter_stable_checkpoints%ROWTYPE; original chapter_adoption_sessions%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.supplement_base_checkpoint_id IS DISTINCT FROM OLD.supplement_base_checkpoint_id OR
      (OLD.adoption_kind='resource_supplement' AND NEW.adoption_id IS DISTINCT FROM OLD.adoption_id) THEN
      RAISE EXCEPTION 'supplement origin is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.adoption_kind='resource_supplement') IS DISTINCT FROM (NEW.supplement_base_checkpoint_id IS NOT NULL) THEN
    RAISE EXCEPTION 'supplement kind and base must agree' USING ERRCODE='23514';
  END IF;
  IF NEW.supplement_base_checkpoint_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=NEW.supplement_base_checkpoint_id;
  SELECT * INTO original FROM chapter_adoption_sessions WHERE id=base.session_id;
  IF base.status IS DISTINCT FROM 'stable' OR original.status IS DISTINCT FROM 'stable'
    OR NEW.book_id IS DISTINCT FROM base.book_id OR NEW.chapter_document_id IS DISTINCT FROM base.chapter_document_id
    OR NEW.body_version_id IS DISTINCT FROM base.body_version_id OR NEW.adoption_id IS DISTINCT FROM original.adoption_id
    OR NEW.planning_object_id IS DISTINCT FROM original.planning_object_id OR NEW.planning_version_id IS DISTINCT FROM original.planning_version_id
    OR NEW.context_manifest_id IS DISTINCT FROM original.context_manifest_id
    OR NEW.status<>'adopted_pending_proposals' OR NEW.prior_body_version_id IS NOT NULL OR NEW.settlement_id IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM chapter_adoption_preparations prep WHERE prep.id=NEW.preparation_id
      AND prep.supplement_base_checkpoint_id=base.id AND prep.status='consumed') THEN
    RAISE EXCEPTION 'supplement cannot adopt, switch or reopen original body' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_resource_supplement_session_guard BEFORE INSERT OR UPDATE ON chapter_adoption_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_resource_supplement_session();

CREATE FUNCTION validate_resource_supplement_origin() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE child chapter_adoption_sessions%ROWTYPE; base chapter_stable_checkpoints%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'supplement original receipt is immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO child FROM chapter_adoption_sessions WHERE id=NEW.session_id;
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=NEW.base_checkpoint_id;
  IF child.adoption_kind IS DISTINCT FROM 'resource_supplement' OR child.supplement_base_checkpoint_id IS DISTINCT FROM base.id
    OR child.book_id IS DISTINCT FROM NEW.book_id OR base.book_id IS DISTINCT FROM NEW.book_id OR base.status IS DISTINCT FROM 'stable'
    OR NEW.source_snapshot->'basis'->'original'->'checkpoint' IS DISTINCT FROM to_jsonb(base)
    OR NEW.source_snapshot->'basis'->>'sourceHash' IS DISTINCT FROM NEW.source_hash::text
    OR NEW.full_input->>'requestKey' IS DISTINCT FROM NEW.request_key
    OR NEW.full_input->>'checkpointId' IS DISTINCT FROM base.id::text
    OR NEW.full_input->>'expectedSourceHash' IS DISTINCT FROM NEW.source_hash::text
    OR NEW.original_receipt->>'sessionId' IS DISTINCT FROM child.id::text
    OR NEW.original_receipt->>'bookId' IS DISTINCT FROM NEW.book_id::text
    OR NEW.original_receipt->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR NEW.original_receipt->>'bodyVersionId' IS DISTINCT FROM child.body_version_id::text
    OR NEW.original_receipt->>'preparationId' IS DISTINCT FROM child.preparation_id::text
    OR NEW.original_receipt->>'requestKey' IS DISTINCT FROM NEW.request_key
    OR NEW.original_receipt->'input' IS DISTINCT FROM NEW.full_input
    OR NEW.original_receipt->>'inputHash' IS DISTINCT FROM NEW.input_hash::text THEN
    RAISE EXCEPTION 'supplement full original input and source receipt mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_resource_supplements_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON chapter_resource_supplements
  FOR EACH ROW EXECUTE FUNCTION validate_resource_supplement_origin();

CREATE FUNCTION guard_resource_supplement_item_scope() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE child chapter_adoption_sessions%ROWTYPE; origin chapter_resource_supplements%ROWTYPE; proposal state_change_proposals%ROWTYPE;
BEGIN
  SELECT * INTO child FROM chapter_adoption_sessions WHERE id=NEW.session_id;
  IF child.adoption_kind<>'resource_supplement' THEN RETURN NEW; END IF;
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=child.id;
  SELECT * INTO proposal FROM state_change_proposals WHERE id=NEW.state_proposal_id;
  IF NEW.category NOT IN ('prop','relationship') OR NEW.canonical_fact_id IS NOT NULL OR NEW.knowledge_proposal_id IS NOT NULL
    OR proposal.id IS NULL OR proposal.book_id IS DISTINCT FROM child.book_id
    OR proposal.chapter_document_id IS DISTINCT FROM child.chapter_document_id OR proposal.body_version_id IS DISTINCT FROM child.body_version_id
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(origin.source_snapshot->'resourceScope'->'resources') resource
      WHERE (NEW.category='prop' AND proposal.subject_kind='card' AND resource->>'id'=proposal.subject_id::text)
        OR (NEW.category='relationship' AND proposal.subject_kind='relation' AND resource->>'relationId'=proposal.subject_id::text)) THEN
    RAISE EXCEPTION 'resource supplement item must remain within its frozen resource scope' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_resource_supplement_item_scope_guard BEFORE INSERT OR UPDATE ON chapter_settlement_items
  FOR EACH ROW EXECUTE FUNCTION guard_resource_supplement_item_scope();

CREATE FUNCTION require_resource_supplement_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF NEW.adoption_kind='resource_supplement' AND NOT EXISTS(SELECT 1 FROM chapter_resource_supplements origin
    WHERE origin.session_id=NEW.id AND origin.base_checkpoint_id=NEW.supplement_base_checkpoint_id AND origin.book_id=NEW.book_id) THEN
    RAISE EXCEPTION 'supplement session requires an atomic full original receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER chapter_resource_supplement_receipt_required AFTER INSERT ON chapter_adoption_sessions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_resource_supplement_receipt();

CREATE FUNCTION guard_stable_checkpoint_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION 'stable checkpoint history and confirmation summary are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_stable_checkpoint_origin_guard BEFORE UPDATE OR DELETE ON chapter_stable_checkpoints
  FOR EACH ROW EXECUTE FUNCTION guard_stable_checkpoint_origin();

CREATE FUNCTION validate_resource_supplement_settlement() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.supplement_base_checkpoint_id IS DISTINCT FROM OLD.supplement_base_checkpoint_id THEN
    RAISE EXCEPTION 'supplement settlement origin is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.supplement_base_checkpoint_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM chapter_adoption_sessions child JOIN chapter_resource_supplements origin ON origin.session_id=child.id
    WHERE child.supplement_base_checkpoint_id=NEW.supplement_base_checkpoint_id AND child.book_id=NEW.book_id
      AND child.chapter_document_id=NEW.chapter_document_id AND child.body_version_id=NEW.body_version_id
      AND child.adoption_kind='resource_supplement') THEN
    RAISE EXCEPTION 'supplement settlement requires its owning supplement session' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_resource_supplement_settlement_guard BEFORE INSERT OR UPDATE ON chapter_settlements
  FOR EACH ROW EXECUTE FUNCTION validate_resource_supplement_settlement();

-- Until the merged checkpoint/downstream closure is implemented, incomplete
-- ordinary settlement code cannot commit a child and lose the original history.
CREATE FUNCTION require_resource_supplement_closure() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
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
CREATE CONSTRAINT TRIGGER chapter_resource_supplement_closure_required AFTER INSERT OR UPDATE ON chapter_settlements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_resource_supplement_closure();
