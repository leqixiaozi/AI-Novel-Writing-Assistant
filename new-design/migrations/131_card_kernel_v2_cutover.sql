-- 卡片内核 v2 最终切换：全量核对后删除重复专表，只保留 79 张应用表。
-- 本文件必须与 123-130 及迁移账本登记置于同一个外层事务中执行。
SET search_path TO new_design, public;

DO $$
DECLARE required_id text;
BEGIN
  FOREACH required_id IN ARRAY ARRAY[
    '123_card_workflow_convergence','124_comic_card_convergence','125_drama_card_convergence',
    '126_creative_hub_card_convergence','127_card_convergence_support','128_content_card_convergence',
    '129_author_workflow_convergence','130_infrastructure_ledger_convergence'
  ] LOOP
    IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id=required_id) THEN
      RAISE EXCEPTION 'required convergence migration is not registered: %',required_id;
    END IF;
  END LOOP;
END $$;

-- 语义相同的共享账本原位改名；旧名随后以可写兼容视图保留。
DO $$
DECLARE pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['context_manifest_entries','context_manifest_items'],['ai_task_state_events','ai_task_events'],
    ['asset_mounts','asset_links'],['publication_export_manifests','publication_manifests'],
    ['publication_export_artifacts','publication_artifacts'],['release_gate_definitions','release_definitions'],
    ['release_gate_assessments','release_assessments'],['dependency_state_events','dependency_events'],
    ['background_job_results','background_job_events'],['graph_projection_generations','graph_projection_runs'],
    ['embedding_index_generations','embedding_generations'],['semantic_retrieval_runs','retrieval_runs'],
    ['semantic_retrieval_results','retrieval_results'],['transfer_archive_entries','transfer_entries'],
    ['transfer_operation_events','transfer_events'],['transfer_validation_results','transfer_validations'],
    ['runtime_lifecycle_events','runtime_events'],['runtime_health_snapshots','runtime_snapshots']
  ]::text[][] LOOP
    IF to_regclass(format('new_design.%I',pair[1])) IS NOT NULL AND to_regclass(format('new_design.%I',pair[2])) IS NULL THEN
      EXECUTE format('ALTER TABLE new_design.%I RENAME TO %I',pair[1],pair[2]);
    END IF;
  END LOOP;
END $$;

