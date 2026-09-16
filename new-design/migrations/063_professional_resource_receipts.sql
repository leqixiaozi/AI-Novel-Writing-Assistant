SET search_path TO new_design, public;
-- Resource content remains in the original versioned Card ledger. This ledger
-- stores immutable command acknowledgements and reference-only preferences.
CREATE TABLE professional_resource_receipts (
 request_key text PRIMARY KEY CHECK(length(request_key) BETWEEN 8 AND 160),
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 operation text NOT NULL CHECK(operation IN ('create','edit','archive','favorite','adopt_title','install','rule_settings','feedback')),
 resource_card_id uuid REFERENCES cards(id),
 resource_version_id uuid REFERENCES card_versions(id),
 book_id uuid REFERENCES books(id),
 preview_id uuid REFERENCES ai_run_previews(id),
 issue_id uuid REFERENCES quality_issues(id),
 preference boolean,
 feedback_effect text CHECK(feedback_effect IN ('helpful','neutral','harmful')),
 feedback_note text CHECK(length(feedback_note)<=2000),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(operation <> 'favorite' OR (resource_card_id IS NOT NULL AND preference IS NOT NULL)),
 CHECK(operation <> 'feedback' OR (resource_card_id IS NOT NULL AND resource_version_id IS NOT NULL AND (preview_id IS NULL)<>(issue_id IS NULL) AND feedback_effect IS NOT NULL AND length(feedback_note)>0))
);
CREATE FUNCTION guard_professional_resource_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'professional command receipts are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.resource_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM new_design.card_versions WHERE id=NEW.resource_version_id AND card_id=NEW.resource_card_id) THEN
  RAISE EXCEPTION 'resource version scope mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.resource_card_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM new_design.cards c JOIN new_design.card_types t ON t.id=c.card_type_id WHERE c.id=NEW.resource_card_id AND c.space_id='60000000-0000-4000-8000-000000000001' AND t.type_key IN ('title_candidate','writing_config','quality_rule','genre_strategy','progression_mode')) THEN
  RAISE EXCEPTION 'not an original professional resource' USING ERRCODE='23514';
 END IF;
 IF NEW.receipt->>'requestKey' IS DISTINCT FROM NEW.request_key OR NEW.receipt->>'operation' IS DISTINCT FROM NEW.operation THEN
  RAISE EXCEPTION 'command receipt identity mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER professional_resource_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON professional_resource_receipts FOR EACH ROW EXECUTE FUNCTION guard_professional_resource_receipt();
CREATE INDEX professional_resource_receipts_card_idx ON professional_resource_receipts(resource_card_id,created_at DESC,request_key);

-- An additional published content specification, not a parallel title table.
INSERT INTO card_types(id,space_id,type_key,name,description,status,is_system,sort_order,draft_fields)
VALUES('65000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','title_candidate','标题候选','比较标题与读者承诺；明确采用只修改目标书名。','published',true,230,$json$[
 {"key":"promise","name":"读者承诺","description":"这个标题让读者期待什么","type":"long_text","required":true,"defaultValue":null,"options":[],"group":"标题比较","order":0},
 {"key":"fit","name":"题材与受众","description":"适合的故事与读者","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"标题比较","order":1},
 {"key":"risk","name":"误导风险","description":"可能造成哪些不恰当期待","type":"long_text","required":false,"defaultValue":null,"options":[],"group":"标题比较","order":2}
]$json$::jsonb);
INSERT INTO card_type_versions(id,card_type_id,version,fields)
SELECT '65000000-0000-4000-8000-000000000002',id,1,draft_fields FROM card_types WHERE id='65000000-0000-4000-8000-000000000001';
UPDATE card_types SET current_version_id='65000000-0000-4000-8000-000000000002' WHERE id='65000000-0000-4000-8000-000000000001';
