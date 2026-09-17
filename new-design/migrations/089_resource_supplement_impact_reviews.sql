-- Manual review storage only; NOT registered by startup. No formal gate changes.
SET search_path TO new_design,public;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id='088_stable_resource_supplement_candidates') THEN
    RAISE EXCEPTION 'candidate contract must precede impact reviews';
  END IF;
END $$;
CREATE TABLE resource_supplement_impact_reviews (
  review_id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id),
  session_id uuid NOT NULL REFERENCES chapter_resource_supplements(session_id),
  request_key uuid NOT NULL,
  session_revision integer NOT NULL CHECK(session_revision>0),
  full_input jsonb NOT NULL CHECK(jsonb_typeof(full_input)='object'),
  input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
  canonical_input text NOT NULL,
  impact_snapshot jsonb NOT NULL CHECK(jsonb_typeof(impact_snapshot)='object'),
  impact_hash char(64) NOT NULL CHECK(impact_hash ~ '^[a-f0-9]{64}$'),
  canonical_impact text NOT NULL,
  original_receipt jsonb NOT NULL CHECK(jsonb_typeof(original_receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,request_key)
);
CREATE FUNCTION validate_resource_supplement_impact_review() RETURNS trigger LANGUAGE plpgsql
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
  SELECT coalesce(jsonb_agg(to_jsonb(reference)||jsonb_build_object('source_version',to_jsonb(version)) ORDER BY reference.id),'[]'::jsonb) INTO actual
    FROM planning_version_references reference LEFT JOIN card_versions version ON version.id=reference.card_version_id AND version.card_id=reference.card_id
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
CREATE TRIGGER resource_supplement_impact_review_guard BEFORE INSERT OR UPDATE OR DELETE ON resource_supplement_impact_reviews
  FOR EACH ROW EXECUTE FUNCTION validate_resource_supplement_impact_review();
COMMENT ON TABLE resource_supplement_impact_reviews IS 'Immutable awareness receipt only. No state commit, source fence, conflict resolution or formal activation.';