CREATE TABLE media_jobs(
  id uuid PRIMARY KEY,
  media_kind text NOT NULL,
  subject_card_id uuid REFERENCES cards(id),
  request_key uuid,
  input_hash char(64),
  status text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_key),
  CHECK(input_hash IS NULL OR input_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE media_job_attempts(
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES media_jobs(id),
  attempt integer NOT NULL CHECK(attempt>0),
  provider_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL,
  failure text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(job_id,attempt)
);
CREATE TABLE media_outputs(
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES media_jobs(id),
  attempt_id uuid REFERENCES media_job_attempts(id),
  asset_version_id uuid REFERENCES asset_versions(id),
  output_kind text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 旧名直连到正式共享账本；这些简单视图可直接写入并保留原 API SQL。
DO $$
DECLARE pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['context_manifest_entries','context_manifest_items'],['ai_task_state_events','ai_task_events'],
    ['asset_mounts','asset_links'],['publication_export_manifests','publication_manifests'],
    ['publication_export_artifacts','publication_artifacts'],['release_gate_definitions','release_definitions'],
    ['release_gate_assessments','release_assessments'],['dependency_state_events','dependency_events'],
    ['background_job_results','background_job_events'],['graph_projection_generations','graph_projection_runs'],
    ['embedding_index_generations','embedding_generations'],['semantic_retrieval_runs','retrieval_runs'],
    ['semantic_retrieval_results','retrieval_results'],['transfer_archive_entries','transfer_entries'],
    ['transfer_operation_events','transfer_events'],['transfer_validation_results','transfer_validations'],
    ['runtime_lifecycle_events','runtime_events'],['runtime_health_snapshots','runtime_snapshots']
  ]::text[][] LOOP
    IF to_regclass(format('new_design.%I',pair[1])) IS NULL AND to_regclass(format('new_design.%I',pair[2])) IS NOT NULL THEN
      EXECUTE format('CREATE VIEW new_design.%I AS SELECT * FROM new_design.%I',pair[1],pair[2]);
    END IF;
  END LOOP;
END $$;

CREATE TEMP TABLE convergence_final_tables(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO convergence_final_tables(name) SELECT unnest(ARRAY[
  'schema_migrations','system_capabilities','card_spaces','card_types','card_type_versions','cards','card_versions','card_version_actions','relation_types','card_relations','card_relation_versions','field_definitions','field_definition_versions','books',
  'chapter_documents','chapter_body_versions','chapter_body_adoptions','text_anchors','chapter_settlements','chapter_settlement_items','research_documents','research_document_versions',
  'task_contracts','task_contract_versions','prompt_recipes','prompt_recipe_versions','model_credential_refs','model_route_configs','model_route_versions','model_route_snapshots','context_manifests','context_manifest_items','ai_tasks','ai_task_steps','ai_task_attempts','ai_task_events','ai_attempt_usage',
  'asset_content_objects','asset_versions','asset_links','asset_events','media_jobs','media_job_attempts','media_outputs','publication_manifests','publication_artifacts','release_definitions','release_assessments',
  'dependency_resources','dependency_edges','dependency_events','outbox_events','outbox_inbox_receipts','outbox_consumers','outbox_aggregate_sequences','background_jobs','background_job_attempts','background_job_checkpoints','background_job_events',
  'graph_projection_configs','graph_projection_runs','graph_projection_checkpoints','embedding_profiles','embedding_generations','embedding_chunks','embedding_vectors','retrieval_runs','retrieval_results',
  'transfer_operations','transfer_manifests','transfer_entries','transfer_events','transfer_conflicts','transfer_validations','transfer_id_mappings','runtime_installations','runtime_events','runtime_snapshots','runtime_upgrade_plans'
]::text[]);

DO $$ BEGIN
  IF (SELECT count(*) FROM convergence_final_tables)<>79 THEN RAISE EXCEPTION 'final table catalog must contain exactly 79 names'; END IF;
  IF EXISTS(SELECT 1 FROM convergence_final_tables target WHERE to_regclass(format('new_design.%I',target.name)) IS NULL) THEN
    RAISE EXCEPTION 'one or more final card-kernel tables are missing';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS new_design_compat;
CREATE TEMP TABLE convergence_relation_metadata(
  table_name text PRIMARY KEY,
  primary_key_columns text[] NOT NULL,
  column_definition text NOT NULL,
  legacy_count bigint NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE convergence_column_defaults(table_name text,column_name text,default_expression text) ON COMMIT DROP;
CREATE TEMP TABLE convergence_view_defs(view_name text PRIMARY KEY,definition text NOT NULL,recreated boolean NOT NULL DEFAULT false) ON COMMIT DROP;
CREATE TEMP TABLE convergence_function_defs(identity text PRIMARY KEY,definition text NOT NULL,recreated boolean NOT NULL DEFAULT false) ON COMMIT DROP;

INSERT INTO convergence_view_defs(view_name,definition)
SELECT view_definition.oid::regclass::text,pg_get_viewdef(view_definition.oid,true)
FROM pg_class view_definition JOIN pg_namespace namespace ON namespace.oid=view_definition.relnamespace
WHERE namespace.nspname='new_design' AND view_definition.relkind='v';

INSERT INTO convergence_function_defs(identity,definition)
SELECT procedure.oid::regprocedure::text,pg_get_functiondef(procedure.oid)
FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
WHERE namespace.nspname='new_design' AND procedure.prokind IN('f','p');

DO $$
DECLARE relation record;
DECLARE pk_columns text[];
DECLARE columns_sql text;
DECLARE row_count bigint;
BEGIN
  FOR relation IN
    SELECT class.relname
    FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='new_design' AND class.relkind='r'
      AND NOT EXISTS(SELECT 1 FROM convergence_final_tables final WHERE final.name=class.relname)
    ORDER BY class.relname
  LOOP
    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
    INTO pk_columns
    FROM pg_index index_definition
    JOIN LATERAL unnest(index_definition.indkey) WITH ORDINALITY key_column(attnum,ordinality) ON true
    JOIN pg_attribute attribute ON attribute.attrelid=index_definition.indrelid AND attribute.attnum=key_column.attnum
    WHERE index_definition.indrelid=format('new_design.%I',relation.relname)::regclass AND index_definition.indisprimary;
    IF coalesce(array_length(pk_columns,1),0)=0 THEN
      SELECT array_agg(attname ORDER BY attnum) INTO pk_columns FROM pg_attribute
      WHERE attrelid=format('new_design.%I',relation.relname)::regclass AND attnum>0 AND NOT attisdropped;
    END IF;
    SELECT string_agg(format('%I %s',attribute.attname,format_type(attribute.atttypid,attribute.atttypmod)),',' ORDER BY attribute.attnum)
    INTO columns_sql FROM pg_attribute attribute
    WHERE attribute.attrelid=format('new_design.%I',relation.relname)::regclass AND attribute.attnum>0 AND NOT attribute.attisdropped;
    EXECUTE format('SELECT count(*) FROM new_design.%I',relation.relname) INTO row_count;
    INSERT INTO convergence_relation_metadata VALUES(relation.relname,pk_columns,columns_sql,row_count);
    INSERT INTO convergence_column_defaults(table_name,column_name,default_expression)
    SELECT relation.relname,attribute.attname,pg_get_expr(default_value.adbin,default_value.adrelid)
    FROM pg_attribute attribute JOIN pg_attrdef default_value ON default_value.adrelid=attribute.attrelid AND default_value.adnum=attribute.attnum
    WHERE attribute.attrelid=format('new_design.%I',relation.relname)::regclass AND attribute.attnum>0 AND NOT attribute.attisdropped;
    PERFORM stage_legacy_table(relation.relname,'final_cutover');
    IF row_count<>(
      SELECT count(*) FROM cards card JOIN card_types type ON type.id=card.card_type_id
      WHERE type.type_key='legacy.'||relation.relname
    ) THEN RAISE EXCEPTION 'legacy row count mismatch before cutover: %',relation.relname; END IF;
    EXECUTE format('CREATE TYPE new_design_compat.%I AS (%s)',relation.relname,columns_sql);
  END LOOP;
END $$;

-- 可写兼容视图的统一动作函数：任何旧 SQL 写入仍落入卡片版本和动作账本。
CREATE OR REPLACE FUNCTION card_kernel_compat_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  table_name text:=TG_ARGV[0];
  pk_columns text[]:=string_to_array(TG_ARGV[1],',');
  old_values jsonb;
  new_values jsonb;
  identity_values jsonb;
  target_card_id uuid;
  target_version_id uuid:=gen_random_uuid();
  target_type_id uuid;
  target_type_version_id uuid;
  next_revision integer;
  target_title text;
BEGIN
  IF TG_OP<>'INSERT' THEN old_values:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_values:=to_jsonb(NEW); END IF;
  SELECT id,current_version_id INTO STRICT target_type_id,target_type_version_id
  FROM card_types WHERE space_id='00000000-0000-4000-8000-000000000001' AND type_key='legacy.'||table_name;
  IF TG_OP='INSERT' THEN
    SELECT jsonb_object_agg(key,new_values->key ORDER BY key) INTO identity_values FROM unnest(pk_columns) key;
    target_card_id:=md5('card-kernel-v2:record:'||table_name||':'||identity_values::text)::uuid;
    target_title:=coalesce(nullif(new_values->>'title',''),nullif(new_values->>'name',''),nullif(new_values->>'label',''),table_name||' · '||left(identity_values::text,80));
    new_values:=new_values||jsonb_build_object('__legacy_table',table_name,'__legacy_identity',identity_values,'__convergence_category','compat_write');
    INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values)
    VALUES(target_card_id,'00000000-0000-4000-8000-000000000001',target_type_id,target_title,'active',1,target_type_version_id,target_version_id,new_values);
    INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source)
    VALUES(target_version_id,target_card_id,1,target_type_version_id,target_title,new_values,'create');
    INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,payload)
    VALUES(gen_random_uuid(),target_card_id,target_version_id,'compat.insert',jsonb_build_object('legacyTable',table_name));
    RETURN NEW;
  END IF;
  SELECT jsonb_object_agg(key,old_values->key ORDER BY key) INTO identity_values FROM unnest(pk_columns) key;
  target_card_id:=md5('card-kernel-v2:record:'||table_name||':'||identity_values::text)::uuid;
  SELECT coalesce(max(revision),0)+1 INTO next_revision FROM card_versions WHERE card_id=target_card_id;
  IF TG_OP='DELETE' THEN
    target_title:=coalesce(nullif(old_values->>'title',''),nullif(old_values->>'name',''),nullif(old_values->>'label',''),table_name||' · '||left(identity_values::text,80));
    old_values:=old_values||jsonb_build_object('__legacy_table',table_name,'__legacy_identity',identity_values,'__convergence_category','compat_delete');
    INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source)
    VALUES(target_version_id,target_card_id,next_revision,target_type_version_id,target_title,old_values,'archive');
    UPDATE cards SET status='archived',revision=revision+1,current_version_id=target_version_id,values=old_values,updated_at=now(),archived_at=now() WHERE id=target_card_id;
    INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,payload)
    VALUES(gen_random_uuid(),target_card_id,target_version_id,'compat.archive',jsonb_build_object('legacyTable',table_name));
    RETURN OLD;
  END IF;
  target_title:=coalesce(nullif(new_values->>'title',''),nullif(new_values->>'name',''),nullif(new_values->>'label',''),table_name||' · '||left(identity_values::text,80));
  new_values:=new_values||jsonb_build_object('__legacy_table',table_name,'__legacy_identity',identity_values,'__convergence_category','compat_update');
  INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source)
  VALUES(target_version_id,target_card_id,next_revision,target_type_version_id,target_title,new_values,'edit');
  UPDATE cards SET title=target_title,revision=revision+1,current_version_id=target_version_id,values=new_values,updated_at=now() WHERE id=target_card_id;
  INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,payload)
  VALUES(gen_random_uuid(),target_card_id,target_version_id,'compat.update',jsonb_build_object('legacyTable',table_name));
  RETURN NEW;
