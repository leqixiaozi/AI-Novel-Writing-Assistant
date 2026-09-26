-- 结构目录、字段规格和树作用域的最终卡片实现；不访问旧视图。
SET LOCAL search_path TO new_design,public;

CREATE OR REPLACE FUNCTION new_design.scoped_field_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT (substr(md5(seed),1,8)||'-'||substr(md5(seed),9,4)||'-4'||substr(md5(seed),14,3)||'-8'||substr(md5(seed),18,3)||'-'||substr(md5(seed),21,12))::uuid
$$;

-- 标量子查询在逻辑身份不唯一时失败，不任取一条记录。
CREATE FUNCTION new_design.structure_record(kind text,logical_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO new_design,public AS $$
 SELECT (SELECT version.values FROM cards card JOIN card_types type ON type.id=card.card_type_id
  JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
  WHERE type.is_internal AND type.type_key=kind AND card.status='active' AND version.values->>'id'=logical_id::text)
$$;

CREATE OR REPLACE FUNCTION new_design.sync_type_version_fields(target_version_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE version_row record; type_row record; source_template uuid; source_form uuid;
 item jsonb; option_item jsonb; definition_id uuid; definition_version_id uuid; option_id uuid;
 option_version_id uuid; prior jsonb; option_version jsonb; resolved_origin text;
BEGIN
 SELECT * INTO STRICT version_row FROM card_type_versions WHERE id=target_version_id;
 SELECT * INTO STRICT type_row FROM card_types WHERE id=version_row.card_type_id;
 IF type_row.is_internal THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('type-field-sync:'||type_row.id,0));
 SELECT book.template_version_id INTO source_template FROM books book WHERE book.space_id=type_row.space_id;
 SELECT (head.values->>'current_version_id')::uuid INTO source_form
 FROM cards form JOIN card_types kind ON kind.id=form.card_type_id AND kind.type_key='card_group_form'
 JOIN card_versions head ON head.id=form.current_version_id AND head.card_id=form.id
 WHERE form.status='active' AND COALESCE((head.values->>'space_id')::uuid,'00000000-0000-4000-8000-000000000001')=type_row.space_id
   AND structure_record('card_group_form_version',(head.values->>'current_version_id')::uuid)->'definition'->>'primaryTypeKey'=type_row.type_key
 ORDER BY (head.values->>'updated_at')::timestamptz DESC,form.id LIMIT 1;
 FOR item IN SELECT value FROM jsonb_array_elements(version_row.fields) LOOP
  definition_id:=scoped_field_uuid(version_row.card_type_id::text||':'||(item->>'key'));
  definition_version_id:=scoped_field_uuid(definition_id::text||':version:'||version_row.id::text);
  SELECT origin INTO resolved_origin FROM field_definitions WHERE id=definition_id;
  resolved_origin:=COALESCE(resolved_origin,CASE
    WHEN type_row.space_id='00000000-0000-4000-8000-000000000001' THEN 'core'
    WHEN type_row.source_type_version_id IS NOT NULL AND version_row.version=1 THEN 'template' ELSE 'book_extension' END);
  INSERT INTO field_definitions(id,space_id,card_type_id,field_key,origin,scope,status,source_template_version_id,source_type_version_id,source_form_version_id,created_by)
   VALUES(definition_id,type_row.space_id,type_row.id,item->>'key',resolved_origin,'book_type',
    CASE WHEN COALESCE((item->>'hidden')::boolean,false) THEN 'archived' ELSE 'active' END,
    source_template,version_row.id,source_form,'system:type-version')
   ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,source_type_version_id=EXCLUDED.source_type_version_id,
    source_form_version_id=COALESCE(EXCLUDED.source_form_version_id,field_definitions.source_form_version_id),
    revision=field_definitions.revision+CASE WHEN field_definitions.source_type_version_id IS DISTINCT FROM EXCLUDED.source_type_version_id THEN 1 ELSE 0 END,
    updated_at=now();
  INSERT INTO field_definition_versions(id,field_definition_id,version,field_schema,created_by)
   VALUES(definition_version_id,definition_id,version_row.version,item,'system:type-version') ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM field_definition_versions WHERE id=definition_version_id AND field_definition_id=definition_id AND version=version_row.version AND field_schema=item) THEN
   RAISE EXCEPTION '字段版本身份或内容不一致'; END IF;
  UPDATE field_definitions SET current_version_id=definition_version_id WHERE id=definition_id;
  FOR option_item IN SELECT value FROM jsonb_array_elements(COALESCE(item->'options','[]'::jsonb)) LOOP
   option_id:=CASE WHEN COALESCE(option_item->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (option_item->>'id')::uuid ELSE scoped_field_uuid(definition_id::text||':option:'||(option_item->>'value')) END;
   prior:=structure_record('field_option_definition',option_id);
   IF prior IS NOT NULL AND (prior->>'field_definition_id' IS DISTINCT FROM definition_id::text OR prior->>'option_key' IS DISTINCT FROM option_item->>'value') THEN
    RAISE EXCEPTION '可选内容身份不属于当前字段或稳定键发生变化'; END IF;
   option_version_id:=scoped_field_uuid(option_id::text||':version:'||version_row.id::text);
   option_version:=structure_record('field_option_version',option_version_id);
   IF option_version IS NULL THEN
    PERFORM kernel_store_record('field_option_version',type_row.space_id,option_version_id,jsonb_build_object(
      'option_definition_id',option_id,'version',version_row.version,'label',option_item->>'label','created_by','system:type-version'));
   ELSIF option_version->>'option_definition_id' IS DISTINCT FROM option_id::text OR option_version->>'label' IS DISTINCT FROM option_item->>'label' THEN
    RAISE EXCEPTION '可选内容版本不一致'; END IF;
   IF prior IS NULL OR prior->>'current_version_id' IS DISTINCT FROM option_version_id::text OR prior->>'status'<>'active' THEN
    PERFORM kernel_store_record('field_option_definition',type_row.space_id,option_id,COALESCE(prior,'{}'::jsonb)||jsonb_build_object(
      'field_definition_id',definition_id,'option_key',option_item->>'value','status','active',
      'revision',COALESCE((prior->>'revision')::integer,0)+1,'current_version_id',option_version_id,'updated_at',now()));
   END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION new_design.register_type_version_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM card_types WHERE id=NEW.card_type_id AND NOT is_internal) THEN
  PERFORM sync_type_version_fields(NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER card_type_versions_register_fields AFTER INSERT ON new_design.card_type_versions
 FOR EACH ROW EXECUTE FUNCTION new_design.register_type_version_fields();
CREATE TRIGGER field_definition_versions_immutable BEFORE UPDATE OR DELETE ON new_design.field_definition_versions
 FOR EACH ROW EXECUTE FUNCTION new_design.kernel_reject_history_change();

CREATE FUNCTION new_design.guard_scoped_field_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE mount jsonb; instance jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM card_types WHERE id=NEW.card_type_id AND space_id=NEW.space_id AND NOT is_internal) THEN
  RAISE EXCEPTION '字段定义必须属于同空间的作者规格'; END IF;
 IF NEW.card_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.card_id AND space_id=NEW.space_id AND card_type_id=NEW.card_type_id) THEN
  RAISE EXCEPTION '局部字段必须属于原作者卡片'; END IF;
 IF NEW.card_mount_id IS NOT NULL THEN
  mount:=structure_record('card_mount',NEW.card_mount_id);
  instance:=structure_record('card_group_form_instance',(mount->>'form_instance_id')::uuid);
  IF mount IS NULL OR instance IS NULL OR instance->>'space_id' IS DISTINCT FROM NEW.space_id::text
   OR NOT EXISTS(SELECT 1 FROM cards WHERE id=(instance->>'primary_card_id')::uuid AND card_type_id=NEW.card_type_id AND space_id=NEW.space_id) THEN
   RAISE EXCEPTION '挂载局部字段必须属于原空间和资料规格'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER field_definitions_owner_guard BEFORE INSERT OR UPDATE ON new_design.field_definitions
 FOR EACH ROW EXECUTE FUNCTION new_design.guard_scoped_field_owner();

