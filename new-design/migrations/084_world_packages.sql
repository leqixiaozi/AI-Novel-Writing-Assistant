-- Deliberately not registered in automatic startup. Activate only after backup
-- and restore verification; disabling preserves all packages and original receipts.
SET search_path TO new_design, public;

CREATE TABLE world_package_capability (
 contract text PRIMARY KEY CHECK(contract='public_world_package_v1'),
 operational boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO world_package_capability(contract) VALUES('public_world_package_v1');

CREATE TABLE world_package_versions (
 id uuid PRIMARY KEY,
 root_card_id uuid NOT NULL REFERENCES cards(id),
 root_version_id uuid NOT NULL REFERENCES card_versions(id),
 version integer NOT NULL CHECK(version>0),
 frame jsonb NOT NULL CHECK(jsonb_typeof(frame)='object' AND frame->>'contract'='public_world_package_v1'),
 frame_hash text NOT NULL CHECK(frame_hash ~ '^[a-f0-9]{64}$'),
 request_key uuid NOT NULL UNIQUE,
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(root_card_id,version)
);
CREATE TABLE world_package_card_refs (
 package_id uuid NOT NULL REFERENCES world_package_versions(id),
 source_card_id uuid NOT NULL REFERENCES cards(id),
 source_version_id uuid NOT NULL REFERENCES card_versions(id),
 type_version_id uuid NOT NULL REFERENCES card_type_versions(id),
 form_version_id uuid REFERENCES card_group_form_versions(id),
 section text NOT NULL CHECK(section IN ('profile','rules','factions','forces','locations','relations')),
 PRIMARY KEY(package_id,source_card_id)
);
CREATE TABLE world_package_relation_refs (
 package_id uuid NOT NULL REFERENCES world_package_versions(id),
 source_relation_id uuid NOT NULL REFERENCES card_relations(id),
 source_version_id uuid NOT NULL REFERENCES card_relation_versions(id),
 PRIMARY KEY(package_id,source_relation_id)
);
CREATE TABLE world_package_installations (
 id uuid PRIMARY KEY,
 book_id uuid NOT NULL REFERENCES books(id),
 package_id uuid NOT NULL REFERENCES world_package_versions(id),
 root_card_id uuid NOT NULL REFERENCES cards(id),
 sync_enabled boolean NOT NULL,
 origin text NOT NULL DEFAULT 'import' CHECK(origin IN ('import','published_source')),
 request_key uuid NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(book_id,request_key),
 UNIQUE(book_id,root_card_id)
);
CREATE TABLE world_package_install_card_refs (
 installation_id uuid NOT NULL REFERENCES world_package_installations(id),
 source_card_id uuid NOT NULL REFERENCES cards(id),
 source_version_id uuid NOT NULL REFERENCES card_versions(id),
 target_card_id uuid NOT NULL REFERENCES cards(id),
 target_version_id uuid NOT NULL REFERENCES card_versions(id),
 target_type_version_id uuid NOT NULL REFERENCES card_type_versions(id),
 mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='array'),
 PRIMARY KEY(installation_id,source_card_id),
 UNIQUE(installation_id,target_card_id)
);
CREATE TABLE world_package_install_relation_refs (
 installation_id uuid NOT NULL REFERENCES world_package_installations(id),
 source_relation_id uuid NOT NULL REFERENCES card_relations(id),source_version_id uuid NOT NULL REFERENCES card_relation_versions(id),
 target_relation_id uuid NOT NULL REFERENCES card_relations(id),target_version_id uuid NOT NULL REFERENCES card_relation_versions(id),
 target_type_id uuid NOT NULL REFERENCES relation_types(id),PRIMARY KEY(installation_id,source_relation_id),UNIQUE(installation_id,target_relation_id)
);

CREATE FUNCTION guard_world_package_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
BEGIN RAISE EXCEPTION 'world package history and original receipts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER world_package_versions_immutable BEFORE UPDATE OR DELETE ON world_package_versions FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE TRIGGER world_package_card_refs_immutable BEFORE UPDATE OR DELETE ON world_package_card_refs FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE TRIGGER world_package_relation_refs_immutable BEFORE UPDATE OR DELETE ON world_package_relation_refs FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE TRIGGER world_package_installations_immutable BEFORE UPDATE OR DELETE ON world_package_installations FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE TRIGGER world_package_install_card_refs_immutable BEFORE UPDATE OR DELETE ON world_package_install_card_refs FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();

