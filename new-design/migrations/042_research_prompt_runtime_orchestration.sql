SET search_path TO new_design, public;

ALTER TABLE model_route_configs DROP CONSTRAINT model_route_configs_scope_check;
ALTER TABLE model_route_configs ADD COLUMN task_key text;
ALTER TABLE model_route_configs ADD CONSTRAINT model_route_configs_scope_check CHECK(scope IN ('system_default','task_group','task','node','book','one_time'));
ALTER TABLE model_route_configs DROP CONSTRAINT model_route_configs_check;
ALTER TABLE model_route_configs ADD CONSTRAINT model_route_configs_shape_check CHECK(
  (scope='system_default' AND task_group IS NULL AND task_key IS NULL AND node_key IS NULL AND book_id IS NULL AND override_key IS NULL) OR
  (scope='task_group' AND task_group IS NOT NULL AND task_key IS NULL AND node_key IS NULL AND book_id IS NULL AND override_key IS NULL) OR
  (scope='task' AND task_key IS NOT NULL AND node_key IS NULL AND book_id IS NULL AND override_key IS NULL) OR
  (scope='node' AND node_key IS NOT NULL AND task_key IS NULL AND book_id IS NULL AND override_key IS NULL) OR
  (scope='book' AND book_id IS NOT NULL AND task_group IS NULL AND task_key IS NULL AND node_key IS NULL AND override_key IS NULL) OR
  (scope='one_time' AND override_key IS NOT NULL AND task_key IS NULL AND node_key IS NULL)
);
DROP INDEX model_route_configs_scope_unique;
CREATE UNIQUE INDEX model_route_configs_scope_unique ON model_route_configs(scope,task_group,task_key,node_key,book_id,override_key) NULLS NOT DISTINCT WHERE status='active';

CREATE TABLE book_research_adoption_batches (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK(source_kind IN ('research_version','reference_pack_version')),
  source_id uuid NOT NULL,
  source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','adopted','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE book_research_adoption_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES book_research_adoption_batches(id) ON DELETE CASCADE,
  source_candidate_id uuid NOT NULL REFERENCES research_candidates(id),
  target_type_key text NOT NULL,
  title text NOT NULL,
  values jsonb NOT NULL CHECK(jsonb_typeof(values)='object'),
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  decision text NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','adopt','reject')),
  target_card_id uuid REFERENCES cards(id),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,source_candidate_id),
  UNIQUE(batch_id,sort_order)
);

CREATE TABLE book_research_adoption_events (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES book_research_adoption_batches(id),
  action text NOT NULL CHECK(action IN ('preview','edit','decide','adopt','cancel')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  idempotency_key text NOT NULL,
  actor text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,idempotency_key)
);

CREATE TABLE ai_run_previews (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES card_spaces(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  task_group text NOT NULL,
  task_node_key text NOT NULL,
  source_route text NOT NULL,
  source_kind text NOT NULL,
  source_id uuid,
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  prompt_recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id),
  context_preview_id uuid NOT NULL REFERENCES context_previews(id),
  context_manifest_id uuid NOT NULL REFERENCES context_manifests(id),
  model_route_snapshot_id uuid NOT NULL REFERENCES model_route_snapshots(id),
  input_snapshot jsonb NOT NULL CHECK(jsonb_typeof(input_snapshot)='object'),
  input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
  safe_checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(safe_checkpoint)='object'),
  budget_snapshot jsonb NOT NULL CHECK(jsonb_typeof(budget_snapshot)='object'),
  prompt_plan jsonb NOT NULL CHECK(jsonb_typeof(prompt_plan)='object'),
  route_plan jsonb NOT NULL CHECK(jsonb_typeof(route_plan)='object'),
  blocker_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(blocker_snapshot)='array'),
  preview_hash char(64) NOT NULL CHECK(preview_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK(status IN ('ready','blocked','stale','submitted')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id,idempotency_key)
);

