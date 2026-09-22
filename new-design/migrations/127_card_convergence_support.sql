-- 表单、字典、标签、分组、模板、视图与挂载统一进入卡片内核。
-- 同时提供 127-131 共用的无损暂存函数；旧表仍保留到 131。
SET search_path TO new_design, public;

CREATE TABLE system_capabilities(
  capability_key text PRIMARY KEY,
  installed boolean NOT NULL DEFAULT false,
  operational boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_capabilities(capability_key,installed,operational,details)
VALUES('card_kernel_v2',false,false,'{"state":"installing","finalMigration":"131_card_kernel_v2_cutover"}'::jsonb)
ON CONFLICT(capability_key) DO UPDATE SET installed=false,operational=false,details=excluded.details,updated_at=now();

CREATE OR REPLACE FUNCTION stage_legacy_table(p_table text,p_category text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  relation regclass;
  pk_columns text[];
  item record;
  row_values jsonb;
  row_identity jsonb;
  target_card_id uuid;
  target_version_id uuid;
  target_type_id uuid:=md5('card-kernel-v2:type:'||p_table)::uuid;
  target_type_version_id uuid:=md5('card-kernel-v2:type-version:'||p_table)::uuid;
  created_value timestamptz;
  updated_value timestamptz;
  inserted_count bigint:=0;
BEGIN
  relation:=to_regclass(format('new_design.%I',p_table));
  IF relation IS NULL OR (SELECT relkind FROM pg_class WHERE oid=relation)<>'r' THEN RETURN 0; END IF;

  SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
  INTO pk_columns
  FROM pg_index index_definition
  JOIN LATERAL unnest(index_definition.indkey) WITH ORDINALITY key_column(attnum,ordinality) ON true
  JOIN pg_attribute attribute ON attribute.attrelid=index_definition.indrelid AND attribute.attnum=key_column.attnum
  WHERE index_definition.indrelid=relation AND index_definition.indisprimary;
  IF coalesce(array_length(pk_columns,1),0)=0 THEN
    SELECT array_agg(attname ORDER BY attnum) INTO pk_columns
    FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped;
  END IF;
  IF coalesce(array_length(pk_columns,1),0)=0 THEN RAISE EXCEPTION 'cannot converge table without visible columns: %',p_table; END IF;

  INSERT INTO card_types(id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields)
  VALUES(target_type_id,'00000000-0000-4000-8000-000000000001','legacy.'||p_table,p_table,
    '由卡片内核 v2 无损承载的兼容业务对象。','published',1,NULL,
    jsonb_build_array(jsonb_build_object('key','legacy_record','name','兼容记录','type','json','required',true,'legacyTable',p_table,'primaryKey',to_jsonb(pk_columns),'category',p_category)))
  ON CONFLICT(space_id,type_key) DO NOTHING;
  INSERT INTO card_type_versions(id,card_type_id,version,fields)
  VALUES(target_type_version_id,target_type_id,1,jsonb_build_array(jsonb_build_object('key','legacy_record','name','兼容记录','type','json','required',true,'legacyTable',p_table,'primaryKey',to_jsonb(pk_columns),'category',p_category)))
  ON CONFLICT(card_type_id,version) DO NOTHING;
  UPDATE card_types SET current_version_id=target_type_version_id
  WHERE id=target_type_id AND current_version_id IS NULL;

  FOR item IN EXECUTE format(
    'SELECT to_jsonb(legacy_record_row) row_values,(SELECT jsonb_object_agg(key,to_jsonb(legacy_record_row)->key ORDER BY key) FROM unnest($1::text[]) key) row_identity FROM new_design.%I AS legacy_record_row',
    p_table
  ) USING pk_columns LOOP
    row_values:=item.row_values;
    row_identity:=item.row_identity;
    target_card_id:=md5('card-kernel-v2:record:'||p_table||':'||row_identity::text)::uuid;
    target_version_id:=md5('card-kernel-v2:record-version:'||p_table||':'||row_identity::text)::uuid;
    BEGIN created_value:=coalesce((row_values->>'created_at')::timestamptz,now()); EXCEPTION WHEN OTHERS THEN created_value:=now(); END;
    BEGIN updated_value:=coalesce((row_values->>'updated_at')::timestamptz,created_value); EXCEPTION WHEN OTHERS THEN updated_value:=created_value; END;
    row_values:=row_values||jsonb_build_object('__legacy_table',p_table,'__legacy_identity',row_identity,'__convergence_category',p_category);
    INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
    VALUES(target_card_id,'00000000-0000-4000-8000-000000000001',target_type_id,
      coalesce(nullif(row_values->>'title',''),nullif(row_values->>'name',''),nullif(row_values->>'label',''),p_table||' · '||left(row_identity::text,80)),
      'active',1,target_type_version_id,target_version_id,row_values,created_value,updated_value)
    ON CONFLICT(id) DO NOTHING;
    IF FOUND THEN
      INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
      VALUES(target_version_id,target_card_id,1,target_type_version_id,
        coalesce(nullif(row_values->>'title',''),nullif(row_values->>'name',''),nullif(row_values->>'label',''),p_table||' · '||left(row_identity::text,80)),
        row_values,'create',created_value);
      inserted_count:=inserted_count+1;
    END IF;
  END LOOP;
  RETURN inserted_count;
END $$;

-- 131 会把字段选项专表替换为可写兼容视图；先把同步函数改为不依赖
-- PostgreSQL 仅支持物理表的 ON CONFLICT，这样空库与升级库在切换后都能继续创建类型。
CREATE OR REPLACE FUNCTION sync_type_version_fields(target_version_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  version_row card_type_versions%rowtype;
  type_row record;
  source_template uuid;
  source_form uuid;
  item jsonb;
  option_item jsonb;
  definition_id uuid;
  definition_version_id uuid;
  option_id uuid;
  option_version_id uuid;
  resolved_origin text;
BEGIN
  SELECT * INTO version_row FROM card_type_versions WHERE id=target_version_id;
  SELECT * INTO type_row FROM card_types WHERE id=version_row.card_type_id;
  SELECT book.template_version_id INTO source_template FROM books book WHERE book.space_id=type_row.space_id;
  SELECT form.current_version_id INTO source_form
  FROM card_group_forms form JOIN card_group_form_versions version ON version.id=form.current_version_id
  WHERE form.space_id=type_row.space_id AND version.definition->>'primaryTypeKey'=type_row.type_key
  ORDER BY form.updated_at DESC LIMIT 1;

  FOR item IN SELECT value FROM jsonb_array_elements(version_row.fields) LOOP
    definition_id:=scoped_field_uuid(version_row.card_type_id::text||':'||(item->>'key'));
    SELECT origin INTO resolved_origin FROM field_definitions WHERE id=definition_id;
    IF resolved_origin IS NULL THEN
      resolved_origin:=CASE
        WHEN type_row.space_id='00000000-0000-4000-8000-000000000001'::uuid THEN 'core'
        WHEN type_row.source_type_version_id IS NOT NULL AND version_row.version=1 THEN 'template'
        ELSE 'book_extension'
      END;
    END IF;
    INSERT INTO field_definitions(id,space_id,card_type_id,field_key,origin,scope,status,source_template_version_id,source_type_version_id,source_form_version_id,created_by)
    VALUES(definition_id,type_row.space_id,version_row.card_type_id,item->>'key',resolved_origin,'book_type',CASE WHEN COALESCE((item->>'hidden')::boolean,false) THEN 'archived' ELSE 'active' END,source_template,version_row.id,source_form,'system:type-version')
    ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,source_type_version_id=EXCLUDED.source_type_version_id,source_form_version_id=COALESCE(EXCLUDED.source_form_version_id,field_definitions.source_form_version_id),revision=field_definitions.revision+1,updated_at=now();

    definition_version_id:=scoped_field_uuid(definition_id::text||':version:'||version_row.id::text);
    INSERT INTO field_definition_versions(id,field_definition_id,version,field_schema,created_by)
    VALUES(definition_version_id,definition_id,version_row.version,item,'system:type-version') ON CONFLICT DO NOTHING;
    UPDATE field_definitions SET current_version_id=definition_version_id WHERE id=definition_id;

    FOR option_item IN SELECT value FROM jsonb_array_elements(COALESCE(item->'options','[]'::jsonb)) LOOP
      option_id:=CASE WHEN COALESCE(option_item->>'id','') ~* '^[0-9a-f-]{36}$' THEN (option_item->>'id')::uuid ELSE scoped_field_uuid(definition_id::text||':option:'||(option_item->>'value')) END;
      UPDATE field_option_definitions SET status='active',revision=revision+1,updated_at=now() WHERE id=option_id;
      IF NOT FOUND THEN
        INSERT INTO field_option_definitions(id,field_definition_id,option_key,status)
        VALUES(option_id,definition_id,option_item->>'value','active');
      END IF;
      option_version_id:=scoped_field_uuid(option_id::text||':version:'||version_row.id::text);
      IF NOT EXISTS(SELECT 1 FROM field_option_versions WHERE id=option_version_id) THEN
        INSERT INTO field_option_versions(id,option_definition_id,version,label,created_by)
        VALUES(option_version_id,option_id,version_row.version,option_item->>'label','system:type-version');
      END IF;
      UPDATE field_option_definitions SET current_version_id=option_version_id WHERE id=option_id;
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'card_group_forms','card_group_form_versions','card_group_form_instances','dictionary_definitions','dictionary_items','dictionary_item_versions',
    'material_groups','material_group_versions','material_group_memberships','material_group_membership_versions','material_tags','material_tag_versions',
    'material_tag_dimensions','material_tag_dimension_versions','material_tag_memberships','material_tag_membership_versions',
    'material_tag_target_memberships','material_tag_target_membership_versions','template_groups','template_group_versions','smart_views','smart_view_versions',
    'card_mounts','card_mount_versions','card_mount_local_value_versions','card_type_tag_bindings','card_type_tag_binding_versions',
    'field_option_definitions','field_option_versions','field_scope_adoptions','standard_field_semantics','book_view_configs'
  ] LOOP PERFORM stage_legacy_table(table_name,'structure'); END LOOP;
END $$;
