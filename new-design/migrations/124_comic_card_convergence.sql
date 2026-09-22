-- 漫画内容收敛到卡片内核。成图、文件和导出仍保留专用媒体账本。
-- 本迁移必须在 109-114、117 与 123 之后执行，并在一个事务内整体完成。
SET search_path TO new_design, public;

DO $$
BEGIN
  IF to_regclass('new_design.card_version_actions') IS NULL OR
     to_regclass('new_design.comic_projects') IS NULL OR
     to_regclass('new_design.comic_render_versions') IS NULL THEN
    RAISE EXCEPTION 'comic migrations 109-114, 117 and convergence migration 123 must be installed before 124';
  END IF;
  IF EXISTS(
    SELECT request_key FROM (
      SELECT create_request_key request_key FROM comic_projects
      UNION ALL SELECT request_key FROM comic_source_bundle_versions
      UNION ALL SELECT request_key FROM comic_source_bundle_adoptions
      UNION ALL SELECT request_key FROM comic_episode_versions
      UNION ALL SELECT request_key FROM comic_episode_adoptions
      UNION ALL SELECT request_key FROM comic_panel_sets
      UNION ALL SELECT request_key FROM comic_panel_set_adoptions
      UNION ALL SELECT request_key FROM comic_bible_versions
      UNION ALL SELECT request_key FROM comic_bible_adoptions
    ) requests GROUP BY request_key HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'comic request keys collide across legacy ledgers';
  END IF;
END $$;

INSERT INTO card_types(id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields)
VALUES
  ('12400000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','comic_project','漫画项目','漫画项目与冻结来源快照。','published',1,NULL,'[]'),
  ('12400000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','comic_source_bundle','漫画来源整理','项目来源的结构化整理候选。','published',1,NULL,'[]'),
  ('12400000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','comic_episode','漫画分话','漫画分话大纲及候选版本。','published',1,NULL,'[]'),
  ('12400000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','comic_panel_script','漫画分格脚本','整话分格脚本及采用状态。','published',1,NULL,'[]'),
  ('12400000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','comic_bible','漫画角色与场景设定','漫画角色或场景的设定候选。','published',1,NULL,'[]')
ON CONFLICT(space_id,type_key) DO NOTHING;

INSERT INTO card_type_versions(id,card_type_id,version,fields)
SELECT md5('124:comic-type:'||type.id::text)::uuid,type.id,1,type.draft_fields
FROM card_types type
WHERE type.space_id='00000000-0000-4000-8000-000000000001'
  AND type.type_key IN('comic_project','comic_source_bundle','comic_episode','comic_panel_script','comic_bible')
ON CONFLICT(card_type_id,version) DO NOTHING;

UPDATE card_types type SET current_version_id=version.id
FROM card_type_versions version
WHERE version.card_type_id=type.id AND version.version=1
  AND type.type_key IN('comic_project','comic_source_bundle','comic_episode','comic_panel_script','comic_bible')
  AND type.current_version_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cards_space_id_id_unique ON cards(space_id,id);

-- 项目和冻结来源：项目本身成为独立空间中的根卡片，原来源版本 ID 原样保留。
INSERT INTO card_spaces(id,space_key,name,created_at)
SELECT project.id,'comic:'||project.id::text,project.title,project.created_at
FROM comic_projects project;

INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT project.id,project.id,type.id,project.title,'active',greatest(project.revision,1),type.current_version_id,NULL,
  jsonb_build_object(
    'record_kind','comic_project','source_type',project.source_type,'comic_format',project.comic_format,
    'style_preset',project.style_preset,'source_version_id',source.id,
    'source_snapshot',jsonb_build_object('source_book_id',source.source_book_id,'source_book_name',source.source_book_name,
      'content',source.content,'content_hash',source.content_hash,'manifest',source.manifest)
  ),project.created_at,project.updated_at
FROM comic_projects project
JOIN comic_source_versions source ON source.id=project.adopted_source_version_id AND source.project_id=project.id
JOIN card_types type ON type.type_key='comic_project' AND type.status='published'
ORDER BY CASE WHEN type.space_id='00000000-0000-4000-8000-000000000001' THEN 0 ELSE 1 END
ON CONFLICT(id) DO NOTHING;

INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT source.id,project.id,source.version,type.current_version_id,project.title,
  jsonb_build_object(
    'record_kind','comic_project','source_type',project.source_type,'comic_format',project.comic_format,
    'style_preset',project.style_preset,'source_version_id',source.id,
    'source_snapshot',jsonb_build_object('source_book_id',source.source_book_id,'source_book_name',source.source_book_name,
      'content',source.content,'content_hash',source.content_hash,'manifest',source.manifest)
  ),CASE WHEN source.version=1 THEN 'create' ELSE 'edit' END,source.created_at
FROM comic_source_versions source
JOIN comic_projects project ON project.id=source.project_id
JOIN card_types type ON type.type_key='comic_project' AND type.status='published'
ON CONFLICT(id) DO NOTHING;

UPDATE cards card SET current_version_id=project.adopted_source_version_id
FROM comic_projects project WHERE card.id=project.id;

INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('comic_project.create:'||project.id::text)::uuid,project.id,project.adopted_source_version_id,
  'comic_project.create',project.create_request_key,project.create_input_hash,
  jsonb_build_object('sourceType',project.source_type,'comicFormat',project.comic_format,'stylePreset',project.style_preset),project.created_at
FROM comic_projects project;

-- 来源整理：每个项目只有一张稳定卡片，候选继续保留原版本 ID。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT md5('comic_source_bundle:'||state.project_id::text)::uuid,state.project_id,type.id,'来源整理','active',greatest(state.revision,1),type.current_version_id,latest.id,
  jsonb_build_object('record_kind','comic_source_bundle','project_id',state.project_id,'workflow_revision',state.revision,
    'adopted_version_id',state.adopted_version_id,'version',latest.version,'source_version_id',latest.source_version_id,
    'source_kind',latest.source_kind,'content',latest.content),latest.created_at,state.updated_at
FROM comic_source_bundle_state state
JOIN LATERAL(SELECT * FROM comic_source_bundle_versions version WHERE version.project_id=state.project_id ORDER BY version.version DESC,version.id DESC LIMIT 1) latest ON true
JOIN card_types type ON type.type_key='comic_source_bundle' AND type.status='published';

INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT version.id,md5('comic_source_bundle:'||version.project_id::text)::uuid,version.version,type.current_version_id,'来源整理',
  jsonb_build_object('record_kind','comic_source_bundle','project_id',version.project_id,'workflow_revision',state.revision,
    'adopted_version_id',state.adopted_version_id,'version',version.version,'source_version_id',version.source_version_id,
    'source_kind',version.source_kind,'content',version.content),CASE WHEN version.version=1 THEN 'create' ELSE 'edit' END,version.created_at
FROM comic_source_bundle_versions version JOIN comic_source_bundle_state state ON state.project_id=version.project_id
JOIN card_types type ON type.type_key='comic_source_bundle' AND type.status='published';

INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('comic_source_bundle.candidate:'||version.id::text)::uuid,md5('comic_source_bundle:'||version.project_id::text)::uuid,
  version.id,'comic_source_bundle.candidate',version.request_key,version.input_hash,jsonb_build_object('sourceKind',version.source_kind),version.created_at
FROM comic_source_bundle_versions version;
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT adoption.id,md5('comic_source_bundle:'||adoption.project_id::text)::uuid,adoption.version_id,'comic_source_bundle.adopt',
  adoption.request_key,adoption.input_hash,jsonb_build_object('revision',adoption.revision,'projectId',adoption.project_id),adoption.created_at
FROM comic_source_bundle_adoptions adoption;

-- 分话大纲。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT episode.id,episode.project_id,type.id,latest.content->>'title','active',greatest(episode.revision,1),type.current_version_id,latest.id,
  jsonb_build_object('record_kind','comic_episode','project_id',episode.project_id,'episode_order',episode.episode_order,
    'workflow_revision',episode.revision,'adopted_version_id',episode.adopted_version_id,'script_revision',episode.script_revision,
    'adopted_panel_set_id',episode.adopted_panel_set_id,'version',latest.version,'source_kind',latest.source_kind,
    'source_version_id',latest.source_version_id,'content',latest.content),episode.created_at,episode.updated_at
FROM comic_episodes episode
JOIN LATERAL(SELECT * FROM comic_episode_versions version WHERE version.episode_id=episode.id ORDER BY version.version DESC,version.id DESC LIMIT 1) latest ON true
JOIN card_types type ON type.type_key='comic_episode' AND type.status='published';

INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT version.id,version.episode_id,version.version,type.current_version_id,version.content->>'title',
  jsonb_build_object('record_kind','comic_episode','project_id',version.project_id,'episode_order',episode.episode_order,
    'workflow_revision',episode.revision,'adopted_version_id',episode.adopted_version_id,'script_revision',episode.script_revision,
    'adopted_panel_set_id',episode.adopted_panel_set_id,'version',version.version,'source_kind',version.source_kind,
    'source_version_id',version.source_version_id,'content',version.content),CASE WHEN version.version=1 THEN 'create' ELSE 'edit' END,version.created_at
FROM comic_episode_versions version JOIN comic_episodes episode ON episode.id=version.episode_id
JOIN card_types type ON type.type_key='comic_episode' AND type.status='published';

INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('comic_episode.candidate:'||version.id::text)::uuid,version.episode_id,version.id,'comic_episode.candidate',
  version.request_key,version.input_hash,jsonb_build_object('sourceKind',version.source_kind),version.created_at
FROM comic_episode_versions version;
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT adoption.id,adoption.episode_id,adoption.version_id,'comic_episode.adopt',adoption.request_key,adoption.input_hash,
  jsonb_build_object('revision',adoption.revision,'projectId',adoption.project_id),adoption.created_at
FROM comic_episode_adoptions adoption;

-- 整话分格脚本；分格明细作为不可变版本中的数组保存，原分格 ID 保留给成图记录引用。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT md5('comic_panel_script:'||episode.id::text)::uuid,episode.project_id,type.id,
  '第 '||episode.episode_order||' 话分格','active',greatest(episode.script_revision,1),type.current_version_id,latest.id,
  jsonb_build_object('record_kind','comic_panel_script','project_id',episode.project_id,'episode_id',episode.id,
    'workflow_revision',episode.script_revision,'adopted_version_id',episode.adopted_panel_set_id,'version',latest.version,
    'episode_version_id',latest.episode_version_id,'density_mode',latest.density_mode,'source_kind',latest.source_kind,
    'panels',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',panel.id,'order',panel.panel_order,'panelType',panel.panel_type,
      'action',panel.action,'dialogues',panel.dialogues,'characterRefs',panel.character_refs,'sceneRef',panel.scene_ref,
      'visualPrompt',panel.visual_prompt,'densityLevel',panel.density_level,'focus',panel.focus,'layoutData',panel.layout_data)
      ORDER BY panel.panel_order),'[]'::jsonb) FROM comic_panels panel WHERE panel.panel_set_id=latest.id)),
  latest.created_at,episode.updated_at