CREATE TABLE ai_run_prompt_sections (
  id uuid PRIMARY KEY,
  preview_id uuid NOT NULL REFERENCES ai_run_previews(id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  section_kind text NOT NULL CHECK(section_kind IN ('instruction','formal_data','reference','output_contract')),
  label text NOT NULL,
  source_refs jsonb NOT NULL CHECK(jsonb_typeof(source_refs)='array'),
  token_estimate integer NOT NULL CHECK(token_estimate>=0),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE(preview_id,sort_order)
);

CREATE TABLE ai_run_submissions (
  id uuid PRIMARY KEY,
  preview_id uuid NOT NULL UNIQUE REFERENCES ai_run_previews(id),
  ai_task_id uuid NOT NULL UNIQUE REFERENCES ai_tasks(id),
  submitted_revision integer NOT NULL CHECK(submitted_revision>0),
  idempotency_key text NOT NULL UNIQUE,
  submitted_by text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION guard_ai_run_prompt_section() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'run prompt sections are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER ai_run_prompt_sections_guard BEFORE UPDATE OR DELETE ON ai_run_prompt_sections FOR EACH ROW EXECUTE FUNCTION guard_ai_run_prompt_section();
CREATE TRIGGER ai_run_submissions_guard BEFORE UPDATE OR DELETE ON ai_run_submissions FOR EACH ROW EXECUTE FUNCTION guard_ai_run_prompt_section();
CREATE FUNCTION guard_ai_run_preview_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'run previews cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','revision','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at']::text[]) OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'run preview snapshots are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.status='ready' AND NEW.status IN ('stale','submitted')) OR (OLD.status='blocked' AND NEW.status='stale')) THEN
    RAISE EXCEPTION 'invalid run preview transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_run_previews_guard BEFORE UPDATE OR DELETE ON ai_run_previews FOR EACH ROW EXECUTE FUNCTION guard_ai_run_preview_update();

CREATE INDEX book_research_adoption_batches_book_idx ON book_research_adoption_batches(book_id,updated_at DESC,id DESC);
CREATE INDEX ai_run_previews_book_idx ON ai_run_previews(book_id,created_at DESC,id DESC);

COMMENT ON TABLE book_research_adoption_batches IS 'Book-local editable adoption preview over shared immutable research candidates. A source update creates a new source version and never overwrites this snapshot.';
COMMENT ON TABLE ai_run_previews IS 'Unified immutable pre-run receipt freezing contract, recipe, context, route, input, checkpoint, budget and blockers before an AI task enters Outbox.';

INSERT INTO prompt_recipes(id,recipe_key,name,description)
VALUES('72000000-0000-4000-8000-000000000001','builtin.novel.production','长篇小说生产配方','组合角色边界、正式事实约束、创作任务说明与输出合同。')
ON CONFLICT(recipe_key) DO NOTHING;
INSERT INTO prompt_recipe_versions(id,recipe_id,version,source,status,variables_schema,content_hash,created_by)
SELECT '72100000-0000-4000-8000-000000000001',id,1,'system','published','{"type":"object","properties":{"task_input":{"type":"object"}}}'::jsonb,dependency_content_hash('builtin.novel.production.v1'),'system'
FROM prompt_recipes WHERE recipe_key='builtin.novel.production' AND current_version_id IS NULL ON CONFLICT DO NOTHING;
UPDATE prompt_recipes SET current_version_id='72100000-0000-4000-8000-000000000001',published_version_id='72100000-0000-4000-8000-000000000001' WHERE recipe_key='builtin.novel.production' AND current_version_id IS NULL AND EXISTS(SELECT 1 FROM prompt_recipe_versions WHERE id='72100000-0000-4000-8000-000000000001' AND recipe_id=prompt_recipes.id);
INSERT INTO prompt_recipe_slots(id,recipe_version_id,slot_key,sort_order,required,allowed_content_types,variable_contract) VALUES
('72200000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000001','system_role',0,true,ARRAY['system_role'],'{}'),
('72200000-0000-4000-8000-000000000002','72100000-0000-4000-8000-000000000001','business_rules',1,true,ARRAY['business_constraint'],'{}')
ON CONFLICT DO NOTHING;
INSERT INTO prompt_recipe_slot_components(id,recipe_version_id,slot_id,component_card_id,component_version_id,sort_order,required) VALUES
('72300000-0000-4000-8000-000000000001','72100000-0000-4000-8000-000000000001','72200000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000001',0,true),
('72300000-0000-4000-8000-000000000002','72100000-0000-4000-8000-000000000001','72200000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000002','69000000-0000-4000-8000-000000000002',0,true),
('72300000-0000-4000-8000-000000000003','72100000-0000-4000-8000-000000000001','72200000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000004','69000000-0000-4000-8000-000000000004',1,true)
ON CONFLICT DO NOTHING;

