-- Deactivate NEW journals; preserve histories and fences on any existing issues.
CREATE OR REPLACE FUNCTION new_design.validate_resource_supplement_integrity_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'integrity journal writes deactivated; histories and source fences retained' USING ERRCODE='23514'; END $$;
-- Never DROP issue/resolution history, clear is_stale, or disable projection guards.
