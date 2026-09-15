SET search_path TO new_design, public;

CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path TO ag_catalog, new_design, "$user", public;

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ag_catalog.ag_graph WHERE name='new_design_projection') THEN
    PERFORM ag_catalog.create_graph('new_design_projection');
  END IF;
END $$;

SET search_path TO new_design, ag_catalog, "$user", public;

CREATE TABLE graph_projection_configs (
  id uuid PRIMARY KEY,
  graph_name text NOT NULL UNIQUE CHECK(graph_name='new_design_projection'),
  mapping_version integer NOT NULL CHECK(mapping_version>0),
  max_depth integer NOT NULL CHECK(max_depth BETWEEN 1 AND 6),
  max_results integer NOT NULL CHECK(max_results BETWEEN 1 AND 200),
  statement_timeout_ms integer NOT NULL CHECK(statement_timeout_ms BETWEEN 100 AND 5000),
  status text NOT NULL CHECK(status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO graph_projection_configs(id,graph_name,mapping_version,max_depth,max_results,statement_timeout_ms,status)
VALUES('81000000-0000-4000-8000-000000000001','new_design_projection',1,6,200,5000,'active');

CREATE TABLE graph_projection_mapping_definitions (
  mapping_key text PRIMARY KEY,
  source_kind text NOT NULL,
  element_kind text NOT NULL CHECK(element_kind IN ('vertex','edge')),
  graph_label text NOT NULL CHECK(graph_label ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
  eligibility text NOT NULL,
  mapping_version integer NOT NULL CHECK(mapping_version>0),
  enabled boolean NOT NULL DEFAULT true
);

INSERT INTO graph_projection_mapping_definitions(mapping_key,source_kind,element_kind,graph_label,eligibility,mapping_version) VALUES
('book','book','vertex','ProjectedNode','有效书籍',1),
('card','card_version','vertex','ProjectedNode','有效卡片的当前版本',1),
('chapter_body','chapter_body_version','vertex','ProjectedNode','有效章节的采用正文',1),
('fact','canonical_fact','vertex','ProjectedNode','已确认且未陈旧事实',1),
('knowledge','knowledge_state_change','vertex','ProjectedNode','当前人物或读者认知投影',1),
('state_change','state_change','vertex','ProjectedNode','有效状态变化形成的当前投影',1),
('state','state_projection','vertex','ProjectedNode','未陈旧当前状态投影',1),
('story_event','card_version','vertex','ProjectedNode','类型为事件的有效卡片当前版本',1),
('story_timing','story_event_timing','vertex','ProjectedNode','有效故事时间',1),
('planning','planning_version','vertex','ProjectedNode','有效规划节点的采用版本',1),
('research_asset','research_record_version','vertex','ProjectedNode','本书引用的研究版本',1),
('attachment_asset','asset_version','vertex','ProjectedNode','有效附件资产的采用版本',1),
('card_relation','card_relation','edge','PROJECTED_RELATION','有效卡片关系',1),
('story_relation','story_event_relation','edge','PROJECTED_RELATION','有效时间或因果关系',1),
('story_timing_link','story_event_timing_link','edge','PROJECTED_RELATION','事件卡到有效故事时间的关联',1),
('planning_parent','planning_parent','edge','PROJECTED_RELATION','有效规划父子关系',1),
('research_reference','research_reference','edge','PROJECTED_RELATION','本书到研究版本引用',1),
('research_reference_pack_item','research_reference_pack_item','edge','PROJECTED_RELATION','本书引用包中的研究版本关联',1),
('asset_mount','asset_mount','edge','PROJECTED_RELATION','有效附件业务挂载',1);

CREATE TABLE graph_projection_generations (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  generation bigint NOT NULL CHECK(generation>0),
  mapping_version integer NOT NULL CHECK(mapping_version>0),
  status text NOT NULL DEFAULT 'building' CHECK(status IN ('building','ready','active','failed','superseded')),
  source_watermark jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_watermark)='object'),
  vertex_count bigint NOT NULL DEFAULT 0 CHECK(vertex_count>=0),
  edge_count bigint NOT NULL DEFAULT 0 CHECK(edge_count>=0),
  projection_checksum char(64),
  error_code text NOT NULL DEFAULT '',
  error_detail text NOT NULL DEFAULT '',
  retryable boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  activated_at timestamptz,
  UNIQUE(id,book_id),
  UNIQUE(book_id,generation),
  CHECK(projection_checksum IS NULL OR projection_checksum ~ '^[a-f0-9]{64}$')
);

CREATE TABLE graph_projection_book_states (
  book_id uuid PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  active_generation_id uuid,
  status text NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','building','active','degraded','unavailable')),
  last_request_at timestamptz,
  last_success_at timestamptz,
  last_error_code text NOT NULL DEFAULT '',
  last_error_detail text NOT NULL DEFAULT '',
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(active_generation_id,book_id) REFERENCES graph_projection_generations(id,book_id)
);

CREATE TABLE graph_projection_requests (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  generation_id uuid,
  request_kind text NOT NULL CHECK(request_kind IN ('incremental_upsert','tombstone','full_rebuild')),
  dependency_resource_id uuid REFERENCES dependency_resources(id),
  source_kind text,
  source_id uuid,
  source_version_id uuid,
  source_revision bigint,
  source_hash char(64),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','failed','superseded')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  idempotency_key text NOT NULL,
  last_error_code text NOT NULL DEFAULT '',
  last_error_detail text NOT NULL DEFAULT '',
  retryable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY(generation_id,book_id) REFERENCES graph_projection_generations(id,book_id),
  UNIQUE(book_id,idempotency_key),
  CHECK(source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$'),
  CHECK((request_kind='full_rebuild' AND dependency_resource_id IS NULL) OR (request_kind<>'full_rebuild' AND dependency_resource_id IS NOT NULL))
);

CREATE TABLE graph_projection_batches (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES graph_projection_requests(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  mode text NOT NULL CHECK(mode IN ('incremental','full_rebuild')),
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')),
  source_watermark jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_watermark)='object'),
  processed_count bigint NOT NULL DEFAULT 0 CHECK(processed_count>=0),
  vertex_count bigint NOT NULL DEFAULT 0 CHECK(vertex_count>=0),
  edge_count bigint NOT NULL DEFAULT 0 CHECK(edge_count>=0),
  checksum char(64),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY(generation_id,book_id) REFERENCES graph_projection_generations(id,book_id),
  CHECK(checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$')
);

CREATE TABLE graph_projection_checkpoints (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES graph_projection_batches(id) ON DELETE CASCADE,
  checkpoint_key text NOT NULL,
  source_watermark jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_watermark)='object'),
  processed_count bigint NOT NULL CHECK(processed_count>=0),
  checksum char(64) NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,checkpoint_key)
);

