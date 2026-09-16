SET search_path TO new_design, public;

ALTER TABLE ai_generation_batches ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);

CREATE UNIQUE INDEX ai_business_form_request_idempotency_idx
ON ai_generation_batches(book_id,(input_payload->>'idempotencyKey'))
WHERE operation='form_assist' AND input_payload->>'contract'='business_form_ai_v1';

CREATE TABLE form_ai_draft_decisions (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES ai_generation_batches(id),
  candidate_id uuid,
  decision text NOT NULL CHECK(decision IN ('adopt','discard')),
  selected_field_keys text[] NOT NULL DEFAULT '{}',
  selected_tree_keys text[] NOT NULL DEFAULT '{}',
  draft_snapshot jsonb NOT NULL,
  request_hash text NOT NULL,
  source_hash text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,idempotency_key)
);
CREATE TABLE card_version_ai_draft_sources (
  card_version_id uuid NOT NULL REFERENCES card_versions(id),
  decision_id uuid NOT NULL REFERENCES form_ai_draft_decisions(id),
  PRIMARY KEY(card_version_id,decision_id)
);
CREATE UNIQUE INDEX card_ai_decision_single_save_idx ON card_version_ai_draft_sources(decision_id);
COMMENT ON TABLE form_ai_draft_decisions IS 'AI 候选采用到普通表单草稿的审计；不改变正式卡片。';
COMMENT ON TABLE card_version_ai_draft_sources IS '正常保存的卡片版本与已确认 AI 草稿来源关联。';
