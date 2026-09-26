-- Close new resolution inserts and restore ordinary-only final SQL proof.
-- Keep all original corrective/ordinary receipts, resolutions and healthy source history.
CREATE OR REPLACE FUNCTION new_design.reject_unavailable_resource_integrity_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'corrective proof writes deactivated; all originals retained' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION assert_resource_supplement_formal_commit_source(saved resource_supplement_formal_commits) RETURNS void LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; child chapter_adoption_sessions%ROWTYPE;
  base chapter_stable_checkpoints%ROWTYPE; merged_checkpoint chapter_stable_checkpoints%ROWTYPE;
  review resource_supplement_impact_reviews%ROWTYPE; journal resource_supplement_integrity_journals%ROWTYPE;
  snapshot jsonb; actual jsonb; issues jsonb; field jsonb; historical jsonb; source_kind text;
  field_values jsonb:='{}'::jsonb; field_key text; before_value jsonb; expected_chain jsonb:='[]'::jsonb; effective numeric; reason text;
BEGIN
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=saved.session_id AND book_id=saved.book_id;
  SELECT * INTO child FROM chapter_adoption_sessions WHERE id=saved.session_id AND book_id=saved.book_id AND status='stable' AND settlement_id=saved.settlement_id;
  SELECT * INTO journal FROM resource_supplement_integrity_journals WHERE settlement_id=saved.settlement_id AND book_id=saved.book_id;
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=saved.book_id AND status='superseded';
  SELECT * INTO merged_checkpoint FROM chapter_stable_checkpoints WHERE id=journal.checkpoint_id AND book_id=saved.book_id AND status='stable' AND session_id=saved.session_id AND settlement_id=saved.settlement_id;
  SELECT * INTO review FROM resource_supplement_impact_reviews WHERE review_id=journal.review_id AND book_id=saved.book_id AND session_id=saved.session_id;
  IF origin.session_id IS NULL OR child.id IS NULL OR journal.settlement_id IS NULL OR base.id IS NULL OR merged_checkpoint.id IS NULL OR review.review_id IS NULL
    OR origin.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_supplement_preview_v1'
    OR merged_checkpoint.previous_checkpoint_id IS DISTINCT FROM base.id
    OR child.revision IS DISTINCT FROM review.session_revision+2
    OR saved.full_input->>'requestKey' IS DISTINCT FROM saved.request_key::text
    OR saved.full_input->>'reviewId' IS DISTINCT FROM review.review_id::text
    OR saved.full_input->>'expectedSessionRevision' IS DISTINCT FROM review.session_revision::text
    OR saved.full_input->>'expectedImpactHash' IS DISTINCT FROM review.impact_hash::text
    OR saved.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract','resource_supplement_formal_commit_v1','bookId',saved.book_id,'sessionId',saved.session_id,'input',saved.full_input)
    OR encode(sha256(convert_to(saved.canonical_input,'UTF8')),'hex') IS DISTINCT FROM saved.input_hash::text
    OR saved.canonical_receipt::jsonb IS DISTINCT FROM saved.original_receipt
    OR encode(sha256(convert_to(saved.canonical_receipt,'UTF8')),'hex') IS DISTINCT FROM saved.receipt_hash::text
    OR saved.original_receipt->>'contract' IS DISTINCT FROM 'resource_supplement_formal_commit_v1'
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
        AND change.settlement_id<>saved.settlement_id AND document.logical_order<=base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<=base.chapter_order
        AND (change.text_anchor_id IS NULL OR anchor.status='active' AND anchor.book_id=saved.book_id AND anchor.chapter_document_id=document.id AND anchor.body_version_id=body.id)
      ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
    source_kind:='state_change';
    IF historical IS NULL THEN
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

END $$;
