SET search_path TO new_design, public;

CREATE TABLE settlement_policy_versions (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),
  auto_confirm_low_risk boolean NOT NULL DEFAULT false,
  allowed_auto_categories text[] NOT NULL DEFAULT '{}'::text[] CHECK(allowed_auto_categories <@ ARRAY['fact','knowledge','character_state','relationship','prop','event','foreshadow']::text[]),
  major_fact_categories text[] NOT NULL DEFAULT ARRAY['death','identity_reveal','faction_change','core_relationship','key_prop','timeline_causality','world_rule','foreshadow_payoff']::text[],
  confidence_floor numeric(5,4) NOT NULL DEFAULT .95 CHECK(confidence_floor BETWEEN 0 AND 1),
  created_by text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,version),
  UNIQUE(id,book_id)
);

CREATE TABLE book_settlement_policies (
  book_id uuid PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  current_version_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(current_version_id,book_id) REFERENCES settlement_policy_versions(id,book_id)
);

CREATE TABLE chapter_adoption_sessions (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  body_version_id uuid NOT NULL,
  preparation_id uuid NOT NULL UNIQUE REFERENCES chapter_adoption_preparations(id),
  prior_body_version_id uuid,
  adoption_id uuid UNIQUE REFERENCES chapter_body_adoptions(id),
  settlement_id uuid UNIQUE REFERENCES chapter_settlements(id),
  policy_version_id uuid NOT NULL,
  planning_object_id uuid NOT NULL,
  planning_version_id uuid NOT NULL,
  context_manifest_id uuid REFERENCES context_manifests(id),
  dependency_hash char(64) NOT NULL CHECK(dependency_hash ~ '^[a-f0-9]{64}$'),
  adoption_kind text NOT NULL CHECK(adoption_kind IN ('first_adoption','body_switch')),
  status text NOT NULL CHECK(status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','stable','failed','impact_review_required','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  created_by text NOT NULL DEFAULT '',
  error_summary text NOT NULL DEFAULT '' CHECK(length(error_summary)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  FOREIGN KEY(prior_body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id),
  FOREIGN KEY(policy_version_id,book_id) REFERENCES settlement_policy_versions(id,book_id),
  FOREIGN KEY(planning_version_id,planning_object_id) REFERENCES planning_versions(id,object_id),
  UNIQUE(book_id,idempotency_key)
);

CREATE UNIQUE INDEX chapter_adoption_sessions_active_unique ON chapter_adoption_sessions(chapter_document_id)
  WHERE status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed');

CREATE TABLE chapter_settlement_items (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chapter_adoption_sessions(id) ON DELETE CASCADE,
  category text NOT NULL CHECK(category IN ('fact','knowledge','character_state','relationship','prop','event','foreshadow')),
  major_category text,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  canonical_fact_id uuid UNIQUE REFERENCES canonical_facts(id),
  knowledge_proposal_id uuid UNIQUE REFERENCES knowledge_state_proposals(id),
  state_proposal_id uuid UNIQUE REFERENCES state_change_proposals(id),
  evidence_anchor_id uuid NOT NULL REFERENCES chapter_text_anchors(id),
  risk_level text NOT NULL CHECK(risk_level IN ('low','medium','high','critical')),
  confidence numeric(5,4) CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  confidence_note text NOT NULL DEFAULT '',
  plan_alignment text NOT NULL DEFAULT 'not_applicable' CHECK(plan_alignment IN ('matches','deviates','missing','not_applicable')),
  plan_expectation text NOT NULL DEFAULT '',
  before_value jsonb,
  change_value jsonb,
  after_value jsonb NOT NULL,
  source_kind text NOT NULL CHECK(source_kind IN ('manual','ai')),
  source_task_id uuid REFERENCES ai_tasks(id),
  source_attempt_id uuid REFERENCES ai_task_attempts(id),
  decision text NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','confirm','reject','defer')),
  decision_source text CHECK(decision_source IS NULL OR decision_source IN ('user','policy')),
  decision_note text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(canonical_fact_id,knowledge_proposal_id,state_proposal_id)=1),
  CHECK((source_kind='ai' AND source_task_id IS NOT NULL AND source_attempt_id IS NOT NULL) OR (source_kind='manual' AND source_task_id IS NULL AND source_attempt_id IS NULL)),
  CHECK((decision='pending' AND decision_source IS NULL AND decided_at IS NULL) OR (decision<>'pending' AND decision_source IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE chapter_settlement_item_versions (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES chapter_settlement_items(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  editor text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id,version)
);

CREATE TABLE chapter_proposal_extraction_requests (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chapter_adoption_sessions(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  body_version_id uuid NOT NULL REFERENCES chapter_body_versions(id),
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  prompt_recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id),
  context_manifest_id uuid NOT NULL REFERENCES context_manifests(id),
  model_route_snapshot_id uuid NOT NULL REFERENCES model_route_snapshots(id),
  ai_task_id uuid UNIQUE REFERENCES ai_tasks(id),
  status text NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','queued','running','succeeded','failed','cancelled','unavailable','stale')),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
  created_by text NOT NULL DEFAULT '',
  error_summary text NOT NULL DEFAULT '' CHECK(length(error_summary)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,idempotency_key)
);

CREATE TABLE chapter_stable_checkpoints (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id) ON DELETE CASCADE,
  body_version_id uuid NOT NULL,
  session_id uuid NOT NULL UNIQUE REFERENCES chapter_adoption_sessions(id),
  settlement_id uuid NOT NULL UNIQUE REFERENCES chapter_settlements(id),
  previous_checkpoint_id uuid REFERENCES chapter_stable_checkpoints(id),
  chapter_order integer NOT NULL CHECK(chapter_order>0),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(summary)='object'),
  dependency_hash char(64) NOT NULL CHECK(dependency_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'stable' CHECK(status IN ('stable','stale','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE UNIQUE INDEX chapter_stable_checkpoints_active_unique ON chapter_stable_checkpoints(chapter_document_id) WHERE status='stable';

CREATE TABLE chapter_settlement_events (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chapter_adoption_sessions(id) ON DELETE CASCADE,
  event_kind text NOT NULL CHECK(event_kind IN ('session_started','body_adopted','impact_review_required','proposal_added','proposal_edited','decision_recorded','settlement_started','settlement_committed','settlement_failed')),
  from_status text,
  to_status text NOT NULL,
  item_id uuid REFERENCES chapter_settlement_items(id),
  idempotency_key text,
  actor text NOT NULL DEFAULT '',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chapter_settlement_events_idempotency_unique
  ON chapter_settlement_events(session_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE FUNCTION guard_settlement_policy_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'settlement policy versions are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER settlement_policy_versions_guard BEFORE UPDATE OR DELETE ON settlement_policy_versions FOR EACH ROW EXECUTE FUNCTION guard_settlement_policy_version();

CREATE FUNCTION guard_chapter_settlement_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'chapter settlement audit rows are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER chapter_settlement_item_versions_guard BEFORE UPDATE OR DELETE ON chapter_settlement_item_versions FOR EACH ROW EXECUTE FUNCTION guard_chapter_settlement_audit();
CREATE TRIGGER chapter_settlement_events_guard BEFORE UPDATE OR DELETE ON chapter_settlement_events FOR EACH ROW EXECUTE FUNCTION guard_chapter_settlement_audit();

CREATE FUNCTION validate_chapter_adoption_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prep chapter_adoption_preparations%ROWTYPE; document chapter_documents%ROWTYPE; body chapter_body_versions%ROWTYPE;
BEGIN
  SELECT * INTO prep FROM chapter_adoption_preparations WHERE id=NEW.preparation_id;
  SELECT * INTO document FROM chapter_documents WHERE id=NEW.chapter_document_id;
  SELECT * INTO body FROM chapter_body_versions WHERE id=NEW.body_version_id;
  IF prep.book_id IS DISTINCT FROM NEW.book_id OR prep.chapter_document_id IS DISTINCT FROM NEW.chapter_document_id OR prep.body_version_id IS DISTINCT FROM NEW.body_version_id OR prep.planning_object_id IS DISTINCT FROM NEW.planning_object_id OR prep.planning_version_id IS DISTINCT FROM NEW.planning_version_id OR prep.context_manifest_id IS DISTINCT FROM NEW.context_manifest_id OR prep.dependency_hash IS DISTINCT FROM NEW.dependency_hash THEN RAISE EXCEPTION 'adoption session does not match frozen preparation' USING ERRCODE='23514'; END IF;
  IF document.book_id IS DISTINCT FROM NEW.book_id OR body.chapter_document_id IS DISTINCT FROM NEW.chapter_document_id OR body.archived_at IS NOT NULL THEN RAISE EXCEPTION 'adoption session body scope mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_adoption_sessions_validate BEFORE INSERT ON chapter_adoption_sessions FOR EACH ROW EXECUTE FUNCTION validate_chapter_adoption_session();

CREATE FUNCTION guard_chapter_adoption_session_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.book_id,NEW.chapter_document_id,NEW.body_version_id,NEW.preparation_id,NEW.prior_body_version_id,
         NEW.policy_version_id,NEW.planning_object_id,NEW.planning_version_id,NEW.context_manifest_id,
         NEW.dependency_hash,NEW.adoption_kind,NEW.idempotency_key,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.book_id,OLD.chapter_document_id,OLD.body_version_id,OLD.preparation_id,OLD.prior_body_version_id,
         OLD.policy_version_id,OLD.planning_object_id,OLD.planning_version_id,OLD.context_manifest_id,
         OLD.dependency_hash,OLD.adoption_kind,OLD.idempotency_key,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'adoption session frozen references are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'adoption session revision must advance by one' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='reviewing' AND NEW.status IN ('adopted_pending_proposals','impact_review_required','cancelled','failed')) OR
    (OLD.status='adopted_pending_proposals' AND NEW.status IN ('pending_review','settling','failed')) OR
    (OLD.status='pending_review' AND NEW.status IN ('partially_confirmed','settling','failed')) OR
    (OLD.status='partially_confirmed' AND NEW.status IN ('pending_review','settling','failed')) OR
    (OLD.status='settling' AND NEW.status IN ('stable','failed')) OR
    (OLD.status='failed' AND NEW.status IN ('pending_review','settling','cancelled')) OR
    (OLD.status=NEW.status)
  ) THEN RAISE EXCEPTION 'invalid adoption session status transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('stable','impact_review_required','cancelled') THEN RAISE EXCEPTION 'terminal adoption session is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='stable' AND (NEW.adoption_id IS NULL OR NEW.settlement_id IS NULL) THEN RAISE EXCEPTION 'stable adoption session requires adoption and settlement' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_adoption_sessions_update_guard BEFORE UPDATE ON chapter_adoption_sessions FOR EACH ROW EXECUTE FUNCTION guard_chapter_adoption_session_update();

CREATE FUNCTION validate_chapter_settlement_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session chapter_adoption_sessions%ROWTYPE; anchor chapter_text_anchors%ROWTYPE;
BEGIN
  SELECT * INTO session FROM chapter_adoption_sessions WHERE id=NEW.session_id;
  SELECT * INTO anchor FROM chapter_text_anchors WHERE id=NEW.evidence_anchor_id;
  IF session.status IN ('stable','impact_review_required','cancelled') THEN RAISE EXCEPTION 'settlement session cannot accept proposal changes' USING ERRCODE='23514'; END IF;
  IF anchor.chapter_document_id IS DISTINCT FROM session.chapter_document_id OR anchor.body_version_id IS DISTINCT FROM session.body_version_id OR anchor.status<>'active' THEN RAISE EXCEPTION 'settlement item evidence must point to active adopted body' USING ERRCODE='23514'; END IF;
  IF NEW.source_kind='ai' AND NOT EXISTS(SELECT 1 FROM ai_task_attempts attempt WHERE attempt.id=NEW.source_attempt_id AND attempt.task_id=NEW.source_task_id) THEN RAISE EXCEPTION 'settlement AI provenance mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_settlement_items_validate BEFORE INSERT OR UPDATE ON chapter_settlement_items FOR EACH ROW EXECUTE FUNCTION validate_chapter_settlement_item();

CREATE FUNCTION guard_chapter_proposal_extraction_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session chapter_adoption_sessions%ROWTYPE;
BEGIN
  SELECT * INTO session FROM chapter_adoption_sessions WHERE id=NEW.session_id;
  IF session.book_id IS DISTINCT FROM NEW.book_id OR session.body_version_id IS DISTINCT FROM NEW.body_version_id THEN
    RAISE EXCEPTION 'proposal extraction request scope mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.session_id,NEW.book_id,NEW.body_version_id,NEW.task_contract_version_id,
      NEW.prompt_recipe_version_id,NEW.context_manifest_id,NEW.model_route_snapshot_id,NEW.request_hash,
      NEW.idempotency_key,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.session_id,OLD.book_id,OLD.body_version_id,OLD.task_contract_version_id,
      OLD.prompt_recipe_version_id,OLD.context_manifest_id,OLD.model_route_snapshot_id,OLD.request_hash,
      OLD.idempotency_key,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'proposal extraction frozen references are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapter_proposal_extraction_requests_guard BEFORE INSERT OR UPDATE ON chapter_proposal_extraction_requests FOR EACH ROW EXECUTE FUNCTION guard_chapter_proposal_extraction_request();

CREATE INDEX chapter_adoption_sessions_document_idx ON chapter_adoption_sessions(chapter_document_id,created_at DESC,id);
CREATE INDEX chapter_settlement_items_session_idx ON chapter_settlement_items(session_id,decision,risk_level,category,created_at,id);
CREATE INDEX chapter_proposal_extraction_requests_session_idx ON chapter_proposal_extraction_requests(session_id,created_at DESC,id);
CREATE INDEX chapter_stable_checkpoints_book_order_idx ON chapter_stable_checkpoints(book_id,chapter_order,status);

INSERT INTO schema_migrations(id) VALUES('040_chapter_adoption_settlement') ON CONFLICT(id) DO NOTHING;
