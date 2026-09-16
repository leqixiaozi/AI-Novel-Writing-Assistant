SET search_path TO new_design, public;

-- Reuse the existing immutable route snapshot chain before a book/contract exists.
-- Existing book-backed rows and foreign keys remain untouched.
ALTER TABLE model_route_snapshots ADD COLUMN managed_task_key text;
ALTER TABLE model_route_snapshots ALTER COLUMN book_id DROP NOT NULL;
ALTER TABLE model_route_snapshots ALTER COLUMN task_contract_version_id DROP NOT NULL;
ALTER TABLE model_route_snapshots ADD CONSTRAINT model_route_snapshots_managed_scope_check CHECK (
  (book_id IS NOT NULL AND task_contract_version_id IS NOT NULL AND managed_task_key IS NULL) OR
  (book_id IS NULL AND task_contract_version_id IS NULL AND managed_task_key IS NOT NULL AND managed_task_key IN ('directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate'))
);
CREATE INDEX model_route_snapshots_managed_task_idx ON model_route_snapshots(managed_task_key,created_at DESC) WHERE managed_task_key IS NOT NULL;
