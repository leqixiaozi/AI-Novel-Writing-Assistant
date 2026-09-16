SET search_path TO new_design, public;

CREATE TABLE planning_ai_candidate_runs (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  target_object_id uuid REFERENCES planning_objects(id) ON DELETE SET NULL,
  base_version_id uuid REFERENCES planning_versions(id) ON DELETE SET NULL,
  result_object_id uuid REFERENCES planning_objects(id) ON DELETE SET NULL,
  result_version_id uuid REFERENCES planning_versions(id) ON DELETE SET NULL,
  status text NOT NULL CHECK(status IN ('running','completed','failed')),
  instruction text NOT NULL DEFAULT '',
  source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
  prompt_snapshot jsonb CHECK(prompt_snapshot IS NULL OR jsonb_typeof(prompt_snapshot)='object'),
  model_snapshot jsonb CHECK(model_snapshot IS NULL OR jsonb_typeof(model_snapshot)='object'),
  used_tokens integer CHECK(used_tokens IS NULL OR used_tokens>=0),
  error_message text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK((status='running' AND completed_at IS NULL AND result_version_id IS NULL) OR (status='completed' AND completed_at IS NOT NULL AND result_object_id IS NOT NULL AND result_version_id IS NOT NULL) OR (status='failed' AND completed_at IS NOT NULL AND error_message<>''))
);

CREATE INDEX planning_ai_candidate_runs_book_idx ON planning_ai_candidate_runs(book_id,created_at DESC,id);
CREATE INDEX planning_ai_candidate_runs_target_idx ON planning_ai_candidate_runs(target_object_id,created_at DESC,id);

INSERT INTO schema_migrations(id) VALUES('045_planning_ai_candidates') ON CONFLICT(id) DO NOTHING;