END $$;

DO $$
DECLARE relation record;
DECLARE default_value record;
BEGIN
  FOR relation IN SELECT * FROM convergence_relation_metadata ORDER BY table_name LOOP
    EXECUTE format('DROP TABLE new_design.%I CASCADE',relation.table_name);
  END LOOP;
  FOR relation IN SELECT * FROM convergence_relation_metadata ORDER BY table_name LOOP
    EXECUTE format(
      'CREATE VIEW new_design.%I AS SELECT (jsonb_populate_record(NULL::new_design_compat.%I,card.values)).* FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE type.type_key=%L AND card.status=''active''',
      relation.table_name,relation.table_name,'legacy.'||relation.table_name
    );
    FOR default_value IN SELECT * FROM convergence_column_defaults WHERE table_name=relation.table_name LOOP
      IF default_value.default_expression NOT ILIKE 'nextval(%' THEN
        BEGIN
          EXECUTE format('ALTER VIEW new_design.%I ALTER COLUMN %I SET DEFAULT %s',relation.table_name,default_value.column_name,default_value.default_expression);
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'compatibility default skipped for %.%: %',relation.table_name,default_value.column_name,SQLERRM;
        END;
      END IF;
    END LOOP;
    EXECUTE format('CREATE TRIGGER card_kernel_compat_write INSTEAD OF INSERT OR UPDATE OR DELETE ON new_design.%I FOR EACH ROW EXECUTE FUNCTION new_design.card_kernel_compat_write(%L,%L)',
      relation.table_name,relation.table_name,array_to_string(relation.primary_key_columns,','));
  END LOOP;
