SET search_path TO new_design, public;
-- Receipts extend existing append-only ledgers; no second attachment/text fact store.
ALTER TABLE asset_events ADD COLUMN knowledge_input_hash char(64), ADD COLUMN knowledge_receipt jsonb,
 ADD CONSTRAINT asset_events_knowledge_receipt_check CHECK((knowledge_input_hash IS NULL AND knowledge_receipt IS NULL) OR (knowledge_input_hash IS NOT NULL AND knowledge_receipt IS NOT NULL AND knowledge_input_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(knowledge_receipt)='object'));
ALTER TABLE asset_mounts ADD COLUMN knowledge_input_hash char(64), ADD COLUMN knowledge_receipt jsonb,
 ADD CONSTRAINT asset_mounts_knowledge_receipt_check CHECK((knowledge_input_hash IS NULL AND knowledge_receipt IS NULL) OR (knowledge_input_hash IS NOT NULL AND knowledge_receipt IS NOT NULL AND knowledge_input_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(knowledge_receipt)='object'));
ALTER TABLE asset_derivation_results ADD COLUMN knowledge_input_hash char(64), ADD COLUMN knowledge_receipt jsonb,
 ADD CONSTRAINT asset_results_knowledge_receipt_check CHECK((knowledge_input_hash IS NULL AND knowledge_receipt IS NULL) OR (knowledge_input_hash IS NOT NULL AND knowledge_receipt IS NOT NULL AND knowledge_input_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(knowledge_receipt)='object'));
CREATE OR REPLACE FUNCTION bridge_asset_change_events() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE old_resource uuid; new_resource uuid; event_id uuid;
BEGIN
 IF TG_TABLE_NAME='asset_adoptions' THEN
  IF NEW.from_version_id IS NOT NULL AND NEW.from_version_id<>NEW.to_version_id THEN
   old_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.from_version_id);
   new_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.to_version_id);
   event_id:=record_dependency_invalidation(gen_random_uuid(),NEW.book_id,old_resource,new_resource,'附件采用版本发生变化。','asset_adoption','stale',NEW.id,'asset-adoption:'||NEW.id::text,NEW.dependency_preview_id,NULL);
  END IF;
 ELSIF TG_TABLE_NAME='asset_events' THEN
  IF NEW.action='archive' AND NEW.asset_version_id IS NOT NULL THEN
   old_resource:=register_dependency_resource('asset_version',NEW.asset_id,NEW.asset_version_id);
   event_id:=record_dependency_invalidation(gen_random_uuid(),NEW.book_id,old_resource,NULL,'附件已归档。','asset_archive','invalid',NEW.id,'asset-archive:'||NEW.id::text,NEW.dependency_preview_id,NULL);
  END IF;
 END IF;
 IF event_id IS NOT NULL THEN
  PERFORM set_config('new_design.knowledge_write','managed',true);
  INSERT INTO asset_derivation_events(id,derivation_id,from_status,to_status,action,actor,detail,derivation_revision)
  SELECT gen_random_uuid(),derivation.id,'succeeded','stale','mark_stale','system','来源附件版本发生变化，派生结果等待重建。',derivation.revision+1 FROM asset_derivations derivation
  WHERE derivation.status='succeeded' AND EXISTS(SELECT 1 FROM dependency_invalidation_impacts impact JOIN dependency_resources resource ON resource.id=impact.resource_id AND resource.resource_kind='asset_version' JOIN asset_derivation_results result ON result.output_asset_version_id=resource.exact_version_id AND result.derivation_id=derivation.id WHERE impact.event_id=event_id);
  UPDATE asset_derivations derivation SET status='stale',revision=revision+1,updated_at=now()
  WHERE derivation.status='succeeded' AND EXISTS(SELECT 1 FROM dependency_invalidation_impacts impact JOIN dependency_resources resource ON resource.id=impact.resource_id AND resource.resource_kind='asset_version' JOIN asset_derivation_results result ON result.output_asset_version_id=resource.exact_version_id AND result.derivation_id=derivation.id WHERE impact.event_id=event_id);
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_managed_knowledge_version() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE kind text; registered asset_content_objects%ROWTYPE;
BEGIN
 kind:=NEW.metadata->'knowledgeReference'->>'kind';
 IF EXISTS(SELECT 1 FROM asset_derivations request WHERE request.output_asset_id=NEW.asset_id AND request.recipe_key='knowledge.utf8') AND kind IS DISTINCT FROM 'parsed' THEN RAISE EXCEPTION 'managed knowledge output cannot be replaced by an unrelated asset version' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM assets asset JOIN asset_versions current_version ON current_version.id=asset.current_version_id WHERE asset.id=NEW.asset_id AND current_version.metadata->'knowledgeReference'->>'kind'='source') AND kind IS DISTINCT FROM 'source' THEN RAISE EXCEPTION 'managed knowledge source cannot be silently replaced by another upload workflow' USING ERRCODE='23514'; END IF;
 IF kind IN ('source','parsed') THEN
  IF current_setting('new_design.knowledge_write',true) IS DISTINCT FROM 'managed' THEN RAISE EXCEPTION 'managed knowledge versions require the controlled upload or parse workflow' USING ERRCODE='23514'; END IF;
  SELECT * INTO registered FROM asset_content_objects WHERE id=NEW.content_object_id;
  IF registered.storage_kind<>'managed_file' OR registered.storage_provider<>'local' OR registered.integrity_state<>'verified' OR registered.storage_locator !~ '^knowledge-[a-f0-9]{64}\.utf8$' THEN RAISE EXCEPTION 'knowledge version requires verified controlled text content' USING ERRCODE='23514'; END IF;
  IF kind='parsed' THEN
   IF jsonb_typeof(NEW.metadata->'knowledgeReference'->'text') IS DISTINCT FROM 'string' OR length(NEW.metadata->'knowledgeReference'->>'text')=0 OR NEW.source_kind<>'derived' OR registered.checksum<>encode(sha256(convert_to(NEW.metadata->'knowledgeReference'->>'text','UTF8')),'hex') OR NOT EXISTS(SELECT 1 FROM asset_derivations request WHERE request.recipe_key='knowledge.utf8' AND request.tool_key='knowledge.utf8' AND request.status='processing' AND request.output_asset_id=NEW.asset_id AND request.source_asset_version_id=NEW.derived_from_version_id AND request.book_id=NEW.book_id) THEN RAISE EXCEPTION 'knowledge parse output does not match its exact controlled request and content hash' USING ERRCODE='23514'; END IF;
  ELSIF NEW.source_kind<>'upload' THEN RAISE EXCEPTION 'knowledge source must be a controlled upload' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER managed_knowledge_versions_validate BEFORE INSERT ON asset_versions FOR EACH ROW EXECUTE FUNCTION guard_managed_knowledge_version();
