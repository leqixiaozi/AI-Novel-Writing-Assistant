-- 空库系统默认值；依赖 record-types 与作者规格／关系目录，不导入作者业务数据。
-- 来源：018 状态能力、028 图配置、029 检索策略、030/031 作业与传输、044 导出。
SET LOCAL search_path TO new_design,public;

DO $state_defaults$
DECLARE spec record; payload jsonb; logical_id uuid; lifecycle boolean; field_state boolean;
BEGIN
  FOR spec IN SELECT space_id,type_key,semantic_capabilities FROM card_types WHERE NOT is_internal LOOP
    lifecycle := spec.type_key IN ('goal_task','conflict','secret_truth','clue_evidence','foreshadow','suspense_question','plotline','arc');
    field_state := spec.type_key IN ('character','organization','prop','location') OR spec.semantic_capabilities @> '["state_change"]'::jsonb;
    logical_id := md5('card-kernel:seed:state_type_capability:'||spec.space_id||':'||spec.type_key)::uuid;
    payload := jsonb_build_object(
      'space_id',spec.space_id,'type_key',spec.type_key,
      'settlement_capability',CASE WHEN spec.type_key IN ('character','organization','prop') THEN 'required'
        WHEN lifecycle OR field_state THEN 'optional' ELSE 'disabled' END,
      'state_mode',CASE WHEN lifecycle THEN 'lifecycle' WHEN field_state THEN 'field_state' ELSE 'none' END,
      'default_field_policy',CASE WHEN lifecycle THEN 'lifecycle_only' WHEN field_state THEN 'tracked' ELSE 'none' END);
    PERFORM kernel_store_record('state_type_capability',spec.space_id,logical_id,payload);
  END LOOP;
  FOR spec IN SELECT DISTINCT COALESCE(owner_space_id,'00000000-0000-4000-8000-000000000001'::uuid) AS space_id,relation_key FROM relation_types LOOP
    logical_id := md5('card-kernel:seed:state_relation_capability:'||spec.space_id||':'||spec.relation_key)::uuid;
    payload := jsonb_build_object('space_id',spec.space_id,'relation_key',spec.relation_key,
      'settlement_capability',CASE WHEN spec.relation_key IN ('character_relationship','event_prop') THEN 'required' ELSE 'disabled' END,
      'state_mode',CASE WHEN spec.relation_key IN ('character_relationship','event_prop') THEN 'relation_state' ELSE 'none' END);
    PERFORM kernel_store_record('state_relation_capability',spec.space_id,logical_id,payload);
    IF spec.relation_key IN ('character_relationship','event_prop') THEN
      payload := jsonb_build_object('space_id',spec.space_id,'relation_key',spec.relation_key,
        'dimension_key',CASE spec.relation_key WHEN 'character_relationship' THEN 'relationship_state' ELSE 'holding_state' END,
        'label',CASE spec.relation_key WHEN 'character_relationship' THEN '关系状态' ELSE '持有与损耗' END,
        'direction',CASE spec.relation_key WHEN 'character_relationship' THEN 'bidirectional' ELSE 'forward' END,
        'settlement_policy','tracked','state_mode','absolute');
      logical_id := md5('card-kernel:seed:state_relation_dimension:'||spec.space_id||':'||spec.relation_key||':'||(payload->>'dimension_key'))::uuid;
      PERFORM kernel_store_record('state_relation_dimension',spec.space_id,logical_id,payload);
    END IF;
  END LOOP;
END;
$state_defaults$;

-- 字段策略、值映射没有原全局默认；由作者显式配置，不能猜造人物状态值。
-- 模型、凭据及 embedding_profiles 亦不凭空生成；检索策略不代表模型已配置。
SELECT kernel_store_record('semantic_retrieval_policy','00000000-0000-4000-8000-000000000001',
  md5('card-kernel:seed:semantic_retrieval_policy:singleton')::uuid,
  jsonb_build_object('singleton',true,'max_top_k',100,'max_candidates',1000,'max_timeout_ms',5000,'max_query_chars',4000,
    'default_vector_weight',0.7,'default_fts_weight',0.2,'default_trigram_weight',0.1));
SELECT kernel_store_record('background_job_archive_policy','00000000-0000-4000-8000-000000000001',
  md5('card-kernel:seed:background_job_archive_policy:singleton')::uuid,
  jsonb_build_object('singleton',true,'terminal_retention_days',90,'dead_letter_retention_days',365,'archive_batch_limit',500));

-- 注册信息与租约／重试默认值集中在 handler 记录；不另建 topic 业务表。
DO $job_defaults$
DECLARE handler record;
BEGIN
  FOR handler IN SELECT * FROM (VALUES
    ('dependency.recompute','dependency.recompute','dependency.recompute.requested',1,'dependency_recompute_request',5,120000,1000,300000),
    ('asset.derive','asset.derive','asset.derivation.requested',1,'asset_derivation',5,300000,2000,600000),
    ('graph.project','graph.project','graph.projection.requested',1,'graph_projection_request',5,120000,1000,300000),
    ('embedding.chunk','embedding.chunk','embedding.chunking.requested',1,'embedding_chunking_request',5,120000,1000,300000),
    ('embedding.generate','embedding.generate','embedding.generation.requested',1,'embedding_request',8,120000,2000,900000),
    ('embedding.index','embedding.index','embedding.index.requested',1,'embedding_index_generation',3,1800000,5000,1800000),
    ('ai.task','ai.task','ai.task.requested',1,'ai_task',5,120000,1000,300000),
    ('backup.run','backup.run','backup.requested',1,'backup_request',3,3600000,10000,3600000),
    ('publication.export','publication.export','publication.export.requested',1,'publication_export_request',3,300000,2000,60000)
  ) AS defaults(handler_key,job_kind,topic,event_version,specialized_request_kind,default_max_attempts,default_lease_ms,backoff_base_ms,backoff_cap_ms)
  LOOP
    PERFORM kernel_store_record('background_job_handler','00000000-0000-4000-8000-000000000001',
      md5('card-kernel:seed:background_job_handler:'||handler.handler_key)::uuid,
      to_jsonb(handler)||jsonb_build_object('status','active'));
    INSERT INTO outbox_consumers(consumer_key,handler_key,max_concurrency)
      VALUES('runtime.'||replace(handler.handler_key,'.','-'),handler.handler_key,
        CASE handler.handler_key WHEN 'embedding.generate' THEN 4 ELSE 1 END);
  END LOOP;