FROM comic_episodes episode
JOIN LATERAL(SELECT * FROM comic_panel_sets set_row WHERE set_row.episode_id=episode.id ORDER BY set_row.version DESC,set_row.id DESC LIMIT 1) latest ON true
JOIN card_types type ON type.type_key='comic_panel_script' AND type.status='published';

INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT set_row.id,md5('comic_panel_script:'||set_row.episode_id::text)::uuid,set_row.version,type.current_version_id,
  '第 '||episode.episode_order||' 话分格',
  jsonb_build_object('record_kind','comic_panel_script','project_id',set_row.project_id,'episode_id',set_row.episode_id,
    'workflow_revision',episode.script_revision,'adopted_version_id',episode.adopted_panel_set_id,'version',set_row.version,
    'episode_version_id',set_row.episode_version_id,'density_mode',set_row.density_mode,'source_kind',set_row.source_kind,
    'panels',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',panel.id,'order',panel.panel_order,'panelType',panel.panel_type,
      'action',panel.action,'dialogues',panel.dialogues,'characterRefs',panel.character_refs,'sceneRef',panel.scene_ref,
      'visualPrompt',panel.visual_prompt,'densityLevel',panel.density_level,'focus',panel.focus,'layoutData',panel.layout_data)
      ORDER BY panel.panel_order),'[]'::jsonb) FROM comic_panels panel WHERE panel.panel_set_id=set_row.id)),
  CASE WHEN set_row.version=1 THEN 'create' ELSE 'edit' END,set_row.created_at
