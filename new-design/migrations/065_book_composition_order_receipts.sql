SET search_path TO new_design,public;
CREATE TABLE book_composition_order_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 book_id uuid NOT NULL REFERENCES books(id),
 request_key uuid NOT NULL,
 input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(book_id,request_key)
);
CREATE FUNCTION protect_book_composition_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '全书编排原请求事件不可修改或删除'; END $$;
CREATE TRIGGER book_composition_order_events_immutable BEFORE UPDATE OR DELETE ON book_composition_order_events FOR EACH ROW EXECUTE FUNCTION protect_book_composition_order_event();
COMMENT ON TABLE book_composition_order_events IS '原 planning_objects 与 chapter_documents 顺序事务的不可变请求凭证；不是规划或正文事实副本';
