SET search_path TO new_design, public;

ALTER TABLE card_versions ADD CONSTRAINT card_versions_id_card_unique UNIQUE(id,card_id);

CREATE TABLE prompt_recipes (
  id uuid PRIMARY KEY,
  recipe_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  current_version_id uuid,
  published_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prompt_recipe_versions (
  id uuid PRIMARY KEY,
  recipe_id uuid NOT NULL REFERENCES prompt_recipes(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),
  base_version_id uuid,
  source text NOT NULL CHECK(source IN ('manual','ai','import','system')),
  status text NOT NULL CHECK(status IN ('draft','proposed','published','superseded','rejected')),
  variables_schema jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(variables_schema)='object'),
  content_hash char(64) NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipe_id,version),
  UNIQUE(id,recipe_id),
  FOREIGN KEY(base_version_id,recipe_id) REFERENCES prompt_recipe_versions(id,recipe_id)
);

ALTER TABLE prompt_recipes ADD CONSTRAINT prompt_recipes_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES prompt_recipe_versions(id,recipe_id);
ALTER TABLE prompt_recipes ADD CONSTRAINT prompt_recipes_published_version_fk FOREIGN KEY(published_version_id,id) REFERENCES prompt_recipe_versions(id,recipe_id);
CREATE UNIQUE INDEX prompt_recipe_versions_published_unique ON prompt_recipe_versions(recipe_id) WHERE status='published';

CREATE TABLE prompt_recipe_slots (
  id uuid PRIMARY KEY,
  recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  sort_order integer NOT NULL CHECK(sort_order>=0),
  required boolean NOT NULL DEFAULT false,
  allowed_content_types text[] NOT NULL CHECK(cardinality(allowed_content_types)>0),
  variable_contract jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(variable_contract)='object'),
  UNIQUE(recipe_version_id,slot_key),
  UNIQUE(recipe_version_id,sort_order),
  UNIQUE(id,recipe_version_id)
);

CREATE TABLE prompt_recipe_slot_components (
  id uuid PRIMARY KEY,
  recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL,
  component_card_id uuid NOT NULL REFERENCES cards(id),
  component_version_id uuid NOT NULL,
  sort_order integer NOT NULL CHECK(sort_order>=0),
  required boolean NOT NULL DEFAULT true,
  UNIQUE(slot_id,sort_order),
  UNIQUE(slot_id,component_version_id),
  FOREIGN KEY(slot_id,recipe_version_id) REFERENCES prompt_recipe_slots(id,recipe_version_id),
  FOREIGN KEY(component_version_id,component_card_id) REFERENCES card_versions(id,card_id)
);

CREATE TABLE task_contracts (
  id uuid PRIMARY KEY,
  task_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  current_version_id uuid,
  published_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_contract_versions (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES task_contracts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),
  base_version_id uuid,
  source text NOT NULL CHECK(source IN ('manual','ai','import','system')),
  status text NOT NULL CHECK(status IN ('draft','proposed','published','superseded','rejected')),
  task_group text NOT NULL,
  input_schema jsonb NOT NULL CHECK(jsonb_typeof(input_schema)='object'),
  input_schema_version text NOT NULL,
  output_schema jsonb NOT NULL CHECK(jsonb_typeof(output_schema)='object'),
  output_schema_version text NOT NULL,
  context_policy_version text NOT NULL,
  prompt_recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id),
  required_capabilities text[] NOT NULL DEFAULT '{}',
  budget_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(budget_policy)='object'),
  timeout_ms integer NOT NULL CHECK(timeout_ms>0),
  retry_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(retry_policy)='object'),
  confirmation_policy text NOT NULL CHECK(confirmation_policy IN ('none','before_execute','before_adopt','always')),
  content_hash char(64) NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contract_id,version),
  UNIQUE(id,contract_id),
  FOREIGN KEY(base_version_id,contract_id) REFERENCES task_contract_versions(id,contract_id)
);

ALTER TABLE task_contracts ADD CONSTRAINT task_contracts_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES task_contract_versions(id,contract_id);
ALTER TABLE task_contracts ADD CONSTRAINT task_contracts_published_version_fk FOREIGN KEY(published_version_id,id) REFERENCES task_contract_versions(id,contract_id);
CREATE UNIQUE INDEX task_contract_versions_published_unique ON task_contract_versions(contract_id) WHERE status='published';

