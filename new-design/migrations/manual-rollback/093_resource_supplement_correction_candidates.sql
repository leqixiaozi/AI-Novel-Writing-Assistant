-- Deactivate NEW correction candidates/edits, retain complete managed results,
-- original input, usage, author history and all real source fences.
CREATE OR REPLACE FUNCTION new_design.block_unavailable_resource_correction_candidates() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM chapter_resource_supplements WHERE session_id=NEW.session_id AND source_snapshot->>'contract'='stable_resource_correction_preview_v1') THEN
    RAISE EXCEPTION 'correction candidates and editing deactivated; full originals retained' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
-- Keep controlled-payload metadata for saved correction results/ledger completion.
-- Do not delete histories, close origins, drop triggers, clear is_stale or resolve.
