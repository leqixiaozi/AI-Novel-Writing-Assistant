SET search_path TO new_design, public;

ALTER TABLE state_change_proposals
  ADD COLUMN before_known boolean NOT NULL DEFAULT false;

UPDATE state_change_proposals
SET before_known = true
WHERE before_json IS NOT NULL;
