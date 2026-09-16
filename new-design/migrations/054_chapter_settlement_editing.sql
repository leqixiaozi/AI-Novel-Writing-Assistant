SET search_path TO new_design, public;

-- Receipts are append-only entries in the existing settlement ledger, not a
-- second store of state or creative facts. Existing historical events stay NULL.
ALTER TABLE chapter_settlement_events
  ADD COLUMN editing_request_key text,
  ADD COLUMN editing_input_hash char(64),
  ADD COLUMN editing_receipt jsonb,
  ADD CONSTRAINT chapter_settlement_editing_receipt_complete CHECK (
    num_nonnulls(editing_request_key,editing_input_hash,editing_receipt)=0 OR
    (num_nonnulls(editing_request_key,editing_input_hash,editing_receipt)=3
      AND length(editing_request_key) BETWEEN 8 AND 160
      AND editing_input_hash ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(editing_receipt)='object'
      AND editing_receipt->>'sessionId'=session_id::text
      AND editing_receipt->>'requestKey'=editing_request_key)
  );
CREATE UNIQUE INDEX chapter_settlement_editing_receipt_unique
  ON chapter_settlement_events(session_id,editing_request_key)
  WHERE editing_request_key IS NOT NULL;
CREATE INDEX chapter_settlement_editing_contract_lookup
  ON chapter_settlement_events(session_id,item_id,created_at)
  WHERE detail->>'editingKind'='contract';

COMMENT ON COLUMN chapter_settlement_events.editing_receipt IS
  '同事务形成的章节编辑回执；正文、状态和知识正本仍在既有领域表，历史事件不回填。';