CREATE FUNCTION new_design.structure_template_dictionaries() RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO new_design,public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceId',head.values->>'id','key',head.values->>'dictionary_key',
  'name',head.values->>'name','description',COALESCE(head.values->>'description',''),'items',
  COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',item.values->>'id','parentSourceId',item.values->'parent_id',
   'key',item.values->>'item_key','label',item.values->>'label','description',COALESCE(item.values->>'description',''),
   'value',item.values->'value','sortOrder',(item.values->>'sort_order')::integer) ORDER BY (item.values->>'sort_order')::integer,item.values->>'id')
   FROM cards child JOIN card_types child_type ON child_type.id=child.card_type_id AND child_type.type_key='dictionary_item'
   JOIN card_versions item ON item.id=child.current_version_id AND item.card_id=child.id WHERE child.status='active'
    AND item.values->>'dictionary_id'=head.values->>'id' AND item.values->>'status'='active'),'[]'::jsonb))
  ORDER BY head.values->>'name'),'[]'::jsonb)
 FROM cards dictionary JOIN card_types type ON type.id=dictionary.card_type_id AND type.type_key='dictionary_definition'
 JOIN card_versions head ON head.id=dictionary.current_version_id AND head.card_id=dictionary.id
 WHERE dictionary.status='active' AND head.values->>'scope'='system' AND head.values->>'status'='published'
