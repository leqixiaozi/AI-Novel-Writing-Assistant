SET search_path TO new_design, public;

-- Select the actual table and operation before accessing its record fields.
-- SQL boolean expressions do not guarantee short-circuit record access.
CREATE OR REPLACE FUNCTION bridge_dependency_change_events() RETURNS trigger LANGUAGE plpgsql
SET search_path TO new_design, ag_catalog, public AS $$
DECLARE old_resource uuid; new_resource uuid; stable_id uuid; confirmed_id uuid;
BEGIN
  CASE TG_TABLE_NAME
  WHEN 'chapter_body_adoptions' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.from_version_id IS NULL THEN RETURN NEW; END IF;
      old_resource:=register_dependency_resource('chapter_body_version',NEW.chapter_document_id,NEW.from_version_id);
      new_resource:=register_dependency_resource('chapter_body_version',NEW.chapter_document_id,NEW.to_version_id);
      PERFORM invalidate_registered_resource(old_resource,new_resource,'正文采用版本发生变化。','body_adoption',NEW.id,'body-adoption:'||NEW.id::text);
    END IF;
  WHEN 'planning_adoptions' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.from_version_id IS NULL THEN RETURN NEW; END IF;
      old_resource:=register_dependency_resource('planning_version',NEW.object_id,NEW.from_version_id);
      new_resource:=register_dependency_resource('planning_version',NEW.object_id,NEW.to_version_id);
      PERFORM invalidate_registered_resource(old_resource,new_resource,'规划采用版本发生变化。','planning_adoption',NEW.id,'planning-adoption:'||NEW.id::text);
    END IF;
  WHEN 'canonical_fact_review_actions' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.action IN ('confirm','supersede','mark_stale') THEN
        old_resource:=register_dependency_resource('canonical_fact',NEW.fact_id,NEW.fact_id);
        PERFORM invalidate_registered_resource(old_resource,old_resource,'正典事实状态发生变化：'||NEW.action,'fact_review',NEW.id,'fact-review:'||NEW.id::text,CASE WHEN NEW.action='mark_stale' THEN 'invalid' ELSE 'stale' END);
      END IF;
    END IF;
  WHEN 'chapter_settlements' THEN
    IF TG_OP='INSERT' THEN
      SELECT id INTO confirmed_id FROM chapter_settlements WHERE chapter_document_id=NEW.chapter_document_id AND id<>NEW.id ORDER BY committed_at DESC,id DESC LIMIT 1;
      new_resource:=register_dependency_resource('chapter_settlement',NEW.chapter_document_id,NEW.id);
      IF confirmed_id IS NOT NULL THEN
        old_resource:=register_dependency_resource('chapter_settlement',NEW.chapter_document_id,confirmed_id);
        PERFORM invalidate_registered_resource(old_resource,new_resource,'章节重新结算并采用了新的结算版本。','settlement',NEW.id,'settlement-replace:'||NEW.id::text);
      END IF;
    ELSIF TG_OP='UPDATE' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        old_resource:=register_dependency_resource('chapter_settlement',NEW.chapter_document_id,NEW.id);
        PERFORM invalidate_registered_resource(old_resource,old_resource,'章节结算状态发生变化：'||NEW.status,'settlement',NEW.id,'settlement-state:'||NEW.id::text||':'||NEW.status,CASE WHEN NEW.status IN ('reverted','superseded') THEN 'invalid' ELSE 'stale' END);
      END IF;
    END IF;
  WHEN 'knowledge_state_review_actions' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.action IN ('confirm','invalidate') THEN
        SELECT confirmed_change_id INTO confirmed_id FROM knowledge_state_proposals WHERE id=NEW.proposal_id;
        IF confirmed_id IS NOT NULL THEN
          old_resource:=register_dependency_resource('knowledge_state_change',NEW.proposal_id,confirmed_id);
          PERFORM invalidate_registered_resource(old_resource,old_resource,'知情状态发生变化：'||NEW.action,'knowledge_review',NEW.id,'knowledge-review:'||NEW.id::text,CASE WHEN NEW.action='invalidate' THEN 'invalid' ELSE 'stale' END);
        END IF;
      END IF;
    END IF;
  WHEN 'story_time_review_actions' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.action IN ('confirm','mark_stale','invalidate') THEN
        SELECT confirmed_timing_id INTO confirmed_id FROM story_time_proposals WHERE id=NEW.proposal_id;
        IF confirmed_id IS NOT NULL THEN
          old_resource:=register_dependency_resource('story_event_timing',confirmed_id,confirmed_id);
          PERFORM invalidate_registered_resource(old_resource,old_resource,'故事时间状态发生变化：'||NEW.action,'story_time_review',NEW.id,'story-time-review:'||NEW.id::text,CASE WHEN NEW.action='invalidate' THEN 'invalid' WHEN NEW.action='mark_stale' THEN 'needs_review' ELSE 'stale' END);
        END IF;
      END IF;
    END IF;
  WHEN 'story_relation_review_actions' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.action IN ('confirm','mark_stale','invalidate') THEN
        SELECT confirmed_relation_id INTO confirmed_id FROM story_relation_proposals WHERE id=NEW.proposal_id;
        IF confirmed_id IS NOT NULL THEN
          SELECT proposal_id INTO stable_id FROM story_event_relations WHERE id=confirmed_id;
          old_resource:=register_dependency_resource('story_event_relation',stable_id,confirmed_id);
          PERFORM invalidate_registered_resource(old_resource,old_resource,'故事因果关系状态发生变化：'||NEW.action,'story_relation_review',NEW.id,'story-relation-review:'||NEW.id::text,CASE WHEN NEW.action='invalidate' THEN 'invalid' WHEN NEW.action='mark_stale' THEN 'needs_review' ELSE 'stale' END);
        END IF;
      END IF;
    END IF;
  WHEN 'ai_contract_publications' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.from_version_id IS NULL OR NEW.entity_kind='model_route' THEN RETURN NEW; END IF;
      old_resource:=register_dependency_resource(CASE NEW.entity_kind WHEN 'prompt_recipe' THEN 'prompt_recipe_version' ELSE 'task_contract_version' END,NEW.entity_id,NEW.from_version_id);
      new_resource:=register_dependency_resource(CASE NEW.entity_kind WHEN 'prompt_recipe' THEN 'prompt_recipe_version' ELSE 'task_contract_version' END,NEW.entity_id,NEW.to_version_id);
      PERFORM invalidate_registered_resource(old_resource,new_resource,'AI 执行合同发布版本发生变化。','contract_publication',NEW.id,'contract-publication:'||NEW.id::text,'needs_review');
    END IF;
  WHEN 'quality_audit_reports' THEN
    IF TG_OP='UPDATE' THEN
      IF OLD.stale_at IS NULL AND NEW.stale_at IS NOT NULL THEN
        old_resource:=register_dependency_resource('quality_audit_report',NEW.id,NEW.id);
        PERFORM invalidate_registered_resource(old_resource,old_resource,NEW.stale_reason,'quality_stale',NEW.id,'quality-stale:'||NEW.id::text,'stale');
      END IF;
    END IF;
  ELSE
    NULL;
  END CASE;
  RETURN NEW;
END $$;
