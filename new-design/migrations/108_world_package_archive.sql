-- Manual world-package extension. Apply only after 084_world_packages.sql.
SET search_path TO new_design, public;

CREATE TABLE world_package_catalog_actions (
 id uuid PRIMARY KEY,
 root_card_id uuid NOT NULL REFERENCES cards(id),
 action text NOT NULL CHECK (action IN ('archive','restore')),
 revision integer NOT NULL CHECK (revision>0),
 expected_revision integer NOT NULL CHECK (expected_revision>=0),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (root_card_id,revision)
);
CREATE INDEX world_package_catalog_actions_latest ON world_package_catalog_actions(root_card_id,revision DESC);

CREATE FUNCTION guard_world_package_catalog_action() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE previous_revision integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM world_package_capability WHERE contract='public_world_package_v1' AND operational)
 OR NOT EXISTS(SELECT 1 FROM world_package_versions WHERE root_card_id=NEW.root_card_id)
 THEN RAISE EXCEPTION 'public world must be operational and published before catalog action' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(revision),0) INTO previous_revision FROM world_package_catalog_actions WHERE root_card_id=NEW.root_card_id;
 IF NEW.expected_revision<>previous_revision OR NEW.revision<>previous_revision+1
 OR (previous_revision=0 AND NEW.action<>'archive')
 OR (previous_revision>0 AND EXISTS(SELECT 1 FROM world_package_catalog_actions WHERE root_card_id=NEW.root_card_id AND revision=previous_revision AND action=NEW.action))
 OR NEW.receipt->>'rootCardId' IS DISTINCT FROM NEW.root_card_id::text
 OR NEW.receipt->>'requestKey' IS DISTINCT FROM NEW.request_key::text
 OR (NEW.action='archive' AND NEW.receipt->>'status' IS DISTINCT FROM 'archived')
 OR (NEW.action='restore' AND NEW.receipt->>'status' IS DISTINCT FROM 'active')
 OR NEW.receipt->>'revision' IS DISTINCT FROM NEW.revision::text
 OR NEW.receipt->'repeated' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'public world catalog action is stale or incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER world_package_catalog_action_guard BEFORE INSERT ON world_package_catalog_actions FOR EACH ROW EXECUTE FUNCTION guard_world_package_catalog_action();
CREATE TRIGGER world_package_catalog_actions_immutable BEFORE UPDATE OR DELETE ON world_package_catalog_actions FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
