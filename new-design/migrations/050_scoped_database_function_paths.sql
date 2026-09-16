SET search_path TO new_design, public;

-- A migration's SET applies only to its connection. API-triggered functions
-- need their own lookup path. Preserve explicitly specialized function paths.
DO $$
DECLARE scoped_function record;
BEGIN
  FOR scoped_function IN
    SELECT namespace.nspname,procedure.proname,pg_get_function_identity_arguments(procedure.oid) arguments
    FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='new_design' AND procedure.prokind='f'
      AND NOT EXISTS(SELECT 1 FROM unnest(COALESCE(procedure.proconfig,ARRAY[]::text[])) configuration WHERE configuration LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path TO new_design, ag_catalog, public',scoped_function.nspname,scoped_function.proname,scoped_function.arguments);
  END LOOP;
END $$;
