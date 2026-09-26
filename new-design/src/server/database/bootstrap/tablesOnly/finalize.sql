-- 能力登记必须在完整表、领域保护与确定性基础数据之后；不代表已调用模型或作者验收。
SET LOCAL search_path TO new_design,public;
DO $finalize$
DECLARE required_function text; required_type text;
BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relkind IN('r','p'))<>79
  OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design_projection' AND c.relkind IN('r','p'))<>4
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('new_design','new_design_projection') AND c.relkind IN('v','m'))
  OR to_regnamespace('new_design_compat') IS NOT NULL THEN
  RAISE EXCEPTION '完整纯表结构必须为79张应用表、4张AGE投影表、零业务视图与零兼容schema';
 END IF;
 FOREACH required_function IN ARRAY ARRAY[
  'new_design.kernel_store_record(text,uuid,uuid,jsonb)',
  'new_design.sync_type_version_fields(uuid)',
  'new_design.assert_character_dialogue_selection(jsonb)',
  'new_design.assert_character_author_trial(jsonb,jsonb)',
  'new_design.assert_character_author_influence(jsonb,jsonb)',
  'new_design.assert_resource_supplement_formal_closure(uuid)',
  'new_design.assert_resource_correction_candidate_source(uuid)',
  'new_design.reconcile_chapter_revision_after_checkpoint(uuid)',
  'new_design.activate_embedding_generation(uuid)'
 ] LOOP
  IF to_regprocedure(required_function) IS NULL THEN RAISE EXCEPTION '纯表业务保护尚未完整安装：%',required_function; END IF;
 END LOOP;
 FOREACH required_type IN ARRAY ARRAY[
  'template_group','template_group_version','card_group_form','card_group_form_version','dictionary_definition',
  'planning_object','planning_version','chapter_adoption_session','chapter_stable_checkpoint',
  'creative_hub_thread','world_generation_session','comic_project','drama_project',
  'public_title_factory_trial','public_character_trial','image_prompt_preparation',
  'character_dialogue_session','character_dialogue_round','character_author_trial','character_author_influence_candidate',
  'book_content_history_snapshot','book_content_history_restore','model_route_fallback'
 ] LOOP
  IF NOT EXISTS(SELECT 1 FROM card_types type JOIN card_type_versions version ON version.id=type.current_version_id AND version.card_type_id=type.id
    WHERE type.type_key=required_type AND type.is_internal AND type.status='published') THEN
   RAISE EXCEPTION '纯表内部目录缺少正式类型：%',required_type;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='new_design.card_version_actions'::regclass AND tgname='card_version_actions_immutable' AND tgenabled='O')
  OR NOT EXISTS(SELECT 1 FROM relation_types WHERE relation_key='world_sample_relation' AND status='published')
  OR NOT EXISTS(SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id WHERE type.type_key='template_group_version')
  OR NOT EXISTS(SELECT 1 FROM task_contracts WHERE task_key='chapter.write' AND published_version_id IS NOT NULL) THEN
  RAISE EXCEPTION '动作历史保护、世界样本关系或开书/写作基础数据未就绪';
 END IF;
END $finalize$;

INSERT INTO system_capabilities(capability_key,installed,operational,details)
SELECT key,true,true,jsonb_build_object('storage','tables_only','baseline','132_card_kernel_tables_only','applicationTables',79,'projectionTables',4,'businessViews',0)
FROM unnest(ARRAY[
 'card_kernel_v2','comic_projects_v1','public_character_profile_v1','public_character_trial_v1',
 'image_prompt_preparation_v1','character_dialogue_v1','character_author_v1','character_author_influence_v1',
 'public_title_factory_v1','book_content_history_v1'
]) keys(key);
INSERT INTO schema_migrations(id) VALUES('132_card_kernel_tables_only');
-- TABLES_ONLY_BASELINE_COMPLETE
