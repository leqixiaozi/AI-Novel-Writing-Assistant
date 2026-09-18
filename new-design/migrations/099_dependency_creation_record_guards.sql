-- Manual repair only; never registered in author startup migrations.
-- Select the actual trigger table before accessing table-specific record fields.
SET search_path TO new_design, public;
DO $repair$
DECLARE definition text;
  old_branch text := 'ELSIF TG_TABLE_NAME=''ai_task_attempts'' AND NEW.status=''succeeded'' AND OLD.status IS DISTINCT FROM NEW.status THEN';
  next_branch text := 'ELSIF TG_TABLE_NAME=''quality_audit_reports'' THEN';
BEGIN
  definition := pg_get_functiondef('new_design.bridge_dependency_creation()'::regprocedure);
  IF strpos(definition,old_branch)=0 OR strpos(definition,next_branch)=0 THEN
    RAISE EXCEPTION 'unexpected dependency creation bridge; preserve existing guards';
  END IF;
  definition := replace(definition,old_branch,
    'ELSIF TG_TABLE_NAME=''ai_task_attempts'' THEN
      IF TG_OP=''UPDATE'' THEN
        IF NEW.status=''succeeded'' AND OLD.status IS DISTINCT FROM NEW.status THEN');
  definition := replace(definition,next_branch,
    '    END IF;
      END IF;
  ELSIF TG_TABLE_NAME=''quality_audit_reports'' THEN');
  -- CREATE OR REPLACE preserves the function OID, trigger bindings and any
  -- installed public-scope guard; all original dependency writes remain.
  EXECUTE definition;
END $repair$;
