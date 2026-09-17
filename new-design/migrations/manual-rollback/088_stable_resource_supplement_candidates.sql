-- Non-destructive deactivation: retain candidate requests, output, attempts and origin receipts.
-- Does not restore incompatible uniqueness, delete sources or enable formal settlement.
SET search_path TO new_design,public;
CREATE OR REPLACE FUNCTION block_unavailable_resource_supplement_extraction() RETURNS trigger
LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM chapter_adoption_sessions WHERE id=NEW.session_id AND adoption_kind='resource_supplement') THEN
    RAISE EXCEPTION 'stable resource supplement candidates are deactivated' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
