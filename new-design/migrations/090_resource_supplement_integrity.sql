-- Manual transaction foundation only. NOT registered by startup. 087 stays shut.
SET search_path TO new_design,public;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id='089_resource_supplement_impact_reviews') THEN
    RAISE EXCEPTION 'complete impact review contract must precede integrity journal';
  END IF;
END $$;
CREATE TABLE resource_supplement_integrity_journals (
  settlement_id uuid PRIMARY KEY REFERENCES chapter_settlements(id),
  book_id uuid NOT NULL REFERENCES books(id),
  review_id uuid NOT NULL REFERENCES resource_supplement_impact_reviews(review_id),
  checkpoint_id uuid NOT NULL UNIQUE REFERENCES chapter_stable_checkpoints(id),
  merged_write jsonb NOT NULL CHECK(jsonb_typeof(merged_write)='object'),
  merged_hash char(64) NOT NULL CHECK(merged_hash ~ '^[a-f0-9]{64}$'),
  canonical_merged text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE resource_supplement_integrity_issues (
  issue_id uuid PRIMARY KEY,
  settlement_id uuid NOT NULL REFERENCES resource_supplement_integrity_journals(settlement_id),
  book_id uuid NOT NULL REFERENCES books(id),
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id),
  body_version_id uuid NOT NULL REFERENCES chapter_body_versions(id),
  state_change_id uuid NOT NULL REFERENCES state_changes(id),
  subject_kind text NOT NULL CHECK(subject_kind IN ('card','relation')),
  subject_id uuid NOT NULL,
  state_key text NOT NULL,
  impact jsonb NOT NULL CHECK(jsonb_typeof(impact)='object'),
  source_route text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(settlement_id,state_change_id)
);
-- No mutable resolved flag. Only a later, source-validated immutable proof can
-- close an issue; the insertion guard below is deliberately not yet operational.
CREATE TABLE resource_supplement_integrity_resolutions (
  resolution_id uuid PRIMARY KEY,
  issue_id uuid NOT NULL UNIQUE REFERENCES resource_supplement_integrity_issues(issue_id),
  book_id uuid NOT NULL REFERENCES books(id),
  correction_checkpoint_id uuid NOT NULL REFERENCES chapter_stable_checkpoints(id),
  request_key uuid NOT NULL,
  full_proof jsonb NOT NULL CHECK(jsonb_typeof(full_proof)='object'),
  proof_hash char(64) NOT NULL CHECK(proof_hash ~ '^[a-f0-9]{64}$'),
  original_receipt jsonb NOT NULL CHECK(jsonb_typeof(original_receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,request_key)
);
CREATE FUNCTION guard_resource_supplement_integrity_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'resource integrity history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER resource_supplement_integrity_journal_history BEFORE UPDATE OR DELETE ON resource_supplement_integrity_journals FOR EACH ROW EXECUTE FUNCTION guard_resource_supplement_integrity_history();
CREATE TRIGGER resource_supplement_integrity_issue_history BEFORE UPDATE OR DELETE ON resource_supplement_integrity_issues FOR EACH ROW EXECUTE FUNCTION guard_resource_supplement_integrity_history();
CREATE TRIGGER resource_supplement_integrity_resolution_history BEFORE UPDATE OR DELETE ON resource_supplement_integrity_resolutions FOR EACH ROW EXECUTE FUNCTION guard_resource_supplement_integrity_history();
CREATE FUNCTION validate_resource_supplement_integrity_journal() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE review resource_supplement_impact_reviews%ROWTYPE; checkpoint chapter_stable_checkpoints%ROWTYPE;
  child chapter_adoption_sessions%ROWTYPE; snapshot jsonb;
BEGIN
  -- resource_supplement_integrity_v1
  SELECT * INTO review FROM resource_supplement_impact_reviews WHERE review_id=NEW.review_id AND book_id=NEW.book_id;
  SELECT * INTO checkpoint FROM chapter_stable_checkpoints WHERE id=NEW.checkpoint_id AND book_id=NEW.book_id AND settlement_id=NEW.settlement_id AND status='stable';
  SELECT * INTO child FROM chapter_adoption_sessions WHERE id=checkpoint.session_id AND book_id=NEW.book_id AND settlement_id=NEW.settlement_id AND status='stable' AND adoption_kind='resource_supplement';
  IF review.review_id IS NULL OR checkpoint.id IS NULL OR child.id IS NULL OR review.session_id IS DISTINCT FROM child.id
    OR checkpoint.previous_checkpoint_id IS DISTINCT FROM child.supplement_base_checkpoint_id
    OR checkpoint.summary->>'supplementReviewId' IS DISTINCT FROM NEW.review_id::text
    OR checkpoint.summary->>'supplementImpactHash' IS DISTINCT FROM review.impact_hash::text
    OR NEW.merged_write->>'sessionId' IS DISTINCT FROM child.id::text
    OR NEW.merged_write->>'settlementId' IS DISTINCT FROM NEW.settlement_id::text
    OR NEW.merged_write->>'checkpointId' IS DISTINCT FROM NEW.checkpoint_id::text
    OR NEW.merged_write->>'baseCheckpointId' IS DISTINCT FROM child.supplement_base_checkpoint_id::text
    OR NEW.merged_write->>'bodyVersionId' IS DISTINCT FROM child.body_version_id::text
    OR NEW.merged_write->>'reviewId' IS DISTINCT FROM NEW.review_id::text
    OR NEW.merged_write->>'impactHash' IS DISTINCT FROM review.impact_hash::text
    OR NEW.merged_write->'confirmed' IS DISTINCT FROM checkpoint.summary->'confirmed'
    OR NEW.canonical_merged::jsonb IS DISTINCT FROM NEW.merged_write
    OR encode(sha256(convert_to(NEW.canonical_merged,'UTF8')),'hex') IS DISTINCT FROM NEW.merged_hash::text
    OR NOT EXISTS(SELECT 1 FROM chapter_settlements WHERE id=NEW.settlement_id AND book_id=NEW.book_id AND status='committed' AND supplement_base_checkpoint_id=child.supplement_base_checkpoint_id)
    THEN RAISE EXCEPTION 'integrity journal merged source mismatch' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(NEW.merged_write->'newStateChangeIds') IS DISTINCT FROM 'array'
    OR (SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]'::jsonb) FROM state_changes WHERE settlement_id=NEW.settlement_id AND status='active')
      IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) FROM jsonb_array_elements_text(NEW.merged_write->'newStateChangeIds'))
    THEN RAISE EXCEPTION 'integrity journal new states incomplete' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_supplement_integrity_journal_guard BEFORE INSERT ON resource_supplement_integrity_journals FOR EACH ROW EXECUTE FUNCTION validate_resource_supplement_integrity_journal();
