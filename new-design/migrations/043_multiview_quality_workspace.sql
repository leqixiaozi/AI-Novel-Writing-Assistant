SET search_path TO new_design, public;

ALTER TABLE quality_issues DROP CONSTRAINT IF EXISTS quality_issues_current_status_check;
ALTER TABLE quality_issues ADD CONSTRAINT quality_issues_current_status_check CHECK (
  current_status IN ('open','acknowledged','deferred','dismissed','fix_proposed','fixed','verified','stale','superseded')
);
ALTER TABLE quality_issue_events DROP CONSTRAINT IF EXISTS quality_issue_events_to_status_check;
ALTER TABLE quality_issue_events ADD CONSTRAINT quality_issue_events_to_status_check CHECK (
  to_status IN ('open','acknowledged','deferred','dismissed','fix_proposed','fixed','verified','stale','superseded')
);

ALTER TABLE book_view_configs DROP CONSTRAINT IF EXISTS book_view_configs_view_key_check;
ALTER TABLE book_view_configs ADD CONSTRAINT book_view_configs_view_key_check CHECK (
  view_key IN ('chapters','characters','relations','events','clues','props','states','rules','comparison','quality','world','resources')
);

ALTER TABLE smart_views DROP CONSTRAINT IF EXISTS smart_views_base_view_key_check;
ALTER TABLE smart_views ADD CONSTRAINT smart_views_base_view_key_check CHECK (
  base_view_key IS NULL OR base_view_key IN ('chapters','characters','relations','events','clues','props','states','rules','comparison','quality','world','resources')
);

WITH defaults(view_key,config) AS (VALUES
  ('relations','{"groupBy":"relation_type","sort":"title","display":"list","expanded":[]}'::jsonb),
  ('props','{"groupBy":"prop","sort":"story_order","display":"list","expanded":[]}'::jsonb),
  ('states','{"groupBy":"chapter","sort":"story_order","display":"list","expanded":[]}'::jsonb),
  ('rules','{"groupBy":"rule","sort":"title","display":"list","expanded":[]}'::jsonb),
  ('comparison','{"groupBy":"chapter","sort":"chapter_order","display":"list","expanded":[]}'::jsonb),
  ('quality','{"groupBy":"quality_kind","sort":"severity","display":"list","expanded":[]}'::jsonb)
)
INSERT INTO book_view_configs(id,book_id,view_key,config)
SELECT (
  substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),1,8)||'-'||
  substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),9,4)||'-4'||
  substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),14,3)||'-8'||
  substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),18,3)||'-'||
  substr(md5('book-view-'||book.id::text||'-'||defaults.view_key),21,12)
)::uuid,book.id,defaults.view_key,defaults.config
FROM books book CROSS JOIN defaults
ON CONFLICT (book_id,view_key) DO NOTHING;
