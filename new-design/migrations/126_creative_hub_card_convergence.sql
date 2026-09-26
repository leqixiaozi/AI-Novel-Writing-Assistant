-- 创作中枢会话收敛为卡片；诊断轮次收敛为不可变动作状态。
-- 本阶段只复制数据，旧表由 131 在最终核对后统一删除。
SET search_path TO new_design, public;

DO $$
BEGIN
  IF to_regclass('new_design.card_version_actions') IS NULL OR
     to_regclass('new_design.creative_hub_threads') IS NULL OR
     to_regclass('new_design.creative_hub_turns') IS NULL THEN
    RAISE EXCEPTION 'creative hub migration 115 and convergence migration 123 must be installed before 126';
  END IF;
  IF EXISTS(SELECT 1 FROM creative_hub_threads legacy JOIN cards card ON card.id=legacy.id) THEN
    RAISE EXCEPTION 'creative hub thread identifiers collide with existing cards';
  END IF;
  IF EXISTS(
    SELECT 1 FROM creative_hub_turns legacy
    JOIN card_version_actions action ON action.request_key=legacy.request_key
  ) THEN
    RAISE EXCEPTION 'creative hub request keys collide with existing card actions';
  END IF;
END $$;

INSERT INTO card_types(id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields)
VALUES(
  '12600000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'creative_hub_thread','创作中枢会话',
  '只读创作诊断会话；绑定信息进入卡片版本，诊断状态进入不可变动作账本。',
  'published',1,NULL,
  '[{"key":"binding","name":"来源绑定","type":"json","required":true},{"key":"thread_revision","name":"会话修订号","type":"number","required":true}]'::jsonb
)
ON CONFLICT(space_id,type_key) DO NOTHING;

INSERT INTO card_type_versions(id,card_type_id,version,fields)
SELECT '12600000-0000-4000-8000-000000000101',id,1,draft_fields
FROM card_types
WHERE space_id='00000000-0000-4000-8000-000000000001' AND type_key='creative_hub_thread'
ON CONFLICT(card_type_id,version) DO NOTHING;

UPDATE card_types type SET current_version_id=version.id
FROM card_type_versions version
WHERE version.card_type_id=type.id AND version.version=1
  AND type.space_id='00000000-0000-4000-8000-000000000001'
  AND type.type_key='creative_hub_thread' AND type.current_version_id IS NULL;

INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at,archived_at)
SELECT thread.id,'00000000-0000-4000-8000-000000000001',type.id,thread.title,thread.status,
  greatest(thread.revision,1),type.current_version_id,md5('creative_hub.thread.version:'||thread.id::text)::uuid,
  jsonb_build_object('record_kind','creative_hub_thread','binding',thread.binding,'thread_revision',thread.revision),
  thread.created_at,thread.updated_at,CASE WHEN thread.status='archived' THEN thread.updated_at ELSE NULL END
FROM creative_hub_threads thread
JOIN card_types type ON type.type_key='creative_hub_thread' AND type.status='published'
ORDER BY CASE WHEN type.space_id='00000000-0000-4000-8000-000000000001' THEN 0 ELSE 1 END;

INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
SELECT md5('creative_hub.thread.version:'||thread.id::text)::uuid,thread.id,1,type.current_version_id,thread.title,
  jsonb_build_object('record_kind','creative_hub_thread','binding',thread.binding,'thread_revision',thread.revision),
  CASE WHEN thread.status='archived' THEN 'archive' ELSE 'create' END,thread.created_at
FROM creative_hub_threads thread
JOIN card_types type ON type.type_key='creative_hub_thread' AND type.status='published'
ORDER BY CASE WHEN type.space_id='00000000-0000-4000-8000-000000000001' THEN 0 ELSE 1 END;

INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
SELECT md5('creative_hub.turn.started:'||turn.id::text)::uuid,turn.thread_id,NULL,
  'creative_hub.turn.started',turn.request_key,turn.request_hash,
  jsonb_build_object(
    'turn_id',turn.id,'request_key',turn.request_key,'request_hash',turn.request_hash,
    'question',turn.question,'frozen_state',turn.frozen_state,'status','running',
    'result',NULL,'failure',NULL,'prompt_snapshot',NULL,'model_snapshot',NULL,
    'used_tokens',NULL,'turn_created_at',turn.created_at,'completed_at',NULL
  ),turn.created_at
FROM creative_hub_turns turn;

INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,payload,created_at)
SELECT turn.id,turn.thread_id,NULL,'creative_hub.turn.'||turn.status,
  jsonb_build_object(
    'turn_id',turn.id,'request_key',turn.request_key,'request_hash',turn.request_hash,
    'question',turn.question,'frozen_state',turn.frozen_state,'status',turn.status,
    'result',turn.result,'failure',turn.failure,'prompt_snapshot',turn.prompt_snapshot,
    'model_snapshot',turn.model_snapshot,'used_tokens',turn.used_tokens,
    'turn_created_at',turn.created_at,'completed_at',turn.completed_at
  ),turn.updated_at
FROM creative_hub_turns turn
WHERE turn.status<>'running';

DO $$
BEGIN
  IF (SELECT count(*) FROM creative_hub_threads)<>(
    SELECT count(*) FROM cards card JOIN card_types type ON type.id=card.card_type_id
    WHERE type.type_key='creative_hub_thread'
  ) THEN RAISE EXCEPTION 'creative hub thread count mismatch'; END IF;
  IF (SELECT count(*) FROM creative_hub_turns)<>(
    SELECT count(*) FROM card_version_actions WHERE action_key='creative_hub.turn.started'
  ) THEN RAISE EXCEPTION 'creative hub turn count mismatch'; END IF;
END $$;