CREATE TABLE graph_projection_failures (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES graph_projection_requests(id),
  batch_id uuid REFERENCES graph_projection_batches(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  generation_id uuid,
  stage text NOT NULL,
  error_code text NOT NULL,
  error_detail text NOT NULL,
  retryable boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(generation_id,book_id) REFERENCES graph_projection_generations(id,book_id)
);

CREATE TABLE graph_projection_source_mappings (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  element_kind text NOT NULL CHECK(element_kind IN ('vertex','edge')),
  graph_label text NOT NULL,
  graph_element_key text NOT NULL,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_revision bigint NOT NULL CHECK(source_revision>0),
  source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  projection_hash char(64) NOT NULL CHECK(projection_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','tombstoned')),
  projected_at timestamptz NOT NULL DEFAULT now(),
  tombstoned_at timestamptz,
  FOREIGN KEY(generation_id,book_id) REFERENCES graph_projection_generations(id,book_id),
  UNIQUE(generation_id,graph_element_key),
  UNIQUE(generation_id,element_kind,source_kind,source_id,source_version_id),
  CHECK((status='active' AND tombstoned_at IS NULL) OR (status='tombstoned' AND tombstoned_at IS NOT NULL))
);

CREATE FUNCTION guard_graph_projection_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='graph_projection_requests' THEN
    IF (to_jsonb(NEW)-ARRAY['status','attempt_count','last_error_code','last_error_detail','retryable','started_at','completed_at','generation_id']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','last_error_code','last_error_detail','retryable','started_at','completed_at','generation_id']::text[]) THEN RAISE EXCEPTION 'graph projection request identity is immutable' USING ERRCODE='23514'; END IF;
    IF NOT ((OLD.status='pending' AND NEW.status IN ('processing','superseded')) OR (OLD.status='processing' AND NEW.status IN ('succeeded','failed')) OR (OLD.status='failed' AND NEW.status='processing')) THEN RAISE EXCEPTION 'invalid graph projection request transition' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='graph_projection_generations' THEN
    IF (to_jsonb(NEW)-ARRAY['status','source_watermark','vertex_count','edge_count','projection_checksum','error_code','error_detail','retryable','completed_at','activated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','source_watermark','vertex_count','edge_count','projection_checksum','error_code','error_detail','retryable','completed_at','activated_at']::text[]) THEN RAISE EXCEPTION 'graph generation identity is immutable' USING ERRCODE='23514'; END IF;
    IF NOT ((OLD.status='building' AND NEW.status IN ('ready','failed')) OR (OLD.status='ready' AND NEW.status IN ('active','failed')) OR (OLD.status='active' AND NEW.status IN ('active','superseded'))) THEN RAISE EXCEPTION 'invalid graph generation transition' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER graph_projection_requests_transition BEFORE UPDATE ON graph_projection_requests FOR EACH ROW EXECUTE FUNCTION guard_graph_projection_transition();
CREATE TRIGGER graph_projection_generations_transition BEFORE UPDATE ON graph_projection_generations FOR EACH ROW EXECUTE FUNCTION guard_graph_projection_transition();

CREATE FUNCTION guard_graph_projection_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'graph projection history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER graph_projection_checkpoints_immutable BEFORE UPDATE OR DELETE ON graph_projection_checkpoints FOR EACH ROW EXECUTE FUNCTION guard_graph_projection_history();
CREATE TRIGGER graph_projection_failures_immutable BEFORE UPDATE OR DELETE ON graph_projection_failures FOR EACH ROW EXECUTE FUNCTION guard_graph_projection_history();

CREATE FUNCTION guard_graph_projection_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'graph projection mappings are append-only' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'active' OR NEW.status<>'tombstoned' OR NEW.tombstoned_at IS NULL OR
     (to_jsonb(NEW)-ARRAY['status','tombstoned_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','tombstoned_at']::text[]) THEN
    RAISE EXCEPTION 'graph projection mapping may only be tombstoned' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER graph_projection_mappings_guard BEFORE UPDATE OR DELETE ON graph_projection_source_mappings FOR EACH ROW EXECUTE FUNCTION guard_graph_projection_mapping();

CREATE FUNCTION enqueue_graph_projection_resource() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target dependency_resources%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='dependency_resources' THEN target:=NEW;
  ELSE SELECT * INTO target FROM dependency_resources WHERE id=NEW.resource_id;
  END IF;
  IF target.book_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO graph_projection_book_states(book_id,last_request_at) VALUES(target.book_id,now())
  ON CONFLICT(book_id) DO UPDATE SET last_request_at=excluded.last_request_at,revision=graph_projection_book_states.revision+1,updated_at=now();
  INSERT INTO graph_projection_requests(id,book_id,request_kind,dependency_resource_id,source_kind,source_id,source_version_id,source_revision,source_hash,reason,idempotency_key)
  VALUES(gen_random_uuid(),target.book_id,CASE WHEN TG_TABLE_NAME='dependency_resources' THEN 'incremental_upsert' ELSE 'tombstone' END,target.id,target.resource_kind,target.stable_object_id,target.exact_version_id,1,target.content_hash,CASE WHEN TG_TABLE_NAME='dependency_resources' THEN '统一依赖资源登记后同步图投影。' ELSE '统一依赖资源失效后移出当前图投影。' END,CASE WHEN TG_TABLE_NAME='dependency_resources' THEN 'resource:' ELSE 'invalidation:'||NEW.event_id::text||':' END||target.id::text)
  ON CONFLICT(book_id,idempotency_key) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER graph_projection_resource_request AFTER INSERT ON dependency_resources FOR EACH ROW EXECUTE FUNCTION enqueue_graph_projection_resource();
CREATE TRIGGER graph_projection_invalidation_request AFTER INSERT ON dependency_invalidation_impacts FOR EACH ROW EXECUTE FUNCTION enqueue_graph_projection_resource();

CREATE INDEX graph_projection_requests_queue_idx ON graph_projection_requests(book_id,status,created_at,id);
CREATE INDEX graph_projection_batches_request_idx ON graph_projection_batches(request_id,started_at DESC,id);
CREATE INDEX graph_projection_generations_book_idx ON graph_projection_generations(book_id,generation DESC);
CREATE UNIQUE INDEX graph_projection_generations_active_unique ON graph_projection_generations(book_id) WHERE status='active';
CREATE INDEX graph_projection_mappings_source_idx ON graph_projection_source_mappings(book_id,generation_id,source_kind,source_id,source_version_id,status);
CREATE INDEX graph_projection_failures_book_idx ON graph_projection_failures(book_id,created_at DESC,id);

INSERT INTO schema_migrations(id) VALUES('028_age_graph_projection') ON CONFLICT(id) DO NOTHING;
