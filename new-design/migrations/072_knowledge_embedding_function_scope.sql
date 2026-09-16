-- 070's session search_path does not persist as a function execution setting.
-- Fix already-installed functions without rewriting facts or historical versions.
ALTER FUNCTION new_design.guard_knowledge_build_receipt()
  SET search_path TO pg_catalog, new_design, public, pg_temp;
ALTER FUNCTION new_design.validate_knowledge_embedding_freeze(jsonb, uuid)
  SET search_path TO pg_catalog, new_design, public, pg_temp;
ALTER FUNCTION new_design.guard_knowledge_embedding_execution()
  SET search_path TO pg_catalog, new_design, public, pg_temp;
ALTER FUNCTION new_design.guard_knowledge_embedding_result()
  SET search_path TO pg_catalog, new_design, public, pg_temp;