$$;
CREATE FUNCTION new_design.structure_template_forms() RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO new_design,public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceId',head.values->>'id','sourceVersionId',head.values->>'current_version_id',
  'key',head.values->>'form_key','name',head.values->>'name','description',COALESCE(head.values->>'description',''),
  'definition',structure_record('card_group_form_version',(head.values->>'current_version_id')::uuid)->'definition')
 ORDER BY head.values->>'name'),'[]'::jsonb)
 FROM cards form JOIN card_types type ON type.id=form.card_type_id AND type.type_key='card_group_form'
 JOIN card_versions head ON head.id=form.current_version_id AND head.card_id=form.id
 WHERE form.status='active' AND head.values->>'status'='published'
  AND COALESCE((head.values->>'space_id')::uuid,'00000000-0000-4000-8000-000000000001')='00000000-0000-4000-8000-000000000001'
$$;

-- 逻辑历史卡不能通过创建第二个物理版本被覆写。
CREATE FUNCTION new_design.guard_structure_record_history() RETURNS trigger
LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE kind text; old_values jsonb;
BEGIN
 SELECT type.type_key,head.values INTO kind,old_values FROM cards card JOIN card_types type ON type.id=card.card_type_id
  LEFT JOIN card_versions head ON head.id=card.current_version_id WHERE card.id=NEW.card_id;
 IF kind=ANY(ARRAY['field_option_version','field_scope_adoption','card_version_local_value','card_mount_local_value_version',
   'dictionary_item_version','card_group_form_version','card_mount_version','material_tag_version','material_tag_dimension_version',
   'material_tag_membership_version','material_group_version','material_group_membership_version','card_type_tag_binding_version',
   'smart_view_version','template_group_version','card_tree_value_snapshot']) AND old_values IS NOT NULL
  AND old_values IS DISTINCT FROM NEW.values THEN RAISE EXCEPTION '结构版本及采用历史不可改写'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER structure_record_history_guard BEFORE INSERT ON new_design.card_versions
 FOR EACH ROW EXECUTE FUNCTION new_design.guard_structure_record_history();

-- 延迟到事务末：批量字典保存允许先写子节点版本再写父节点，最终必须完整同域且无环。
CREATE FUNCTION new_design.guard_structure_record_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE kind text; payload jsonb; owner jsonb; ancestor jsonb; version_payload jsonb;
 owning_space uuid; cursor_id uuid; seen uuid[]; own_id uuid; owner_field text; version_kind text;