CREATE FUNCTION validate_resource_supplement_integrity_issue() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE review resource_supplement_impact_reviews%ROWTYPE; actual jsonb;
BEGIN
  SELECT review_row.* INTO review FROM resource_supplement_integrity_journals journal JOIN resource_supplement_impact_reviews review_row ON review_row.review_id=journal.review_id WHERE journal.settlement_id=NEW.settlement_id AND journal.book_id=NEW.book_id;
  SELECT value INTO actual FROM jsonb_array_elements(review.impact_snapshot->'stateChain') WHERE value->>'stateChangeId'=NEW.state_change_id::text;
  IF review.review_id IS NULL OR actual IS NULL OR actual IS DISTINCT FROM NEW.impact OR actual->>'reason' NOT IN ('before_conflict','backdated_source')
    OR actual->>'chapterDocumentId' IS DISTINCT FROM NEW.chapter_document_id::text OR actual->>'bodyVersionId' IS DISTINCT FROM NEW.body_version_id::text
    OR actual->>'subjectKind' IS DISTINCT FROM NEW.subject_kind OR actual->>'subjectId' IS DISTINCT FROM NEW.subject_id::text OR actual->>'stateKey' IS DISTINCT FROM NEW.state_key
    OR NEW.source_route IS DISTINCT FROM '/new-design/books/'||NEW.book_id||'/writing?chapterDocument='||NEW.chapter_document_id||'&resourceIssue='||NEW.issue_id
    OR NOT EXISTS(SELECT 1 FROM state_changes change JOIN chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id
      WHERE change.id=NEW.state_change_id AND change.book_id=NEW.book_id AND change.status='active' AND document.status='active' AND document.adopted_version_id=change.body_version_id
        AND change.chapter_document_id=NEW.chapter_document_id AND change.body_version_id=NEW.body_version_id AND change.subject_kind=NEW.subject_kind AND change.subject_id=NEW.subject_id AND change.state_key=NEW.state_key
        AND change.before_json IS NOT DISTINCT FROM actual->'recordedBefore' AND change.after_json IS NOT DISTINCT FROM actual->'recordedAfter')
    THEN RAISE EXCEPTION 'integrity issue actual conflicting source mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_supplement_integrity_issue_guard BEFORE INSERT ON resource_supplement_integrity_issues FOR EACH ROW EXECUTE FUNCTION validate_resource_supplement_integrity_issue();
