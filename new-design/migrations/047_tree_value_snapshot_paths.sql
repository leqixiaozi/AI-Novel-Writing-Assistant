SET search_path TO new_design, public;

-- Tree paths have different depths, so they are stored as a JSON array of arrays rather than a rectangular PostgreSQL array.
ALTER TABLE card_tree_value_snapshots
  ALTER COLUMN display_paths TYPE jsonb USING to_jsonb(display_paths);

ALTER TABLE card_tree_value_snapshots
  ADD CONSTRAINT card_tree_value_snapshot_paths_array CHECK(jsonb_typeof(display_paths)='array');

ALTER TABLE book_template_syncs
  ADD COLUMN tree_additions jsonb NOT NULL DEFAULT '{"dictionaries":[],"tagDimensions":[],"tagBindings":[]}'::jsonb
  CHECK(jsonb_typeof(tree_additions)='object');