CREATE FUNCTION guard_managed_knowledge_derivation() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
BEGIN
 IF NEW.recipe_key='knowledge.utf8' AND current_setting('new_design.knowledge_write',true) IS DISTINCT FROM 'managed' THEN RAISE EXCEPTION 'knowledge parsing requires explicit controlled parsing, not a generic worker result' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER managed_knowledge_derivations_validate BEFORE INSERT OR UPDATE ON asset_derivations FOR EACH ROW EXECUTE FUNCTION guard_managed_knowledge_derivation();

ALTER TABLE context_manifests ADD COLUMN knowledge_request_key text, ADD COLUMN knowledge_input_hash char(64), ADD COLUMN knowledge_receipt jsonb,
 ADD CONSTRAINT context_manifests_knowledge_receipt_check CHECK((knowledge_request_key IS NULL AND knowledge_input_hash IS NULL AND knowledge_receipt IS NULL) OR (knowledge_request_key IS NOT NULL AND knowledge_input_hash IS NOT NULL AND knowledge_receipt IS NOT NULL AND length(knowledge_request_key) BETWEEN 8 AND 160 AND knowledge_input_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(knowledge_receipt)='object'));
CREATE UNIQUE INDEX context_manifests_knowledge_request_unique ON context_manifests(book_id,knowledge_request_key) WHERE knowledge_request_key IS NOT NULL;
-- Replace only enumerated metadata constraints, retaining every prior source value and every row.
ALTER TABLE context_manifest_entries DROP CONSTRAINT context_manifest_entries_source_type_check;
ALTER TABLE context_manifest_entries ADD CONSTRAINT context_manifest_entries_source_type_check CHECK(source_type IN ('card_version','card_relation','body_version','text_anchor','planning_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','research_version','research_pack_version','prompt_component','retrieval_chunk','asset_version'));
ALTER TABLE context_binding_selectors DROP CONSTRAINT context_binding_selectors_source_type_check;
ALTER TABLE context_binding_selectors ADD CONSTRAINT context_binding_selectors_source_type_check CHECK(source_type IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version','prompt_component','retrieval_chunk','asset_version'));
ALTER TABLE context_preview_decisions DROP CONSTRAINT context_preview_decisions_source_type_check;
ALTER TABLE context_preview_decisions ADD CONSTRAINT context_preview_decisions_source_type_check CHECK(source_type IN ('card_version','body_version','canonical_fact','knowledge_state_change','state_change','story_time','story_event_relation','research_document_version','planning_version','research_version','research_pack_version','prompt_component','retrieval_chunk','asset_version'));

CREATE FUNCTION initialize_new_knowledge_resource_state() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE initialized_resource_id uuid;
BEGIN
 IF NEW.metadata->'knowledgeReference'->>'kind' IN ('source','parsed') THEN
  initialized_resource_id:=register_dependency_resource('asset_version',NEW.asset_id,NEW.id);
  INSERT INTO dependency_resource_states(resource_id,book_id,state) VALUES(initialized_resource_id,NEW.book_id,'fresh') ON CONFLICT(resource_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER knowledge_new_version_state AFTER INSERT ON asset_versions FOR EACH ROW EXECUTE FUNCTION initialize_new_knowledge_resource_state();
CREATE FUNCTION initialize_new_complete_context_state() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE initialized_resource_id uuid;
BEGIN
 IF NEW.status='complete' THEN
  initialized_resource_id:=register_dependency_resource('context_manifest',NEW.id,NEW.id);
  INSERT INTO dependency_resource_states(resource_id,book_id,state) VALUES(initialized_resource_id,NEW.book_id,'fresh') ON CONFLICT(resource_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER knowledge_new_complete_context_state AFTER INSERT ON context_manifests FOR EACH ROW EXECUTE FUNCTION initialize_new_complete_context_state();