CREATE FUNCTION fence_resource_supplement_integrity_projection() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE key_book uuid; key_kind text; key_subject uuid; key_state text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.state_key IS DISTINCT FROM OLD.state_key)
    AND EXISTS(SELECT 1 FROM resource_supplement_integrity_issues issue WHERE issue.book_id=OLD.book_id AND issue.subject_kind=OLD.subject_kind AND issue.subject_id=OLD.subject_id AND issue.state_key=OLD.state_key
      AND NOT EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions resolution WHERE resolution.issue_id=issue.issue_id)) THEN
    RAISE EXCEPTION 'open resource source identity cannot be moved to bypass integrity' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN key_book=OLD.book_id;key_kind=OLD.subject_kind;key_subject=OLD.subject_id;key_state=OLD.state_key;
  ELSE key_book=NEW.book_id;key_kind=NEW.subject_kind;key_subject=NEW.subject_id;key_state=NEW.state_key; END IF;
  IF EXISTS(SELECT 1 FROM resource_supplement_integrity_issues issue WHERE issue.book_id=key_book AND issue.subject_kind=key_kind AND issue.subject_id=key_subject AND issue.state_key=key_state
    AND NOT EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions resolution WHERE resolution.issue_id=issue.issue_id)) THEN
    IF TG_OP='DELETE' OR NEW.is_stale IS DISTINCT FROM true THEN RAISE EXCEPTION 'open actual resource source conflict cannot be cleared by projection rebuild or deletion' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER resource_supplement_integrity_projection_fence BEFORE INSERT OR UPDATE OR DELETE ON current_state_projections FOR EACH ROW EXECUTE FUNCTION fence_resource_supplement_integrity_projection();
CREATE FUNCTION mark_resource_supplement_integrity_projection() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
BEGIN
  UPDATE current_state_projections SET is_stale=true,projection_revision=projection_revision+1,rebuilt_at=now()
    WHERE book_id=NEW.book_id AND subject_kind=NEW.subject_kind AND subject_id=NEW.subject_id AND state_key=NEW.state_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'actual resource projection missing; cannot publish an unfenced issue' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_supplement_integrity_projection_mark AFTER INSERT ON resource_supplement_integrity_issues FOR EACH ROW EXECUTE FUNCTION mark_resource_supplement_integrity_projection();
CREATE FUNCTION reject_unavailable_resource_integrity_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'actual corrective source proof is not operational; acknowledgement cannot resolve integrity' USING ERRCODE='23514'; END $$;
CREATE TRIGGER resource_supplement_integrity_resolution_guard BEFORE INSERT ON resource_supplement_integrity_resolutions FOR EACH ROW EXECUTE FUNCTION reject_unavailable_resource_integrity_resolution();
-- No replacement of require_resource_supplement_closure(), no capability flip.
-- Protect cached claim code as well as current application preflight. Original
-- saved results stay readable; this guard only rejects a new ordinary claim.
CREATE FUNCTION fence_resource_supplement_integrity_extraction() RETURNS trigger LANGUAGE plpgsql SET search_path TO new_design,public AS $$
DECLARE origin chapter_resource_supplements%ROWTYPE;
BEGIN
  SELECT * INTO origin FROM chapter_resource_supplements WHERE session_id=NEW.session_id AND book_id=NEW.book_id;
  IF origin.session_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM resource_supplement_integrity_issues issue JOIN chapter_documents document ON document.id=issue.chapter_document_id AND document.book_id=issue.book_id
    WHERE issue.book_id=NEW.book_id AND document.logical_order<=(origin.source_snapshot#>>'{basis,chapterOrder}')::numeric
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(origin.source_snapshot#>'{catalog,subjects}') subject WHERE (subject->>'id')::uuid=issue.subject_id AND subject->>'subjectKind'=issue.subject_kind)
      AND NOT EXISTS(SELECT 1 FROM resource_supplement_integrity_resolutions resolution WHERE resolution.issue_id=issue.issue_id)) THEN
    RAISE EXCEPTION 'ordinary stable resource extraction cannot bypass actual source conflict' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_resource_supplement_integrity_extraction_fence BEFORE INSERT ON chapter_proposal_extraction_requests FOR EACH ROW EXECUTE FUNCTION fence_resource_supplement_integrity_extraction();