END $$;

-- 先恢复被 CASCADE 移除的只读视图，再恢复依赖这些视图的数据库函数。
DO $$
DECLARE item record;
DECLARE progress integer;
DECLARE pass integer:=0;
BEGIN
  LOOP
    pass:=pass+1; progress:=0;
    FOR item IN SELECT * FROM convergence_view_defs WHERE NOT recreated ORDER BY view_name LOOP
      IF to_regclass(item.view_name) IS NOT NULL THEN UPDATE convergence_view_defs SET recreated=true WHERE view_name=item.view_name; progress:=progress+1; CONTINUE; END IF;
      BEGIN
        EXECUTE format('CREATE VIEW %s AS %s',item.view_name,item.definition);
        UPDATE convergence_view_defs SET recreated=true WHERE view_name=item.view_name; progress:=progress+1;
      EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN NULL;
      END;
    END LOOP;
    EXIT WHEN NOT EXISTS(SELECT 1 FROM convergence_view_defs WHERE NOT recreated) OR progress=0 OR pass>=32;
  END LOOP;
  IF EXISTS(SELECT 1 FROM convergence_view_defs WHERE NOT recreated) THEN
    RAISE EXCEPTION 'one or more dependent views could not be recreated after cutover';
  END IF;

  pass:=0;
  LOOP
    pass:=pass+1; progress:=0;
    FOR item IN SELECT * FROM convergence_function_defs WHERE NOT recreated ORDER BY identity LOOP
      BEGIN
        EXECUTE item.definition;
        UPDATE convergence_function_defs SET recreated=true WHERE identity=item.identity; progress:=progress+1;
      EXCEPTION WHEN undefined_table OR undefined_object OR undefined_column OR undefined_function OR invalid_schema_name THEN NULL;
      END;
    END LOOP;
    EXIT WHEN NOT EXISTS(SELECT 1 FROM convergence_function_defs WHERE NOT recreated) OR progress=0 OR pass>=32;
  END LOOP;
  IF EXISTS(SELECT 1 FROM convergence_function_defs WHERE NOT recreated) THEN
    RAISE EXCEPTION 'one or more database functions could not be recreated after cutover';
  END IF;
