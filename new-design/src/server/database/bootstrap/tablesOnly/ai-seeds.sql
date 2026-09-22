-- Actual built-in contracts/recipe from 042. Author component versions come from 010/author-seeds.
-- No provider, model, endpoint or credential is invented. Explicit model-init copies selected local configuration.
-- Per-request world/quality/writing/image contracts remain frozen by their existing request-specific service.
SET LOCAL search_path TO new_design,public;
INSERT INTO prompt_recipes(id,recipe_key,name,description)
VALUES('72000000-0000-4000-8000-000000000001','builtin.novel.production','长篇小说生产配方','组合角色边界、正式事实约束、创作任务说明与输出合同。')
ON CONFLICT(recipe_key) DO NOTHING;
INSERT INTO prompt_recipe_versions(id,recipe_id,version,source,status,variables_schema,content_hash,created_by)
SELECT '72100000-0000-4000-8000-000000000001',id,1,'system','published','{"type":"object","properties":{"task_input":{"type":"object"}}}'::jsonb,dependency_content_hash('builtin.novel.production.v1'),'system'
FROM prompt_recipes WHERE recipe_key='builtin.novel.production' AND current_version_id IS NULL ON CONFLICT DO NOTHING;
UPDATE prompt_recipes SET current_version_id='72100000-0000-4000-8000-000000000001',published_version_id='72100000-0000-4000-8000-000000000001' WHERE recipe_key='builtin.novel.production' AND current_version_id IS NULL AND EXISTS(SELECT 1 FROM prompt_recipe_versions WHERE id='72100000-0000-4000-8000-000000000001' AND recipe_id=prompt_recipes.id);

DO $recipe_slots$
DECLARE seed record; owner_space uuid:='00000000-0000-4000-8000-000000000001';
BEGIN
 FOR seed IN SELECT * FROM (VALUES
 ('72200000-0000-4000-8000-000000000001'::uuid,'system_role'::text,0,ARRAY['system_role']::text[]),
 ('72200000-0000-4000-8000-000000000002'::uuid,'business_rules'::text,1,ARRAY['business_constraint']::text[])
 ) source(id,slot_key,sort_order,allowed_content_types) LOOP
  PERFORM kernel_store_record('prompt_recipe_slot',owner_space,seed.id,jsonb_build_object(
   'id',seed.id,'recipe_version_id','72100000-0000-4000-8000-000000000001','slot_key',seed.slot_key,
   'sort_order',seed.sort_order,'required',true,'allowed_content_types',to_jsonb(seed.allowed_content_types),'variable_contract','{}'::jsonb));
 END LOOP;
 FOR seed IN SELECT * FROM (VALUES
 ('72300000-0000-4000-8000-000000000001'::uuid,'72200000-0000-4000-8000-000000000001'::uuid,'68000000-0000-4000-8000-000000000001'::uuid,'69000000-0000-4000-8000-000000000001'::uuid,0),
 ('72300000-0000-4000-8000-000000000002'::uuid,'72200000-0000-4000-8000-000000000002'::uuid,'68000000-0000-4000-8000-000000000002'::uuid,'69000000-0000-4000-8000-000000000002'::uuid,0),
 ('72300000-0000-4000-8000-000000000003'::uuid,'72200000-0000-4000-8000-000000000002'::uuid,'68000000-0000-4000-8000-000000000004'::uuid,'69000000-0000-4000-8000-000000000004'::uuid,1)
 ) source(id,slot_id,component_card_id,component_version_id,sort_order) LOOP
  IF NOT EXISTS(SELECT 1 FROM card_versions version JOIN cards card ON card.id=version.card_id
   WHERE version.id=seed.component_version_id AND card.id=seed.component_card_id) THEN
   RAISE EXCEPTION 'built-in recipe requires its exact original public prompt component version';
  END IF;
  PERFORM kernel_store_record('prompt_recipe_slot_component',owner_space,seed.id,jsonb_build_object(
   'id',seed.id,'recipe_version_id','72100000-0000-4000-8000-000000000001','slot_id',seed.slot_id,
   'component_card_id',seed.component_card_id,'component_version_id',seed.component_version_id,'sort_order',seed.sort_order,'required',true));
 END LOOP;
END $recipe_slots$;
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
