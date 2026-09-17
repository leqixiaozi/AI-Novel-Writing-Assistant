-- Deactivate NEW correction requests without dropping full originals or fences.
CREATE OR REPLACE FUNCTION new_design.validate_resource_supplement_correction_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'correction origin writes deactivated; full originals retained' USING ERRCODE='23514'; END $$;
-- No DELETE/DROP, no body writes, no resolved flag, no is_stale clearing,
-- no changes to 087 closure, 090 resolution or correction candidate guards.