CREATE FUNCTION guard_world_package_version() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE item jsonb; actual record; root_count integer:=0; relation_item jsonb; local_values jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM world_package_capability WHERE operational) THEN RAISE EXCEPTION 'world package capability is not activated' USING ERRCODE='23514'; END IF;
 IF NOT(NEW.frame ?& ARRAY['contract','rootCardId','rootVersionId','cards','types','relations','forms','dictionaries'])
 OR NOT(NEW.input ?& ARRAY['requestKey','rootCardId','rootVersionId','cards','relationVersionIds','previewHash'])
 OR NOT(NEW.receipt ?& ARRAY['requestKey','inputHash','input','package','repeated'])
 OR NOT(NEW.receipt->'package' ?& ARRAY['id','rootCardId','rootVersionId','version','frame','frameHash','createdAt'])
 OR NEW.receipt->'package'->>'rootCardId' IS DISTINCT FROM NEW.root_card_id::text
 OR NEW.receipt->'package'->>'rootVersionId' IS DISTINCT FROM NEW.root_version_id::text
 OR (NEW.receipt->'package'->>'version')::integer IS DISTINCT FROM NEW.version
 OR NEW.input->>'rootCardId' IS DISTINCT FROM NEW.root_card_id::text OR NEW.input->>'rootVersionId' IS DISTINCT FROM NEW.root_version_id::text
 OR jsonb_typeof(NEW.frame->'types') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.frame->'relations') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.frame->'forms') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.frame->'dictionaries') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'world package complete frame is required' USING ERRCODE='23514'; END IF;
 IF NEW.frame->>'rootCardId'<>NEW.root_card_id::text OR NEW.frame->>'rootVersionId'<>NEW.root_version_id::text
 OR NEW.input->>'requestKey'<>NEW.request_key::text OR NEW.receipt->>'requestKey'<>NEW.request_key::text
 OR NEW.receipt->>'inputHash'<>NEW.input_hash OR NEW.receipt->'input'<>NEW.input
 OR NEW.receipt->'package'->>'id'<>NEW.id::text OR NEW.receipt->'package'->'frame'<>NEW.frame
 OR NEW.receipt->'package'->>'frameHash'<>NEW.frame_hash OR NEW.receipt->'repeated' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'world package original frame and receipt mismatch' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.frame->'cards') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.frame->'cards') NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid world package members' USING ERRCODE='23514'; END IF;
 IF (SELECT count(DISTINCT elem->>'cardId') FROM jsonb_array_elements(NEW.frame->'cards') elem)<>jsonb_array_length(NEW.frame->'cards') THEN RAISE EXCEPTION 'duplicate world package member' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.frame->'cards') LOOP
  IF NOT(item ?& ARRAY['cardId','versionId','section','typeId','typeKey','typeVersionId','title','revision','values','localValues','fields','localFields','formVersionId','formResolutionKind']) THEN RAISE EXCEPTION 'incomplete world member snapshot' USING ERRCODE='23514'; END IF;
  SELECT c.space_id,c.card_type_id,v.*,t.type_key,tv.fields INTO actual FROM cards c JOIN card_versions v ON v.card_id=c.id
   JOIN card_types t ON t.id=c.card_type_id JOIN card_type_versions tv ON tv.id=v.type_version_id AND tv.card_type_id=t.id
   WHERE c.id=(item->>'cardId')::uuid AND v.id=(item->>'versionId')::uuid AND c.status='active' AND t.status='published';
  IF NOT FOUND OR actual.space_id<>'60000000-0000-4000-8000-000000000001'::uuid OR actual.type_key NOT IN ('world_setting','world_overview','world_rule','time_rule','location','faction','organization','prop','power_system','race','culture','religion')
   OR item->>'typeId' IS DISTINCT FROM actual.card_type_id::text OR item->>'typeKey' IS DISTINCT FROM actual.type_key OR item->>'typeVersionId' IS DISTINCT FROM actual.type_version_id::text
   OR item->>'title' IS DISTINCT FROM actual.title OR (item->>'revision')::integer IS DISTINCT FROM actual.revision OR item->'values' IS DISTINCT FROM actual.values OR item->'fields' IS DISTINCT FROM actual.fields
   OR item->>'section' NOT IN ('profile','rules','factions','forces','locations','relations')
   OR item->'formVersionId' IS DISTINCT FROM to_jsonb(actual.form_version_id) AND NOT(item->'formVersionId'='null'::jsonb AND actual.form_version_id IS NULL)
   THEN RAISE EXCEPTION 'world package member is not the exact public version' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_object_agg(d.field_key,l.value),'{}'::jsonb) INTO local_values FROM card_version_local_values l JOIN field_definitions d ON d.id=l.field_definition_id WHERE l.card_version_id=actual.id;
  IF item->'localValues' IS DISTINCT FROM local_values THEN RAISE EXCEPTION 'world package local fields mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.frame->'types') typ JOIN card_types t ON t.id=(typ->>'id')::uuid JOIN card_type_versions v ON v.id=(typ->>'versionId')::uuid AND v.card_type_id=t.id WHERE t.id=actual.card_type_id AND v.id=actual.type_version_id AND typ->'metadata'=to_jsonb(t) AND typ->'version'=to_jsonb(v))
  OR item->'localFields' IS DISTINCT FROM (SELECT coalesce(jsonb_agg(jsonb_build_object('definitionId',d.id,'versionId',fv.id,'field',fv.field_schema) ORDER BY d.field_key),'[]'::jsonb) FROM card_version_local_values l JOIN field_definitions d ON d.id=l.field_definition_id JOIN field_definition_versions fv ON fv.id=l.field_definition_version_id AND fv.field_definition_id=d.id WHERE l.card_version_id=actual.id)
  OR item->>'formResolutionKind' IS DISTINCT FROM actual.form_resolution_kind
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.input->'cards') ref WHERE ref->>'cardId'=item->>'cardId' AND ref->>'versionId'=item->>'versionId' AND ref->>'section'=item->>'section')
  THEN RAISE EXCEPTION 'world member source definitions mismatch' USING ERRCODE='23514'; END IF;
  IF actual.id=NEW.root_version_id AND (item->>'cardId')::uuid=NEW.root_card_id THEN root_count:=root_count+1; END IF;
 END LOOP;
 IF jsonb_array_length(NEW.frame->'cards')<>jsonb_array_length(NEW.input->'cards') OR jsonb_array_length(NEW.frame->'relations')<>jsonb_array_length(NEW.input->'relationVersionIds') THEN RAISE EXCEPTION 'world package input must contain the complete reference set' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.frame->'forms') LOOP
  IF NOT EXISTS(SELECT 1 FROM card_group_form_versions v JOIN card_group_forms f ON f.id=v.form_id WHERE v.id=(item->>'id')::uuid AND v.form_id=(item->>'formId')::uuid AND v.definition=item->'definition' AND (f.space_id IS NULL OR f.space_id='60000000-0000-4000-8000-000000000001'::uuid)) THEN RAISE EXCEPTION 'world package form snapshot mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.frame->'dictionaries') LOOP
  IF NOT EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.id=(item->>'id')::uuid AND to_jsonb(d)=item->'definition' AND (d.owner_space_id IS NULL OR d.owner_space_id='60000000-0000-4000-8000-000000000001'::uuid)) THEN RAISE EXCEPTION 'world package dictionary snapshot mismatch' USING ERRCODE='23514'; END IF;
  FOR relation_item IN SELECT * FROM jsonb_array_elements(item->'nodes') LOOP
   IF NOT EXISTS(SELECT 1 FROM dictionary_item_versions v JOIN dictionary_items n ON n.id=v.item_id WHERE n.dictionary_id=(item->>'id')::uuid AND n.id=(relation_item->>'id')::uuid AND v.id=(relation_item->>'versionId')::uuid AND to_jsonb(v)=relation_item->'snapshot') THEN RAISE EXCEPTION 'world package dictionary node snapshot mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
 END LOOP;
 IF root_count<>1 THEN RAISE EXCEPTION 'world package root is not a member' USING ERRCODE='23514'; END IF;
 FOR relation_item IN SELECT * FROM jsonb_array_elements(NEW.frame->'relations') LOOP
  IF NOT(relation_item ?& ARRAY['relationId','versionId','sourceCardId','targetCardId','sourceVersionId','targetVersionId','revision','properties','type']) OR NOT(NEW.input->'relationVersionIds' ? (relation_item->>'versionId')) THEN RAISE EXCEPTION 'world package relation original input mismatch' USING ERRCODE='23514'; END IF;
  SELECT r.*,v.id version_id,v.source_card_version_id,v.target_card_version_id,v.properties version_properties,v.revision version_revision INTO actual FROM card_relations r JOIN card_relation_versions v ON v.card_relation_id=r.id WHERE r.id=(relation_item->>'relationId')::uuid AND v.id=(relation_item->>'versionId')::uuid AND v.status='active';
  IF NOT FOUND OR actual.space_id<>'60000000-0000-4000-8000-000000000001'::uuid OR relation_item->>'sourceCardId'<>actual.source_card_id::text OR relation_item->>'targetCardId'<>actual.target_card_id::text
   OR relation_item->>'sourceVersionId'<>actual.source_card_version_id::text OR relation_item->>'targetVersionId'<>actual.target_card_version_id::text OR relation_item->'properties'<>actual.version_properties OR (relation_item->>'revision')::integer<>actual.version_revision
   OR relation_item->'type' IS DISTINCT FROM (SELECT to_jsonb(t) FROM relation_types t WHERE t.id=actual.relation_type_id AND t.status='published')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.frame->'cards') c WHERE c->>'cardId'=actual.source_card_id::text AND c->>'versionId'=actual.source_card_version_id::text)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.frame->'cards') c WHERE c->>'cardId'=actual.target_card_id::text AND c->>'versionId'=actual.target_card_version_id::text)
   THEN RAISE EXCEPTION 'world package relation endpoints do not match the frozen set' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER world_package_version_guard BEFORE INSERT ON world_package_versions FOR EACH ROW EXECUTE FUNCTION guard_world_package_version();

