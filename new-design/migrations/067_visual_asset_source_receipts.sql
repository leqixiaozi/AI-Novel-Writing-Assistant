SET search_path TO new_design, public;
-- Additive technical acknowledgements on the existing unique asset ledgers.
ALTER TABLE asset_events ADD COLUMN visual_input_hash text CHECK(visual_input_hash ~ '^[0-9a-f]{64}$'), ADD COLUMN visual_receipt jsonb CHECK(jsonb_typeof(visual_receipt)='object');
ALTER TABLE asset_events ADD CONSTRAINT asset_events_visual_receipt_pair CHECK((visual_input_hash IS NULL)=(visual_receipt IS NULL) AND (visual_receipt IS NULL OR idempotency_key IS NOT NULL));
ALTER TABLE asset_mounts ADD COLUMN visual_input_hash text CHECK(visual_input_hash ~ '^[0-9a-f]{64}$'), ADD COLUMN visual_receipt jsonb CHECK(jsonb_typeof(visual_receipt)='object');
ALTER TABLE asset_mounts ADD CONSTRAINT asset_mounts_visual_receipt_pair CHECK((visual_input_hash IS NULL)=(visual_receipt IS NULL));
ALTER TABLE dependency_change_previews ADD COLUMN visual_input_hash text CHECK(visual_input_hash ~ '^[0-9a-f]{64}$'),ADD COLUMN visual_source jsonb CHECK(jsonb_typeof(visual_source)='object');
ALTER TABLE dependency_change_previews ADD CONSTRAINT visual_preview_pair CHECK((visual_input_hash IS NULL)=(visual_source IS NULL));
CREATE FUNCTION validate_visual_source_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.visual_receipt IS NOT NULL AND (NEW.visual_receipt->>'bookId' IS DISTINCT FROM NEW.book_id::text OR NEW.visual_receipt->>'requestKey' IS DISTINCT FROM NEW.idempotency_key OR NEW.visual_receipt->>'assetId' IS DISTINCT FROM NEW.asset_id::text) THEN
  RAISE EXCEPTION 'visual source receipt identity mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.visual_receipt IS NOT NULL THEN
  IF TG_TABLE_NAME='asset_events' THEN
   IF NEW.visual_receipt->>'versionId' IS DISTINCT FROM NEW.asset_version_id::text OR (
    (NEW.visual_receipt->>'operation'='upload' AND NEW.action IN ('create','add_version')) OR
    (NEW.visual_receipt->>'operation'='description' AND NEW.action='add_version') OR
    (NEW.visual_receipt->>'operation'='adopt' AND NEW.action IN ('adopt','readopt','rollback')) OR
    (NEW.visual_receipt->>'operation'='archive' AND NEW.action='archive')
   ) IS NOT TRUE THEN RAISE EXCEPTION 'visual event operation or version mismatch' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='asset_mounts' THEN
   IF NEW.visual_receipt->>'versionId' IS DISTINCT FROM NEW.asset_version_id::text OR NEW.visual_receipt->>'mountId' IS DISTINCT FROM NEW.id::text OR NEW.visual_receipt->>'operation' IS DISTINCT FROM 'mount' THEN
    RAISE EXCEPTION 'visual mount operation or version mismatch' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER visual_event_source_receipt BEFORE INSERT ON asset_events FOR EACH ROW EXECUTE FUNCTION validate_visual_source_receipt();
CREATE TRIGGER visual_mount_source_receipt BEFORE INSERT ON asset_mounts FOR EACH ROW EXECUTE FUNCTION validate_visual_source_receipt();
CREATE FUNCTION validate_visual_preview_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_asset assets%ROWTYPE;
BEGIN
 IF NEW.visual_source IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO source_asset FROM assets WHERE id=(NEW.visual_source->>'assetId')::uuid AND book_id=NEW.book_id AND asset_kind IN ('cover','illustration');
 IF NOT FOUND OR source_asset.status<>'active' OR source_asset.revision::text IS DISTINCT FROM NEW.visual_source->>'revision' OR source_asset.current_version_id::text IS DISTINCT FROM NEW.visual_source->>'fromVersionId' OR NOT EXISTS(
  SELECT 1 FROM dependency_resources resource WHERE resource.id=NEW.old_resource_id AND resource.book_id=NEW.book_id AND resource.resource_kind='asset_version' AND resource.stable_object_id=source_asset.id
 ) THEN RAISE EXCEPTION 'visual preview source scope mismatch' USING ERRCODE='23514'; END IF;
 IF (NEW.visual_source->>'toVersionId' IS NULL)<>(NEW.new_resource_id IS NULL) OR (NEW.new_resource_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM dependency_resources resource WHERE resource.id=NEW.new_resource_id AND resource.book_id=NEW.book_id AND resource.resource_kind='asset_version' AND resource.stable_object_id=source_asset.id AND resource.exact_version_id=(NEW.visual_source->>'toVersionId')::uuid
 )) THEN RAISE EXCEPTION 'visual preview target scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER visual_preview_source_validate BEFORE INSERT ON dependency_change_previews FOR EACH ROW EXECUTE FUNCTION validate_visual_preview_source();
-- Existing asset_mounts lack an active-asset check. This scoped guard prevents late
-- visual bindings racing a reviewed adopt/archive without weakening legacy owners.
CREATE FUNCTION guard_visual_active_mount() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_asset assets%ROWTYPE;
BEGIN
 IF NEW.status<>'active' THEN RETURN NEW; END IF;
 SELECT * INTO source_asset FROM assets WHERE id=NEW.asset_id AND book_id=NEW.book_id;
 IF NOT FOUND OR source_asset.asset_kind NOT IN ('cover','illustration') THEN RETURN NEW; END IF;
 PERFORM id FROM books WHERE id=NEW.book_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'visual binding book is not active' USING ERRCODE='23514'; END IF;
 SELECT * INTO source_asset FROM assets WHERE id=NEW.asset_id AND book_id=NEW.book_id FOR SHARE;
 IF NOT FOUND THEN RETURN NEW; END IF; -- The original scope guard retains its failure.
 IF source_asset.asset_kind IN ('cover','illustration') AND source_asset.status<>'active' THEN
  RAISE EXCEPTION 'archived visual asset does not accept new active bindings' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER visual_mount_active_source BEFORE INSERT ON asset_mounts FOR EACH ROW EXECUTE FUNCTION guard_visual_active_mount();
