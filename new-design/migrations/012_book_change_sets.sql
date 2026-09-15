SET search_path TO new_design, public;

CREATE TABLE book_change_sets (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  operation_key text NOT NULL CHECK (operation_key IN ('story_time','narrative_placement','character_relation','clue_lifecycle')),
  input jsonb NOT NULL,
  impacts jsonb NOT NULL,
  base_revisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','applied','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE INDEX book_change_sets_book_status_idx ON book_change_sets(book_id,status,created_at DESC);
