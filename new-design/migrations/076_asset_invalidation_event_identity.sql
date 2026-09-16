-- Preserve the 061 bridge exactly, distinguishing its local event identity from
-- dependency_invalidation_impacts.event_id in the two correlated predicates.
CREATE OR REPLACE FUNCTION new_design.bridge_asset_change_events()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO pg_catalog, new_design, public, pg_temp AS $$
DECLARE old_resource uuid; new_resource uuid; invalidation_event_id uuid;
BEGIN
 IF TG_TABLE_NAME='asset_adoptions' THEN
  IF NEW.from_version_id IS NOT NULL AND NEW.from_version_id<>NEW.to_version_id THEN
   old_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.from_version_id);
   new_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.to_version_id);
   invalidation_event_id:=record_dependency_invalidation(gen_random_uuid(),NEW.book_id,old_resource,new_resource,'附件采用版本发生变化。','asset_adoption','stale',NEW.id,'asset-adoption:'||NEW.id::text,NEW.dependency_preview_id,NULL);
  END IF;
 ELSIF TG_TABLE_NAME='asset_events' THEN
  IF NEW.action='archive' AND NEW.asset_version_id IS NOT NULL THEN
   old_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.asset_version_id);
   invalidation_event_id:=record_dependency_invalidation(gen_random_uuid(),NEW.book_id,old_resource,NULL,'附件已归档。','asset_archive','invalid',NEW.id,'asset-archive:'||NEW.id::text,NEW.dependency_preview_id,NULL);
  END IF;
 END IF;
 IF invalidation_event_id IS NOT NULL THEN
  PERFORM set_config('new_design.knowledge_write','managed',true);
  INSERT INTO asset_derivation_events(id,derivation_id,from_status,to_status,action,actor,detail,derivation_revision)
  SELECT gen_random_uuid(),derivation.id,'succeeded','stale','mark_stale','system','来源附件版本发生变化，派生结果等待重建。',derivation.revision+1 FROM asset_derivations derivation
  WHERE derivation.status='succeeded' AND EXISTS(SELECT 1 FROM dependency_invalidation_impacts impact JOIN dependency_resources resource ON resource.id=impact.resource_id AND resource.resource_kind='asset_version' JOIN asset_derivation_results result ON result.output_asset_version_id=resource.exact_version_id AND result.derivation_id=derivation.id WHERE impact.event_id=invalidation_event_id);
  UPDATE asset_derivations derivation SET status='stale',revision=revision+1,updated_at=now()
  WHERE derivation.status='succeeded' AND EXISTS(SELECT 1 FROM dependency_invalidation_impacts impact JOIN dependency_resources resource ON resource.id=impact.resource_id AND resource.resource_kind='asset_version' JOIN asset_derivation_results result ON result.output_asset_version_id=resource.exact_version_id AND result.derivation_id=derivation.id WHERE impact.event_id=invalidation_event_id);
 END IF;
 RETURN NEW;
END $$;