CREATE FUNCTION guard_world_package_refs() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE frame jsonb; item jsonb; install record; public_package uuid;
BEGIN
 IF TG_TABLE_NAME='world_package_card_refs' THEN
  SELECT v.frame INTO frame FROM world_package_versions v WHERE v.id=NEW.package_id;
  SELECT c INTO item FROM jsonb_array_elements(frame->'cards') c WHERE c->>'cardId'=NEW.source_card_id::text;
  IF item IS NULL OR item->>'versionId'<>NEW.source_version_id::text OR item->>'typeVersionId'<>NEW.type_version_id::text OR item->>'section'<>NEW.section OR coalesce(item->>'formVersionId','')<>coalesce(NEW.form_version_id::text,'') THEN RAISE EXCEPTION 'world package card reference mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='world_package_relation_refs' THEN
  SELECT v.frame INTO frame FROM world_package_versions v WHERE v.id=NEW.package_id;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(frame->'relations') r WHERE r->>'relationId'=NEW.source_relation_id::text AND r->>'versionId'=NEW.source_version_id::text) THEN RAISE EXCEPTION 'world package relation reference mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT i.*,b.space_id INTO install FROM world_package_installations i JOIN books b ON b.id=i.book_id WHERE i.id=NEW.installation_id;
  SELECT c INTO item FROM jsonb_array_elements(install.receipt->'cards') c WHERE c->>'sourceCardId'=NEW.source_card_id::text;
  IF item IS NULL OR item->>'sourceVersionId'<>NEW.source_version_id::text OR item->>'targetCardId'<>NEW.target_card_id::text OR item->>'targetVersionId'<>NEW.target_version_id::text OR item->>'targetTypeVersionId'<>NEW.target_type_version_id::text OR item->'mapping'<>NEW.mapping
   OR NOT EXISTS(SELECT 1 FROM world_package_card_refs r WHERE r.package_id=install.package_id AND r.source_card_id=NEW.source_card_id AND r.source_version_id=NEW.source_version_id)
   OR NOT EXISTS(SELECT 1 FROM cards c JOIN card_versions v ON v.card_id=c.id WHERE c.id=NEW.target_card_id AND c.space_id=install.space_id AND v.id=NEW.target_version_id AND v.type_version_id=NEW.target_type_version_id)
   THEN RAISE EXCEPTION 'world installation must use independent normal book versions' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_package_card_ref_guard BEFORE INSERT ON world_package_card_refs FOR EACH ROW EXECUTE FUNCTION guard_world_package_refs();
CREATE TRIGGER world_package_relation_ref_guard BEFORE INSERT ON world_package_relation_refs FOR EACH ROW EXECUTE FUNCTION guard_world_package_refs();
CREATE TRIGGER world_package_install_card_ref_guard BEFORE INSERT ON world_package_install_card_refs FOR EACH ROW EXECUTE FUNCTION guard_world_package_refs();