END;
$job_defaults$;

DO $transfer_defaults$
DECLARE profile record;
BEGIN
  FOR profile IN SELECT * FROM (VALUES
    ('full_system','full_system','整库 PostgreSQL 逻辑数据、受管附件与一致性清单。',
      '["new_design_schema","managed_assets","migration_history","extension_compatibility"]'::jsonb,
      '["credentials","session_tokens","temporary_urls","absolute_local_paths"]'::jsonb,true,true),
    ('compact_continue','book','可在另一台机器继续创作的单书正本、当前采用链、必要历史、来源证据与附件。',
      '["book_identity","card_schema","book_cards","planning","chapter_bodies","facts","state","knowledge","timeline","research_references","prompt_bindings","required_runtime_snapshots","managed_assets"]'::jsonb,
      '["age_projection","embedding_vectors","embedding_indexes","transient_outbox_jobs","cache","credentials","unreferenced_history"]'::jsonb,false,true),
    ('full_audit','book','用于完整追溯的单书正本、全部版本历史、证据、采用记录、必要运行快照与附件。',
      '["book_identity","card_schema","book_cards","planning","chapter_bodies","facts","state","knowledge","timeline","research_references","prompt_bindings","runtime_evidence","managed_assets"]'::jsonb,
      '["age_projection","embedding_vectors","embedding_indexes","transient_outbox_jobs","cache","credentials"]'::jsonb,true,true),
    ('template_bundle','template','系统模板、卡片类型、字段、表单、模板版本与提示词方案，不包含书籍实例。',
      '["card_types","field_schemas","dictionaries","relations","forms","template_groups","template_versions","prompt_recipes"]'::jsonb,
      '["books","book_cards","chapter_bodies","runtime_jobs","credentials"]'::jsonb,true,false),
    ('resource_bundle','resource','以稳定 portable key 和版本携带业务资源卡及其显式依赖。',
      '["resource_card_types","resource_cards","resource_versions","resource_dependencies"]'::jsonb,
      '["books","templates","runtime_jobs","credentials"]'::jsonb,true,false)
  ) AS defaults(profile_key,package_kind,description,included_domains,excluded_domains,include_version_history,include_runtime_evidence)
  LOOP
    PERFORM kernel_store_record('transfer_export_profile','00000000-0000-4000-8000-000000000001',
      md5('card-kernel:seed:transfer_export_profile:'||profile.profile_key)::uuid,
      to_jsonb(profile)||jsonb_build_object('status','active'));
  END LOOP;
END;
$transfer_defaults$;

-- 图映射由投影仓储的显式 source-kind 分支决定；这里只登记最终物理配置。
INSERT INTO graph_projection_configs(id,graph_name,mapping_version,max_depth,max_results,statement_timeout_ms,status)
  VALUES('81000000-0000-4000-8000-000000000001','new_design_projection',1,6,200,5000,'active');

-- 发布验收仅提供待评目录；没有真实运行证据，不创建任何 passed/failed/blocked 历史。
INSERT INTO release_definitions(gate_key,category,title,acceptance,sort_order) VALUES
  ('database.pg17_migrations','database','PG17 空库初始化与回滚','在隔离 PostgreSQL 17 环境完成 132 卡片底座空库初始化、结构核验与失败回滚。',10),
  ('extensions.age','extensions','Apache AGE 加载与重建','装配匹配 PG17 的 age.dll，完成加载、投影重建和失败恢复。',20),
  ('extensions.pgvector','extensions','pgvector 加载与重建','装配匹配 PG17 的 vector.dll，完成加载、索引重建和失败恢复。',30),
  ('novel.three_chapter_flow','novel_flow','三章完整创作链','完成开书、规划、候选、采用、结算、续写、旧章返修、重算、质量检查和导出。',40),
  ('recovery.restart_concurrency','recovery','重启、并发与任务恢复','覆盖重启恢复、并发 409、Outbox 重试和死信。',50),
  ('recovery.backup_restore','recovery','备份与恢复演练','完成整库备份、恢复预检、实际恢复和一致性校验。',60),
  ('export.formats','export','三种导出格式打开校验','验证 Markdown、UTF-8 纯文本和 DOCX 可打开且内容、顺序、哈希一致。',70),
  ('interface.themes_scale','interface','主题、终端与规模','覆盖全部主题、桌面/移动、空态、大数据、性能、成本和脱敏。',80),
  ('isolation.legacy_readonly','isolation','旧系统并行隔离','证明旧页面、旧 Prisma/SQLite 与旧目录无新设计写入。',90),
  ('packaging.windows_runtime','packaging','Windows 私有运行包装配','完成真实运行包、签名、完整性校验、安装、覆盖安装和卸载保留数据。',100);