FROM comic_panel_sets set_row JOIN comic_episodes episode ON episode.id=set_row.episode_id
JOIN card_types type ON type.type_key='comic_panel_script' AND type.status='published';

INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('comic_panel_script.candidate:'||set_row.id::text)::uuid,md5('comic_panel_script:'||set_row.episode_id::text)::uuid,
  set_row.id,'comic_panel_script.candidate',set_row.request_key,set_row.input_hash,jsonb_build_object('sourceKind',set_row.source_kind),set_row.created_at
FROM comic_panel_sets set_row;
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT adoption.id,md5('comic_panel_script:'||adoption.episode_id::text)::uuid,adoption.set_id,'comic_panel_script.adopt',
  adoption.request_key,adoption.input_hash,jsonb_build_object('revision',adoption.revision,'projectId',adoption.project_id,'episodeId',adoption.episode_id),adoption.created_at
FROM comic_panel_set_adoptions adoption;

-- 角色和场景 Bible。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT entity.id,entity.project_id,type.id,coalesce(latest.content->>'name',entity.kind),'active',greatest(entity.revision,1),type.current_version_id,latest.id,
  jsonb_build_object('record_kind','comic_bible','project_id',entity.project_id,'kind',entity.kind,
    'workflow_revision',entity.revision,'adopted_version_id',entity.adopted_version_id,'version',latest.version,
    'content',latest.content,'source_kind',latest.source_kind),entity.created_at,entity.updated_at
