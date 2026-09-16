SET search_path TO new_design, public;
CREATE TABLE IF NOT EXISTS book_composition_timeline_commands (
 id uuid PRIMARY KEY,
 book_id uuid NOT NULL REFERENCES books(id),
 request_key uuid NOT NULL,
 input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(book_id,request_key)
);
COMMENT ON TABLE book_composition_timeline_commands IS '全书编排原故事时间领域命令的不可变技术回执，不是事件或时间事实副本';
CREATE OR REPLACE FUNCTION protect_book_composition_timeline_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '全书事件修改原回执不可覆盖或删除'; END;
$$;
DROP TRIGGER IF EXISTS immutable_book_composition_timeline_receipt ON book_composition_timeline_commands;
CREATE TRIGGER immutable_book_composition_timeline_receipt BEFORE UPDATE OR DELETE ON book_composition_timeline_commands FOR EACH ROW EXECUTE FUNCTION protect_book_composition_timeline_receipt();
