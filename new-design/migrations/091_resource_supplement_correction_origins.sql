-- Manual independent-request foundation only. NOT registered by startup.
-- 087 formal closure and 090 resolution guards remain closed, unchanged.
SET search_path TO new_design,public;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id='090_resource_supplement_integrity') THEN
    RAISE EXCEPTION 'actual integrity sources must precede correction originals';
  END IF;
END $$;
CREATE TABLE resource_supplement_correction_origins (
  session_id uuid PRIMARY KEY REFERENCES chapter_resource_supplements(session_id),
  book_id uuid NOT NULL REFERENCES books(id),
  issue_id uuid NOT NULL REFERENCES resource_supplement_integrity_issues(issue_id),
  canonical_input text NOT NULL,
  canonical_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER resource_supplement_correction_origin_history BEFORE UPDATE OR DELETE ON resource_supplement_correction_origins
  FOR EACH ROW EXECUTE FUNCTION guard_resource_supplement_integrity_history();
CREATE FUNCTION validate_resource_supplement_correction_origin() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE; child chapter_adoption_sessions%ROWTYPE;
  issue resource_supplement_integrity_issues%ROWTYPE; base chapter_stable_checkpoints%ROWTYPE;
  source jsonb; correction jsonb; actual_prefix jsonb; related jsonb; field jsonb; prefix_order integer;
BEGIN
  -- stable_resource_correction_start_v1: creation only; no candidate or resolution permission.
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=NEW.session_id AND book_id=NEW.book_id;
  SELECT * INTO child FROM chapter_adoption_sessions WHERE id=NEW.session_id AND book_id=NEW.book_id;
  SELECT * INTO issue FROM resource_supplement_integrity_issues WHERE issue_id=NEW.issue_id AND book_id=NEW.book_id;
  SELECT * INTO base FROM chapter_stable_checkpoints WHERE id=origin.base_checkpoint_id AND book_id=NEW.book_id AND status='stable';
  source:=origin.source_snapshot; correction:=source->'correction';
  IF origin.session_id IS NULL OR child.id IS NULL OR issue.issue_id IS NULL OR base.id IS NULL
    OR child.status IS DISTINCT FROM 'adopted_pending_proposals' OR child.adoption_kind IS DISTINCT FROM 'resource_supplement'
    OR base.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR base.body_version_id IS DISTINCT FROM issue.body_version_id
    OR child.chapter_document_id IS DISTINCT FROM issue.chapter_document_id OR child.body_version_id IS DISTINCT FROM issue.body_version_id
    OR NOT EXISTS(SELECT 1 FROM books WHERE id=NEW.book_id AND status='active')
    OR NOT EXISTS(SELECT 1 FROM chapter_documents WHERE id=issue.chapter_document_id AND book_id=NEW.book_id AND status='active' AND adopted_version_id=issue.body_version_id)
    OR EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=NEW.issue_id)
    OR EXISTS(SELECT 1 FROM chapter_adoption_sessions WHERE chapter_document_id=issue.chapter_document_id AND id<>child.id
      AND status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed'))
    OR source->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1'
    OR origin.original_receipt->>'contract' IS DISTINCT FROM 'stable_resource_correction_start_v1'
    OR origin.full_input->>'issueId' IS DISTINCT FROM NEW.issue_id::text
    OR origin.original_receipt->>'issueId' IS DISTINCT FROM NEW.issue_id::text
    OR source->'input' IS DISTINCT FROM jsonb_build_object('issueId',NEW.issue_id,'resourceScope',origin.full_input->'resourceScope')
    OR NEW.canonical_input::jsonb IS DISTINCT FROM jsonb_build_object('contract','stable_resource_correction_start_v1','bookId',NEW.book_id,'input',origin.full_input)
    OR encode(sha256(convert_to(NEW.canonical_input,'UTF8')),'hex') IS DISTINCT FROM origin.input_hash::text
    OR NEW.canonical_source::jsonb IS DISTINCT FROM source-'sourceHash'
    OR encode(sha256(convert_to(NEW.canonical_source,'UTF8')),'hex') IS DISTINCT FROM origin.source_hash::text
    OR correction->>'contract' IS DISTINCT FROM 'resource_supplement_correction_basis_v1'
    OR correction->>'bookId' IS DISTINCT FROM NEW.book_id::text OR correction->>'issueId' IS DISTINCT FROM NEW.issue_id::text
    OR correction->>'baseCheckpointId' IS DISTINCT FROM base.id::text
    OR correction->>'chapterDocumentId' IS DISTINCT FROM issue.chapter_document_id::text
    OR correction->>'bodyVersionId' IS DISTINCT FROM issue.body_version_id::text
    OR correction->>'subjectKind' IS DISTINCT FROM issue.subject_kind OR correction->>'subjectId' IS DISTINCT FROM issue.subject_id::text
    OR correction->>'stateKey' IS DISTINCT FROM issue.state_key
    OR correction->'issue' IS DISTINCT FROM to_jsonb(issue)||jsonb_build_object('current_checkpoint',to_jsonb(base))
    OR correction->'chapterEndBasis' IS DISTINCT FROM source->'basis'
    OR correction->'originalRecordedBefore' IS DISTINCT FROM issue.impact->'recordedBefore'
    OR correction->'originalRecordedAfter' IS DISTINCT FROM issue.impact->'recordedAfter'
    OR origin.original_receipt->>'sourceRoute' IS DISTINCT FROM '/new-design/books/'||NEW.book_id||'/writing?chapterDocument='||issue.chapter_document_id||'&session='||NEW.session_id||'&resourceIssue='||NEW.issue_id
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
    WHERE change.book_id=NEW.book_id AND change.subject_kind=issue.subject_kind AND change.subject_id=issue.subject_id AND change.state_key=issue.state_key AND change.status='active'
      AND document.logical_order<base.chapter_order AND coalesce(change.effective_story_order,document.logical_order)<base.chapter_order
    ORDER BY coalesce(change.effective_story_order,document.logical_order) DESC,document.logical_order DESC,change.sequence DESC LIMIT 1;
  IF actual_prefix IS NULL OR correction->'prefixSource' IS DISTINCT FROM actual_prefix
    OR correction->'beforeValue' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'proposal'->>'status' IS DISTINCT FROM 'confirmed'
    OR actual_prefix->'proposal'->>'book_id' IS DISTINCT FROM NEW.book_id::text
    OR actual_prefix->'proposal'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'proposal'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'proposal'->>'subject_kind' IS DISTINCT FROM issue.subject_kind
    OR actual_prefix->'proposal'->>'subject_id' IS DISTINCT FROM issue.subject_id::text
    OR actual_prefix->'proposal'->>'state_key' IS DISTINCT FROM issue.state_key
    OR actual_prefix->'proposal'->>'confirmed_state_change_id' IS DISTINCT FROM actual_prefix->'change'->>'id'
    OR actual_prefix->'proposal'->'before_json' IS DISTINCT FROM actual_prefix->'change'->'before_json'
    OR actual_prefix->'proposal'->'after_json' IS DISTINCT FROM actual_prefix->'change'->'after_json'
    OR actual_prefix->'settlement'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'settlement'->>'book_id' IS DISTINCT FROM NEW.book_id::text
    OR actual_prefix->'settlement'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'settlement'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'body'->'archived_at' IS DISTINCT FROM 'null'::jsonb
    OR encode(sha256(convert_to(actual_prefix->'body'->>'content','UTF8')),'hex') IS DISTINCT FROM actual_prefix->'body'->>'content_hash'
    OR actual_prefix->'checkpoint_commit'->>'status' IS DISTINCT FROM 'committed'
    OR actual_prefix->'checkpoint_commit'->>'book_id' IS DISTINCT FROM NEW.book_id::text
    OR actual_prefix->'checkpoint_commit'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_commit'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'status' IS DISTINCT FROM 'stable'
    OR actual_prefix->'checkpoint_session'->>'book_id' IS DISTINCT FROM NEW.book_id::text
    OR actual_prefix->'checkpoint_session'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
    OR actual_prefix->'checkpoint_session'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id'
    OR actual_prefix->'checkpoint_session'->>'settlement_id' IS DISTINCT FROM actual_prefix->'checkpoint_commit'->>'id'
    OR NOT coalesce((actual_prefix->'checkpoint'->'summary'->'confirmed'->'states') ? (actual_prefix->'change'->>'id'),false)
    OR (SELECT count(*) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
      IS DISTINCT FROM (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(actual_prefix->'checkpoint'->'summary'->'confirmed'->'states'))
    OR actual_prefix->'change'->'text_anchor_id'<>'null'::jsonb AND (actual_prefix->'anchor'->>'status' IS DISTINCT FROM 'active'
      OR actual_prefix->'anchor'->>'book_id' IS DISTINCT FROM NEW.book_id::text
      OR actual_prefix->'anchor'->>'chapter_document_id' IS DISTINCT FROM actual_prefix->'change'->>'chapter_document_id'
      OR actual_prefix->'anchor'->>'body_version_id' IS DISTINCT FROM actual_prefix->'change'->>'body_version_id')
    OR EXISTS(SELECT 1 FROM resource_supplement_integrity_issues earlier JOIN chapter_documents document ON document.id=earlier.chapter_document_id
      WHERE earlier.book_id=NEW.book_id AND earlier.subject_kind=issue.subject_kind AND earlier.subject_id=issue.subject_id AND document.logical_order<=prefix_order
        AND NOT EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions WHERE issue_id=earlier.issue_id))
    THEN RAISE EXCEPTION 'correction must retain the actual valid latest chapter-before proof' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(actual) ORDER BY document.logical_order,actual.issue_id),'[]'::jsonb) INTO related
    FROM resource_supplement_integrity_issues actual JOIN chapter_documents document ON document.id=actual.chapter_document_id AND document.book_id=actual.book_id
    WHERE actual.book_id=NEW.book_id AND document.logical_order<=base.chapter_order AND NOT EXISTS(
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
  RETURN NEW;
END $$;
CREATE TRIGGER resource_supplement_correction_origin_guard BEFORE INSERT ON resource_supplement_correction_origins
  FOR EACH ROW EXECUTE FUNCTION validate_resource_supplement_correction_origin();
CREATE FUNCTION require_resource_supplement_correction_origin() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF NEW.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_supplement_preview_v1' THEN
    IF NEW.source_snapshot->>'contract' IS DISTINCT FROM 'stable_resource_correction_preview_v1' OR NOT EXISTS(
      SELECT 1 FROM resource_supplement_correction_origins WHERE session_id=NEW.session_id AND book_id=NEW.book_id)
      THEN RAISE EXCEPTION 'correction session requires its atomic full original proof' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER resource_supplement_correction_origin_required AFTER INSERT ON chapter_resource_supplements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_resource_supplement_correction_origin();
CREATE FUNCTION block_unavailable_resource_correction_candidates() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM chapter_resource_supplements WHERE session_id=NEW.session_id AND source_snapshot->>'contract'='stable_resource_correction_preview_v1') THEN
    RAISE EXCEPTION 'resource correction candidate and manual editing contract is not operational' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_resource_correction_item_guard BEFORE INSERT OR UPDATE ON chapter_settlement_items FOR EACH ROW EXECUTE FUNCTION block_unavailable_resource_correction_candidates();
CREATE TRIGGER a_resource_correction_extraction_guard BEFORE INSERT ON chapter_proposal_extraction_requests FOR EACH ROW EXECUTE FUNCTION block_unavailable_resource_correction_candidates();
