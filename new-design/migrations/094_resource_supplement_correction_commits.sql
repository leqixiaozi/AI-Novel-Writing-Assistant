-- Manual actual corrective commit/proof closure; NOT registered startup.
-- No operational flag flip, deleted history, disabled trigger or old-v1 reinterpretation.
SET search_path TO new_design,public;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id='093_resource_supplement_correction_candidates') THEN RAISE EXCEPTION 'actual governed corrective candidates must precede correction closure'; END IF;
END $$;
CREATE FUNCTION assert_resource_correction_formal_source(saved resource_supplement_correction_origins) RETURNS void LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; child chapter_adoption_sessions%ROWTYPE;
  issue resource_supplement_integrity_issues%ROWTYPE; base chapter_stable_checkpoints%ROWTYPE;
  source jsonb; correction jsonb; actual_prefix jsonb; related jsonb; field jsonb; prefix_order integer;
BEGIN
  -- stable_resource_correction_start_v1: creation only; no candidate or resolution permission.
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO child FROM chapter_adoption_sessions WHERE id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO issue FROM resource_supplement_integrity_issues WHERE issue_id=saved.issue_id AND book_id=saved.book_id;
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=saved.book_id AND status='superseded';
  source:=origin.source_snapshot; correction:=source->'correction';
  IF origin.session_id IS NULL OR child.id IS NULL OR issue.issue_id IS NULL OR base.id IS NULL
    OR child.status IS DISTINCT FROM 'stable' OR child.adoption_kind IS DISTINCT FROM 'resource_supplement'
    OR base.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR base.body_version_id IS DISTINCT FROM issue.body_version_id
    OR child.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR child.body_version_id IS DISTINCT FROM issue.body_version_id
    OR NOT EXISTS(SELECT 1 FROM books WHERE id=saved.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM chapter_documents WHERE id=issue.chapter_document_id AND book_id=saved.book_id AND status='active' AND adopted_version_id=issue.body_version_id)
    OR EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=saved.issue_id AND correction_checkpoint_id NOT IN (SELECT id FROM chapter_stable_checkpoints WHERE session_id=child.id AND settlement_id=child.settlement_id AND status='stable'))
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
    OR correction->'issue' IS DISTINCT FROM to_jsonb(issue)||jsonb_build_object('current_checkpoint',to_jsonb(base)||jsonb_build_object('status','stable'))
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
      SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=actual.issue_id AND correction_checkpoint_id NOT IN (SELECT id FROM chapter_stable_checkpoints WHERE session_id=child.id AND settlement_id=child.settlement_id AND status='stable'))
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
CREATE OR REPLACE FUNCTION validate_resource_supplement_impact_review() RETURNS trigger LANGUAGE plpgsql
  SET search_path TO new_design,public AS $$
DECLARE session chapter_adoption_sessions%ROWTYPE; base chapter_stable_checkpoints%ROWTYPE;
  snapshot jsonb; actual jsonb; origin chapter_resource_supplements%ROWTYPE;
  conflicts jsonb; acknowledged jsonb; field_values jsonb:='{}'::jsonb; field_key text;
  expected_chain jsonb:='[]'::jsonb; before_value jsonb; reason text; effective numeric;
