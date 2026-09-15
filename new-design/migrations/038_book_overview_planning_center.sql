SET search_path TO new_design, public;

ALTER TABLE planning_versions
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'manual'
  CHECK (execution_mode IN ('manual','ai_assisted','automatic'));

CREATE TABLE planning_version_references (
  id uuid PRIMARY KEY,
  planning_version_id uuid NOT NULL,
  planning_object_id uuid NOT NULL,
  book_id uuid NOT NULL,
  reference_role text NOT NULL CHECK(reference_role IN ('viewpoint','location','participant','event','foreshadow','item','organization')),
  card_id uuid NOT NULL,
  card_version_id uuid NOT NULL,
  action_key text CHECK(action_key IS NULL OR action_key IN ('plant','reinforce','recover','misdirect','reveal')),
  note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(planning_version_id,planning_object_id) REFERENCES planning_versions(id,object_id) ON DELETE CASCADE,
  FOREIGN KEY(planning_object_id,book_id) REFERENCES planning_objects(id,book_id) ON DELETE CASCADE,
  FOREIGN KEY(card_version_id,card_id) REFERENCES card_versions(id,card_id),
  UNIQUE NULLS NOT DISTINCT(planning_version_id,reference_role,card_id,action_key)
);

CREATE INDEX planning_version_references_version_idx
  ON planning_version_references(planning_version_id,reference_role,sort_order,id);
CREATE INDEX planning_version_references_card_idx
  ON planning_version_references(book_id,card_id,card_version_id);

CREATE FUNCTION validate_planning_version_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_space uuid; target_space uuid; type_key_value text;
BEGIN
  SELECT card.space_id,type.type_key INTO source_space,type_key_value
  FROM new_design.cards card
  JOIN new_design.card_types type ON type.id=card.card_type_id
  WHERE card.id=NEW.card_id AND card.status='active' AND card.current_version_id=NEW.card_version_id;
  SELECT space_id INTO target_space FROM new_design.books WHERE id=NEW.book_id AND status='active';
  IF source_space IS NULL OR target_space IS NULL OR source_space IS DISTINCT FROM target_space THEN
    RAISE EXCEPTION 'planning reference must use the current version of an active card from the same book' USING ERRCODE='23514';
  END IF;
  IF NEW.reference_role='viewpoint' AND type_key_value<>'character' THEN
    RAISE EXCEPTION 'viewpoint reference must target a character' USING ERRCODE='23514';
  ELSIF NEW.reference_role='location' AND type_key_value<>'location' THEN
    RAISE EXCEPTION 'location reference must target a location' USING ERRCODE='23514';
  ELSIF NEW.reference_role='participant' AND type_key_value<>'character' THEN
    RAISE EXCEPTION 'participant reference must target a character' USING ERRCODE='23514';
  ELSIF NEW.reference_role='event' AND type_key_value<>'event' THEN
    RAISE EXCEPTION 'event reference must target an event' USING ERRCODE='23514';
  ELSIF NEW.reference_role='foreshadow' AND type_key_value NOT IN ('foreshadow','clue') THEN
    RAISE EXCEPTION 'foreshadow reference must target a clue or foreshadow item' USING ERRCODE='23514';
  ELSIF NEW.reference_role='item' AND type_key_value<>'prop' THEN
    RAISE EXCEPTION 'item reference must target an item' USING ERRCODE='23514';
  ELSIF NEW.reference_role='organization' AND type_key_value<>'organization' THEN
    RAISE EXCEPTION 'organization reference must target an organization' USING ERRCODE='23514';
  END IF;
  IF NEW.reference_role='foreshadow' AND NEW.action_key IS NULL THEN
    RAISE EXCEPTION 'foreshadow reference requires an action' USING ERRCODE='23514';
  ELSIF NEW.reference_role<>'foreshadow' AND NEW.action_key IS NOT NULL THEN
    RAISE EXCEPTION 'only foreshadow references accept an action' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER planning_version_references_validate
BEFORE INSERT ON planning_version_references
FOR EACH ROW EXECUTE FUNCTION validate_planning_version_reference();

CREATE TABLE planning_operation_events (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  object_id uuid REFERENCES planning_objects(id) ON DELETE CASCADE,
  version_id uuid REFERENCES planning_versions(id),
  action text NOT NULL CHECK(action IN ('create','revise','reject','archive','restore')),
  expected_revision integer CHECK(expected_revision IS NULL OR expected_revision>0),
  result_revision integer NOT NULL CHECK(result_revision>0),
  request_hash char(64) NOT NULL,
  idempotency_key text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE INDEX planning_operation_events_object_idx
  ON planning_operation_events(object_id,created_at DESC,id DESC);

ALTER TABLE planning_version_actions DROP CONSTRAINT planning_version_actions_action_check;
ALTER TABLE planning_version_actions ADD CONSTRAINT planning_version_actions_action_check
  CHECK(action IN ('create','edit','reject','mark_stale','archive','restore'));

CREATE FUNCTION guard_planning_center_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'planning center history is append-only' USING ERRCODE='23514'; END $$;

CREATE TRIGGER planning_version_references_immutable
BEFORE UPDATE OR DELETE ON planning_version_references
FOR EACH ROW EXECUTE FUNCTION guard_planning_center_append_only();

CREATE TRIGGER planning_operation_events_immutable
BEFORE UPDATE OR DELETE ON planning_operation_events
FOR EACH ROW EXECUTE FUNCTION guard_planning_center_append_only();

CREATE FUNCTION bridge_planning_reference_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM new_design.add_registered_dependency(
    'card_version',NEW.card_id,NEW.card_version_id,
    'planning_version',NEW.planning_object_id,NEW.planning_version_id,
    'planned_from','hard','manual',NEW.planning_version_id
  );
  RETURN NEW;
END $$;

CREATE TRIGGER planning_version_reference_dependency
AFTER INSERT ON planning_version_references
FOR EACH ROW EXECUTE FUNCTION bridge_planning_reference_dependency();

COMMENT ON TABLE planning_version_references IS 'Exact adopted material versions referenced by an immutable planning version; titles remain projections, never copied canonical data.';
COMMENT ON TABLE planning_operation_events IS 'Idempotent audit receipts for planning creation, revision, rejection, archive, and restore operations.';
COMMENT ON COLUMN planning_versions.execution_mode IS 'Author intent for later chapter execution. F2 records intent only and never generates chapter body content.';
