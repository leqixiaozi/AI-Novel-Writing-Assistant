-- Manual issue-owned candidates and author review only. NOT registered startup.
-- Ordinary v1 stays unchanged. Corrective formal merge/090 resolution stay shut.
SET search_path TO new_design,public;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id='092_resource_supplement_formal_commits') THEN
    RAISE EXCEPTION 'actual committed conflict and full originals must precede corrective candidates';
  END IF;
END $$;
CREATE FUNCTION assert_resource_correction_candidate_source(saved resource_supplement_correction_origins) RETURNS void LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; child chapter_adoption_sessions%ROWTYPE;
  issue resource_supplement_integrity_issues%ROWTYPE; base chapter_stable_checkpoints%ROWTYPE;
  source jsonb; correction jsonb; actual_prefix jsonb; related jsonb; field jsonb; prefix_order integer;
BEGIN
  -- stable_resource_correction_start_v1: creation only; no candidate or resolution permission.
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO child FROM chapter_adoption_sessions WHERE id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO issue FROM resource_supplement_integrity_issues WHERE issue_id=saved.issue_id AND book_id=saved.book_id;
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=saved.book_id AND status='stable';
  source:=origin.source_snapshot; correction:=source->'correction';
  IF origin.session_id IS NULL OR child.id IS NULL OR issue.issue_id IS NULL OR base.id IS NULL
    OR child.status NOT IN ('adopted_pending_proposals','pending_review','partially_confirmed','failed') OR child.adoption_kind IS DISTINCT FROM 'resource_supplement'
    OR base.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR base.body_version_id IS DISTINCT FROM issue.body_version_id
    OR child.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR child.body_version_id IS DISTINCT FROM issue.body_version_id
    OR NOT EXISTS(SELECT 1 FROM books WHERE id=saved.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM chapter_documents WHERE id=issue.chapter_document_id AND book_id=saved.book_id AND status='active' AND adopted_version_id=issue.body_version_id)
    OR EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=saved.issue_id)
    OR EXISTS(SELECT 1 FROM chapter_adoption_sessions WHERE chapter_document_id=issue.chapter_document_id AND id<>child.id
      AND status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed'))
    OR source->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1'
    OR origin.original_receipt->>'contract' IS DISTINCT FROM 'stable_resource_correction_start_v1'
    OR origin.full_input->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR origin.original_receipt->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR source->'input' IS DISTINCT FROM jsonb_build_object('issueId',saved.issue_id,'resourceScope',origin.full_input->'resourceScope')
    OR saved.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract','stable_resource_correction_start_v1','bookId',saved.book_id,'input',origin.full_input)
    OR encode(sha256(convert_to(saved.canonical_input,'UTF8')),'hex') IS DISTINCT FROM origin.input_hash::text
    OR saved.canonical_source::jsonb IS DISTINCT FROM source-'sourceHash'
    OR encode(sha256(convert_to(saved.canonical_source,'UTF8')),'hex') IS DISTINCT FROM origin.source_hash::text
    OR correction->>'contract' IS DISTINCT FROM 'resource_supplement_correction_basis_v1'
    OR correction->>'bookId' IS DISTINCT FROM saved.book_id::text OR correction->>'issueId' IS DISTINCT FROM saved.issue_id::text
    OR correction->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR correction->>'chapterDocumentId' IS DISTINCT FROM issue.chapter_document_id::text
    OR correction->>'bodyVersionId' IS DISTINCT FROM issue.body_version_id::text
    OR correction->>'subjectKind' IS DISTINCT FROM issue.subject_kind OR correction->>'subjectId' IS DISTINCT FROM issue.subject_id::text
    OR correction->>'stateKey' IS DISTINCT FROM issue.state_key
    OR correction->'issue' IS DISTINCT FROM to_jsonb(issue)||jsonb_build_object('current_checkpoint',to_jsonb(base))
    OR correction->'chapterEndBasis' IS DISTINCT FROM source->'basis'
    OR correction->'originalRecordedBefore' IS DISTINCT FROM issue.impact->'recordedBefore'
    OR correction->'originalRecordedAfter' IS DISTINCT FROM issue.impact->'recordedAfter'
    OR origin.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||saved.book_id||'/writing?chapterDocument='||issue.chapter_document_id||'&session='||saved.session_id||'&resourceIssue='||saved.issue_id
    THEN RAISE EXCEPTION 'correction original input, issue or current body mismatch' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('change',to_jsonb(change),'proposal',to_jsonb(proposal),'settlement',to_jsonb(settlement),
    'anchor',to_jsonb(anchor),'document',to_jsonb(document),'body',to_jsonb(body),'checkpoint',to_jsonb(checkpoint),
    'checkpoint_commit',to_jsonb(checkpoint_commit),'checkpoint_session',to_jsonb(checkpoint_session)),document.logical_order
    INTO actual_prefix,prefix_order FROM state_changes change
    JOIN chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
    LEFT JOIN state_change_proposals proposal ON proposal.id=change.proposal_id
    LEFT JOIN chapter_settlements settlement ON settlement.id=change.settlement_id
    LEFT JOIN chapter_text_anchors anchor ON anchor.id=change.text_anchor_id
    LEFT JOIN chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id
    LEFT JOIN chapter_stable_checkpoints checkpoint ON checkpoint.book_id=change.book_id AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
    LEFT JOIN chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id
    LEFT JOIN chapter_adoption_sessions checkpoint_session ON checkpoint_session.id=checkpoint.session_id
    WHERE change.book_id=saved.book_id AND change.subject_kind=issue.subject_kind AND change.subject_id=issue.subject_id AND change.state_key=issue.state_key AND change.status='active'
      AND document.logical_order<base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<base.chapter_order
    ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
  IF actual_prefix IS NULL OR correction->'prefixSource' IS DISTINCT FROM actual_prefix
    OR correction->'beforeValue' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'proposal'->>'status' IS DISTINCT FROM 'confirmed'
    OR actual_prefix->'proposal'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'proposal'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'proposal'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'proposal'->>'subject_kind' IS DISTINCT FROM issue.subject_kind
    OR actual_prefix->'proposal'->>'subject_id' IS DISTINCT FROM issue.subject_id::text
    OR actual_prefix->'proposal'->>'state_key' IS DISTINCT FROM issue.state_key
    OR actual_prefix->'proposal'->>'confirmed_state_change_id' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR actual_prefix->'proposal'->'before_json' IS DISTINCT FROM actual_prefix->'change'->'before_json'
    OR actual_prefix->'proposal'->'after_json' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'settlement'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'settlement'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'settlement'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'settlement'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'body'->'archived_at' IS DISTINCT FROM 'null'::jsonb
    OR encode(sha256(convert_to(actual_prefix->'body'->>'content','UTF8')),'hex') IS DISTINCT FROM actual_prefix->'body'->>'content_hash'
    OR actual_prefix->'checkpoint_commit'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'checkpoint_commit'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'checkpoint_commit'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_commit'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'status' IS DISTINCT FROM 'stable'
    OR actual_prefix->'checkpoint_session'->>'book_id' IS DISTINCT FROM saved.book_id::text
    OR actual_prefix->'checkpoint_session'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_session'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'settlement_id' IS DISTINCT FROM actual_prefix->'checkpoint_commit'->>'id'
    OR NOT coalesce((actual_prefix->'checkpoint'->'summary'->'confirmed'->'states') ? (actual_prefix->'change'->>'id'),false)
    OR (SELECT count(*) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
      IS DISTINCT FROM (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
    OR actual_prefix->'change'->'text_anchor_id'<>'null'::jsonb AND (actual_prefix->'anchor'->>'status' IS DISTINCT FROM 'active'
      OR actual_prefix->'anchor'->>'book_id' IS DISTINCT FROM saved.book_id::text
      OR actual_prefix->'anchor'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
      OR actual_prefix->'anchor'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id')
    OR EXISTS(SELECT 1 FROM resource_supplement_integrity_issues earlier JOIN chapter_documents document ON document.id=earlier.chapter_document_id
      WHERE earlier.book_id=saved.book_id AND earlier.subject_kind=issue.subject_kind AND earlier.subject_id=issue.subject_id AND document.logical_order<=prefix_order
        AND NOT EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=earlier.issue_id))
    THEN RAISE EXCEPTION 'correction must retain the actual valid latest chapter-before proof' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(actual) ORDER BY document.logical_order,actual.issue_id),'[]'::jsonb) INTO related
    FROM resource_supplement_integrity_issues actual JOIN chapter_documents document ON document.id=actual.chapter_document_id AND document.book_id=actual.book_id
    WHERE actual.book_id=saved.book_id AND document.logical_order<=base.chapter_order AND NOT EXISTS(
      SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=actual.issue_id)
    AND ((actual.subject_kind='card' AND (origin.full_input->'resourceScope'->'resourceIds') ? actual.subject_id::text)
      OR (actual.subject_kind='relation' AND (origin.full_input->'resourceScope'->'relationIds') ? actual.subject_id::text));
  IF related IS DISTINCT FROM source->'relatedIssues' OR NOT related @> jsonb_build_array(to_jsonb(issue))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(related) item WHERE item->>'chapter_document_id' IS DISTINCT FROM issue.chapter_document_id::text
      OR item->>'body_version_id' IS DISTINCT FROM issue.body_version_id::text OR item->>'subject_kind' IS DISTINCT FROM issue.subject_kind
      OR item->>'subject_id' IS DISTINCT FROM issue.subject_id::text OR item->>'state_key' IS DISTINCT FROM issue.state_key)
    OR origin.original_receipt->'relatedIssueIds' IS DISTINCT FROM (SELECT jsonb_agg(item->'issue_id') FROM jsonb_array_elements(related) item)
    THEN RAISE EXCEPTION 'correction must retain every selected actual related issue' USING ERRCODE='23514'; END IF;
  SELECT item INTO field FROM jsonb_array_elements(source->'catalog'->'subjects') subject,
    jsonb_array_elements(subject->'fields') item WHERE subject->>'subjectKind'=issue.subject_kind AND subject->>'id'=issue.subject_id::text AND item->>'key'=issue.state_key;
  IF field IS NULL OR field->'baseline'->'known' IS DISTINCT FROM 'true'::jsonb OR field->'baseline'->'stale' IS DISTINCT FROM 'false'::jsonb
    OR field->'baseline'->'value' IS DISTINCT FROM correction->'beforeValue'
    OR field->'baseline'->>'sourceKind' IS DISTINCT FROM 'state_change'
    OR field->'baseline'->>'sourceId' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR NOT EXISTS(SELECT 1 FROM chapter_adoption_preparations WHERE id=child.preparation_id AND dependency_snapshot->>'correctionIssueId'=issue.issue_id::text
      AND dependency_snapshot->'correctionIssueIds'=origin.original_receipt->'relatedIssueIds' AND dependency_snapshot->>'correctionSourceHash'=correction->>'sourceHash')
    THEN RAISE EXCEPTION 'correction editor baseline must remain bound to actual chapter-before evidence' USING ERRCODE='23514'; END IF;
  RETURN;