BEGIN
 SELECT type.type_key,head.values,card.space_id INTO kind,payload,owning_space
 FROM cards card JOIN card_types type ON type.id=card.card_type_id
 JOIN card_versions head ON head.id=card.current_version_id AND head.card_id=card.id
 WHERE card.id=NEW.id AND card.current_version_id=NEW.current_version_id AND type.is_internal;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF kind NOT IN ('dictionary_item','material_tag','material_group','material_tag_membership','material_group_membership',
   'field_option_definition','card_group_form','card_group_form_instance','card_mount') THEN RETURN NEW; END IF;
 own_id:=(payload->>'id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('structure-scope:'||owning_space,0));
 IF kind IN ('dictionary_item','material_tag','material_group') THEN
  owner_field:=CASE kind WHEN 'dictionary_item' THEN 'dictionary_id' WHEN 'material_tag' THEN 'dimension_id' ELSE 'space_id' END;
  IF kind IN ('dictionary_item','material_tag') THEN
   owner:=structure_record(CASE kind WHEN 'dictionary_item' THEN 'dictionary_definition' ELSE 'material_tag_dimension' END,(payload->>owner_field)::uuid);
   IF owner IS NULL OR COALESCE((owner->>'owner_space_id')::uuid,'00000000-0000-4000-8000-000000000001')<>owning_space THEN
    RAISE EXCEPTION '结构节点所属目录不存在或跨空间'; END IF;
  ELSIF payload->>'space_id' IS DISTINCT FROM owning_space::text
    OR payload->>'book_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM books WHERE id=(payload->>'book_id')::uuid AND space_id=owning_space) THEN
   RAISE EXCEPTION '分组所属作品空间不一致'; END IF;
  seen:=ARRAY[own_id]; cursor_id:=(payload->>'parent_id')::uuid;
  WHILE cursor_id IS NOT NULL LOOP
   IF cursor_id=ANY(seen) THEN RAISE EXCEPTION '结构树不能形成循环'; END IF;
   seen:=array_append(seen,cursor_id); ancestor:=structure_record(kind,cursor_id);
   IF ancestor IS NULL OR ancestor->>owner_field IS DISTINCT FROM payload->>owner_field
    OR kind='material_group' AND (ancestor->>'book_id' IS DISTINCT FROM payload->>'book_id' OR ancestor->>'status'<>'active') THEN
    RAISE EXCEPTION '上级结构必须位于相同目录与作用域'; END IF;
   cursor_id:=(ancestor->>'parent_id')::uuid;
  END LOOP;
 ELSIF kind IN ('material_tag_membership','material_group_membership') THEN
  owner:=structure_record(CASE kind WHEN 'material_tag_membership' THEN 'material_tag' ELSE 'material_group' END,
   (payload->>CASE kind WHEN 'material_tag_membership' THEN 'tag_id' ELSE 'group_id' END)::uuid);
  IF owner IS NULL OR owner->>'space_id' IS DISTINCT FROM owning_space::text OR payload->>'space_id' IS DISTINCT FROM owning_space::text
   OR NOT EXISTS(SELECT 1 FROM cards WHERE id=(payload->>'card_id')::uuid AND space_id=owning_space) THEN
   RAISE EXCEPTION '资料组织引用不能跨空间'; END IF;
 ELSIF kind='field_option_definition' THEN
  IF NOT EXISTS(SELECT 1 FROM field_definitions WHERE id=(payload->>'field_definition_id')::uuid AND space_id=owning_space) THEN
   RAISE EXCEPTION '选项所属字段不存在或跨空间'; END IF;
 ELSIF kind='card_group_form_instance' THEN
  version_payload:=structure_record('card_group_form_version',(payload->>'form_version_id')::uuid);
  IF version_payload IS NULL OR NOT EXISTS(SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id
    WHERE card.id=(payload->>'primary_card_id')::uuid AND card.space_id=owning_space AND NOT type.is_internal
     AND type.type_key=version_payload->'definition'->>'primaryTypeKey') THEN
   RAISE EXCEPTION '表单实例必须绑定同空间及匹配规格的主卡'; END IF;
 ELSIF kind='card_mount' THEN
  owner:=structure_record('card_group_form_instance',(payload->>'form_instance_id')::uuid);
  IF owner IS NULL OR owner->>'space_id' IS DISTINCT FROM owning_space::text
   OR NOT EXISTS(SELECT 1 FROM cards WHERE id=(payload->>'card_id')::uuid AND space_id=owning_space)
   OR payload->>'relation_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_relations WHERE id=(payload->>'relation_id')::uuid AND space_id=owning_space) THEN
   RAISE EXCEPTION '表单挂载及关系不能跨空间'; END IF;
 END IF;
 version_kind:=CASE kind WHEN 'dictionary_item' THEN 'dictionary_item_version' WHEN 'material_tag' THEN 'material_tag_version'
  WHEN 'material_group' THEN 'material_group_version' WHEN 'field_option_definition' THEN 'field_option_version'
  WHEN 'card_group_form' THEN 'card_group_form_version' END;
 IF version_kind IS NOT NULL AND payload->>'current_version_id' IS NOT NULL THEN
  owner_field:=CASE kind WHEN 'dictionary_item' THEN 'item_id' WHEN 'material_tag' THEN 'tag_id'
   WHEN 'material_group' THEN 'group_id' WHEN 'field_option_definition' THEN 'option_definition_id' ELSE 'form_id' END;
  version_payload:=structure_record(version_kind,(payload->>'current_version_id')::uuid);
  IF version_payload IS NULL OR version_payload->>owner_field IS DISTINCT FROM own_id::text THEN
   RAISE EXCEPTION '结构当前版本必须属于原对象'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER structure_record_scope_guard AFTER INSERT OR UPDATE ON new_design.cards
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION new_design.guard_structure_record_scope();
