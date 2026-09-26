-- Explicit manual opt-in. Never part of ordinary startup registrations.
SET search_path TO new_design,public;
CREATE TABLE character_author_influence_capability(contract text PRIMARY KEY CHECK(contract='character_author_influence_v1'),operational boolean NOT NULL DEFAULT false);
INSERT INTO character_author_influence_capability(contract) VALUES('character_author_influence_v1');
CREATE TABLE character_author_influence_candidates(
 id uuid PRIMARY KEY REFERENCES character_author_trials(id),book_id uuid NOT NULL REFERENCES books(id),card_id uuid NOT NULL REFERENCES cards(id),
 source_hash char(64) NOT NULL,draft jsonb NOT NULL,
 target_start integer NOT NULL CHECK(target_start>0),target_end integer NOT NULL CHECK(target_end>=target_start AND target_end-target_start<=2),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active','expired','superseded','dismissed')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 guidance_card_id uuid REFERENCES cards(id),guidance_version_id uuid REFERENCES card_versions(id),
 CHECK((guidance_card_id IS NULL)=(guidance_version_id IS NULL)),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE character_author_influence_decisions(
 request_key uuid PRIMARY KEY,book_id uuid NOT NULL REFERENCES books(id),card_id uuid NOT NULL REFERENCES cards(id),candidate_id uuid NOT NULL REFERENCES character_author_influence_candidates(id),
 input_hash char(64) NOT NULL,input_payload jsonb NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_character_author_influence() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE original character_author_trials%ROWTYPE; material card_versions%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'original influence candidate immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT original FROM character_author_trials WHERE id=NEW.id;
 IF original.status<>'succeeded' OR original.book_id<>NEW.book_id OR original.card_id<>NEW.card_id OR original.source_snapshot->>'hash'<>NEW.source_hash OR original.output->'influenceDraft' IS DISTINCT FROM NEW.draft OR jsonb_typeof(NEW.draft)<>'object' THEN RAISE EXCEPTION 'influence must preserve exact original structured reply' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.revision<>1 OR NEW.guidance_card_id IS NOT NULL THEN RAISE EXCEPTION 'influence begins as unadopted candidate' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','revision','target_start','target_end','guidance_card_id','guidance_version_id','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','target_start','target_end','guidance_card_id','guidance_version_id','updated_at']) OR NEW.revision<>OLD.revision+1 OR OLD.status IN('expired','superseded','dismissed') OR OLD.guidance_card_id IS NOT NULL AND (NEW.guidance_card_id IS DISTINCT FROM OLD.guidance_card_id OR NEW.guidance_version_id IS DISTINCT FROM OLD.guidance_version_id OR NEW.target_start<>OLD.target_start OR NEW.target_end<>OLD.target_end) THEN RAISE EXCEPTION 'original influence provenance and terminal state immutable' USING ERRCODE='23514'; END IF;
  IF NOT (OLD.status='draft' AND NEW.status IN('active','dismissed','expired') OR OLD.status='active' AND NEW.status IN('dismissed','superseded','expired')) THEN RAISE EXCEPTION 'influence transition rejected' USING ERRCODE='23514'; END IF;
  IF NEW.status='active' THEN
   IF NOT EXISTS(SELECT 1 FROM character_author_influence_capability WHERE operational) OR NOT EXISTS(SELECT 1 FROM cards person JOIN books book ON book.space_id=person.space_id WHERE person.id=NEW.card_id AND book.id=NEW.book_id AND person.status='active' AND book.status='active') THEN RAISE EXCEPTION 'influence activation not enabled for this book person' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.guidance_version_id IS NOT NULL THEN
  SELECT * INTO STRICT material FROM card_versions WHERE id=NEW.guidance_version_id AND card_id=NEW.guidance_card_id;
  IF (NOT EXISTS(SELECT 1 FROM cards card JOIN card_types type ON type.id=card.card_type_id JOIN books book ON book.space_id=card.space_id WHERE card.id=material.card_id AND book.id=NEW.book_id AND type.type_key='character_author_guidance') OR material.author_book_id IS DISTINCT FROM NEW.book_id OR material.values->>'content_kind'<>'author_selected_creative_guidance' OR material.values->>'source_trial_id'<>NEW.id::text OR material.values->>'character_id'<>NEW.card_id::text OR material.values->>'source_hash'<>NEW.source_hash OR NULLIF(material.values->>'draft_json','')::jsonb IS DISTINCT FROM NEW.draft OR material.values->>'target_start'<>NEW.target_start::text OR material.values->>'target_end'<>NEW.target_end::text) IS DISTINCT FROM false THEN RAISE EXCEPTION 'influence must use original exact author material version' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='active' AND NEW.guidance_version_id IS NULL THEN RAISE EXCEPTION 'activated influence lacks author material version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER character_author_influence_guard BEFORE INSERT OR UPDATE OR DELETE ON character_author_influence_candidates FOR EACH ROW EXECUTE FUNCTION guard_character_author_influence();
CREATE FUNCTION create_character_author_influence_candidate() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
DECLARE first_order integer;
BEGIN
 IF NEW.status='succeeded' AND NEW.output->'influenceDraft' IS NOT NULL AND NEW.output->'influenceDraft'<>'null'::jsonb THEN
  SELECT COALESCE(max(document.logical_order),0)+1 INTO first_order FROM chapter_documents document JOIN chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=document.adopted_version_id AND checkpoint.status='stable' WHERE document.book_id=NEW.book_id AND document.status='active';
  INSERT INTO character_author_influence_candidates(id,book_id,card_id,source_hash,draft,target_start,target_end) VALUES(NEW.id,NEW.book_id,NEW.card_id,NEW.source_snapshot->>'hash',NEW.output->'influenceDraft',first_order,first_order+2) ON CONFLICT(id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER character_author_influence_from_reply AFTER INSERT OR UPDATE ON character_author_trials FOR EACH ROW EXECUTE FUNCTION create_character_author_influence_candidate();
CREATE FUNCTION guard_character_author_influence_decision() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,new_design,public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'original influence decisions immutable' USING ERRCODE='23514'; END IF;
 IF (NOT EXISTS(SELECT 1 FROM character_author_influence_candidates candidate WHERE candidate.id=NEW.candidate_id AND candidate.book_id=NEW.book_id AND candidate.card_id=NEW.card_id AND candidate.source_hash=NEW.input_payload->>'sourceHash' AND candidate.revision=(NEW.input_payload->>'expectedRevision')::integer+1 AND candidate.target_start=(NEW.input_payload->>'targetStart')::integer AND candidate.target_end=(NEW.input_payload->>'targetEnd')::integer AND candidate.status=CASE WHEN NEW.input_payload->>'action'='activate' THEN 'active' WHEN NEW.input_payload->>'action' IN('dismiss','revoke') THEN 'dismissed' ELSE NULL END AND candidate.revision=(NEW.receipt->'candidate'->>'revision')::integer) OR NEW.input_payload->>'requestKey'<>NEW.request_key::text OR NEW.input_payload->>'candidateId'<>NEW.candidate_id::text OR NEW.input_payload->>'bookId'<>NEW.book_id::text OR NEW.input_payload->>'cardId'<>NEW.card_id::text OR NEW.receipt->>'requestKey'<>NEW.request_key::text OR NEW.receipt->>'inputHash'<>NEW.input_hash OR NEW.receipt->'candidate'->>'id'<>NEW.candidate_id::text OR NEW.receipt->'candidate'->>'bookId'<>NEW.book_id::text OR NEW.receipt->'candidate'->>'cardId'<>NEW.card_id::text) IS DISTINCT FROM false THEN RAISE EXCEPTION 'influence decision scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER character_author_influence_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON character_author_influence_decisions FOR EACH ROW EXECUTE FUNCTION guard_character_author_influence_decision();

-- Preserve the original validation function OID, scope checks and existing triggers.
DO $$
DECLARE definition text; original text := 'NEW.controlled_snapshot->>''assetVersion'' IS DISTINCT FROM ''v1''';
BEGIN
 SELECT pg_get_functiondef('new_design.validate_chapter_writing_request_scope()'::regprocedure) INTO definition;
 IF strpos(definition,original)=0 THEN RAISE EXCEPTION 'original controlled chapter version guard unavailable'; END IF;
 EXECUTE replace(definition,original,'COALESCE(NEW.controlled_snapshot->>''assetVersion'','''') NOT IN (''v1'',''v2'')');
END $$;