CREATE FUNCTION guard_world_package_installation() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE root_source uuid; actual_count integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM world_package_capability WHERE operational) THEN RAISE EXCEPTION 'world package capability is not activated' USING ERRCODE='23514'; END IF;
 IF NEW.origin='published_source' THEN
  IF NEW.receipt->>'origin' IS DISTINCT FROM NEW.origin OR NEW.receipt->>'bookId' IS DISTINCT FROM NEW.book_id::text
  OR NEW.receipt->>'installationId' IS DISTINCT FROM NEW.id::text OR NEW.receipt->>'requestKey' IS DISTINCT FROM NEW.request_key::text
  OR NEW.receipt->>'inputHash' IS DISTINCT FROM NEW.input_hash OR NEW.receipt->'input' IS DISTINCT FROM NEW.input
  OR NEW.input->>'requestKey' IS DISTINCT FROM NEW.request_key::text OR NEW.receipt->>'packageId' IS DISTINCT FROM NEW.package_id::text
  OR NOT EXISTS(SELECT 1 FROM world_library_candidates candidate JOIN world_package_versions package ON package.id=NEW.package_id
   WHERE candidate.id=(NEW.input->>'candidateId')::uuid AND candidate.book_id=NEW.book_id AND package.request_key=(NEW.input->>'publicRequestKey')::uuid
   AND candidate.snapshot->'input'->>'rootCardId'=NEW.root_card_id::text AND jsonb_array_length(candidate.snapshot->'preview'->'sourceFrame'->'cards')=jsonb_array_length(NEW.receipt->'cards'))
  THEN RAISE EXCEPTION 'published world source original mapping mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT(NEW.receipt ?& ARRAY['bookId','installationId','requestKey','inputHash','input','packageId','cards','relations','sourceRoute','repeated'])
 OR NOT(NEW.input ?& ARRAY['input','previewHash']) OR NOT(NEW.input->'input' ?& ARRAY['requestKey','packageId','cards','relations','syncEnabled'])
 OR jsonb_typeof(NEW.receipt->'cards') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'world installation complete original request is required' USING ERRCODE='23514'; END IF;
 SELECT p.root_card_id,jsonb_array_length(p.frame->'cards') INTO root_source,actual_count FROM world_package_versions p WHERE p.id=NEW.package_id;
 IF NOT EXISTS(SELECT 1 FROM books b JOIN cards c ON c.space_id=b.space_id WHERE b.id=NEW.book_id AND b.status='active' AND c.id=NEW.root_card_id AND c.status='active')
 OR NEW.receipt->>'bookId'<>NEW.book_id::text OR NEW.receipt->>'installationId'<>NEW.id::text OR NEW.receipt->>'packageId'<>NEW.package_id::text
 OR NEW.receipt->>'requestKey'<>NEW.request_key::text OR NEW.receipt->>'inputHash'<>NEW.input_hash OR NEW.receipt->'input'<>NEW.input
 OR NEW.input->'input'->>'packageId'<>NEW.package_id::text OR NEW.input->'input'->>'requestKey'<>NEW.request_key::text OR (NEW.input->'input'->>'syncEnabled')::boolean<>NEW.sync_enabled
 OR jsonb_array_length(NEW.receipt->'cards')<>actual_count
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.receipt->'cards') c WHERE c->>'sourceCardId'=root_source::text AND c->>'targetCardId'=NEW.root_card_id::text)
 THEN RAISE EXCEPTION 'world installation original frame mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_package_installation_guard BEFORE INSERT ON world_package_installations FOR EACH ROW EXECUTE FUNCTION guard_world_package_installation();

-- Existing canonical history becomes protected when referenced by a public package.
CREATE FUNCTION guard_world_package_source_history() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE used boolean;
BEGIN
 IF TG_TABLE_NAME='card_versions' THEN SELECT EXISTS(SELECT 1 FROM world_package_card_refs WHERE source_version_id=OLD.id) OR EXISTS(SELECT 1 FROM world_package_install_card_refs WHERE target_version_id=OLD.id) OR EXISTS(SELECT 1 FROM world_package_added_card_refs WHERE snapshot->>'targetVersionId'=OLD.id::text) OR EXISTS(SELECT 1 FROM world_package_field_baselines WHERE local_version_id=OLD.id OR public_version_id=OLD.id) INTO used;
 ELSIF TG_TABLE_NAME='card_type_versions' THEN SELECT EXISTS(SELECT 1 FROM world_package_card_refs WHERE type_version_id=OLD.id) OR EXISTS(SELECT 1 FROM world_package_install_card_refs WHERE target_type_version_id=OLD.id) OR EXISTS(SELECT 1 FROM world_package_added_card_refs WHERE snapshot->>'targetTypeVersionId'=OLD.id::text) INTO used;
 ELSIF TG_TABLE_NAME='card_group_form_versions' THEN SELECT EXISTS(SELECT 1 FROM world_package_card_refs WHERE form_version_id=OLD.id) INTO used;
 ELSE SELECT EXISTS(SELECT 1 FROM world_package_versions p,jsonb_array_elements(p.frame->'dictionaries') d,jsonb_array_elements(d->'nodes') n WHERE n->>'versionId'=OLD.id::text) INTO used;
 END IF;
 IF used THEN RAISE EXCEPTION 'frozen world source history cannot change' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER world_package_card_history_guard BEFORE UPDATE OR DELETE ON card_versions FOR EACH ROW EXECUTE FUNCTION guard_world_package_source_history();
CREATE TRIGGER world_package_type_history_guard BEFORE UPDATE OR DELETE ON card_type_versions FOR EACH ROW EXECUTE FUNCTION guard_world_package_source_history();
CREATE TRIGGER world_package_form_history_guard BEFORE UPDATE OR DELETE ON card_group_form_versions FOR EACH ROW EXECUTE FUNCTION guard_world_package_source_history();
CREATE TRIGGER world_package_dictionary_history_guard BEFORE UPDATE OR DELETE ON dictionary_item_versions FOR EACH ROW EXECUTE FUNCTION guard_world_package_source_history();

CREATE FUNCTION check_world_package_complete_refs() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
BEGIN
 IF TG_TABLE_NAME='world_package_versions' THEN
  IF (SELECT count(*) FROM world_package_card_refs WHERE package_id=NEW.id)<>jsonb_array_length(NEW.frame->'cards') OR (SELECT count(*) FROM world_package_relation_refs WHERE package_id=NEW.id)<>jsonb_array_length(NEW.frame->'relations') THEN RAISE EXCEPTION 'incomplete frozen world reference set' USING ERRCODE='23514'; END IF;
 ELSE
  IF (SELECT count(*) FROM world_package_install_card_refs WHERE installation_id=NEW.id)<>jsonb_array_length(NEW.receipt->'cards') OR (SELECT count(*) FROM world_package_install_relation_refs WHERE installation_id=NEW.id)<>jsonb_array_length(NEW.receipt->'relations') THEN RAISE EXCEPTION 'incomplete world installation mapping' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER world_package_complete_refs AFTER INSERT ON world_package_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_world_package_complete_refs();