END $$;

-- 切换事务结束后服务会建立全新连接，不能依赖执行迁移时连接残留的 search_path。
-- 固定所有新版数据库函数的解析范围，确保兼容视图触发器和历史函数在重启后仍可写。
DO $$
DECLARE routine record;
BEGIN
  FOR routine IN
    SELECT procedure.oid::regprocedure identity,procedure.prokind
    FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='new_design' AND procedure.prokind IN('f','p')
  LOOP
    EXECUTE format('ALTER %s %s SET search_path=new_design,ag_catalog,public',CASE WHEN routine.prokind='p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,routine.identity);
  END LOOP;
END $$;

SET search_path TO new_design, ag_catalog, "$user", public;
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ag_catalog.ag_label label JOIN ag_catalog.ag_graph graph ON graph.graphid=label.graph WHERE graph.name='new_design_projection' AND label.name='ProjectedNode') THEN
    PERFORM ag_catalog.create_vlabel('new_design_projection','ProjectedNode');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM ag_catalog.ag_label label JOIN ag_catalog.ag_graph graph ON graph.graphid=label.graph WHERE graph.name='new_design_projection' AND label.name='PROJECTED_RELATION') THEN
    PERFORM ag_catalog.create_elabel('new_design_projection','PROJECTED_RELATION');
  END IF;
END $$;
SET search_path TO new_design, public;

DO $$
DECLARE application_table_count integer;
DECLARE projection_table_count integer;
BEGIN
  SELECT count(*) INTO application_table_count
  FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
  WHERE namespace.nspname='new_design' AND class.relkind='r';
  IF application_table_count<>79 THEN RAISE EXCEPTION 'card kernel v2 expected 79 application tables, found %',application_table_count; END IF;
  IF EXISTS(
    SELECT 1 FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
    WHERE namespace.nspname='new_design' AND class.relkind='r'
      AND NOT EXISTS(SELECT 1 FROM convergence_final_tables final WHERE final.name=class.relname)
  ) THEN RAISE EXCEPTION 'unexpected physical table remains after card kernel v2 cutover'; END IF;
  SELECT count(*) INTO projection_table_count FROM pg_class class
  JOIN pg_namespace namespace ON namespace.oid=class.relnamespace
  WHERE namespace.nspname='new_design_projection' AND class.relkind='r';
  IF projection_table_count<>4 THEN RAISE EXCEPTION 'AGE projection expected 4 physical label tables, found %',projection_table_count; END IF;
  IF EXISTS(SELECT 1 FROM cards card LEFT JOIN card_versions version ON version.id=card.current_version_id AND version.card_id=card.id WHERE card.current_version_id IS NOT NULL AND version.id IS NULL) THEN
    RAISE EXCEPTION 'card current version orphan detected';
  END IF;
  IF EXISTS(SELECT 1 FROM card_version_actions action LEFT JOIN cards card ON card.id=action.card_id WHERE card.id IS NULL) THEN
    RAISE EXCEPTION 'card action orphan detected';
  END IF;
  UPDATE system_capabilities SET installed=true,operational=true,
    details=jsonb_build_object('state','ready','applicationTables',application_table_count,'projectionTables',projection_table_count,'migration','131_card_kernel_v2_cutover'),updated_at=now()
  WHERE capability_key='card_kernel_v2';
END $$;

DROP FUNCTION stage_legacy_table(text,text);