END $$;

CREATE OR REPLACE FUNCTION block_unavailable_resource_correction_candidates() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; saved resource_supplement_correction_origins%ROWTYPE; proposal state_change_proposals%ROWTYPE;
BEGIN
  -- resource_correction_candidates_v1: only its actual issue field is eligible.
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=NEW.session_id;
  IF origin.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1' THEN RETURN NEW; END IF;
  SELECT * INTO saved FROM resource_supplement_correction_origins WHERE session_id=NEW.session_id AND book_id=origin.book_id;
  IF saved.session_id IS NULL THEN RAISE EXCEPTION 'corrective candidate requires complete original source' USING ERRCODE='23514'; END IF;
  PERFORM assert_resource_correction_candidate_source(saved);
  IF TG_TABLE_NAME='chapter_settlement_items' THEN
    SELECT * INTO proposal FROM state_change_proposals WHERE id=NEW.state_proposal_id AND book_id=origin.book_id;
    IF proposal.id IS NULL OR proposal.status IS DISTINCT FROM 'proposed' OR proposal.before_known IS DISTINCT FROM true
      OR proposal.subject_kind IS DISTINCT FROM origin.source_snapshot#>>'{correction,subjectKind}'
      OR proposal.subject_id::text IS DISTINCT FROM origin.source_snapshot#>>'{correction,subjectId}'
      OR proposal.state_key IS DISTINCT FROM origin.source_snapshot#>>'{correction,stateKey}'
      OR proposal.before_json IS DISTINCT FROM origin.source_snapshot#>'{correction,beforeValue}'
      OR proposal.chapter_document_id::text IS DISTINCT FROM origin.source_snapshot#>>'{basis,chapterDocumentId}'
      OR proposal.body_version_id::text IS DISTINCT FROM origin.source_snapshot#>>'{basis,bodyVersionId}'
      OR proposal.text_anchor_id IS DISTINCT FROM NEW.evidence_anchor_id
      OR NEW.canonical_fact_id IS NOT NULL OR NEW.knowledge_proposal_id IS NOT NULL
      OR NEW.category IS DISTINCT FROM (CASE WHEN proposal.subject_kind='relation' THEN 'relationship' ELSE 'prop' END)
      OR proposal.effective_story_order IS NOT NULL AND proposal.effective_story_order<>(origin.source_snapshot#>>'{basis,chapterOrder}')::numeric
      THEN RAISE EXCEPTION 'corrective candidate must stay in its actual proven issue field and body evidence' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.frozen_plan->>'assetId' IS DISTINCT FROM 'new_design.character.stable_resource_correction' THEN
      RAISE EXCEPTION 'corrective claim requires its registered dedicated asset' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION assert_resource_correction_claim(claim chapter_proposal_extraction_requests) RETURNS void LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; saved resource_supplement_correction_origins%ROWTYPE; expected_catalog jsonb; subjects jsonb;
BEGIN
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=claim.session_id AND book_id=claim.book_id;
  SELECT * INTO saved FROM resource_supplement_correction_origins WHERE session_id=claim.session_id AND book_id=claim.book_id;
  IF saved.session_id IS NULL THEN RAISE EXCEPTION 'corrective claim original proof missing' USING ERRCODE='23514'; END IF;
  PERFORM assert_resource_correction_candidate_source(saved);
  SELECT jsonb_agg(jsonb_set(subject,'{fields}',(SELECT jsonb_agg(field) FROM jsonb_array_elements(subject->'fields') field
    WHERE field->>'key'=origin.source_snapshot#>>'{correction,stateKey}'))) INTO subjects
    FROM jsonb_array_elements(origin.source_snapshot#>'{catalog,subjects}') subject
    WHERE subject->>'subjectKind'=origin.source_snapshot#>>'{correction,subjectKind}' AND subject->>'id'=origin.source_snapshot#>>'{correction,subjectId}';
  expected_catalog:=jsonb_set(jsonb_set(jsonb_set(origin.source_snapshot->'catalog','{subjects}',subjects),'{sessionId}',to_jsonb(claim.session_id::text)),
    '{sessionRevision}',to_jsonb(claim.expected_session_revision));
  IF claim.frozen_plan->>'assetId' IS DISTINCT FROM 'new_design.character.stable_resource_correction' OR claim.frozen_plan->>'assetVersion' IS DISTINCT FROM 'v1'
    OR claim.frozen_plan#>'{input,stableCorrection,source}' IS DISTINCT FROM origin.source_snapshot
    OR claim.frozen_plan#>'{input,stableCorrection,sessionRevision}' IS DISTINCT FROM to_jsonb(claim.expected_session_revision)
    OR claim.frozen_plan#>'{input,stableSupplement}' IS NOT NULL
    OR claim.frozen_plan#>'{input,catalog}' IS DISTINCT FROM expected_catalog
    OR claim.frozen_plan#>'{input,resourceScope}' IS DISTINCT FROM origin.source_snapshot->'resourceScope'
    OR claim.frozen_plan#>'{input,bodyContent}' IS DISTINCT FROM origin.source_snapshot#>'{basis,bodyContent}'
    OR claim.frozen_plan#>'{input,expectedChanges}' IS DISTINCT FROM '[]'::jsonb
    OR NOT EXISTS(SELECT 1 FROM chapter_adoption_sessions WHERE id=claim.session_id AND book_id=claim.book_id AND revision=claim.expected_session_revision AND body_version_id=claim.body_version_id)
    THEN RAISE EXCEPTION 'corrective claim must freeze its exact full source and sole issue field' USING ERRCODE='23514'; END IF;
END $$;
CREATE OR REPLACE FUNCTION guard_chapter_settlement_ai_payload() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'chapter extraction receipts cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.frozen_plan,NEW.frozen_input_hash,NEW.expected_session_revision) IS DISTINCT FROM ROW(OLD.frozen_plan,OLD.frozen_input_hash,OLD.expected_session_revision) THEN
      RAISE EXCEPTION 'chapter extraction input is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.generated_output IS NOT NULL AND ROW(NEW.generated_output,NEW.generated_execution) IS DISTINCT FROM ROW(OLD.generated_output,OLD.generated_execution) THEN
      RAISE EXCEPTION 'chapter extraction model result is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.frozen_plan IS NOT NULL AND OLD.ai_task_id IS DISTINCT FROM NEW.ai_task_id THEN RAISE EXCEPTION 'chapter extraction task is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.generated_execution IS NOT NULL AND NEW.generated_execution IS DISTINCT FROM OLD.generated_execution THEN RAISE EXCEPTION 'chapter extraction execution trace is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status='succeeded' AND (NEW.status<>OLD.status OR NEW.failure IS DISTINCT FROM OLD.failure) THEN RAISE EXCEPTION 'saved extraction import is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.frozen_plan IS NOT NULL AND OLD.status IN ('stale','cancelled') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'ended extraction is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.frozen_plan IS NOT NULL AND (NEW.frozen_input_hash IS NULL OR NEW.expected_session_revision IS NULL OR NEW.ai_task_id IS NULL OR COALESCE(NEW.frozen_plan->>'assetId','') NOT IN ('new_design.chapter.settlement_candidates','new_design.character.resource_backfill','new_design.character.stable_resource_supplement','new_design.character.stable_resource_correction') OR NEW.frozen_plan->>'assetVersion' IS DISTINCT FROM 'v1' OR
    NEW.frozen_plan->'input'->>'sessionId' IS DISTINCT FROM NEW.session_id::text OR NEW.frozen_plan->'input'->>'bodyVersionId' IS DISTINCT FROM NEW.body_version_id::text OR
    NOT EXISTS(SELECT 1 FROM ai_tasks task JOIN task_contract_versions contract ON contract.id=task.task_contract_version_id JOIN task_contracts config ON config.id=contract.contract_id WHERE task.id=NEW.ai_task_id AND task.source_kind='chapter_settlement_extraction' AND task.source_id=NEW.id AND task.book_id=NEW.book_id AND contract.id=NEW.task_contract_version_id AND contract.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND contract.task_group='chapter_settlement' AND config.task_key='chapter_settlement_'||NEW.session_id::text
      AND contract.budget_policy->>'assetId'=NEW.frozen_plan->>'assetId' AND contract.budget_policy->>'assetVersion'=NEW.frozen_plan->>'assetVersion'
      AND EXISTS(SELECT 1 FROM prompt_recipe_versions recipe WHERE recipe.id=NEW.prompt_recipe_version_id AND recipe.variables_schema->'const'=NEW.frozen_plan->'input'))) THEN
    RAISE EXCEPTION 'chapter extraction controlled provenance is incomplete' USING ERRCODE='23514';
  END IF;

  IF NEW.frozen_plan->>'assetId' IN ('new_design.character.resource_backfill','new_design.character.stable_resource_supplement','new_design.character.stable_resource_correction') AND (
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope') IS DISTINCT FROM 'object' OR
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope'->'resources') IS DISTINCT FROM 'array' OR
    jsonb_typeof(NEW.frozen_plan->'input'->'resourceScope'->'anchors') IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION 'resource backfill requires its frozen scope' USING ERRCODE='23514'; END IF;
  -- Validate live sources only for a new claim. Saved receipts remain readable and finishable
  -- after legitimate future edits; every frozen input and model result remains immutable.
  IF TG_OP='INSERT' AND NEW.frozen_plan->>'assetId' IN ('new_design.character.resource_backfill','new_design.character.stable_resource_supplement','new_design.character.stable_resource_correction') THEN
    IF NOT EXISTS(
      SELECT 1 FROM books book
      JOIN cards actor ON actor.space_id=book.space_id
      JOIN card_types type ON type.id=actor.card_type_id AND type.type_key='character' AND type.status='published'
      JOIN chapter_documents document ON document.book_id=book.id AND document.adopted_version_id=NEW.body_version_id AND document.status='active'
      JOIN chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      WHERE book.id=NEW.book_id AND book.status='active' AND actor.status='active'
        AND actor.id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterId'
        AND actor.current_version_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterVersionId'
        AND actor.revision=(NEW.frozen_plan->'input'->'resourceScope'->>'characterRevision')::integer
        AND body.content=NEW.frozen_plan->'input'->>'bodyContent'
        AND body.content_hash=NEW.frozen_plan->'input'->>'bodyContentHash'
    ) OR jsonb_array_length(NEW.frozen_plan->'input'->'resourceScope'->'resources')=0 OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(NEW.frozen_plan->'input'->'resourceScope'->'resources') reference
      WHERE NOT EXISTS(
        SELECT 1 FROM card_relations relation JOIN books book ON book.space_id=relation.space_id AND book.id=NEW.book_id
        JOIN cards resource ON resource.id=relation.target_card_id AND resource.space_id=book.space_id AND resource.status='active'
        JOIN card_types type ON type.id=resource.card_type_id AND type.type_key='prop' AND type.status='published'
        JOIN card_relation_versions version ON version.id=relation.current_version_id AND version.card_relation_id=relation.id
        WHERE relation.status='active' AND relation.id::text=reference->>'relationId' AND version.id::text=reference->>'relationVersionId'
          AND relation.source_card_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'characterId'
          AND relation.relation_type_id::text=NEW.frozen_plan->'input'->'resourceScope'->>'relationTypeId'
          AND resource.id::text=reference->>'id' AND resource.current_version_id::text=reference->>'versionId'
          AND version.revision=relation.revision AND version.status=relation.status AND version.properties=relation.properties
      )
    ) OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(NEW.frozen_plan->'input'->'resourceScope'->'anchors') reference
      WHERE NOT EXISTS(
        SELECT 1 FROM chapter_text_anchors anchor WHERE anchor.id::text=reference->>'id' AND anchor.book_id=NEW.book_id
          AND anchor.body_version_id=NEW.body_version_id AND anchor.status='active'
          AND anchor.subject_card_id::text=reference->>'subjectCardId'
          AND anchor.start_offset=(reference->>'start')::integer AND anchor.end_offset=(reference->>'end')::integer
          AND anchor.excerpt=reference->>'excerpt'
      )
    ) THEN RAISE EXCEPTION 'resource backfill requires exact adopted body and book sources' USING ERRCODE='23514'; END IF;
  END IF;

  IF NEW.generated_output IS NOT NULL AND (NEW.frozen_plan IS NULL OR NEW.generated_execution IS NULL) THEN RAISE EXCEPTION 'chapter extraction model result needs controlled provenance' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.generated_output IS NULL AND NEW.generated_output IS NOT NULL AND (OLD.status<>'running' OR NEW.status<>'running' OR
    NOT EXISTS(SELECT 1 FROM ai_task_attempts attempt WHERE attempt.task_id=NEW.ai_task_id AND attempt.status='running' AND attempt.input_hash=NEW.frozen_input_hash AND attempt.task_contract_version_id=NEW.task_contract_version_id AND attempt.prompt_recipe_version_id=NEW.prompt_recipe_version_id AND attempt.context_manifest_id=NEW.context_manifest_id AND attempt.model_route_snapshot_id=NEW.model_route_snapshot_id)) THEN
    RAISE EXCEPTION 'chapter model output requires its running frozen attempt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- Retains the original trigger/OID, receipt rows and closed formal-settlement guard.

CREATE OR REPLACE FUNCTION block_unavailable_resource_supplement_extraction() RETURNS trigger
LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; expected_catalog jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM chapter_adoption_sessions WHERE id=NEW.session_id AND adoption_kind='resource_supplement') THEN RETURN NEW; END IF;
  -- stable_resource_supplement_candidates_v1: no ordinary/cached extractor may claim a child.
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=NEW.session_id AND book_id=NEW.book_id;
  IF origin.source_snapshot->>'contract'='stable_resource_correction_preview_v1' THEN
    PERFORM assert_resource_correction_claim(NEW);
    RETURN NEW;
  END IF;
  expected_catalog:=jsonb_set(jsonb_set(origin.source_snapshot->'catalog','{sessionId}',to_jsonb(NEW.session_id::text)),
    '{sessionRevision}',to_jsonb(NEW.expected_session_revision));
  IF origin.session_id IS NULL OR NEW.frozen_plan->>'assetId' IS DISTINCT FROM 'new_design.character.stable_resource_supplement'
    OR NEW.frozen_plan->>'assetVersion' IS DISTINCT FROM 'v1'
    OR NEW.frozen_plan->'input'->'stableSupplement'->'source' IS DISTINCT FROM origin.source_snapshot
    OR NEW.frozen_plan->'input'->'catalog' IS DISTINCT FROM expected_catalog
    OR NEW.frozen_plan->'input'->'resourceScope' IS DISTINCT FROM origin.source_snapshot->'resourceScope'
    OR NEW.frozen_plan->'input'->'bodyContent' IS DISTINCT FROM origin.source_snapshot->'basis'->'bodyContent'
    OR NEW.frozen_plan->'input'->'stableSupplement'->'sessionRevision' IS DISTINCT FROM to_jsonb(NEW.expected_session_revision)
    OR NEW.frozen_plan->'input'->'expectedChanges' IS DISTINCT FROM '[]'::jsonb
    OR NOT EXISTS(SELECT 1 FROM chapter_adoption_sessions child JOIN chapter_stable_checkpoints base ON base.id=child.supplement_base_checkpoint_id
      WHERE child.id=NEW.session_id AND child.revision=NEW.expected_session_revision AND base.id=origin.base_checkpoint_id
        AND base.status='stable' AND base.book_id=NEW.book_id AND base.body_version_id=NEW.body_version_id) THEN
    RAISE EXCEPTION 'stable resource candidate claim requires its exact retained source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fence_resource_supplement_integrity_extraction() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE;
BEGIN
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=NEW.session_id AND book_id=NEW.book_id;
  IF origin.session_id IS NULL THEN RETURN NEW; END IF;
  IF origin.source_snapshot->>'contract'='stable_resource_correction_preview_v1' THEN
    PERFORM assert_resource_correction_claim(NEW);
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM resource_supplement_integrity_issues issue JOIN chapter_documents document ON document.id=issue.chapter_document_id AND document.book_id=issue.book_id
    WHERE issue.book_id=NEW.book_id AND document.logical_order<=(origin.source_snapshot#>>'{basis,chapterOrder}')::numeric
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(origin.source_snapshot#>'{catalog,subjects}') subject WHERE (subject->>'id')::uuid=issue.subject_id AND subject->>'subjectKind'=issue.subject_kind)
      AND NOT EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions resolution WHERE resolution.issue_id=issue.issue_id)) THEN
    RAISE EXCEPTION 'ordinary stable resource extraction cannot bypass actual source conflict' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