CREATE CONSTRAINT TRIGGER world_install_complete_refs AFTER INSERT ON world_package_installations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_world_package_complete_refs();

CREATE TABLE world_package_sync_commands (
 id uuid PRIMARY KEY, book_id uuid NOT NULL REFERENCES books(id), installation_id uuid NOT NULL REFERENCES world_package_installations(id),
 request_key uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('pull','push','publish','toggle')),
 sequence integer NOT NULL CHECK(sequence>0), input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'), receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(book_id,request_key), UNIQUE(installation_id,sequence)
);
CREATE TABLE world_package_push_candidates (
 id uuid PRIMARY KEY, command_id uuid NOT NULL UNIQUE REFERENCES world_package_sync_commands(id),
 book_id uuid NOT NULL REFERENCES books(id), installation_id uuid NOT NULL REFERENCES world_package_installations(id),
 package_id uuid NOT NULL REFERENCES world_package_versions(id), snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE world_package_field_baselines (
 command_id uuid NOT NULL REFERENCES world_package_sync_commands(id), installation_id uuid NOT NULL REFERENCES world_package_installations(id),
 source_card_id uuid NOT NULL REFERENCES cards(id), source_key text NOT NULL, target_key text NOT NULL,
 public_version_id uuid NOT NULL REFERENCES card_versions(id), local_version_id uuid NOT NULL REFERENCES card_versions(id),
 public_value jsonb NOT NULL CHECK(jsonb_typeof(public_value)='object'), local_value jsonb NOT NULL CHECK(jsonb_typeof(local_value)='object'),
 PRIMARY KEY(command_id,source_card_id,source_key)
);
CREATE TABLE world_package_added_card_refs (
 installation_id uuid NOT NULL REFERENCES world_package_installations(id),command_id uuid NOT NULL REFERENCES world_package_sync_commands(id),
 package_id uuid NOT NULL REFERENCES world_package_versions(id),source_card_id uuid NOT NULL REFERENCES cards(id),target_card_id uuid NOT NULL REFERENCES cards(id),
 snapshot jsonb NOT NULL,PRIMARY KEY(installation_id,source_card_id),UNIQUE(installation_id,target_card_id)
);
CREATE TABLE world_package_relation_baselines (
 command_id uuid NOT NULL REFERENCES world_package_sync_commands(id),installation_id uuid NOT NULL REFERENCES world_package_installations(id),
 source_relation_id uuid NOT NULL REFERENCES card_relations(id),target_relation_id uuid NOT NULL REFERENCES card_relations(id),target_type_id uuid NOT NULL REFERENCES relation_types(id),
 public_version_id uuid REFERENCES card_relation_versions(id),local_version_id uuid NOT NULL REFERENCES card_relation_versions(id),
 public_value jsonb NOT NULL,local_value jsonb NOT NULL,PRIMARY KEY(command_id,source_relation_id)
);
CREATE TRIGGER world_package_added_card_refs_immutable BEFORE UPDATE OR DELETE ON world_package_added_card_refs FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE TRIGGER world_package_relation_baselines_immutable BEFORE UPDATE OR DELETE ON world_package_relation_baselines FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE FUNCTION guard_world_package_sync_command() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM world_package_capability WHERE operational) OR NOT EXISTS(SELECT 1 FROM world_package_installations i JOIN books b ON b.id=i.book_id WHERE i.id=NEW.installation_id AND i.book_id=NEW.book_id AND b.status='active')
 OR NOT(NEW.input ?& ARRAY['requestKey','installationId','packageId','operation','choices','cardRequestKeys','candidateId','publicRequestKey','syncEnabled','previewHash'])
 OR NEW.input->>'requestKey' IS DISTINCT FROM NEW.request_key::text OR NEW.input->>'installationId' IS DISTINCT FROM NEW.installation_id::text OR NEW.input->>'operation' IS DISTINCT FROM NEW.operation
 OR NEW.receipt->>'id' IS DISTINCT FROM NEW.id::text OR NEW.receipt->>'bookId' IS DISTINCT FROM NEW.book_id::text OR NEW.receipt->>'installationId' IS DISTINCT FROM NEW.installation_id::text OR NEW.receipt->>'requestKey' IS DISTINCT FROM NEW.request_key::text
 OR NEW.receipt->>'operation' IS DISTINCT FROM NEW.operation OR NEW.receipt->>'inputHash' IS DISTINCT FROM NEW.input_hash OR NEW.receipt->'input' IS DISTINCT FROM NEW.input OR (NEW.receipt->>'sequence')::integer IS DISTINCT FROM NEW.sequence
 THEN RAISE EXCEPTION 'world sync complete original command mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_package_sync_command_guard BEFORE INSERT ON world_package_sync_commands FOR EACH ROW EXECUTE FUNCTION guard_world_package_sync_command();
CREATE TRIGGER world_package_sync_commands_immutable BEFORE UPDATE OR DELETE ON world_package_sync_commands FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE TRIGGER world_package_push_candidates_immutable BEFORE UPDATE OR DELETE ON world_package_push_candidates FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE TRIGGER world_package_field_baselines_immutable BEFORE UPDATE OR DELETE ON world_package_field_baselines FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();

CREATE FUNCTION guard_world_install_relation_ref() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM world_package_installations i JOIN books b ON b.id=i.book_id JOIN world_package_relation_refs source ON source.package_id=i.package_id
 JOIN card_relations r ON r.id=NEW.target_relation_id AND r.space_id=b.space_id AND r.relation_type_id=NEW.target_type_id
 JOIN card_relation_versions v ON v.id=NEW.target_version_id AND v.card_relation_id=r.id
 JOIN world_package_install_card_refs first_card ON first_card.installation_id=i.id AND first_card.target_card_id=r.source_card_id AND first_card.target_version_id=v.source_card_version_id
 JOIN world_package_install_card_refs second_card ON second_card.installation_id=i.id AND second_card.target_card_id=r.target_card_id AND second_card.target_version_id=v.target_card_version_id
 WHERE i.id=NEW.installation_id AND source.source_relation_id=NEW.source_relation_id AND source.source_version_id=NEW.source_version_id
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.receipt->'relations') AS choice(item) WHERE choice.item->>'sourceRelationId'=NEW.source_relation_id::text AND choice.item->>'sourceVersionId'=NEW.source_version_id::text AND choice.item->>'targetRelationId'=r.id::text AND choice.item->>'targetVersionId'=v.id::text AND choice.item->>'targetTypeId'=NEW.target_type_id::text))
 THEN RAISE EXCEPTION 'independent world relation mapping mismatch' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER world_package_install_relation_ref_guard BEFORE INSERT ON world_package_install_relation_refs FOR EACH ROW EXECUTE FUNCTION guard_world_install_relation_ref();