BEGIN
  -- resource_supplement_impact_review_v1: awareness never resolves a conflict.
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'impact review history is immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO session FROM chapter_adoption_sessions WHERE id=NEW.session_id AND book_id=NEW.book_id;
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=session.id AND book_id=NEW.book_id;
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=NEW.book_id;
  IF origin.source_snapshot->>'contract'='stable_resource_correction_preview_v1' THEN
    PERFORM assert_resource_correction_candidate_source(saved) FROM resource_supplement_correction_origins saved WHERE saved.session_id=NEW.session_id AND saved.book_id=NEW.book_id;
    IF NOT FOUND OR jsonb_array_length(NEW.impact_snapshot->'changes')<>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.impact_snapshot->'changes') item WHERE item->>'subjectKind' IS DISTINCT FROM origin.source_snapshot#>>'{correction,subjectKind}' OR item->>'subjectId' IS DISTINCT FROM origin.source_snapshot#>>'{correction,subjectId}' OR item->>'stateKey' IS DISTINCT FROM origin.source_snapshot#>>'{correction,stateKey}' OR item->'before' IS DISTINCT FROM origin.source_snapshot#>'{correction,beforeValue}') THEN RAISE EXCEPTION 'corrective review must bind its single actual issue source' USING ERRCODE='23514'; END IF;
  END IF;
  IF session.id IS NULL OR session.adoption_kind<>'resource_supplement' OR session.revision<>NEW.session_revision
    OR session.status NOT IN ('pending_review','partially_confirmed','adopted_pending_proposals','failed')
    OR base.id IS NULL OR base.status<>'stable'
    OR NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM chapter_documents WHERE id=session.chapter_document_id AND book_id=NEW.book_id AND status='active' AND adopted_version_id=session.body_version_id)
    OR NEW.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract','resource_supplement_impact_review_v1','bookId',NEW.book_id,'sessionId',NEW.session_id,'input',NEW.full_input)
    OR encode(sha256(convert_to(NEW.canonical_input,'UTF8')),'hex') IS DISTINCT FROM NEW.input_hash::text
    OR NEW.canonical_impact::jsonb IS DISTINCT FROM NEW.impact_snapshot-'impactHash'
    OR encode(sha256(convert_to(NEW.canonical_impact,'UTF8')),'hex') IS DISTINCT FROM NEW.impact_hash::text
    OR NEW.impact_snapshot->>'contract' IS DISTINCT FROM 'resource_supplement_settlement_impact_v1'
    OR NEW.impact_snapshot->>'bookId' IS DISTINCT FROM NEW.book_id::text
    OR NEW.impact_snapshot->>'sessionId' IS DISTINCT FROM NEW.session_id::text
    OR NEW.impact_snapshot->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR NEW.impact_snapshot->>'bodyVersionId' IS DISTINCT FROM session.body_version_id::text
    OR NEW.impact_snapshot->>'sessionRevision' IS DISTINCT FROM NEW.session_revision::text
    OR NEW.impact_snapshot->>'sourceHash' IS DISTINCT FROM origin.source_hash::text
    -- pg returns session timestamps as JS Dates (millisecond ISO), whereas
    -- to_jsonb uses PostgreSQL timezone formatting and microsecond precision.
    OR (NEW.impact_snapshot#>'{inputSnapshot,session}')-ARRAY['body_hash','created_at','updated_at'] IS DISTINCT FROM to_jsonb(session)-ARRAY['created_at','updated_at']
    OR (NEW.impact_snapshot#>>'{inputSnapshot,session,created_at}')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',session.created_at)
    OR (NEW.impact_snapshot#>>'{inputSnapshot,session,updated_at}')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',session.updated_at)
    OR NEW.impact_snapshot#>'{inputSnapshot,source}' IS DISTINCT FROM origin.source_snapshot
    OR NEW.impact_snapshot->>'impactHash' IS DISTINCT FROM NEW.impact_hash::text
    OR jsonb_typeof(NEW.impact_snapshot->'changes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.impact_snapshot->'stateChain') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.impact_snapshot#>'{downstreamSource,chapters}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.impact_snapshot#>'{downstreamSource,states}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.impact_snapshot#>'{downstreamSource,planningReferences}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.full_input->'acknowledgedConflictStateChangeIds') IS DISTINCT FROM 'array'
    OR NEW.full_input->>'requestKey' IS DISTINCT FROM NEW.request_key::text
    OR NEW.full_input->>'expectedSessionRevision' IS DISTINCT FROM NEW.session_revision::text
    OR NEW.full_input->>'expectedImpactHash' IS DISTINCT FROM NEW.impact_hash::text
    OR NEW.original_receipt->>'contract' IS DISTINCT FROM 'resource_supplement_impact_review_v1'
    OR NEW.original_receipt->>'reviewId' IS DISTINCT FROM NEW.review_id::text
    OR NEW.original_receipt->>'bookId' IS DISTINCT FROM NEW.book_id::text
    OR NEW.original_receipt->>'sessionId' IS DISTINCT FROM NEW.session_id::text
    OR NEW.original_receipt->>'chapterDocumentId' IS DISTINCT FROM session.chapter_document_id::text
    OR NEW.original_receipt->>'bodyVersionId' IS DISTINCT FROM session.body_version_id::text
    OR NEW.original_receipt->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR NEW.original_receipt->>'sessionRevision' IS DISTINCT FROM NEW.session_revision::text
    OR NEW.original_receipt->>'inputHash' IS DISTINCT FROM NEW.input_hash::text
    OR NEW.original_receipt->'input' IS DISTINCT FROM NEW.full_input
    OR NEW.original_receipt->'impact' IS DISTINCT FROM NEW.impact_snapshot
    OR NEW.original_receipt->'repeated' IS DISTINCT FROM 'false'::jsonb
    OR NEW.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||NEW.book_id||'/writing?chapterDocument='||session.chapter_document_id||'&session='||session.id
    THEN RAISE EXCEPTION 'impact review origin or complete receipt mismatch' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM chapter_settlement_items WHERE session_id=session.id AND decision NOT IN ('confirm','reject'))
    OR (SELECT count(*) FROM chapter_settlement_items WHERE session_id=session.id AND decision='confirm')<>jsonb_array_length(NEW.impact_snapshot->'changes')
    OR (SELECT count(DISTINCT value->>'itemId') FROM jsonb_array_elements(NEW.impact_snapshot->'changes'))<>jsonb_array_length(NEW.impact_snapshot->'changes')
    THEN RAISE EXCEPTION 'impact review candidate set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(NEW.impact_snapshot->'changes') LOOP
    IF NOT EXISTS(SELECT 1 FROM chapter_settlement_items item JOIN state_change_proposals proposal ON proposal.id=item.state_proposal_id
      WHERE item.id=(snapshot->>'itemId')::uuid AND item.session_id=session.id AND item.decision='confirm'
        AND proposal.id=(snapshot->>'proposalId')::uuid AND proposal.book_id=NEW.book_id AND proposal.status='proposed' AND proposal.before_known
        AND proposal.subject_kind=snapshot->>'subjectKind' AND proposal.subject_id=(snapshot->>'subjectId')::uuid AND proposal.state_key=snapshot->>'stateKey'
        AND proposal.before_json IS NOT DISTINCT FROM snapshot->'before' AND proposal.after_json IS NOT DISTINCT FROM snapshot->'after')
      THEN RAISE EXCEPTION 'impact review confirmed proposal mismatch' USING ERRCODE='23514'; END IF;
    field_key=jsonb_build_array(snapshot->>'subjectKind',snapshot->>'subjectId',snapshot->>'stateKey')::text;
    field_values=jsonb_set(field_values,ARRAY[field_key],snapshot->'after');
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(reference)||jsonb_build_object('source_version',to_jsonb(card_version)) ORDER BY reference.id),'[]'::jsonb) INTO actual
    FROM planning_version_references reference LEFT JOIN card_versions card_version ON card_version.id=reference.card_version_id AND card_version.card_id=reference.card_id
    WHERE reference.book_id=NEW.book_id AND reference.planning_version_id IN (
      SELECT (value#>>'{adopted_plan,id}')::uuid FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,chapters}')
      UNION SELECT (value#>>'{body,planning_version_id}')::uuid FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,chapters}'));
  IF actual IS DISTINCT FROM NEW.impact_snapshot#>'{downstreamSource,planningReferences}' THEN
    RAISE EXCEPTION 'impact review exact planning references changed' USING ERRCODE='23514'; END IF;
  -- Same authority rule as the preview: keep all rows, use the final row per
  -- chapter/field; preserve that field's first position in the ordered chain.
  FOR snapshot IN
    WITH ordered AS (SELECT value,ordinality,
      row_number() OVER(PARTITION BY value#>>'{change,chapter_document_id}',value#>>'{change,subject_kind}',value#>>'{change,subject_id}',value#>>'{change,state_key}' ORDER BY ordinality DESC) last_position,
      min(ordinality) OVER(PARTITION BY value#>>'{change,chapter_document_id}',value#>>'{change,subject_kind}',value#>>'{change,subject_id}',value#>>'{change,state_key}') first_position
      FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,states}') WITH ORDINALITY)
    SELECT value FROM ordered WHERE last_position=1 ORDER BY first_position
  LOOP
    field_key=jsonb_build_array(snapshot#>>'{change,subject_kind}',snapshot#>>'{change,subject_id}',snapshot#>>'{change,state_key}')::text;
    before_value=field_values->field_key;
    effective=(snapshot#>>'{change,effective_story_order}')::numeric;
    reason=CASE WHEN effective IS NOT NULL AND effective<=base.chapter_order THEN 'backdated_source'
      WHEN before_value IS NOT DISTINCT FROM snapshot#>'{change,before_json}' THEN 'compatible' ELSE 'before_conflict' END;
    expected_chain=expected_chain||jsonb_build_array(jsonb_build_object('chapterDocumentId',snapshot#>>'{change,chapter_document_id}',
      'bodyVersionId',snapshot#>>'{change,body_version_id}','chapterOrder',snapshot->'chapter_order','stateChangeId',snapshot#>>'{change,id}',
      'subjectKind',snapshot#>>'{change,subject_kind}','subjectId',snapshot#>>'{change,subject_id}','stateKey',snapshot#>>'{change,state_key}',
      'expectedBefore',before_value,'recordedBefore',snapshot#>'{change,before_json}','recordedAfter',snapshot#>'{change,after_json}',
      'effectiveStoryOrder',effective,'reason',reason));
    field_values=jsonb_set(field_values,ARRAY[field_key],snapshot#>'{change,after_json}');
  END LOOP;
  IF expected_chain IS DISTINCT FROM NEW.impact_snapshot->'stateChain' THEN
    RAISE EXCEPTION 'impact review actual state chain mismatch' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM chapter_documents WHERE book_id=NEW.book_id AND status='active' AND logical_order>base.chapter_order)
    <>jsonb_array_length(NEW.impact_snapshot#>'{downstreamSource,chapters}')
    OR (SELECT count(DISTINCT value#>>'{document,id}') FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,chapters}'))<>jsonb_array_length(NEW.impact_snapshot#>'{downstreamSource,chapters}') THEN
    RAISE EXCEPTION 'impact review downstream chapter set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,chapters}') LOOP
    SELECT jsonb_build_object('document',to_jsonb(document),'body',to_jsonb(body),'planning_object',to_jsonb(object),
      'adopted_plan',to_jsonb(plan),'body_plan',to_jsonb(body_plan),'checkpoint',to_jsonb(checkpoint)) INTO actual
      FROM chapter_documents document
      LEFT JOIN chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      LEFT JOIN planning_objects object ON object.book_id=document.book_id AND object.card_id=document.chapter_card_id AND object.level='chapter' AND object.status='active'
      LEFT JOIN planning_versions plan ON plan.id=object.adopted_version_id AND plan.object_id=object.id
      LEFT JOIN planning_versions body_plan ON body_plan.id=body.planning_version_id AND body_plan.book_id=document.book_id
      LEFT JOIN chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=document.book_id AND checkpoint.body_version_id=body.id AND checkpoint.status='stable'
      WHERE document.id=(snapshot#>>'{document,id}')::uuid AND document.book_id=NEW.book_id AND document.status='active' AND document.logical_order>base.chapter_order;
    IF actual IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'impact review downstream source changed' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM state_changes change
      JOIN chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      WHERE change.book_id=NEW.book_id AND change.status='active' AND document.logical_order>base.chapter_order
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.impact_snapshot->'changes') selection
          WHERE selection->>'subjectKind'=change.subject_kind AND (selection->>'subjectId')::uuid=change.subject_id AND selection->>'stateKey'=change.state_key))
    <>jsonb_array_length(NEW.impact_snapshot#>'{downstreamSource,states}')
    OR (SELECT count(DISTINCT value#>>'{change,id}') FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,states}'))<>jsonb_array_length(NEW.impact_snapshot#>'{downstreamSource,states}')
    THEN RAISE EXCEPTION 'impact review downstream state set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(NEW.impact_snapshot#>'{downstreamSource,states}') LOOP
    SELECT jsonb_build_object('change',to_jsonb(change),'proposal',to_jsonb(proposal),'settlement',to_jsonb(settlement),
      'anchor',to_jsonb(anchor),'checkpoint',to_jsonb(checkpoint),'checkpoint_commit',to_jsonb(checkpoint_commit),
      'checkpoint_session',to_jsonb(checkpoint_session),'chapter_order',document.logical_order) INTO actual
      FROM state_changes change
      JOIN chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      LEFT JOIN state_change_proposals proposal ON proposal.id=change.proposal_id
      LEFT JOIN chapter_settlements settlement ON settlement.id=change.settlement_id
      LEFT JOIN chapter_text_anchors anchor ON anchor.id=change.text_anchor_id
      LEFT JOIN chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=change.book_id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
      LEFT JOIN chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id AND checkpoint_commit.book_id=change.book_id AND checkpoint_commit.chapter_document_id=document.id AND checkpoint_commit.body_version_id=change.body_version_id
      LEFT JOIN chapter_adoption_sessions checkpoint_session ON checkpoint_session.id=checkpoint.session_id AND checkpoint_session.book_id=change.book_id AND checkpoint_session.chapter_document_id=document.id AND checkpoint_session.body_version_id=change.body_version_id AND checkpoint_session.settlement_id=checkpoint.settlement_id
      WHERE change.id=(snapshot#>>'{change,id}')::uuid AND change.book_id=NEW.book_id AND change.status='active' AND document.logical_order>base.chapter_order;
    IF actual IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'impact review downstream state source changed' USING ERRCODE='23514'; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(value->>'stateChangeId' ORDER BY value->>'stateChangeId'),'[]'::jsonb) INTO conflicts
    FROM jsonb_array_elements(NEW.impact_snapshot->'stateChain') WHERE value->>'reason'<>'compatible';
  SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO acknowledged FROM jsonb_array_elements_text(NEW.full_input->'acknowledgedConflictStateChangeIds');
  IF acknowledged IS DISTINCT FROM conflicts THEN RAISE EXCEPTION 'impact review conflicts not explicitly acknowledged' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

ALTER TABLE resource_supplement_integrity_resolutions ADD COLUMN canonical_proof text NOT NULL;
CREATE FUNCTION assert_resource_correction_resolution_source(saved resource_supplement_integrity_resolutions) RETURNS void LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; checkpoint chapter_stable_checkpoints%ROWTYPE;
  issue resource_supplement_integrity_issues%ROWTYPE; journal resource_supplement_integrity_journals%ROWTYPE; review resource_supplement_impact_reviews%ROWTYPE;
  change state_changes%ROWTYPE; proposal state_change_proposals%ROWTYPE; anchor chapter_text_anchors%ROWTYPE;
  body chapter_body_versions%ROWTYPE; settlement chapter_settlements%ROWTYPE; expected jsonb; formal_input jsonb;
BEGIN
  SELECT * INTO checkpoint FROM chapter_stable_checkpoints WHERE id=saved.correction_checkpoint_id AND book_id=saved.book_id AND status='stable';
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=checkpoint.session_id AND book_id=saved.book_id;
  SELECT * INTO issue FROM resource_supplement_integrity_issues WHERE issue_id=saved.issue_id AND book_id=saved.book_id;
  SELECT * INTO journal FROM resource_supplement_integrity_journals WHERE checkpoint_id=checkpoint.id AND book_id=saved.book_id AND settlement_id=checkpoint.settlement_id;
  SELECT * INTO review FROM resource_supplement_impact_reviews WHERE review_id=journal.review_id AND book_id=saved.book_id AND session_id=checkpoint.session_id;
  SELECT * INTO change FROM state_changes WHERE settlement_id=checkpoint.settlement_id AND book_id=saved.book_id AND status='active';
  SELECT * INTO proposal FROM state_change_proposals WHERE id=change.proposal_id AND book_id=saved.book_id AND status='confirmed' AND confirmed_state_change_id=change.id;
  SELECT * INTO anchor FROM chapter_text_anchors WHERE id=change.text_anchor_id AND status='active';
  SELECT * INTO body FROM chapter_body_versions WHERE id=checkpoint.body_version_id AND chapter_document_id=issue.chapter_document_id AND archived_at IS NULL;
  SELECT * INTO settlement FROM chapter_settlements WHERE id=checkpoint.settlement_id AND book_id=saved.book_id AND status='committed';
  IF checkpoint.id IS NULL OR origin.session_id IS NULL OR issue.issue_id IS NULL OR journal.settlement_id IS NULL OR review.review_id IS NULL OR change.id IS NULL OR proposal.id IS NULL OR anchor.id IS NULL OR body.id IS NULL OR settlement.id IS NULL
    OR origin.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1'
    OR NOT (origin.original_receipt->'relatedIssueIds') ? saved.issue_id::text
    OR (SELECT count(*) FROM state_changes WHERE settlement_id=checkpoint.settlement_id AND status='active')<>1
    OR checkpoint.previous_checkpoint_id IS DISTINCT FROM origin.base_checkpoint_id
    OR checkpoint.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR checkpoint.body_version_id IS DISTINCT FROM issue.body_version_id
    OR change.subject_kind IS DISTINCT FROM issue.subject_kind OR change.subject_id IS DISTINCT FROM issue.subject_id OR change.state_key IS DISTINCT FROM issue.state_key
    OR change.before_json IS DISTINCT FROM origin.source_snapshot#>'{correction,beforeValue}'
    OR proposal.before_json IS DISTINCT FROM change.before_json OR proposal.after_json IS DISTINCT FROM change.after_json
    OR anchor.book_id IS DISTINCT FROM saved.book_id OR anchor.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR anchor.body_version_id IS DISTINCT FROM issue.body_version_id
    OR body.chapter_document_id IS DISTINCT FROM issue.chapter_document_id
    THEN RAISE EXCEPTION 'resolution needs its real issue-owned corrective merge and body evidence' USING ERRCODE='23514'; END IF;
  PERFORM assert_resource_correction_formal_source(original) FROM resource_supplement_correction_origins original WHERE original.session_id=checkpoint.session_id AND original.book_id=saved.book_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'resolution immutable correction original missing' USING ERRCODE='23514'; END IF;
  formal_input:=saved.full_proof->'formalInput';
  IF jsonb_typeof(formal_input) IS DISTINCT FROM 'object' OR (formal_input->>'requestKey')::uuid IS NULL
    OR formal_input->>'reviewId' IS DISTINCT FROM review.review_id::text
    OR formal_input->>'expectedSessionRevision' IS DISTINCT FROM review.session_revision::text
    OR formal_input->>'expectedImpactHash' IS DISTINCT FROM review.impact_hash::text
    THEN RAISE EXCEPTION 'resolution complete formal input mismatch' USING ERRCODE='23514'; END IF;
  expected:=jsonb_build_object('contract','resource_supplement_correction_resolution_v1','resolutionId',saved.resolution_id,'requestKey',saved.request_key,'bookId',saved.book_id,'issue',to_jsonb(issue),
    'formalInput',formal_input,'originalStart',origin.original_receipt,'originalReview',review.original_receipt,'merged',journal.merged_write,
    'correctionSource',origin.source_snapshot,'correctedState',to_jsonb(change),'proposal',to_jsonb(proposal),'anchor',to_jsonb(anchor),'body',to_jsonb(body),'checkpoint',to_jsonb(checkpoint),'settlement',to_jsonb(settlement));
  IF saved.full_proof IS DISTINCT FROM expected OR saved.canonical_proof::jsonb IS DISTINCT FROM saved.full_proof
    OR encode(sha256(convert_to(saved.canonical_proof,'UTF8')),'hex') IS DISTINCT FROM saved.proof_hash::text
    OR saved.original_receipt IS DISTINCT FROM jsonb_build_object('contract','resource_supplement_correction_resolution_v1','resolutionId',saved.resolution_id,'requestKey',saved.request_key,'bookId',saved.book_id,'issueId',saved.issue_id,'correctionCheckpointId',saved.correction_checkpoint_id,'proofHash',saved.proof_hash::text,
      'sourceRoute','/new-design/books/'||saved.book_id||'/writing?chapterDocument='||checkpoint.chapter_document_id||'&session='||checkpoint.session_id||'&resourceIssue='||saved.issue_id)
    THEN RAISE EXCEPTION 'resolution actual full proof or immutable receipt mismatch' USING ERRCODE='23514'; END IF;
END $$;
CREATE OR REPLACE FUNCTION reject_unavailable_resource_integrity_resolution() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  -- resource_supplement_correction_commit_v1: actual proof only, never acknowledgement.
  PERFORM assert_resource_correction_resolution_source(NEW);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION assert_resource_supplement_formal_commit_source(saved resource_supplement_formal_commits) RETURNS void LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; child chapter_adoption_sessions%ROWTYPE;
  base chapter_stable_checkpoints%ROWTYPE; merged_checkpoint chapter_stable_checkpoints%ROWTYPE;
  review resource_supplement_impact_reviews%ROWTYPE; journal resource_supplement_integrity_journals%ROWTYPE;
  corrective boolean; frame_contract text; resolution resource_supplement_integrity_resolutions%ROWTYPE;
  snapshot jsonb; actual jsonb; issues jsonb; field jsonb; historical jsonb; source_kind text;
  field_values jsonb:='{}'::jsonb; field_key text; before_value jsonb; expected_chain jsonb:='[]'::jsonb; effective numeric; reason text;
BEGIN
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO child FROM chapter_adoption_sessions WHERE id=saved.session_id AND book_id=saved.book_id AND status='stable' AND settlement_id=saved.settlement_id;
  SELECT * INTO journal FROM resource_supplement_integrity_journals WHERE settlement_id=saved.settlement_id AND book_id=saved.book_id;
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=saved.book_id AND status='superseded';
  SELECT * INTO merged_checkpoint FROM chapter_stable_checkpoints WHERE id=journal.checkpoint_id AND book_id=saved.book_id AND status='stable' AND session_id=saved.session_id AND settlement_id=saved.settlement_id;
  SELECT * INTO review FROM resource_supplement_impact_reviews WHERE review_id=journal.review_id AND book_id=saved.book_id AND session_id=saved.session_id;
  corrective:=origin.source_snapshot->>'contract'='stable_resource_correction_preview_v1';
  frame_contract:=CASE WHEN corrective THEN 'resource_supplement_correction_commit_v1' ELSE 'resource_supplement_formal_commit_v1' END;
  IF corrective THEN
    PERFORM assert_resource_correction_formal_source(original) FROM resource_supplement_correction_origins original WHERE original.session_id=saved.session_id AND original.book_id=saved.book_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'corrective formal commit needs its immutable original' USING ERRCODE='23514'; END IF;
  END IF;
  IF origin.session_id IS NULL OR child.id IS NULL OR journal.settlement_id IS NULL OR base.id IS NULL OR merged_checkpoint.id IS NULL OR review.review_id IS NULL
    OR origin.source_snapshot->>'contract' NOT IN ('stable_resource_supplement_preview_v1','stable_resource_correction_preview_v1')
    OR merged_checkpoint.previous_checkpoint_id IS DISTINCT FROM base.id
    OR child.revision IS DISTINCT FROM review.session_revision+2
    OR saved.full_input->>'requestKey' IS DISTINCT FROM saved.request_key::text
    OR saved.full_input->>'reviewId' IS DISTINCT FROM review.review_id::text
    OR saved.full_input->>'expectedSessionRevision' IS DISTINCT FROM review.session_revision::text
    OR saved.full_input->>'expectedImpactHash' IS DISTINCT FROM review.impact_hash::text
    OR saved.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract',frame_contract,'bookId',saved.book_id,'sessionId',saved.session_id,'input',saved.full_input)
    OR encode(sha256(convert_to(saved.canonical_input,'UTF8')),'hex') IS DISTINCT FROM saved.input_hash::text
    OR saved.canonical_receipt::jsonb IS DISTINCT FROM saved.original_receipt
    OR encode(sha256(convert_to(saved.canonical_receipt,'UTF8')),'hex') IS DISTINCT FROM saved.receipt_hash::text
    OR saved.original_receipt->>'contract' IS DISTINCT FROM frame_contract
    OR saved.original_receipt->>'bookId' IS DISTINCT FROM saved.book_id::text OR saved.original_receipt->>'sessionId' IS DISTINCT FROM saved.session_id::text
    OR saved.original_receipt->>'chapterDocumentId' IS DISTINCT FROM child.chapter_document_id::text
    OR saved.original_receipt->>'inputHash' IS DISTINCT FROM saved.input_hash::text OR saved.original_receipt->'input' IS DISTINCT FROM saved.full_input
    OR saved.original_receipt->'merged' IS DISTINCT FROM journal.merged_write
    OR saved.original_receipt->'originalStart' IS DISTINCT FROM origin.original_receipt
    OR saved.original_receipt->'originalReview' IS DISTINCT FROM review.original_receipt
    OR saved.original_receipt->'repeated' IS DISTINCT FROM 'false'::jsonb
    OR saved.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||saved.book_id||'/writing?chapterDocument='||child.chapter_document_id||'&session='||child.id
    OR journal.merged_write->'confirmed' IS DISTINCT FROM merged_checkpoint.summary->'confirmed'
    OR journal.merged_write->>'impactHash' IS DISTINCT FROM review.impact_hash::text
    OR journal.merged_write->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR NOT EXISTS(SELECT 1 FROM books WHERE id=saved.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM chapter_documents document JOIN chapter_body_versions body ON body.id=document.adopted_version_id
      WHERE document.id=child.chapter_document_id AND document.book_id=saved.book_id AND document.status='active' AND body.id=child.body_version_id AND body.archived_at IS NULL
        AND encode(sha256(convert_to(body.content,'UTF8')),'hex')=body.content_hash)
    THEN RAISE EXCEPTION 'formal supplement full original receipt or merged proof mismatch' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM chapter_settlement_items WHERE session_id=child.id AND decision NOT IN ('confirm','reject'))
    OR (SELECT count(*) FROM chapter_settlement_items WHERE session_id=child.id AND decision='confirm')<>jsonb_array_length(review.impact_snapshot->'changes')
    OR (SELECT count(*) FROM state_changes WHERE settlement_id=saved.settlement_id AND status='active')<>jsonb_array_length(review.impact_snapshot->'changes')
    THEN RAISE EXCEPTION 'formal supplement candidate or actual state set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(review.impact_snapshot->'changes') LOOP
    field_key:=jsonb_build_array(snapshot->>'subjectKind',snapshot->>'subjectId',snapshot->>'stateKey')::text;
    field_values:=jsonb_set(field_values,ARRAY[field_key],snapshot->'after');
    IF NOT EXISTS(SELECT 1 FROM chapter_settlement_items item JOIN state_change_proposals proposal ON proposal.id=item.state_proposal_id
      JOIN state_changes change ON change.proposal_id=proposal.id AND change.id=proposal.confirmed_state_change_id
      JOIN chapter_text_anchors anchor ON anchor.id=change.text_anchor_id AND anchor.status='active'
      WHERE item.id=(snapshot->>'itemId')::uuid AND item.session_id=child.id AND item.decision='confirm'
        AND item.canonical_fact_id IS NULL AND item.knowledge_proposal_id IS NULL AND item.category IN ('prop','relationship')
        AND proposal.id=(snapshot->>'proposalId')::uuid AND proposal.book_id=saved.book_id AND proposal.status='confirmed' AND proposal.before_known
        AND proposal.chapter_document_id=child.chapter_document_id AND proposal.body_version_id=child.body_version_id
        AND proposal.subject_kind=snapshot->>'subjectKind' AND proposal.subject_id=(snapshot->>'subjectId')::uuid AND proposal.state_key=snapshot->>'stateKey'
        AND proposal.before_json IS NOT DISTINCT FROM snapshot->'before' AND proposal.after_json IS NOT DISTINCT FROM snapshot->'after'
        AND change.book_id=saved.book_id AND change.settlement_id=saved.settlement_id AND change.status='active'
        AND change.chapter_document_id=child.chapter_document_id AND change.body_version_id=child.body_version_id
        AND change.subject_kind=proposal.subject_kind AND change.subject_id=proposal.subject_id AND change.state_key=proposal.state_key
        AND change.before_json IS NOT DISTINCT FROM proposal.before_json AND change.after_json IS NOT DISTINCT FROM proposal.after_json
        AND change.delta_json IS NOT DISTINCT FROM proposal.delta_json AND change.text_anchor_id=proposal.text_anchor_id AND item.evidence_anchor_id=anchor.id
        AND coalesce(change.effective_story_order,base.chapter_order)=base.chapter_order
        AND anchor.book_id=saved.book_id AND anchor.chapter_document_id=child.chapter_document_id AND anchor.body_version_id=child.body_version_id)
      THEN RAISE EXCEPTION 'formal supplement actual confirmed state proof mismatch' USING ERRCODE='23514'; END IF;
    -- Reconstruct the original END-of-chapter baseline without this new commit.
    -- It cannot inherit a future chapter, a new initial version or its own after.
    SELECT to_jsonb(change) INTO historical FROM state_changes change
      JOIN chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      JOIN chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      JOIN chapter_settlements own_commit ON own_commit.id=change.settlement_id AND own_commit.book_id=change.book_id AND own_commit.status='committed' AND own_commit.chapter_document_id=document.id AND own_commit.body_version_id=body.id
      JOIN state_change_proposals proposal ON proposal.id=change.proposal_id AND proposal.status='confirmed' AND proposal.confirmed_state_change_id=change.id
        AND proposal.book_id=change.book_id AND proposal.chapter_document_id=document.id AND proposal.body_version_id=body.id
        AND proposal.subject_kind=change.subject_kind AND proposal.subject_id=change.subject_id AND proposal.state_key=change.state_key AND proposal.after_json=change.after_json
      LEFT JOIN chapter_text_anchors anchor ON anchor.id=change.text_anchor_id
      WHERE change.book_id=saved.book_id AND change.subject_kind=snapshot->>'subjectKind' AND change.subject_id=(snapshot->>'subjectId')::uuid AND change.state_key=snapshot->>'stateKey' AND change.status='active'
        AND change.settlement_id<>saved.settlement_id AND ((NOT corrective AND document.logical_order<=base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<=base.chapter_order) OR (corrective AND document.logical_order<base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<base.chapter_order))
        AND (change.text_anchor_id IS NULL OR anchor.status='active' AND anchor.book_id=saved.book_id AND anchor.chapter_document_id=document.id AND anchor.body_version_id=body.id)
      ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
    source_kind:='state_change';
    IF historical IS NULL AND NOT corrective THEN
      SELECT to_jsonb(initial_version) INTO historical FROM entity_initial_states state JOIN entity_initial_state_versions initial_version ON initial_version.initial_state_id=state.id
        WHERE state.book_id=saved.book_id AND state.subject_kind=snapshot->>'subjectKind' AND state.subject_id=(snapshot->>'subjectId')::uuid AND state.state_key=snapshot->>'stateKey'
          AND initial_version.created_at<=base.created_at ORDER BY initial_version.version DESC LIMIT 1;
      source_kind:='initial_state';
    END IF;
    SELECT item INTO field FROM jsonb_array_elements(origin.source_snapshot->'catalog'->'subjects') subject,jsonb_array_elements(subject->'fields') item
      WHERE subject->>'subjectKind'=snapshot->>'subjectKind' AND subject->>'id'=snapshot->>'subjectId' AND item->>'key'=snapshot->>'stateKey';
    IF historical IS NULL OR field IS NULL OR field->'baseline'->'known' IS DISTINCT FROM 'true'::jsonb
      OR field->'baseline'->'stale' IS DISTINCT FROM 'false'::jsonb OR field->'baseline'->>'sourceKind' IS DISTINCT FROM source_kind
      OR field->'baseline'->>'sourceId' IS DISTINCT FROM historical->>'id'
      OR snapshot->'before' IS DISTINCT FROM (CASE WHEN source_kind='state_change' THEN historical->'after_json' ELSE historical->'value_json' END)
      OR field->'baseline'->'value' IS DISTINCT FROM snapshot->'before'
      THEN RAISE EXCEPTION 'formal supplement actual historical chapter-end baseline changed' USING ERRCODE='23514'; END IF;
    SELECT to_jsonb(projection) INTO actual FROM current_state_projections projection WHERE book_id=saved.book_id
      AND subject_kind=snapshot->>'subjectKind' AND subject_id=(snapshot->>'subjectId')::uuid AND state_key=snapshot->>'stateKey';
    SELECT to_jsonb(change) INTO historical FROM state_changes change
      JOIN chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      JOIN chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      JOIN chapter_settlements own_commit ON own_commit.id=change.settlement_id AND own_commit.book_id=change.book_id AND own_commit.status='committed' AND own_commit.chapter_document_id=document.id AND own_commit.body_version_id=body.id
      JOIN state_change_proposals proposal ON proposal.id=change.proposal_id AND proposal.status='confirmed' AND proposal.confirmed_state_change_id=change.id
        AND proposal.book_id=change.book_id AND proposal.chapter_document_id=document.id AND proposal.body_version_id=body.id
        AND proposal.subject_kind=change.subject_kind AND proposal.subject_id=change.subject_id AND proposal.state_key=change.state_key
        AND proposal.before_json IS NOT DISTINCT FROM change.before_json AND proposal.after_json IS NOT DISTINCT FROM change.after_json
      WHERE change.book_id=saved.book_id AND change.subject_kind=snapshot->>'subjectKind' AND change.subject_id=(snapshot->>'subjectId')::uuid AND change.state_key=snapshot->>'stateKey' AND change.status='active'
      ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
    IF actual IS NULL OR historical IS NULL OR actual->>'source_state_change_id' IS DISTINCT FROM historical->>'id' OR actual->'value_json' IS DISTINCT FROM historical->'after_json'
      OR actual->'is_stale' IS DISTINCT FROM to_jsonb(EXISTS(SELECT 1 FROM resource_supplement_integrity_issues issue WHERE issue.book_id=saved.book_id
        AND issue.subject_kind=snapshot->>'subjectKind' AND issue.subject_id=(snapshot->>'subjectId')::uuid AND issue.state_key=snapshot->>'stateKey'
        AND NOT EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=issue.issue_id)))
      THEN RAISE EXCEPTION 'formal supplement projection and actual source fence must close atomically' USING ERRCODE='23514'; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(issue) ORDER BY issue.issue_id),'[]'::jsonb) INTO issues FROM resource_supplement_integrity_issues issue WHERE settlement_id=saved.settlement_id AND book_id=saved.book_id;
  IF issues IS DISTINCT FROM saved.original_receipt->'issues'
    OR (SELECT count(*) FROM jsonb_array_elements(issues))<>(SELECT count(*) FROM jsonb_array_elements(review.impact_snapshot->'stateChain') WHERE value->>'reason'<>'compatible')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(review.impact_snapshot->'stateChain') impact WHERE impact->>'reason'<>'compatible' AND NOT EXISTS(
      SELECT 1 FROM resource_supplement_integrity_issues issue WHERE issue.settlement_id=saved.settlement_id AND issue.book_id=saved.book_id AND issue.state_change_id=(impact->>'stateChangeId')::uuid
        AND issue.impact=impact AND NOT EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=issue.issue_id)))
    THEN RAISE EXCEPTION 'formal supplement every real conflict must retain its actual immutable source fence' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM dependency_resources WHERE book_id=saved.book_id AND resource_kind='chapter_settlement' AND stable_object_id=child.chapter_document_id AND exact_version_id=saved.settlement_id)
    OR EXISTS(SELECT 1 FROM state_changes change WHERE change.settlement_id=saved.settlement_id AND change.status='active' AND NOT EXISTS(
      SELECT 1 FROM dependency_resources resource WHERE resource.book_id=saved.book_id AND resource.resource_kind='state_change' AND resource.stable_object_id=change.id AND resource.exact_version_id=change.id))
    OR EXISTS(SELECT 1 FROM state_changes change CROSS JOIN embedding_profiles profile JOIN embedding_profile_versions profile_version ON profile_version.id=profile.current_version_id
      WHERE change.settlement_id=saved.settlement_id AND change.status='active' AND profile.status='active' AND 'state_change'=ANY(profile_version.allowed_source_kinds)
        AND NOT EXISTS(SELECT 1 FROM dependency_resources resource JOIN embedding_source_snapshots source ON source.dependency_source_resource_id=resource.id
          JOIN chunking_requests request ON request.source_snapshot_id=source.id AND request.book_id=saved.book_id
          WHERE resource.book_id=saved.book_id AND resource.resource_kind='state_change' AND resource.stable_object_id=change.id AND resource.exact_version_id=change.id
            AND source.book_id=saved.book_id AND source.profile_version_id=profile_version.id AND source.source_kind='state_change' AND source.source_stable_id=change.id
            AND source.source_version_id=change.id AND source.source_revision=1 AND source.status='current' AND source.source_hash=resource.content_hash
            AND request.profile_version_id=profile_version.id AND request.expected_source_hash=resource.content_hash))
    THEN RAISE EXCEPTION 'formal supplement actual dependency and semantic sources incomplete' USING ERRCODE='23514'; END IF;
  -- Full actual downstream versions, references and state sources follow below.
  SELECT coalesce(jsonb_agg(to_jsonb(reference)||jsonb_build_object('source_version',to_jsonb(card_version)) ORDER BY reference.id),'[]'::jsonb) INTO actual
    FROM planning_version_references reference LEFT JOIN card_versions card_version ON card_version.id=reference.card_version_id AND card_version.card_id=reference.card_id
    WHERE reference.book_id=saved.book_id AND reference.planning_version_id IN (
      SELECT (value#>>'{adopted_plan,id}')::uuid FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,chapters}')
      UNION SELECT (value#>>'{body,planning_version_id}')::uuid FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,chapters}'));
  IF actual IS DISTINCT FROM review.impact_snapshot#>'{downstreamSource,planningReferences}' THEN
    RAISE EXCEPTION 'impact review exact planning references changed' USING ERRCODE='23514'; END IF;
  -- Same authority rule as the preview: keep all rows, use the final row per
  -- chapter/field; preserve that field's first position in the ordered chain.
  FOR snapshot IN
    WITH ordered AS (SELECT value,ordinality,
      row_number() OVER(PARTITION BY value#>>'{change,chapter_document_id}',value#>>'{change,subject_kind}',value#>>'{change,subject_id}',value#>>'{change,state_key}' ORDER BY ordinality DESC) last_position,
      min(ordinality) OVER(PARTITION BY value#>>'{change,chapter_document_id}',value#>>'{change,subject_kind}',value#>>'{change,subject_id}',value#>>'{change,state_key}') first_position
      FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,states}') WITH ORDINALITY)
    SELECT value FROM ordered WHERE last_position=1 ORDER BY first_position
  LOOP
    field_key=jsonb_build_array(snapshot#>>'{change,subject_kind}',snapshot#>>'{change,subject_id}',snapshot#>>'{change,state_key}')::text;
    before_value=field_values->field_key;
    effective=(snapshot#>>'{change,effective_story_order}')::numeric;
    reason=CASE WHEN effective IS NOT NULL AND effective<=base.chapter_order THEN 'backdated_source'
      WHEN before_value IS NOT DISTINCT FROM snapshot#>'{change,before_json}' THEN 'compatible' ELSE 'before_conflict' END;
    expected_chain=expected_chain||jsonb_build_array(jsonb_build_object('chapterDocumentId',snapshot#>>'{change,chapter_document_id}',
      'bodyVersionId',snapshot#>>'{change,body_version_id}','chapterOrder',snapshot->'chapter_order','stateChangeId',snapshot#>>'{change,id}',
      'subjectKind',snapshot#>>'{change,subject_kind}','subjectId',snapshot#>>'{change,subject_id}','stateKey',snapshot#>>'{change,state_key}',
      'expectedBefore',before_value,'recordedBefore',snapshot#>'{change,before_json}','recordedAfter',snapshot#>'{change,after_json}',
      'effectiveStoryOrder',effective,'reason',reason));
    field_values=jsonb_set(field_values,ARRAY[field_key],snapshot#>'{change,after_json}');
  END LOOP;
  IF expected_chain IS DISTINCT FROM review.impact_snapshot->'stateChain' THEN
    RAISE EXCEPTION 'impact review actual state chain mismatch' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM chapter_documents WHERE book_id=saved.book_id AND status='active' AND logical_order>base.chapter_order)
    <>jsonb_array_length(review.impact_snapshot#>'{downstreamSource,chapters}')
    OR (SELECT count(DISTINCT value#>>'{document,id}') FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,chapters}'))<>jsonb_array_length(review.impact_snapshot#>'{downstreamSource,chapters}') THEN
    RAISE EXCEPTION 'impact review downstream chapter set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,chapters}') LOOP
    SELECT jsonb_build_object('document',to_jsonb(document),'body',to_jsonb(body),'planning_object',to_jsonb(object),
      'adopted_plan',to_jsonb(plan),'body_plan',to_jsonb(body_plan),'checkpoint',to_jsonb(checkpoint)) INTO actual
      FROM chapter_documents document
      LEFT JOIN chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
      LEFT JOIN planning_objects object ON object.book_id=document.book_id AND object.card_id=document.chapter_card_id AND object.level='chapter' AND object.status='active'
      LEFT JOIN planning_versions plan ON plan.id=object.adopted_version_id AND plan.object_id=object.id
      LEFT JOIN planning_versions body_plan ON body_plan.id=body.planning_version_id AND body_plan.book_id=document.book_id
      LEFT JOIN chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=document.book_id AND checkpoint.body_version_id=body.id AND checkpoint.status='stable'
      WHERE document.id=(snapshot#>>'{document,id}')::uuid AND document.book_id=saved.book_id AND document.status='active' AND document.logical_order>base.chapter_order;
    IF actual IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'impact review downstream source changed' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM state_changes change
      JOIN chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      WHERE change.book_id=saved.book_id AND change.status='active' AND document.logical_order>base.chapter_order
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(review.impact_snapshot->'changes') selection
          WHERE selection->>'subjectKind'=change.subject_kind AND (selection->>'subjectId')::uuid=change.subject_id AND selection->>'stateKey'=change.state_key))
    <>jsonb_array_length(review.impact_snapshot#>'{downstreamSource,states}')
    OR (SELECT count(DISTINCT value#>>'{change,id}') FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,states}'))<>jsonb_array_length(review.impact_snapshot#>'{downstreamSource,states}')
    THEN RAISE EXCEPTION 'impact review downstream state set incomplete' USING ERRCODE='23514'; END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(review.impact_snapshot#>'{downstreamSource,states}') LOOP
    SELECT jsonb_build_object('change',to_jsonb(change),'proposal',to_jsonb(proposal),'settlement',to_jsonb(settlement),
      'anchor',to_jsonb(anchor),'checkpoint',to_jsonb(checkpoint),'checkpoint_commit',to_jsonb(checkpoint_commit),
      'checkpoint_session',to_jsonb(checkpoint_session),'chapter_order',document.logical_order) INTO actual
      FROM state_changes change
      JOIN chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
      LEFT JOIN state_change_proposals proposal ON proposal.id=change.proposal_id
      LEFT JOIN chapter_settlements settlement ON settlement.id=change.settlement_id
      LEFT JOIN chapter_text_anchors anchor ON anchor.id=change.text_anchor_id
      LEFT JOIN chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=change.book_id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
      LEFT JOIN chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id AND checkpoint_commit.book_id=change.book_id AND checkpoint_commit.chapter_document_id=document.id AND checkpoint_commit.body_version_id=change.body_version_id
      LEFT JOIN chapter_adoption_sessions checkpoint_session ON checkpoint_session.id=checkpoint.session_id AND checkpoint_session.book_id=change.book_id AND checkpoint_session.chapter_document_id=document.id AND checkpoint_session.body_version_id=change.body_version_id AND checkpoint_session.settlement_id=checkpoint.settlement_id
      WHERE change.id=(snapshot#>>'{change,id}')::uuid AND change.book_id=saved.book_id AND change.status='active' AND document.logical_order>base.chapter_order;
    IF actual IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'impact review downstream state source changed' USING ERRCODE='23514'; END IF;
  END LOOP;


  IF corrective THEN
    IF jsonb_array_length(review.impact_snapshot->'changes')<>1
      OR (SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.issue_id),'[]'::jsonb) FROM resource_supplement_integrity_resolutions item WHERE item.correction_checkpoint_id=merged_checkpoint.id AND item.book_id=saved.book_id) IS DISTINCT FROM saved.original_receipt->'resolutions'
      OR (SELECT coalesce(jsonb_agg(issue_id::text ORDER BY issue_id),'[]'::jsonb) FROM resource_supplement_integrity_resolutions WHERE correction_checkpoint_id=merged_checkpoint.id AND book_id=saved.book_id) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) FROM jsonb_array_elements_text(origin.original_receipt->'relatedIssueIds'))
      THEN RAISE EXCEPTION 'corrective commit must retain every exact atomic resolution proof' USING ERRCODE='23514'; END IF;
    FOR resolution IN SELECT * FROM resource_supplement_integrity_resolutions WHERE correction_checkpoint_id=merged_checkpoint.id AND book_id=saved.book_id LOOP
      PERFORM assert_resource_correction_resolution_source(resolution);
      IF resolution.full_proof->'formalInput' IS DISTINCT FROM saved.full_input THEN RAISE EXCEPTION 'correction proof must bind complete formal original input' USING ERRCODE='23514'; END IF;
    END LOOP;
  END IF;
END $$;
