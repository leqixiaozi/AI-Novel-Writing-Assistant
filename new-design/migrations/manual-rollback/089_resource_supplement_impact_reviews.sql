-- Non-destructive deactivation. Retain every full input, snapshot and receipt.
CREATE OR REPLACE FUNCTION new_design.validate_resource_supplement_impact_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'impact review writes deactivated; saved history retained' USING ERRCODE='23514';
END $$;