CREATE TRIGGER world_package_install_relation_refs_immutable BEFORE UPDATE OR DELETE ON world_package_install_relation_refs FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();

CREATE FUNCTION guard_world_sync_child() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE command world_package_sync_commands;
BEGIN
 SELECT * INTO command FROM world_package_sync_commands WHERE id=NEW.command_id;
 IF TG_TABLE_NAME='world_package_push_candidates' THEN
  IF command.operation IS DISTINCT FROM 'push' OR NEW.book_id IS DISTINCT FROM command.book_id OR NEW.installation_id IS DISTINCT FROM command.installation_id
  OR NEW.package_id::text IS DISTINCT FROM command.input->>'packageId' OR NEW.snapshot->'input' IS DISTINCT FROM command.input
  OR NEW.snapshot->>'id' IS DISTINCT FROM NEW.id::text OR command.receipt->>'candidateId' IS DISTINCT FROM NEW.id::text
  THEN RAISE EXCEPTION 'world push candidate original command mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF command.operation IS DISTINCT FROM 'pull' OR command.installation_id IS DISTINCT FROM NEW.installation_id
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(command.input->'choices') choice WHERE choice->>'sourceCardId'=NEW.source_card_id::text AND choice->>'sourceKey'=NEW.source_key AND choice->>'targetKey'=NEW.target_key)
  OR NOT EXISTS(SELECT 1 FROM world_package_install_card_refs mapping JOIN card_versions public_version ON public_version.id=NEW.public_version_id AND public_version.card_id=mapping.source_card_id JOIN card_versions local_version ON local_version.id=NEW.local_version_id AND local_version.card_id=mapping.target_card_id WHERE mapping.installation_id=NEW.installation_id AND mapping.source_card_id=NEW.source_card_id)
  THEN RAISE EXCEPTION 'world field baseline original command mismatch' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER world_package_candidate_guard BEFORE INSERT ON world_package_push_candidates FOR EACH ROW EXECUTE FUNCTION guard_world_sync_child();
CREATE TRIGGER world_package_baseline_guard BEFORE INSERT ON world_package_field_baselines FOR EACH ROW EXECUTE FUNCTION guard_world_sync_child();

CREATE TABLE world_library_commands (
 id uuid PRIMARY KEY,book_id uuid NOT NULL REFERENCES books(id),request_key uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('prepare','publish')),input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(book_id,request_key)
);
CREATE TABLE world_library_candidates (
 id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE REFERENCES world_library_commands(id),book_id uuid NOT NULL REFERENCES books(id),
 snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_world_library_command() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM world_package_capability WHERE operational) OR NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND status='active')
 OR NEW.input->>'requestKey' IS DISTINCT FROM NEW.request_key::text OR NEW.receipt->>'id' IS DISTINCT FROM NEW.id::text
 OR NEW.receipt->>'bookId' IS DISTINCT FROM NEW.book_id::text OR NEW.receipt->>'requestKey' IS DISTINCT FROM NEW.request_key::text
 OR NEW.receipt->>'operation' IS DISTINCT FROM NEW.operation OR NEW.receipt->>'inputHash' IS DISTINCT FROM NEW.input_hash
 OR NEW.receipt->'input' IS DISTINCT FROM NEW.input
 THEN RAISE EXCEPTION 'world library original command mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.operation='publish' AND NOT EXISTS(SELECT 1 FROM world_library_candidates candidate JOIN world_package_versions package ON package.id=(NEW.receipt->'package'->>'id')::uuid WHERE candidate.id=(NEW.input->>'candidateId')::uuid AND candidate.book_id=NEW.book_id AND package.request_key=(NEW.input->>'publicRequestKey')::uuid AND package.receipt->'package'=NEW.receipt->'package')
 THEN RAISE EXCEPTION 'world library public result mismatch' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE FUNCTION guard_world_library_candidate() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM world_library_commands command WHERE command.id=NEW.command_id AND command.book_id=NEW.book_id AND command.operation='prepare' AND command.receipt->'candidate'=NEW.snapshot AND command.input=NEW.snapshot->'input' AND NEW.snapshot->>'id'=NEW.id::text)
 THEN RAISE EXCEPTION 'world library candidate original command mismatch' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER world_package_library_command_guard BEFORE INSERT ON world_library_commands FOR EACH ROW EXECUTE FUNCTION guard_world_library_command();
CREATE TRIGGER world_package_library_candidate_guard BEFORE INSERT ON world_library_candidates FOR EACH ROW EXECUTE FUNCTION guard_world_library_candidate();
CREATE TRIGGER world_package_library_commands_immutable BEFORE UPDATE OR DELETE ON world_library_commands FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();
CREATE TRIGGER world_package_library_candidates_immutable BEFORE UPDATE OR DELETE ON world_library_candidates FOR EACH ROW EXECUTE FUNCTION guard_world_package_immutable();