FROM comic_bible_entities entity
JOIN LATERAL(SELECT * FROM comic_bible_versions version WHERE version.entity_id=entity.id ORDER BY version.version DESC,version.id DESC LIMIT 1) latest ON true
JOIN card_types type ON type.type_key='comic_bible' AND type.status='published';

INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT version.id,version.entity_id,version.version,type.current_version_id,coalesce(version.content->>'name',entity.kind),
  jsonb_build_object('record_kind','comic_bible','project_id',entity.project_id,'kind',entity.kind,
    'workflow_revision',entity.revision,'adopted_version_id',entity.adopted_version_id,'version',version.version,
    'content',version.content,'source_kind',version.source_kind),CASE WHEN version.version=1 THEN 'create' ELSE 'edit' END,version.created_at
FROM comic_bible_versions version JOIN comic_bible_entities entity ON entity.id=version.entity_id
JOIN card_types type ON type.type_key='comic_bible' AND type.status='published';

INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('comic_bible.candidate:'||version.id::text)::uuid,version.entity_id,version.id,'comic_bible.candidate',
  version.request_key,version.input_hash,jsonb_build_object('kind',entity.kind),version.created_at
FROM comic_bible_versions version JOIN comic_bible_entities entity ON entity.id=version.entity_id;
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT adoption.id,adoption.entity_id,adoption.version_id,'comic_bible.adopt',adoption.request_key,adoption.input_hash,
  jsonb_build_object('revision',adoption.revision,'projectId',adoption.project_id),adoption.created_at
FROM comic_bible_adoptions adoption;

-- 123-130 只复制和重接数据；旧表、旧外键和保护函数由 131 在全量核对后统一处理。
