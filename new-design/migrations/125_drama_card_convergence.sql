-- 短剧内容收敛到卡片内核。供应商执行任务与导出制品继续使用专用账本。
-- 必须在 118-124 之后执行，并在一个事务内整体完成。
SET search_path TO new_design, public;

DO $$
BEGIN
  IF to_regclass('new_design.card_version_actions') IS NULL OR
     to_regclass('new_design.drama_projects') IS NULL OR
     to_regclass('new_design.drama_export_manifests') IS NULL THEN
    RAISE EXCEPTION 'drama migrations 118-122 and card convergence migrations must be installed before 125';
  END IF;
  IF EXISTS(
    SELECT request_key FROM (
      SELECT create_request_key request_key FROM drama_projects
      UNION ALL SELECT request_key FROM drama_stage_versions
      UNION ALL SELECT request_key FROM drama_stage_adoptions
      UNION ALL SELECT request_key FROM drama_script_versions
      UNION ALL SELECT request_key FROM drama_script_adoptions
      UNION ALL SELECT request_key FROM drama_quality_reports
      UNION ALL SELECT request_key FROM drama_storyboard_versions
      UNION ALL SELECT request_key FROM drama_storyboard_adoptions
      UNION ALL SELECT request_key FROM drama_media_prompt_versions
    ) requests GROUP BY request_key HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'drama request keys collide across legacy ledgers'; END IF;
END $$;

INSERT INTO card_types(id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields)
VALUES
 ('12500000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','drama_project','短剧项目','短剧项目和冻结来源。','published',1,NULL,'[]'),
 ('12500000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','drama_stage','短剧阶段内容','策略、人物和分集候选。','published',1,NULL,'[]'),
 ('12500000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','drama_script','短剧台本','分集台本候选。','published',1,NULL,'[]'),
 ('12500000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','drama_storyboard','短剧分镜','台本分镜候选。','published',1,NULL,'[]'),
 ('12500000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','drama_quality_report','短剧质量报告','冻结台本版本的质量检查。','published',1,NULL,'[]'),
 ('12500000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','drama_media_prompt','短剧媒体提示词','分镜镜头的媒体提示词版本。','published',1,NULL,'[]')
ON CONFLICT(space_id,type_key) DO NOTHING;

INSERT INTO card_type_versions(id,card_type_id,version,fields)
SELECT md5('125:drama-type:'||type.id::text)::uuid,type.id,1,type.draft_fields
FROM card_types type
WHERE type.space_id='00000000-0000-4000-8000-000000000001'
  AND type.type_key IN('drama_project','drama_stage','drama_script','drama_storyboard','drama_quality_report','drama_media_prompt')
ON CONFLICT(card_type_id,version) DO NOTHING;
UPDATE card_types type SET current_version_id=version.id FROM card_type_versions version
WHERE version.card_type_id=type.id AND version.version=1
  AND type.type_key IN('drama_project','drama_stage','drama_script','drama_storyboard','drama_quality_report','drama_media_prompt')
  AND type.current_version_id IS NULL;

-- 项目与来源。
INSERT INTO card_spaces(id,space_key,name,created_at)
SELECT project.id,'drama:'||project.id::text,project.title,project.created_at FROM drama_projects project;
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT project.id,project.id,type.id,project.title,'active',greatest(project.revision,1),type.current_version_id,source.id,
 jsonb_build_object('record_kind','drama_project','source_type',project.source_type,'track',project.track,
  'target_episodes',project.target_episodes,'episode_duration_sec',project.episode_duration_sec,'source_version_id',source.id,
  'source_snapshot',jsonb_build_object('source_book_id',source.source_book_id,'source_book_name',source.source_book_name,
   'content',source.content,'content_hash',source.content_hash,'manifest',source.manifest)),project.created_at,project.updated_at
FROM drama_projects project JOIN drama_source_versions source ON source.id=project.adopted_source_version_id
JOIN card_types type ON type.type_key='drama_project' AND type.status='published';
INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT source.id,project.id,source.version,type.current_version_id,project.title,
 jsonb_build_object('record_kind','drama_project','source_type',project.source_type,'track',project.track,
  'target_episodes',project.target_episodes,'episode_duration_sec',project.episode_duration_sec,'source_version_id',source.id,
  'source_snapshot',jsonb_build_object('source_book_id',source.source_book_id,'source_book_name',source.source_book_name,
   'content',source.content,'content_hash',source.content_hash,'manifest',source.manifest)),CASE WHEN source.version=1 THEN 'create' ELSE 'edit' END,source.created_at
FROM drama_source_versions source JOIN drama_projects project ON project.id=source.project_id
JOIN card_types type ON type.type_key='drama_project' AND type.status='published';
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('drama_project.create:'||project.id::text)::uuid,project.id,project.adopted_source_version_id,'drama_project.create',project.create_request_key,project.create_input_hash,
 jsonb_build_object('sourceType',project.source_type,'track',project.track),project.created_at FROM drama_projects project;

-- 策略、人物和分集。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT entity.id,entity.project_id,type.id,
 CASE entity.stage_kind WHEN 'strategy' THEN '短剧策略' WHEN 'character' THEN coalesce(latest.content->>'name','短剧人物') ELSE '第 '||coalesce(entity.logical_order,0)||' 集：'||coalesce(latest.content->>'title','') END,
 'active',greatest(entity.revision,1),type.current_version_id,latest.id,
 jsonb_build_object('record_kind','drama_stage','project_id',entity.project_id,'stage_kind',entity.stage_kind,'logical_order',entity.logical_order,
  'workflow_revision',entity.revision,'adopted_version_id',entity.adopted_version_id,'version',latest.version,
  'source_version_id',latest.source_version_id,'upstream_version_ids',latest.upstream_version_ids,'content',latest.content,'source_kind',latest.source_kind),entity.created_at,entity.updated_at
FROM drama_stage_entities entity
JOIN LATERAL(SELECT * FROM drama_stage_versions version WHERE version.entity_id=entity.id ORDER BY version.version DESC,version.id DESC LIMIT 1) latest ON true
JOIN card_types type ON type.type_key='drama_stage' AND type.status='published';
INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT version.id,version.entity_id,version.version,type.current_version_id,
 CASE entity.stage_kind WHEN 'strategy' THEN '短剧策略' WHEN 'character' THEN coalesce(version.content->>'name','短剧人物') ELSE '第 '||coalesce(entity.logical_order,0)||' 集：'||coalesce(version.content->>'title','') END,
 jsonb_build_object('record_kind','drama_stage','project_id',entity.project_id,'stage_kind',entity.stage_kind,'logical_order',entity.logical_order,
  'workflow_revision',entity.revision,'adopted_version_id',entity.adopted_version_id,'version',version.version,
  'source_version_id',version.source_version_id,'upstream_version_ids',version.upstream_version_ids,'content',version.content,'source_kind',version.source_kind),
 CASE WHEN version.version=1 THEN 'create' ELSE 'edit' END,version.created_at
FROM drama_stage_versions version JOIN drama_stage_entities entity ON entity.id=version.entity_id
JOIN card_types type ON type.type_key='drama_stage' AND type.status='published';
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('drama_stage.candidate:'||version.id::text)::uuid,version.entity_id,version.id,'drama_stage.candidate',version.request_key,version.input_hash,jsonb_build_object('stageKind',entity.stage_kind),version.created_at
FROM drama_stage_versions version JOIN drama_stage_entities entity ON entity.id=version.entity_id;
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT adoption.id,adoption.entity_id,adoption.version_id,'drama_stage.adopt',adoption.request_key,adoption.input_hash,jsonb_build_object('revision',adoption.revision,'projectId',adoption.project_id),adoption.created_at FROM drama_stage_adoptions adoption;

-- 台本。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT entity.id,entity.project_id,type.id,coalesce(latest.content->>'title','短剧台本'),'active',greatest(entity.revision,1),type.current_version_id,latest.id,
 jsonb_build_object('record_kind','drama_script','project_id',entity.project_id,'episode_entity_id',entity.episode_entity_id,
  'workflow_revision',entity.revision,'adopted_version_id',entity.adopted_version_id,'version',latest.version,
  'episode_version_id',latest.episode_version_id,'content',latest.content,'source_kind',latest.source_kind),entity.created_at,entity.updated_at
FROM drama_script_entities entity
JOIN LATERAL(SELECT * FROM drama_script_versions version WHERE version.entity_id=entity.id ORDER BY version.version DESC,version.id DESC LIMIT 1) latest ON true
JOIN card_types type ON type.type_key='drama_script' AND type.status='published';
INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT version.id,version.entity_id,version.version,type.current_version_id,coalesce(version.content->>'title','短剧台本'),
 jsonb_build_object('record_kind','drama_script','project_id',entity.project_id,'episode_entity_id',entity.episode_entity_id,
  'workflow_revision',entity.revision,'adopted_version_id',entity.adopted_version_id,'version',version.version,
  'episode_version_id',version.episode_version_id,'content',version.content,'source_kind',version.source_kind),
 CASE WHEN version.version=1 THEN 'create' ELSE 'edit' END,version.created_at
FROM drama_script_versions version JOIN drama_script_entities entity ON entity.id=version.entity_id
JOIN card_types type ON type.type_key='drama_script' AND type.status='published';
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('drama_script.candidate:'||version.id::text)::uuid,version.entity_id,version.id,'drama_script.candidate',version.request_key,version.input_hash,jsonb_build_object('sourceKind',version.source_kind),version.created_at FROM drama_script_versions version;
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT adoption.id,adoption.entity_id,adoption.version_id,'drama_script.adopt',adoption.request_key,adoption.input_hash,jsonb_build_object('revision',adoption.revision,'projectId',adoption.project_id),adoption.created_at FROM drama_script_adoptions adoption;

-- 分镜。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT entity.id,entity.project_id,type.id,'短剧分镜','active',greatest(entity.revision,1),type.current_version_id,latest.id,
 jsonb_build_object('record_kind','drama_storyboard','project_id',entity.project_id,'script_entity_id',entity.script_entity_id,
  'workflow_revision',entity.revision,'adopted_version_id',entity.adopted_version_id,'version',latest.version,
  'script_version_id',latest.script_version_id,'content',latest.content,'source_kind',latest.source_kind),entity.created_at,entity.updated_at
FROM drama_storyboard_entities entity
JOIN LATERAL(SELECT * FROM drama_storyboard_versions version WHERE version.entity_id=entity.id ORDER BY version.version DESC,version.id DESC LIMIT 1) latest ON true
JOIN card_types type ON type.type_key='drama_storyboard' AND type.status='published';
INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT version.id,version.entity_id,version.version,type.current_version_id,'短剧分镜',
 jsonb_build_object('record_kind','drama_storyboard','project_id',entity.project_id,'script_entity_id',entity.script_entity_id,
  'workflow_revision',entity.revision,'adopted_version_id',entity.adopted_version_id,'version',version.version,
  'script_version_id',version.script_version_id,'content',version.content,'source_kind',version.source_kind),
 CASE WHEN version.version=1 THEN 'create' ELSE 'edit' END,version.created_at
FROM drama_storyboard_versions version JOIN drama_storyboard_entities entity ON entity.id=version.entity_id
JOIN card_types type ON type.type_key='drama_storyboard' AND type.status='published';
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('drama_storyboard.candidate:'||version.id::text)::uuid,version.entity_id,version.id,'drama_storyboard.candidate',version.request_key,version.input_hash,jsonb_build_object('sourceKind',version.source_kind),version.created_at FROM drama_storyboard_versions version;
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT adoption.id,adoption.entity_id,adoption.version_id,'drama_storyboard.adopt',adoption.request_key,adoption.input_hash,jsonb_build_object('revision',adoption.revision,'projectId',adoption.project_id),adoption.created_at FROM drama_storyboard_adoptions adoption;

-- 质量报告，每份报告是一张不可变卡片。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT report.id,report.project_id,type.id,'台本质量检查','active',1,type.current_version_id,report.id,
 jsonb_build_object('record_kind','drama_quality_report','project_id',report.project_id,'script_version_id',report.script_version_id,
  'rule_version',report.rule_version,'issues',report.issues,'passed',report.passed,'source_hash',report.source_hash),report.created_at,report.created_at
FROM drama_quality_reports report JOIN card_types type ON type.type_key='drama_quality_report' AND type.status='published';
INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT report.id,report.id,1,type.current_version_id,'台本质量检查',
 jsonb_build_object('record_kind','drama_quality_report','project_id',report.project_id,'script_version_id',report.script_version_id,
  'rule_version',report.rule_version,'issues',report.issues,'passed',report.passed,'source_hash',report.source_hash),'create',report.created_at
FROM drama_quality_reports report JOIN card_types type ON type.type_key='drama_quality_report' AND type.status='published';
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('drama_quality.inspect:'||report.id::text)::uuid,report.id,report.id,'drama_quality.inspect',report.request_key,report.source_hash,jsonb_build_object('scriptVersionId',report.script_version_id),report.created_at FROM drama_quality_reports report;

-- 媒体提示词：相同分镜版本、镜头和媒体类型共用稳定卡片。
INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
SELECT md5('drama_media_prompt:'||latest.project_id::text||':'||latest.storyboard_version_id::text||':'||latest.shot_key||':'||latest.media_kind)::uuid,
 latest.project_id,type.id,latest.shot_key||' · '||latest.media_kind,'active',greatest(latest.version,1),type.current_version_id,latest.id,
 jsonb_build_object('record_kind','drama_media_prompt','project_id',latest.project_id,'storyboard_version_id',latest.storyboard_version_id,
  'shot_key',latest.shot_key,'media_kind',latest.media_kind,'version',latest.version,'content',latest.content),latest.created_at,latest.created_at
FROM (SELECT DISTINCT ON(project_id,storyboard_version_id,shot_key,media_kind) * FROM drama_media_prompt_versions ORDER BY project_id,storyboard_version_id,shot_key,media_kind,version DESC,id DESC) latest
JOIN card_types type ON type.type_key='drama_media_prompt' AND type.status='published';
INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT prompt.id,md5('drama_media_prompt:'||prompt.project_id::text||':'||prompt.storyboard_version_id::text||':'||prompt.shot_key||':'||prompt.media_kind)::uuid,
 prompt.version,type.current_version_id,prompt.shot_key||' · '||prompt.media_kind,
 jsonb_build_object('record_kind','drama_media_prompt','project_id',prompt.project_id,'storyboard_version_id',prompt.storyboard_version_id,
  'shot_key',prompt.shot_key,'media_kind',prompt.media_kind,'version',prompt.version,'content',prompt.content),
 CASE WHEN prompt.version=1 THEN 'create' ELSE 'edit' END,prompt.created_at
FROM drama_media_prompt_versions prompt JOIN card_types type ON type.type_key='drama_media_prompt' AND type.status='published';
INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('drama_media_prompt.candidate:'||prompt.id::text)::uuid,
 md5('drama_media_prompt:'||prompt.project_id::text||':'||prompt.storyboard_version_id::text||':'||prompt.shot_key||':'||prompt.media_kind)::uuid,
 prompt.id,'drama_media_prompt.candidate',prompt.request_key,prompt.input_hash,
 jsonb_build_object('storyboardVersionId',prompt.storyboard_version_id,'shotKey',prompt.shot_key,'mediaKind',prompt.media_kind),prompt.created_at
FROM drama_media_prompt_versions prompt;

-- 123-130 只复制和重接数据；旧表、旧外键和保护函数由 131 在全量核对后统一处理。