-- Public world archive relations have no book. The original dependency edge
-- ledger deliberately requires a book, so only book relations use that ledger.
-- Frozen public package refs protect archive history; book relation behavior is
-- preserved verbatim, including both endpoint dependencies.
CREATE OR REPLACE FUNCTION register_relation_dependencies() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE relation_row card_relations%ROWTYPE;
BEGIN
 SELECT * INTO relation_row FROM card_relations WHERE id=NEW.card_relation_id;
 IF relation_row.space_id='60000000-0000-4000-8000-000000000001'::uuid THEN
  IF NOT EXISTS(SELECT 1 FROM world_package_capability WHERE operational) THEN RAISE EXCEPTION 'public world relation capability is not activated' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 PERFORM add_registered_dependency('card_version',relation_row.source_card_id,NEW.source_card_version_id,'card_relation',NEW.card_relation_id,NEW.id,'context_included','soft','manual',NEW.id);
 PERFORM add_registered_dependency('card_version',relation_row.target_card_id,NEW.target_card_version_id,'card_relation',NEW.card_relation_id,NEW.id,'context_included','soft','manual',NEW.id);
 RETURN NEW;
END $$;

-- Sync metadata must prove a selected normal save, not merely contain ids.
CREATE FUNCTION world_sync_selected_input(command world_package_sync_commands) RETURNS jsonb LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE selected jsonb;
BEGIN
 IF command.operation='publish' THEN
  SELECT candidate.snapshot->'input' INTO selected FROM world_package_push_candidates candidate
   JOIN world_package_versions package ON package.id=(command.receipt->>'publishedPackageId')::uuid
   WHERE candidate.id=(command.input->>'candidateId')::uuid AND candidate.installation_id=command.installation_id AND candidate.book_id=command.book_id
    AND package.request_key=(command.input->>'publicRequestKey')::uuid;
 ELSE selected:=command.input; END IF;
 RETURN selected;
END $$;

CREATE OR REPLACE FUNCTION guard_world_sync_child() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE command world_package_sync_commands; selected jsonb; package_frame jsonb; source jsonb; actual_values jsonb; public_values jsonb;
BEGIN
 SELECT * INTO command FROM world_package_sync_commands WHERE id=NEW.command_id;
 IF TG_TABLE_NAME='world_package_push_candidates' THEN
  IF command.operation IS DISTINCT FROM 'push' OR NEW.book_id IS DISTINCT FROM command.book_id OR NEW.installation_id IS DISTINCT FROM command.installation_id
  OR NEW.package_id::text IS DISTINCT FROM command.input->>'packageId' OR NEW.snapshot->'input' IS DISTINCT FROM command.input
  OR NEW.snapshot->>'id' IS DISTINCT FROM NEW.id::text OR command.receipt->>'candidateId' IS DISTINCT FROM NEW.id::text
  THEN RAISE EXCEPTION 'world push candidate original command mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 selected:=world_sync_selected_input(command);
 IF command.operation NOT IN ('pull','publish') OR selected IS NULL OR command.installation_id IS DISTINCT FROM NEW.installation_id
 OR NOT (EXISTS(SELECT 1 FROM jsonb_array_elements(selected->'choices') choice WHERE choice->>'sourceCardId'=NEW.source_card_id::text AND choice->>'sourceKey'=NEW.source_key AND choice->>'targetKey'=NEW.target_key)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(selected->'newCards','[]'::jsonb)) card,jsonb_array_elements(card->'mapping') mapping WHERE card->>'sourceCardId'=NEW.source_card_id::text AND mapping->>'sourceKey'=NEW.source_key AND mapping->>'targetKey'=NEW.target_key))
 OR NOT EXISTS(SELECT 1 FROM (SELECT source_card_id,target_card_id FROM world_package_install_card_refs WHERE installation_id=NEW.installation_id UNION ALL SELECT source_card_id,target_card_id FROM world_package_added_card_refs WHERE installation_id=NEW.installation_id) mapping
  JOIN card_versions public_version ON public_version.id=NEW.public_version_id AND public_version.card_id=mapping.source_card_id JOIN card_versions local_version ON local_version.id=NEW.local_version_id AND local_version.card_id=mapping.target_card_id
  WHERE mapping.source_card_id=NEW.source_card_id)
 THEN RAISE EXCEPTION 'world field baseline original command mismatch' USING ERRCODE='23514'; END IF;
 SELECT frame INTO package_frame FROM world_package_versions WHERE id=CASE WHEN command.operation='publish' THEN (command.receipt->>'publishedPackageId')::uuid ELSE (selected->>'packageId')::uuid END;
 SELECT card INTO source FROM jsonb_array_elements(package_frame->'cards') card WHERE card->>'cardId'=NEW.source_card_id::text;
 IF source IS NOT NULL AND source->>'versionId' IS DISTINCT FROM NEW.public_version_id::text THEN RAISE EXCEPTION 'baseline must refer to selected public version' USING ERRCODE='23514'; END IF;
 public_values:=coalesce(source->'values','{}'::jsonb)||coalesce(source->'localValues','{}'::jsonb);
 SELECT version.values||coalesce((SELECT jsonb_object_agg(definition.field_key,local.value) FROM card_version_local_values local JOIN field_definitions definition ON definition.id=local.field_definition_id WHERE local.card_version_id=version.id),'{}'::jsonb) INTO actual_values FROM card_versions version WHERE version.id=NEW.local_version_id;
 IF NEW.public_value IS DISTINCT FROM (CASE WHEN public_values ? NEW.source_key THEN jsonb_build_object('present',true,'value',public_values->NEW.source_key) ELSE jsonb_build_object('present',false) END)
 OR NEW.local_value IS DISTINCT FROM (CASE WHEN actual_values ? NEW.target_key THEN jsonb_build_object('present',true,'value',actual_values->NEW.target_key) ELSE jsonb_build_object('present',false) END)
 THEN RAISE EXCEPTION 'baseline must contain actual acknowledged values' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_world_added_card_ref() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE command world_package_sync_commands;
