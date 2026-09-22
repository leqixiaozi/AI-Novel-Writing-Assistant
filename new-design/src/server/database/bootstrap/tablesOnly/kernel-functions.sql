-- 内部工作流记录的原生写入口：只追加版本，不修改历史，也不接受旧表名。
-- 当前指针可以在同事务插入版本前填写，但提交时必须指向本对象的版本。
ALTER TABLE new_design.cards ADD CONSTRAINT cards_current_version_owner_fk
 FOREIGN KEY(current_version_id,id) REFERENCES new_design.card_versions(id,card_id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX kernel_card_type_version_owner ON new_design.card_type_versions(id,card_type_id);
ALTER TABLE new_design.card_types ADD CONSTRAINT card_types_current_version_owner_fk
 FOREIGN KEY(current_version_id,id) REFERENCES new_design.card_type_versions(id,card_type_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE new_design.cards ADD CONSTRAINT cards_type_version_owner_fk
 FOREIGN KEY(type_version_id,card_type_id) REFERENCES new_design.card_type_versions(id,card_type_id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX kernel_record_logical_identity ON new_design.cards(space_id,card_type_id,(values->>'id')) WHERE values ? 'id';

CREATE OR REPLACE FUNCTION new_design.kernel_store_record(
 p_type_key text,p_space_id uuid,p_logical_id uuid,p_values jsonb
) RETURNS uuid LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE kind record; current_card record; card_id uuid; version_id uuid;
 next_revision integer; payload jsonb; created timestamptz;
BEGIN
 IF p_space_id IS NULL OR p_logical_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION '内部记录缺少明确空间、身份或对象负载';
 END IF;
 SELECT * INTO kind FROM card_types WHERE type_key=p_type_key AND is_internal
  AND status='published' AND current_version_id IS NOT NULL
  ORDER BY CASE WHEN space_id='00000000-0000-4000-8000-000000000001'::uuid THEN 0 ELSE 1 END,id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION '内部记录类型未发布：%',p_type_key; END IF;
 IF p_values ? 'id' AND p_values->>'id' IS DISTINCT FROM p_logical_id::text THEN
  RAISE EXCEPTION '内部记录身份不可替换';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('record:'||p_type_key||':'||p_space_id||':'||p_logical_id,0));
 IF (SELECT count(*) FROM cards WHERE space_id=p_space_id AND card_type_id=kind.id AND values->>'id'=p_logical_id::text)>1 THEN
  RAISE EXCEPTION '内部记录逻辑身份不唯一，禁止猜测覆盖';
 END IF;
 SELECT card.* INTO current_card FROM cards card WHERE card.space_id=p_space_id
  AND card.card_type_id=kind.id AND card.values->>'id'=p_logical_id::text FOR UPDATE;
 IF FOUND AND current_card.status<>'active' THEN RAISE EXCEPTION '内部记录已归档，不能隐式恢复'; END IF;
 created:=coalesce((p_values->>'created_at')::timestamptz,current_card.created_at,now());
 payload:=jsonb_build_object('id',p_logical_id,'status','active','revision',1,'created_at',created,'updated_at',now())
  ||CASE WHEN p_values ? 'owner_space_id' THEN '{}'::jsonb ELSE jsonb_build_object('space_id',p_space_id) END||p_values;
 IF current_card.id IS NOT NULL THEN
  card_id:=current_card.id;
  next_revision:=current_card.revision+1;
 ELSE
  -- 逻辑身份可以跨业务类型相同，物理主键不能冲突。
  card_id:=md5('record:'||p_type_key||':'||p_space_id||':'||p_logical_id)::uuid;
  next_revision:=1;
  INSERT INTO cards(id,space_id,card_type_id,title,status,revision,type_version_id,values,created_at)
   VALUES(card_id,p_space_id,kind.id,p_type_key,'active',1,kind.current_version_id,payload,created);
 END IF;
 version_id:=gen_random_uuid();
 INSERT INTO card_versions(id,card_id,revision,type_version_id,title,values,source)
  VALUES(version_id,card_id,next_revision,kind.current_version_id,coalesce(current_card.title,p_type_key),payload,
   CASE WHEN next_revision=1 THEN 'create' ELSE 'edit' END);
 UPDATE cards SET current_version_id=version_id,values=payload,revision=next_revision,updated_at=now()
  WHERE id=card_id;
 RETURN card_id;
END $$;

CREATE OR REPLACE FUNCTION new_design.kernel_reject_history_change() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN RAISE EXCEPTION '已保存的版本与动作历史不可覆盖或删除'; END $$;

CREATE TRIGGER card_version_actions_immutable BEFORE UPDATE OR DELETE ON new_design.card_version_actions
 FOR EACH ROW EXECUTE FUNCTION new_design.kernel_reject_history_change();

-- 作者保存回执在同一事务内补写一次；内容、来源和已有回执始终不可变。
CREATE OR REPLACE FUNCTION new_design.kernel_protect_card_version() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.author_request_key IS NULL AND NEW.author_request_key IS NOT NULL
  AND (to_jsonb(NEW)-ARRAY['author_book_id','author_request_key','author_input_hash','author_write_receipt'])
      IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['author_book_id','author_request_key','author_input_hash','author_write_receipt'])
  AND NEW.author_write_receipt->>'cardVersionId'=OLD.id::text
  AND NEW.author_write_receipt->>'requestKey'=NEW.author_request_key::text
  AND NEW.author_write_receipt->>'inputHash'=NEW.author_input_hash::text
  AND EXISTS(SELECT 1 FROM cards card JOIN books book ON book.space_id=card.space_id
    JOIN card_types type ON type.id=card.card_type_id AND NOT type.is_internal
    WHERE card.id=OLD.card_id AND card.current_version_id=OLD.id AND book.id=NEW.author_book_id)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION '版本内容、来源及已保存回执不可覆盖或删除';
END $$;
CREATE TRIGGER card_versions_immutable BEFORE UPDATE OR DELETE ON new_design.card_versions
 FOR EACH ROW EXECUTE FUNCTION new_design.kernel_protect_card_version();
CREATE TRIGGER card_type_versions_immutable BEFORE UPDATE OR DELETE ON new_design.card_type_versions
 FOR EACH ROW EXECUTE FUNCTION new_design.kernel_reject_history_change();
CREATE TRIGGER card_relation_versions_immutable BEFORE UPDATE OR DELETE ON new_design.card_relation_versions
 FOR EACH ROW EXECUTE FUNCTION new_design.kernel_reject_history_change();

-- 正文锚点必须引用本书的精确正文；资料锚点必须留在同一作品空间。
CREATE OR REPLACE FUNCTION new_design.kernel_validate_text_anchor() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE body record; subject_space uuid;
BEGIN
 IF NEW.body_version_id IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.subject_card_id AND space_id=NEW.space_id)
   OR NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.chapter_card_id AND space_id=NEW.space_id)
   OR NEW.scene_card_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.scene_card_id AND space_id=NEW.space_id) THEN
   RAISE EXCEPTION '资料锚点不能跨作品空间';
  END IF;
 ELSE
  SELECT version.content,book.space_id INTO body FROM chapter_body_versions version
   JOIN chapter_documents document ON document.id=version.chapter_document_id
   JOIN books book ON book.id=document.book_id
   WHERE version.id=NEW.body_version_id AND document.id=NEW.chapter_document_id AND book.id=NEW.book_id;
  IF NOT FOUND OR NEW.end_offset>length(body.content)
   OR substring(body.content FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset) IS DISTINCT FROM NEW.excerpt THEN
   RAISE EXCEPTION '正文锚点范围或原文与精确版本不一致';
  END IF;
  IF NEW.subject_card_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cards WHERE id=NEW.subject_card_id AND space_id=body.space_id) THEN
   RAISE EXCEPTION '正文锚点对象不属于本书';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.body_version_id IS NOT NULL AND
  (to_jsonb(NEW)-ARRAY['status','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at']) THEN
  RAISE EXCEPTION '已引用的正文锚点来源不可替换';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER text_anchors_scope_guard BEFORE INSERT OR UPDATE ON new_design.text_anchors
 FOR EACH ROW EXECUTE FUNCTION new_design.kernel_validate_text_anchor();