INSERT INTO task_contracts(id,task_key,name,description)
VALUES('72400000-0000-4000-8000-000000000001','chapter.write','章节正文创作','依据采用规划、正式资料与精确上下文生成可审阅正文候选。')
ON CONFLICT(task_key) DO NOTHING;
INSERT INTO task_contract_versions(id,contract_id,version,source,status,task_group,input_schema,input_schema_version,output_schema,output_schema_version,context_policy_version,prompt_recipe_version_id,required_capabilities,budget_policy,timeout_ms,retry_policy,confirmation_policy,content_hash,created_by)
SELECT '72500000-0000-4000-8000-000000000001',id,1,'system','published','writing','{"type":"object","additionalProperties":true}'::jsonb,'chapter-write-input.v1','{"type":"object","required":["content"],"properties":{"content":{"type":"string"}}}'::jsonb,'chapter-write-output.v1','context-binding.v1','72100000-0000-4000-8000-000000000001',ARRAY['long_context','structured_output'],'{"maxTokens":16000,"reserveOutputTokens":6000}'::jsonb,120000,'{"maxAttempts":5,"technicalOnly":true}'::jsonb,'before_execute',dependency_content_hash('chapter.write.v1'),'system'
FROM task_contracts WHERE task_key='chapter.write' AND current_version_id IS NULL ON CONFLICT DO NOTHING;
UPDATE task_contracts SET current_version_id='72500000-0000-4000-8000-000000000001',published_version_id='72500000-0000-4000-8000-000000000001' WHERE task_key='chapter.write' AND current_version_id IS NULL AND EXISTS(SELECT 1 FROM task_contract_versions WHERE id='72500000-0000-4000-8000-000000000001' AND contract_id=task_contracts.id);

INSERT INTO task_contracts(id,task_key,name,description)
VALUES('72400000-0000-4000-8000-000000000002','chapter.extract_changes','章节变化提取','从候选正文提取事实、角色所知、状态与伏笔变化候选。')
ON CONFLICT(task_key) DO NOTHING;
INSERT INTO task_contract_versions(id,contract_id,version,source,status,task_group,input_schema,input_schema_version,output_schema,output_schema_version,context_policy_version,prompt_recipe_version_id,required_capabilities,budget_policy,timeout_ms,retry_policy,confirmation_policy,content_hash,created_by)
SELECT '72500000-0000-4000-8000-000000000002',id,1,'system','published','settlement','{"type":"object","additionalProperties":true}'::jsonb,'chapter-extract-input.v1','{"type":"object","required":["items"],"properties":{"items":{"type":"array"}}}'::jsonb,'chapter-extract-output.v1','context-binding.v1','72100000-0000-4000-8000-000000000001',ARRAY['long_context','structured_output'],'{"maxTokens":12000,"reserveOutputTokens":4000}'::jsonb,90000,'{"maxAttempts":5,"technicalOnly":true}'::jsonb,'before_adopt',dependency_content_hash('chapter.extract_changes.v1'),'system'
FROM task_contracts WHERE task_key='chapter.extract_changes' AND current_version_id IS NULL ON CONFLICT DO NOTHING;
UPDATE task_contracts SET current_version_id='72500000-0000-4000-8000-000000000002',published_version_id='72500000-0000-4000-8000-000000000002' WHERE task_key='chapter.extract_changes' AND current_version_id IS NULL AND EXISTS(SELECT 1 FROM task_contract_versions WHERE id='72500000-0000-4000-8000-000000000002' AND contract_id=task_contracts.id);

INSERT INTO model_route_configs(id,scope,name)
SELECT '72600000-0000-4000-8000-000000000001','system_default','系统默认模型路由'
WHERE NOT EXISTS(SELECT 1 FROM model_route_configs WHERE scope='system_default' AND status='active');
INSERT INTO model_route_versions(id,config_id,version,source,status,provider,model,parameters,required_capabilities,budget_policy,timeout_ms,retry_policy,fallback_mode,content_hash,created_by)
SELECT '72700000-0000-4000-8000-000000000001',id,1,'system','published','ollama','MiniMax-M3','{"temperature":0.7}'::jsonb,ARRAY['structured_output'],'{"maxTokens":16000}'::jsonb,120000,'{"maxAttempts":5,"technicalOnly":true}'::jsonb,'inherit',dependency_content_hash('system.route.v1'),'system'
FROM model_route_configs WHERE id='72600000-0000-4000-8000-000000000001' ON CONFLICT DO NOTHING;
UPDATE model_route_configs SET current_version_id='72700000-0000-4000-8000-000000000001',published_version_id='72700000-0000-4000-8000-000000000001' WHERE id='72600000-0000-4000-8000-000000000001' AND current_version_id IS NULL;

INSERT INTO schema_migrations(id) VALUES('042_research_prompt_runtime_orchestration') ON CONFLICT(id) DO NOTHING;