BEGIN
 SELECT * INTO command FROM world_package_sync_commands WHERE id=NEW.command_id;
 IF command.operation IS DISTINCT FROM 'pull' OR command.installation_id IS DISTINCT FROM NEW.installation_id OR command.input->>'packageId' IS DISTINCT FROM NEW.package_id::text
 OR EXISTS(SELECT 1 FROM world_package_install_card_refs WHERE installation_id=NEW.installation_id AND (source_card_id=NEW.source_card_id OR target_card_id=NEW.target_card_id))
 OR NOT EXISTS(SELECT 1 FROM world_package_card_refs source JOIN books book ON book.id=command.book_id JOIN cards target ON target.id=NEW.target_card_id AND target.space_id=book.space_id
  JOIN card_versions version ON version.card_id=target.id AND version.id=(NEW.snapshot->>'targetVersionId')::uuid
  JOIN jsonb_array_elements(command.input->'newCards') AS selected(item) ON selected.item->>'sourceCardId'=NEW.source_card_id::text
  WHERE source.package_id=NEW.package_id AND source.source_card_id=NEW.source_card_id AND source.source_version_id::text=NEW.snapshot->>'sourceVersionId'
   AND version.author_book_id=command.book_id AND version.author_request_key=(selected.item->>'requestKey')::uuid AND target.card_type_id=(selected.item->>'targetTypeId')::uuid
   AND NEW.snapshot->>'sourceCardId'=NEW.source_card_id::text AND NEW.snapshot->>'targetCardId'=NEW.target_card_id::text AND NEW.snapshot->>'targetTypeVersionId'=version.type_version_id::text
   AND NEW.snapshot->'mapping'=selected.item->'mapping' AND EXISTS(SELECT 1 FROM jsonb_array_elements(command.receipt->'addedCards') AS receipt(item) WHERE receipt.item=NEW.snapshot))
 THEN RAISE EXCEPTION 'added world object must prove selected independent normal save' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_package_added_card_ref_guard BEFORE INSERT ON world_package_added_card_refs FOR EACH ROW EXECUTE FUNCTION guard_world_added_card_ref();

CREATE FUNCTION guard_world_relation_baseline() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE command world_package_sync_commands; selected jsonb; source jsonb; actual record; source_id uuid; target_id uuid; package_frame jsonb;
BEGIN
 SELECT * INTO command FROM world_package_sync_commands WHERE id=NEW.command_id;selected:=world_sync_selected_input(command);
 IF command.operation NOT IN ('pull','publish') OR selected IS NULL OR command.installation_id IS DISTINCT FROM NEW.installation_id
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selected->'relationChoices') choice WHERE choice->>'sourceRelationId'=NEW.source_relation_id::text)
 THEN RAISE EXCEPTION 'relation baseline original selection mismatch' USING ERRCODE='23514'; END IF;
 SELECT relation.*,version.properties version_properties,version.status version_status INTO actual FROM card_relations relation JOIN books book ON book.space_id=relation.space_id AND book.id=command.book_id
  JOIN card_relation_versions version ON version.card_relation_id=relation.id AND version.id=NEW.local_version_id WHERE relation.id=NEW.target_relation_id AND relation.relation_type_id=NEW.target_type_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'relation baseline requires canonical book relation version' USING ERRCODE='23514'; END IF;
 SELECT source_card_id INTO source_id FROM (SELECT source_card_id,target_card_id FROM world_package_install_card_refs WHERE installation_id=NEW.installation_id UNION ALL SELECT source_card_id,target_card_id FROM world_package_added_card_refs WHERE installation_id=NEW.installation_id) mapping WHERE mapping.target_card_id=actual.source_card_id;
 SELECT source_card_id INTO target_id FROM (SELECT source_card_id,target_card_id FROM world_package_install_card_refs WHERE installation_id=NEW.installation_id UNION ALL SELECT source_card_id,target_card_id FROM world_package_added_card_refs WHERE installation_id=NEW.installation_id) mapping WHERE mapping.target_card_id=actual.target_card_id;
 SELECT frame INTO package_frame FROM world_package_versions WHERE id=CASE WHEN command.operation='publish' THEN (command.receipt->>'publishedPackageId')::uuid ELSE (selected->>'packageId')::uuid END;
 SELECT relation INTO source FROM jsonb_array_elements(package_frame->'relations') relation WHERE relation->>'relationId'=NEW.source_relation_id::text;
 IF NEW.public_version_id::text IS DISTINCT FROM source->>'versionId'
 OR NEW.public_value IS DISTINCT FROM (CASE WHEN source IS NULL THEN jsonb_build_object('present',false) ELSE jsonb_build_object('present',true,'value',jsonb_build_object('sourceCardId',source->>'sourceCardId','targetCardId',source->>'targetCardId','properties',source->'properties','status','active')) END)
 OR NEW.local_value IS DISTINCT FROM jsonb_build_object('present',true,'value',jsonb_build_object('sourceCardId',source_id,'targetCardId',target_id,'properties',actual.version_properties,'status',actual.version_status))
 THEN RAISE EXCEPTION 'relation baseline must contain actual acknowledged versions and values' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_package_relation_baseline_guard BEFORE INSERT ON world_package_relation_baselines FOR EACH ROW EXECUTE FUNCTION guard_world_relation_baseline();

CREATE FUNCTION check_world_sync_complete_children() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design, public AS $$
DECLARE selected jsonb; fields integer; relations integer;
BEGIN
 selected:=world_sync_selected_input(NEW);
 IF NEW.operation='push' THEN
  IF (SELECT count(*) FROM world_package_push_candidates WHERE command_id=NEW.id)<>1 THEN RAISE EXCEPTION 'world push requires original candidate' USING ERRCODE='23514'; END IF;
 ELSIF NEW.operation IN ('pull','publish') THEN
  fields:=jsonb_array_length(selected->'choices')+coalesce((SELECT sum(jsonb_array_length(card->'mapping')) FROM jsonb_array_elements(coalesce(selected->'newCards','[]'::jsonb)) card),0);
  relations:=jsonb_array_length(coalesce(selected->'relationChoices','[]'::jsonb));
  IF selected IS NULL OR (SELECT count(*) FROM world_package_field_baselines WHERE command_id=NEW.id)<>fields
   OR (SELECT count(*) FROM world_package_relation_baselines WHERE command_id=NEW.id)<>relations
   OR (NEW.operation='pull' AND (SELECT count(*) FROM world_package_added_card_refs WHERE command_id=NEW.id)<>jsonb_array_length(coalesce(selected->'newCards','[]'::jsonb)))
  THEN RAISE EXCEPTION 'world sync requires complete selected mappings and baselines' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER world_package_sync_complete_children AFTER INSERT ON world_package_sync_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_world_sync_complete_children();
