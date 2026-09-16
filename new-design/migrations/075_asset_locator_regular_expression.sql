-- PostgreSQL ARE repetition bounds cannot exceed 255. Keep the separate
-- 1..1000 length bound and every original managed/external path restriction.
ALTER TABLE new_design.asset_content_objects
  DROP CONSTRAINT asset_content_objects_storage_locator_check,
  ADD CONSTRAINT asset_content_objects_storage_locator_check CHECK (
    length(storage_locator) BETWEEN 1 AND 1000 AND
    storage_locator ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' AND
    storage_locator !~ '(^[\\/]|^[A-Za-z]:|(^|/)\.\.(/|$)|\\|://|//)'
  );
