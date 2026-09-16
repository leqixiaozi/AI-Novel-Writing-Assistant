-- Keep the existing signature and constraints. Qualify the argument explicitly:
-- embedding_profile_versions also has a profile_id column.
CREATE OR REPLACE FUNCTION new_design.validate_knowledge_embedding_freeze(frozen jsonb,profile_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog, new_design, public, pg_temp AS $$
DECLARE profile embedding_profile_versions%ROWTYPE; connection model_route_versions%ROWTYPE; config model_route_configs%ROWTYPE;
BEGIN
 IF jsonb_typeof(frozen) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid embedding freeze' USING ERRCODE='23514'; END IF;
 SELECT * INTO profile FROM embedding_profile_versions WHERE id=validate_knowledge_embedding_freeze.profile_id;
 SELECT * INTO connection FROM model_route_versions WHERE id=(frozen->>'connectionVersionId')::uuid;
 SELECT * INTO config FROM model_route_configs WHERE id=connection.config_id;
 IF profile.id IS NULL OR connection.id IS NULL OR profile.connection_version_id IS DISTINCT FROM connection.id
 OR config.scope IS DISTINCT FROM 'task_group' OR config.task_group IS DISTINCT FROM 'knowledge_embedding' OR config.task_key IS NOT NULL
 OR connection.status NOT IN ('published','superseded') OR connection.required_capabilities IS DISTINCT FROM ARRAY['embedding']::text[]
 OR profile.provider_key IS DISTINCT FROM connection.provider OR profile.model_key IS DISTINCT FROM connection.model
 OR frozen->>'profileVersionId' IS DISTINCT FROM profile.id::text OR frozen->>'profileHash' IS DISTINCT FROM profile.content_hash::text
 OR frozen->>'connectionHash' IS DISTINCT FROM connection.content_hash::text OR frozen->>'provider' IS DISTINCT FROM connection.provider
 OR frozen->>'model' IS DISTINCT FROM connection.model OR (frozen->>'dimensions')::integer IS DISTINCT FROM profile.dimensions
 OR coalesce(frozen->>'inputHash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'embedding freeze does not resolve exact configuration' USING ERRCODE='23514'; END IF;
END $$;