CREATE TABLE ai_contract_publications (
  id uuid PRIMARY KEY,
  entity_kind text NOT NULL CHECK(entity_kind IN ('prompt_recipe','task_contract','model_route')),
  entity_id uuid NOT NULL,
  from_version_id uuid,
  to_version_id uuid NOT NULL,
  entity_revision integer NOT NULL CHECK(entity_revision>0),
  action text NOT NULL CHECK(action IN ('publish','rollback','republish')),
  actor text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE context_manifests (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  prompt_recipe_version_id uuid NOT NULL REFERENCES prompt_recipe_versions(id),
  node_key text,
  status text NOT NULL CHECK(status IN ('complete','invalid')),
  manifest_hash char(64) NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE context_manifest_slots (
  id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL REFERENCES context_manifests(id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  sort_order integer NOT NULL CHECK(sort_order>=0),
  required boolean NOT NULL,
  token_budget integer CHECK(token_budget IS NULL OR token_budget>=0),
  UNIQUE(manifest_id,slot_key),
  UNIQUE(id,manifest_id)
);

CREATE TABLE context_manifest_entries (
  id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL,
  slot_id uuid NOT NULL,
  source_type text NOT NULL CHECK(source_type IN ('card_version','card_relation','body_version','text_anchor','planning_version','canonical_fact','state_change','story_time','research_version','prompt_component')),
  stable_object_id uuid NOT NULL,
  exact_version_id uuid,
  source_space_id uuid,
  content_hash char(64) NOT NULL,
  inclusion_reason text NOT NULL,
  priority integer NOT NULL,
  token_estimate integer NOT NULL CHECK(token_estimate>=0),
  transform_status text NOT NULL CHECK(transform_status IN ('full','truncated','summarized')),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  FOREIGN KEY(slot_id,manifest_id) REFERENCES context_manifest_slots(id,manifest_id),
  UNIQUE(slot_id,sort_order),
  UNIQUE(slot_id,source_type,stable_object_id,exact_version_id)
);

CREATE TABLE context_manifest_exclusions (
  id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL,
  slot_id uuid NOT NULL,
  source_type text NOT NULL,
  stable_object_id uuid,
  exact_version_id uuid,
  reason_code text NOT NULL CHECK(reason_code IN ('invalid_reference','wrong_book','wrong_version','slot_type_mismatch','lower_priority','token_budget','duplicate','stale','unavailable')),
  reason_detail text NOT NULL,
  priority integer,
  token_estimate integer CHECK(token_estimate IS NULL OR token_estimate>=0),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  FOREIGN KEY(slot_id,manifest_id) REFERENCES context_manifest_slots(id,manifest_id),
  UNIQUE(slot_id,sort_order)
);

CREATE INDEX context_manifests_book_idx ON context_manifests(book_id,created_at DESC);

CREATE TABLE model_credential_refs (
  id uuid PRIMARY KEY,
  credential_key text NOT NULL UNIQUE,
  provider text NOT NULL,
  secret_locator text NOT NULL CHECK(secret_locator ~ '^(secret|env|keychain)://[A-Za-z0-9_.:/-]+$'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_route_configs (
  id uuid PRIMARY KEY,
  scope text NOT NULL CHECK(scope IN ('system_default','task_group','node','book','one_time')),
  task_group text,
  node_key text,
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  override_key text,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  current_version_id uuid,
  published_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((scope='system_default' AND task_group IS NULL AND node_key IS NULL AND book_id IS NULL AND override_key IS NULL) OR
        (scope='task_group' AND task_group IS NOT NULL AND node_key IS NULL AND book_id IS NULL AND override_key IS NULL) OR
        (scope='node' AND node_key IS NOT NULL AND book_id IS NULL AND override_key IS NULL) OR
        (scope='book' AND book_id IS NOT NULL AND override_key IS NULL) OR
        (scope='one_time' AND override_key IS NOT NULL))
);

CREATE UNIQUE INDEX model_route_configs_scope_unique ON model_route_configs(scope,task_group,node_key,book_id,override_key) NULLS NOT DISTINCT WHERE status='active';

CREATE TABLE model_route_versions (
  id uuid PRIMARY KEY,
  config_id uuid NOT NULL REFERENCES model_route_configs(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),
  base_version_id uuid,
  source text NOT NULL CHECK(source IN ('manual','import','system')),
  status text NOT NULL CHECK(status IN ('draft','published','superseded','rejected')),
  provider text,
  model text,
  parameters jsonb CHECK(parameters IS NULL OR jsonb_typeof(parameters)='object'),
  required_capabilities text[],
  credential_ref_id uuid REFERENCES model_credential_refs(id),
  budget_policy jsonb CHECK(budget_policy IS NULL OR jsonb_typeof(budget_policy)='object'),
  timeout_ms integer CHECK(timeout_ms IS NULL OR timeout_ms>0),
  retry_policy jsonb CHECK(retry_policy IS NULL OR jsonb_typeof(retry_policy)='object'),
  fallback_mode text NOT NULL DEFAULT 'inherit' CHECK(fallback_mode IN ('inherit','replace')),
  content_hash char(64) NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(config_id,version),
  UNIQUE(id,config_id),
  FOREIGN KEY(base_version_id,config_id) REFERENCES model_route_versions(id,config_id)
);

ALTER TABLE model_route_configs ADD CONSTRAINT model_route_configs_current_version_fk FOREIGN KEY(current_version_id,id) REFERENCES model_route_versions(id,config_id);
ALTER TABLE model_route_configs ADD CONSTRAINT model_route_configs_published_version_fk FOREIGN KEY(published_version_id,id) REFERENCES model_route_versions(id,config_id);
CREATE UNIQUE INDEX model_route_versions_published_unique ON model_route_versions(config_id) WHERE status='published';

CREATE TABLE model_route_fallbacks (
  id uuid PRIMARY KEY,
  route_version_id uuid NOT NULL REFERENCES model_route_versions(id) ON DELETE CASCADE,
  sort_order integer NOT NULL CHECK(sort_order>=0),
  provider text NOT NULL,
  model text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(parameters)='object'),
  credential_ref_id uuid REFERENCES model_credential_refs(id),
  technical_failure_categories text[] NOT NULL CHECK(cardinality(technical_failure_categories)>0 AND technical_failure_categories <@ ARRAY['timeout','rate_limit','authentication','provider_unavailable','transport','context_limit']::text[]),
  UNIQUE(route_version_id,sort_order)
);

CREATE TABLE model_route_snapshots (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  task_contract_version_id uuid NOT NULL REFERENCES task_contract_versions(id),
  node_key text,
  provider text NOT NULL,
  model text NOT NULL,
  parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object'),
  required_capabilities text[] NOT NULL,
  credential_ref_id uuid REFERENCES model_credential_refs(id),
  budget_policy jsonb NOT NULL CHECK(jsonb_typeof(budget_policy)='object'),
  timeout_ms integer NOT NULL CHECK(timeout_ms>0),
  retry_policy jsonb NOT NULL CHECK(jsonb_typeof(retry_policy)='object'),
  source_layers jsonb NOT NULL CHECK(jsonb_typeof(source_layers)='array'),
  policy_version text NOT NULL,
  snapshot_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_route_snapshot_fallbacks (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES model_route_snapshots(id) ON DELETE CASCADE,
  sort_order integer NOT NULL CHECK(sort_order>=0),
  provider text NOT NULL,
  model text NOT NULL,
  parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object'),
  credential_ref_id uuid REFERENCES model_credential_refs(id),
  technical_failure_categories text[] NOT NULL CHECK(cardinality(technical_failure_categories)>0 AND technical_failure_categories <@ ARRAY['timeout','rate_limit','authentication','provider_unavailable','transport','context_limit']::text[]),
  UNIQUE(snapshot_id,sort_order)
);

CREATE FUNCTION guard_ai_contract_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'contract history is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME IN ('prompt_recipe_versions','task_contract_versions','model_route_versions') THEN
    IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'published contract content is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status='rejected' AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'rejected version is final' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'snapshot detail is immutable' USING ERRCODE='23514';
END $$;

CREATE TRIGGER prompt_recipe_versions_immutable BEFORE UPDATE OR DELETE ON prompt_recipe_versions FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER task_contract_versions_immutable BEFORE UPDATE OR DELETE ON task_contract_versions FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER model_route_versions_immutable BEFORE UPDATE OR DELETE ON model_route_versions FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER prompt_recipe_slots_immutable BEFORE UPDATE OR DELETE ON prompt_recipe_slots FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER prompt_recipe_components_immutable BEFORE UPDATE OR DELETE ON prompt_recipe_slot_components FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER context_manifests_immutable BEFORE UPDATE OR DELETE ON context_manifests FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER context_manifest_slots_immutable BEFORE UPDATE OR DELETE ON context_manifest_slots FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER context_manifest_entries_immutable BEFORE UPDATE OR DELETE ON context_manifest_entries FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER context_manifest_exclusions_immutable BEFORE UPDATE OR DELETE ON context_manifest_exclusions FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER model_route_fallbacks_immutable BEFORE UPDATE OR DELETE ON model_route_fallbacks FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER model_route_snapshots_immutable BEFORE UPDATE OR DELETE ON model_route_snapshots FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();
CREATE TRIGGER model_route_snapshot_fallbacks_immutable BEFORE UPDATE OR DELETE ON model_route_snapshot_fallbacks FOR EACH ROW EXECUTE FUNCTION guard_ai_contract_immutable();

CREATE INDEX task_contracts_task_key_idx ON task_contracts(task_key) WHERE status='active';
CREATE INDEX model_route_snapshots_book_idx ON model_route_snapshots(book_id,created_at DESC);
