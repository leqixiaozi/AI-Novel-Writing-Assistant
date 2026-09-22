-- Converge workflow candidates and receipts on the card kernel.
-- Manual migration after 116. This first slice replaces the three dedicated
-- world-generation tables while preserving their public API contract.
SET search_path TO new_design, public;

CREATE TABLE card_version_actions (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id),
  card_version_id uuid,
  action_key text NOT NULL CHECK (length(btrim(action_key)) BETWEEN 1 AND 120),
  request_key uuid,
  input_hash char(64),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  receipt jsonb CHECK (receipt IS NULL OR jsonb_typeof(receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(card_version_id,card_id) REFERENCES card_versions(id,card_id),
  CHECK ((request_key IS NULL AND input_hash IS NULL) OR
         (request_key IS NOT NULL AND input_hash ~ '^[a-f0-9]{64}$'))
);
CREATE UNIQUE INDEX card_version_actions_request_unique
  ON card_version_actions(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX card_version_actions_card_recent
  ON card_version_actions(card_id,created_at DESC,id DESC);

CREATE FUNCTION guard_card_version_actions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'card version actions are immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER card_version_actions_immutable
  BEFORE UPDATE OR DELETE ON card_version_actions
  FOR EACH ROW EXECUTE FUNCTION guard_card_version_actions_immutable();

INSERT INTO card_types(
  id,space_id,type_key,name,description,status,revision,current_version_id,draft_fields
) VALUES (
  '12300000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'world_generation_session',
  '世界生成会话',
  '世界生成的稳定身份；候选、失败和发布状态均追加为卡片版本。',
  'published',1,NULL,
  '[{"key":"record_kind","name":"记录类型","type":"short_text","required":true},{"key":"workflow_status","name":"工作流状态","type":"short_text","required":true},{"key":"blueprint","name":"生成蓝图","type":"json","required":true},{"key":"frozen_references","name":"冻结参考","type":"json","required":true},{"key":"candidate","name":"候选内容","type":"json","required":false}]'::jsonb
) ON CONFLICT(space_id,type_key) DO NOTHING;

INSERT INTO card_type_versions(id,card_type_id,version,fields)
SELECT
  '12300000-0000-4000-8000-000000000101',id,1,draft_fields
FROM card_types
WHERE space_id='00000000-0000-4000-8000-000000000001'
  AND type_key='world_generation_session'
ON CONFLICT(card_type_id,version) DO NOTHING;

UPDATE card_types
SET current_version_id=(
  SELECT version.id FROM card_type_versions version
  WHERE version.card_type_id=card_types.id AND version.version=1
)
WHERE space_id='00000000-0000-4000-8000-000000000001'
  AND type_key='world_generation_session'
  AND current_version_id IS NULL;

DO $$
DECLARE session_row record;
DECLARE candidate_row record;
DECLARE publication_row record;
DECLARE type_id uuid;
DECLARE type_version_id uuid;
DECLARE initial_version_id uuid;
DECLARE v_current_version_id uuid;
DECLARE current_values jsonb;
BEGIN
  IF to_regclass('new_design.world_generation_sessions') IS NULL THEN
    RAISE EXCEPTION 'world generation migration 116 must be installed before 123';
  END IF;

  SELECT type.id,type.current_version_id INTO STRICT type_id,type_version_id
  FROM card_types type
  WHERE type.space_id='00000000-0000-4000-8000-000000000001'
    AND type.type_key='world_generation_session'
    AND type.status='published';

  IF EXISTS(
    SELECT 1 FROM world_generation_sessions session JOIN cards card ON card.id=session.id
  ) OR EXISTS(
    SELECT 1 FROM world_generation_sessions session JOIN card_versions version ON version.id=session.id
  ) OR EXISTS(
    SELECT 1 FROM world_generation_candidates candidate JOIN card_versions version ON version.id=candidate.id
  ) THEN
    RAISE EXCEPTION 'world generation identifiers collide with existing card-kernel identities';
  END IF;

  FOR session_row IN SELECT * FROM world_generation_sessions ORDER BY created_at,id LOOP
    initial_version_id:=session_row.id;
    v_current_version_id:=initial_version_id;
    current_values:=jsonb_build_object(
      'record_kind','world_generation_session',
      'request_key',session_row.create_request_key,
      'request_hash',session_row.request_hash,
      'blueprint',session_row.blueprint,
      'frozen_references',session_row.frozen_references,
      'source_hash',session_row.source_hash,
      'workflow_status',session_row.status,
      'failure',session_row.failure,
      'published_candidate_id',session_row.published_candidate_id,
      'public_root_card_id',session_row.public_root_card_id,
      'published_package_id',session_row.published_package_id
    );

    INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values,created_at,updated_at)
    VALUES(session_row.id,'00000000-0000-4000-8000-000000000001',type_id,session_row.name,'active',session_row.revision,type_version_id,NULL,current_values,session_row.created_at,session_row.updated_at);
    INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
    VALUES(initial_version_id,session_row.id,1,type_version_id,session_row.name,current_values,'create',session_row.created_at);
    INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
    VALUES(md5('world_generation.create:'||session_row.id::text)::uuid,session_row.id,initial_version_id,'world_generation.create',session_row.create_request_key,session_row.request_hash,
      jsonb_build_object('name',session_row.name,'blueprint',session_row.blueprint,'frozenReferences',session_row.frozen_references),session_row.created_at);

    FOR candidate_row IN SELECT * FROM world_generation_candidates WHERE session_id=session_row.id ORDER BY version,id LOOP
      current_values:=current_values||jsonb_build_object(
        'record_kind','world_generation_candidate',
        'candidate_version',candidate_row.version,
        'candidate_request_key',candidate_row.request_key,
        'candidate_source',candidate_row.source,
        'based_on_candidate_id',candidate_row.based_on_candidate_id,
        'candidate',candidate_row.candidate,
        'prompt_snapshot',candidate_row.prompt_snapshot,
        'model_snapshot',candidate_row.model_snapshot,
        'used_tokens',candidate_row.used_tokens
      );
      INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source,created_at)
      VALUES(candidate_row.id,session_row.id,candidate_row.version+1,type_version_id,session_row.name,current_values,'edit',candidate_row.created_at);
      INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,created_at)
      VALUES(md5('world_generation.candidate:'||candidate_row.id::text)::uuid,session_row.id,candidate_row.id,'world_generation.candidate',candidate_row.request_key,candidate_row.request_hash,
        jsonb_build_object('source',candidate_row.source,'basedOnCandidateId',candidate_row.based_on_candidate_id),candidate_row.created_at);
      v_current_version_id:=candidate_row.id;
    END LOOP;

    UPDATE cards SET current_version_id=v_current_version_id,values=current_values WHERE id=session_row.id;

    FOR publication_row IN SELECT * FROM world_generation_publications WHERE session_id=session_row.id ORDER BY created_at,id LOOP
      INSERT INTO card_version_actions(id,card_id,card_version_id,action_key,request_key,input_hash,payload,receipt,created_at)
      VALUES(publication_row.id,session_row.id,publication_row.candidate_id,'world_generation.publish',publication_row.request_key,publication_row.input_hash,publication_row.input,publication_row.receipt,publication_row.created_at);
    END LOOP;
  END LOOP;
END; $$;

-- 123-130 只复制和重接数据；旧表由 131 在全量核对后统一删除。
