SET search_path TO new_design, public;

ALTER TABLE book_creation_sessions
  ADD COLUMN review_cards jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK(jsonb_typeof(review_cards)='array');

UPDATE book_creation_sessions AS session
SET review_cards=(
  SELECT jsonb_agg(jsonb_build_object(
    'id',gen_random_uuid(),'typeKey',draft.card->>'typeKey',
    'title',draft.card->>'title','values',COALESCE(draft.card->'values','{}'::jsonb),
    'sourceKind','ai','sourceId',NULL,'sourceVersionId',NULL,
    'originalTitle',draft.card->>'title','originalValues',COALESCE(draft.card->'values','{}'::jsonb)
  ) ORDER BY draft.ordinal)
  FROM jsonb_array_elements(session.initial_cards) WITH ORDINALITY AS draft(card,ordinal)
)
WHERE jsonb_array_length(initial_cards)>0;

COMMENT ON COLUMN book_creation_sessions.review_cards IS
  '创建书籍前统一审阅的资料草稿；保存用户修改后的当前值、原始值与来源。';
