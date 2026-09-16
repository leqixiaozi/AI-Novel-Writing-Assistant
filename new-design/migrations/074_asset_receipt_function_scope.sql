-- Shared asset mount/preview triggers run for knowledge references as well.
-- Their row types must resolve before a NULL visual marker can return early.
ALTER FUNCTION new_design.validate_visual_source_receipt()
  SET search_path TO pg_catalog, new_design, public, pg_temp;
ALTER FUNCTION new_design.validate_visual_preview_source()
  SET search_path TO pg_catalog, new_design, public, pg_temp;
ALTER FUNCTION new_design.guard_visual_active_mount()
  SET search_path TO pg_catalog, new_design, public, pg_temp;
