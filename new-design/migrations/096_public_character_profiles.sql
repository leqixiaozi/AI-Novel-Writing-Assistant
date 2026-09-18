-- Manual extension only. Do not register in ordinary startup migrations.
SET search_path TO new_design, public;
CREATE TABLE public_character_profile_capability (
 contract text PRIMARY KEY CHECK(contract='public_character_profile_v1'),
 operational boolean NOT NULL DEFAULT false
);
INSERT INTO public_character_profile_capability(contract) VALUES('public_character_profile_v1');
-- Preserve the original trigger and function identity and all original guards.
CREATE OR REPLACE FUNCTION guard_professional_resource_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'professional command receipts are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.resource_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM new_design.card_versions WHERE id=NEW.resource_version_id AND card_id=NEW.resource_card_id) THEN
  RAISE EXCEPTION 'resource version scope mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.resource_card_id IS NOT NULL THEN
  SELECT t.type_key INTO kind FROM new_design.cards c JOIN new_design.card_types t ON t.id=c.card_type_id
   WHERE c.id=NEW.resource_card_id AND c.space_id='60000000-0000-4000-8000-000000000001';
  IF kind IS NULL OR kind NOT IN ('title_candidate','writing_config','quality_rule','genre_strategy','progression_mode','character') THEN
   RAISE EXCEPTION 'not an original professional resource' USING ERRCODE='23514';
  END IF;
  IF kind='character' THEN
   IF NEW.operation NOT IN ('create','edit','archive','favorite') OR NOT EXISTS(
    SELECT 1 FROM new_design.public_character_profile_capability WHERE contract='public_character_profile_v1' AND operational
   ) THEN RAISE EXCEPTION 'public character profile command is not operational' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.receipt->>'requestKey' IS DISTINCT FROM NEW.request_key OR NEW.receipt->>'operation' IS DISTINCT FROM NEW.operation THEN
  RAISE EXCEPTION 'command receipt identity mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