-- 保留专用 AI 执行账本的状态机与冻结契约；不通过卡片状态绕过执行约束。
CREATE FUNCTION new_design.guard_ai_attempt_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
DECLARE debug_task boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AI attempts cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('succeeded','failed','cancelled','discarded') THEN RAISE EXCEPTION 'finished AI attempt is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','provider_request_digest','result_kind','result_stable_id','result_version_id','result_hash','error_category','retry_eligibility','error_summary','started_at','ended_at','debug_result','debug_execution','debug_failure']::text[]) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','provider_request_digest','result_kind','result_stable_id','result_version_id','result_hash','error_category','retry_eligibility','error_summary','started_at','ended_at','debug_result','debug_execution','debug_failure']::text[]) THEN
    RAISE EXCEPTION 'AI attempt frozen inputs are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','cancelled')) OR (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled','discarded'))) THEN
    RAISE EXCEPTION 'illegal AI attempt status transition' USING ERRCODE='23514';
  END IF;
  SELECT source_kind='prompt_composition_debug' INTO debug_task FROM new_design.ai_tasks WHERE id=OLD.task_id;
  IF debug_task IS true AND NEW.status IN ('succeeded','failed','cancelled','discarded') THEN
    IF (NEW.status='succeeded' AND (NEW.debug_result IS NULL OR NEW.debug_execution IS NULL OR NEW.debug_failure IS NOT NULL)) OR
       (NEW.status IN ('failed','cancelled','discarded') AND (NEW.debug_failure IS NULL OR NEW.debug_result IS NOT NULL)) THEN
      RAISE EXCEPTION 'debug terminal outcome is incomplete' USING ERRCODE='23514';
    END IF;
  END IF;
  IF ROW(NEW.debug_result,NEW.debug_execution,NEW.debug_failure) IS DISTINCT FROM ROW(OLD.debug_result,OLD.debug_execution,OLD.debug_failure) THEN
    IF debug_task IS DISTINCT FROM true OR OLD.status<>'running' OR NEW.status NOT IN ('succeeded','failed','cancelled','discarded') OR OLD.debug_result IS NOT NULL OR OLD.debug_execution IS NOT NULL OR OLD.debug_failure IS NOT NULL THEN
      RAISE EXCEPTION 'debug payload can only be frozen once when a debug attempt terminates' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION new_design.guard_ai_contract_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'contract history is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME IN ('prompt_recipe_versions','task_contract_versions','model_route_versions') THEN
    IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'published contract content is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status='rejected' AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'rejected version is final' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'snapshot detail is immutable' USING ERRCODE='23514';
END $$;

CREATE FUNCTION new_design.guard_ai_ledger_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$ BEGIN RAISE EXCEPTION 'AI ledger rows are append-only' USING ERRCODE='23514'; END $$;

CREATE FUNCTION new_design.guard_ai_step_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','checkpoint_key','current_attempt_id','retry_count','next_retry_at','lease_owner','lease_token','lease_expires_at','heartbeat_at','revision','updated_at','completed_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','checkpoint_key','current_attempt_id','retry_count','next_retry_at','lease_owner','lease_token','lease_expires_at','heartbeat_at','revision','updated_at','completed_at']::text[]) THEN
    RAISE EXCEPTION 'AI step definition is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'AI step revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','paused','cancelled')) OR
          (OLD.status='running' AND NEW.status IN ('running','waiting_approval','retry_scheduled','paused','succeeded','failed','cancelled')) OR
          (OLD.status='waiting_approval' AND NEW.status IN ('running','paused','failed','cancelled')) OR
          (OLD.status='retry_scheduled' AND NEW.status IN ('running','paused','failed','cancelled')) OR
          (OLD.status='paused' AND NEW.status IN ('running','failed','cancelled'))) THEN
    RAISE EXCEPTION 'illegal AI step status transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION new_design.guard_ai_task_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','current_step_key','current_checkpoint','revision','updated_at','completed_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_step_key','current_checkpoint','revision','updated_at','completed_at']::text[]) THEN
    RAISE EXCEPTION 'AI task identity and frozen contract are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'AI task revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='queued' AND NEW.status IN ('running','paused','cancelled')) OR
          (OLD.status='running' AND NEW.status IN ('running','waiting_approval','retry_scheduled','paused','succeeded','failed','cancelled')) OR
          (OLD.status='waiting_approval' AND NEW.status IN ('running','paused','failed','cancelled')) OR
          (OLD.status='retry_scheduled' AND NEW.status IN ('running','paused','failed','cancelled')) OR
          (OLD.status='paused' AND NEW.status IN ('running','failed','cancelled'))) THEN
    RAISE EXCEPTION 'illegal AI task status transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION new_design.guard_chapter_body_version_content() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'new_design', 'ag_catalog', 'public'
    AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['archived_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['archived_at']::text[]) THEN
    RAISE EXCEPTION 'chapter body version content and provenance are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL THEN
    RAISE EXCEPTION 'chapter body version archive is one way' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ai_attempt_usage_append_only BEFORE DELETE OR UPDATE ON new_design.ai_attempt_usage FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_ledger_append_only();
CREATE TRIGGER ai_task_attempts_update_guard BEFORE DELETE OR UPDATE ON new_design.ai_task_attempts FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_attempt_update();
CREATE TRIGGER ai_task_state_events_append_only BEFORE DELETE OR UPDATE ON new_design.ai_task_events FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_ledger_append_only();
CREATE TRIGGER ai_task_steps_transition_guard BEFORE UPDATE ON new_design.ai_task_steps FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_step_transition();
CREATE TRIGGER ai_tasks_transition_guard BEFORE UPDATE ON new_design.ai_tasks FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_task_transition();
CREATE TRIGGER chapter_body_versions_content_guard BEFORE UPDATE ON new_design.chapter_body_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_chapter_body_version_content();
CREATE TRIGGER context_manifest_entries_immutable BEFORE DELETE OR UPDATE ON new_design.context_manifest_items FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();
CREATE TRIGGER context_manifests_immutable BEFORE DELETE OR UPDATE ON new_design.context_manifests FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();
CREATE TRIGGER model_route_snapshots_immutable BEFORE DELETE OR UPDATE ON new_design.model_route_snapshots FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();
CREATE TRIGGER model_route_versions_immutable BEFORE DELETE OR UPDATE ON new_design.model_route_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();
CREATE TRIGGER prompt_recipe_versions_immutable BEFORE DELETE OR UPDATE ON new_design.prompt_recipe_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();
CREATE TRIGGER task_contract_versions_immutable BEFORE DELETE OR UPDATE ON new_design.task_contract_versions FOR EACH ROW EXECUTE FUNCTION new_design.guard_ai_contract_immutable();
