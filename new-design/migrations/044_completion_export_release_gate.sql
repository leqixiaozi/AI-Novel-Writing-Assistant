SET search_path TO new_design, public;

CREATE TABLE completion_rule_sets (
  rule_set_key text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  name text NOT NULL,
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
  status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(rule_set_key,version)
);

CREATE TABLE book_completion_snapshots (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  rule_set_key text NOT NULL,
  rule_set_version integer NOT NULL,
  source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  blocker_count integer NOT NULL CHECK(blocker_count>=0),
  warning_count integer NOT NULL CHECK(warning_count>=0),
  info_count integer NOT NULL CHECK(info_count>=0),
  stable_through_order integer NOT NULL CHECK(stable_through_order>=0),
  chapter_count integer NOT NULL CHECK(chapter_count>=0),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rule_set_key,rule_set_version) REFERENCES completion_rule_sets(rule_set_key,version)
);

CREATE TABLE book_completion_check_results (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES book_completion_snapshots(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK(severity IN ('blocker','warning','info')),
  rule_key text NOT NULL CHECK(rule_key ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  title text NOT NULL,
  detail text NOT NULL,
  source_kind text NOT NULL,
  source_id text,
  source_route text NOT NULL CHECK(source_route='' OR source_route LIKE '/new-design%'),
  ordinal integer NOT NULL CHECK(ordinal>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id,rule_key,source_kind,source_id)
);

CREATE TABLE book_completion_snapshot_chapters (
  snapshot_id uuid NOT NULL REFERENCES book_completion_snapshots(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position>0),
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id),
  body_version_id uuid REFERENCES chapter_body_versions(id),
  stable_checkpoint_id uuid REFERENCES chapter_stable_checkpoints(id),
  chapter_order integer NOT NULL CHECK(chapter_order>0),
  title text NOT NULL,
  state text NOT NULL CHECK(state IN ('stable','pending','stale')),
  body_hash char(64),
  updated_at_snapshot timestamptz NOT NULL,
  PRIMARY KEY(snapshot_id,position),
  UNIQUE(snapshot_id,chapter_document_id),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE TABLE book_lifecycle_events (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  event_kind text NOT NULL CHECK(event_kind IN ('completion_checked','completed','reopened')),
  snapshot_id uuid REFERENCES book_completion_snapshots(id),
  actor text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((event_kind IN ('completion_checked','completed') AND snapshot_id IS NOT NULL) OR event_kind='reopened')
);

CREATE TABLE publication_export_manifests (
  id uuid PRIMARY KEY,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  completion_snapshot_id uuid REFERENCES book_completion_snapshots(id),
  export_mode text NOT NULL CHECK(export_mode IN ('formal','review_draft')),
  format text NOT NULL CHECK(format IN ('markdown','plain_text','docx')),
  range_kind text NOT NULL CHECK(range_kind IN ('book','volume','chapters')),
  range_ref jsonb NOT NULL CHECK(jsonb_typeof(range_ref)='object'),
  include_version_manifest boolean NOT NULL DEFAULT true,
  rule_set_key text NOT NULL,
  rule_set_version integer NOT NULL,
  source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  chapter_count integer NOT NULL CHECK(chapter_count>0),
  character_count bigint NOT NULL CHECK(character_count>=0),
  warning_count integer NOT NULL CHECK(warning_count>=0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rule_set_key,rule_set_version) REFERENCES completion_rule_sets(rule_set_key,version)
);

CREATE TABLE publication_export_manifest_chapters (
  manifest_id uuid NOT NULL REFERENCES publication_export_manifests(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position>0),
  chapter_document_id uuid NOT NULL REFERENCES chapter_documents(id),
  body_version_id uuid NOT NULL,
  stable_checkpoint_id uuid REFERENCES chapter_stable_checkpoints(id),
  volume_title text NOT NULL DEFAULT '',
  volume_order integer,
  chapter_title text NOT NULL,
  chapter_order integer NOT NULL CHECK(chapter_order>0),
  body_version integer NOT NULL CHECK(body_version>0),
  body_hash char(64) NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),
  character_count integer NOT NULL CHECK(character_count>=0),
  updated_at_snapshot timestamptz NOT NULL,
  PRIMARY KEY(manifest_id,position),
  UNIQUE(manifest_id,chapter_document_id),
  FOREIGN KEY(body_version_id,chapter_document_id) REFERENCES chapter_body_versions(id,chapter_document_id)
);

CREATE TABLE publication_export_requests (
  id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL REFERENCES publication_export_manifests(id),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  job_id uuid UNIQUE REFERENCES background_jobs(id),
  requested_by text NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 8 AND 240),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE publication_export_artifacts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES publication_export_requests(id),
  manifest_id uuid NOT NULL REFERENCES publication_export_manifests(id),
  format text NOT NULL CHECK(format IN ('markdown','plain_text','docx')),
  storage_locator text NOT NULL CHECK(storage_locator ~ '^exports/[A-Za-z0-9._/-]+$' AND storage_locator !~ '(^|/)\.\.(/|$)'),
  display_filename text NOT NULL CHECK(length(display_filename) BETWEEN 1 AND 180 AND display_filename !~ '[\\/:*?"<>|]'),
  media_type text NOT NULL,
  checksum char(64) NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  byte_size bigint NOT NULL CHECK(byte_size>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE release_gate_definitions (
  gate_key text PRIMARY KEY CHECK(gate_key ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  category text NOT NULL CHECK(category IN ('database','extensions','novel_flow','recovery','export','interface','isolation','packaging')),
  title text NOT NULL,
  acceptance text NOT NULL,
  sort_order integer NOT NULL CHECK(sort_order>=0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired'))
);

CREATE TABLE release_gate_assessments (
  id uuid PRIMARY KEY,
  gate_key text NOT NULL REFERENCES release_gate_definitions(gate_key),
  outcome text NOT NULL CHECK(outcome IN ('unexecuted','passed','failed','blocked')),
  evidence text NOT NULL,
  evidence_ref text NOT NULL DEFAULT '',
  assessed_by text NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE background_job_handlers DROP CONSTRAINT IF EXISTS background_job_handlers_specialized_request_kind_check;
ALTER TABLE background_job_handlers ADD CONSTRAINT background_job_handlers_specialized_request_kind_check CHECK(specialized_request_kind IN ('dependency_recompute_request','asset_derivation','graph_projection_request','embedding_chunking_request','embedding_request','embedding_index_generation','ai_task','backup_request','publication_export_request'));

INSERT INTO outbox_event_topics(topic,event_version,description,payload_contract) VALUES
('publication.export.requested',1,'作品导出请求，仅携带不可变导出请求引用。','{"referenceOnly":true}'::jsonb);
INSERT INTO background_job_handlers(handler_key,job_kind,topic,event_version,specialized_request_kind,default_max_attempts,default_lease_ms,backoff_base_ms,backoff_cap_ms,status) VALUES
('publication.export','publication.export','publication.export.requested',1,'publication_export_request',3,300000,2000,60000,'active');
INSERT INTO outbox_consumers(consumer_key,handler_key,max_concurrency) VALUES('runtime.publication-export','publication.export',1);

INSERT INTO completion_rule_sets(rule_set_key,version,name,definition) VALUES('completion.v1',1,'首版完本检查','{"blockers":["missing_adopted_body","chapter_order_gap","chapter_order_duplicate","chapter_not_stable","objective_issue","revision_incomplete"],"warnings":["unresolved_clue","unconfirmed_fact","pending_proposal","subjective_issue","failed_task","stale_reference","backup_missing","runtime_warning"],"formalExport":"continuous_stable_from_one"}'::jsonb);

INSERT INTO release_gate_definitions(gate_key,category,title,acceptance,sort_order) VALUES
('database.pg17_migrations','database','PG17 新装、升级与回滚','在真实 PostgreSQL 17 环境完成 001—044 新装、升级和失败回滚。',10),
('extensions.age','extensions','Apache AGE 加载与重建','装配匹配 PG17 的 age.dll，完成加载、投影重建和失败恢复。',20),
('extensions.pgvector','extensions','pgvector 加载与重建','装配匹配 PG17 的 vector.dll，完成加载、索引重建和失败恢复。',30),
('novel.three_chapter_flow','novel_flow','三章完整创作链','完成开书、规划、候选、采用、结算、续写、旧章返修、重算、质量检查和导出。',40),
('recovery.restart_concurrency','recovery','重启、并发与任务恢复','覆盖重启恢复、并发 409、Outbox 重试和死信。',50),
('recovery.backup_restore','recovery','备份与恢复演练','完成整库备份、恢复预检、实际恢复和一致性校验。',60),
('export.formats','export','三种导出格式打开校验','验证 Markdown、UTF-8 纯文本和 DOCX 可打开且内容、顺序、哈希一致。',70),
('interface.themes_scale','interface','主题、终端与规模','覆盖全部主题、桌面/移动、空态、大数据、性能、成本和脱敏。',80),
('isolation.legacy_readonly','isolation','旧系统并行隔离','证明旧页面、旧 Prisma/SQLite 与旧目录无新设计写入。',90),
('packaging.windows_runtime','packaging','Windows 私有运行包装配','完成真实运行包、签名、完整性校验、安装、覆盖安装和卸载保留数据。',100);
INSERT INTO release_gate_assessments(id,gate_key,outcome,evidence,evidence_ref,assessed_by) VALUES
(gen_random_uuid(),'extensions.age','blocked','仓库未包含已验收的 PG17 age.dll；静态实现不能替代真实装配与加载。','new-design/docs/private-runtime-runbook.md','system'),
(gen_random_uuid(),'extensions.pgvector','blocked','仓库未包含已验收的 PG17 vector.dll；静态实现不能替代真实装配与加载。','new-design/docs/private-runtime-runbook.md','system'),
(gen_random_uuid(),'packaging.windows_runtime','blocked','真实 Windows 私有运行包尚未装配和签名，安装验证不可标记通过。','new-design/docs/release-gate-checklist.md','system');

CREATE FUNCTION guard_f8_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER completion_rule_sets_append_only BEFORE UPDATE OR DELETE ON completion_rule_sets FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER completion_snapshots_append_only BEFORE UPDATE OR DELETE ON book_completion_snapshots FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER completion_results_append_only BEFORE UPDATE OR DELETE ON book_completion_check_results FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER completion_chapters_append_only BEFORE UPDATE OR DELETE ON book_completion_snapshot_chapters FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER book_lifecycle_events_append_only BEFORE UPDATE OR DELETE ON book_lifecycle_events FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER publication_manifests_append_only BEFORE UPDATE OR DELETE ON publication_export_manifests FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER publication_manifest_chapters_append_only BEFORE UPDATE OR DELETE ON publication_export_manifest_chapters FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER publication_artifacts_append_only BEFORE UPDATE OR DELETE ON publication_export_artifacts FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER release_gate_definitions_append_only BEFORE UPDATE OR DELETE ON release_gate_definitions FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();
CREATE TRIGGER release_gate_assessments_append_only BEFORE UPDATE OR DELETE ON release_gate_assessments FOR EACH ROW EXECUTE FUNCTION guard_f8_append_only();

CREATE FUNCTION validate_book_lifecycle_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest_state text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.book_id::text,0));
  IF NEW.snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM book_completion_snapshots snapshot WHERE snapshot.id=NEW.snapshot_id AND snapshot.book_id=NEW.book_id) THEN RAISE EXCEPTION 'completion snapshot and lifecycle book mismatch' USING ERRCODE='23514'; END IF;
  SELECT event_kind INTO latest_state FROM book_lifecycle_events WHERE book_id=NEW.book_id AND event_kind IN ('completed','reopened') ORDER BY created_at DESC,id DESC LIMIT 1;
  IF NEW.event_kind='completed' AND latest_state='completed' THEN RAISE EXCEPTION 'book is already completed' USING ERRCODE='23514'; END IF;
  IF NEW.event_kind='reopened' AND latest_state IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'only a completed book can be reopened' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER book_lifecycle_events_state_guard BEFORE INSERT ON book_lifecycle_events FOR EACH ROW EXECUTE FUNCTION validate_book_lifecycle_event();

CREATE FUNCTION validate_publication_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.completion_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM book_completion_snapshots snapshot WHERE snapshot.id=NEW.completion_snapshot_id AND snapshot.book_id=NEW.book_id) THEN RAISE EXCEPTION 'completion snapshot and export manifest book mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.export_mode='formal' AND NEW.completion_snapshot_id IS NULL THEN RAISE EXCEPTION 'formal export requires a completion snapshot' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_manifests_scope_guard BEFORE INSERT ON publication_export_manifests FOR EACH ROW EXECUTE FUNCTION validate_publication_manifest();

CREATE FUNCTION guard_publication_request_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['job_id']::text[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['job_id']::text[]) OR OLD.job_id IS NOT NULL OR NEW.job_id IS NULL THEN RAISE EXCEPTION 'publication export request is immutable except initial job binding' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_requests_guard BEFORE UPDATE OR DELETE ON publication_export_requests FOR EACH ROW EXECUTE FUNCTION guard_publication_request_update();

CREATE FUNCTION validate_completion_snapshot_chapter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM book_completion_snapshots snapshot JOIN chapter_documents document ON document.book_id=snapshot.book_id AND document.id=NEW.chapter_document_id LEFT JOIN chapter_body_versions body ON body.id=NEW.body_version_id AND body.chapter_document_id=document.id LEFT JOIN chapter_stable_checkpoints checkpoint ON checkpoint.id=NEW.stable_checkpoint_id AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=NEW.body_version_id WHERE snapshot.id=NEW.snapshot_id AND (NEW.body_version_id IS NULL OR body.id IS NOT NULL) AND (NEW.stable_checkpoint_id IS NULL OR checkpoint.id IS NOT NULL)) THEN RAISE EXCEPTION 'completion chapter binding is outside the snapshot book or version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER completion_snapshot_chapters_scope_guard BEFORE INSERT ON book_completion_snapshot_chapters FOR EACH ROW EXECUTE FUNCTION validate_completion_snapshot_chapter();

CREATE FUNCTION validate_publication_manifest_chapter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM publication_export_manifests manifest JOIN chapter_documents document ON document.book_id=manifest.book_id AND document.id=NEW.chapter_document_id JOIN chapter_body_versions body ON body.id=NEW.body_version_id AND body.chapter_document_id=document.id LEFT JOIN chapter_stable_checkpoints checkpoint ON checkpoint.id=NEW.stable_checkpoint_id AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=body.id WHERE manifest.id=NEW.manifest_id AND body.content_hash=NEW.body_hash AND (NEW.stable_checkpoint_id IS NULL OR checkpoint.id IS NOT NULL)) THEN RAISE EXCEPTION 'export chapter binding is outside the manifest book or hash' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_manifest_chapters_scope_guard BEFORE INSERT ON publication_export_manifest_chapters FOR EACH ROW EXECUTE FUNCTION validate_publication_manifest_chapter();

CREATE FUNCTION validate_publication_export_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE manifest_row publication_export_manifests%ROWTYPE;
BEGIN
  SELECT * INTO manifest_row FROM publication_export_manifests WHERE id=NEW.manifest_id;
  IF NOT FOUND OR manifest_row.book_id IS DISTINCT FROM NEW.book_id THEN RAISE EXCEPTION 'export request and manifest book mismatch' USING ERRCODE='23514'; END IF;
  IF manifest_row.export_mode='formal' AND manifest_row.completion_snapshot_id IS NULL THEN RAISE EXCEPTION 'formal export requires a completion snapshot' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM publication_export_manifest_chapters binding JOIN chapter_documents document ON document.id=binding.chapter_document_id LEFT JOIN chapter_stable_checkpoints checkpoint ON checkpoint.id=binding.stable_checkpoint_id WHERE binding.manifest_id=manifest_row.id AND (document.adopted_version_id IS DISTINCT FROM binding.body_version_id OR (manifest_row.export_mode='formal' AND (checkpoint.id IS NULL OR checkpoint.status<>'stable')))) THEN RAISE EXCEPTION 'export manifest source versions changed before submission' USING ERRCODE='40001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_requests_scope_guard BEFORE INSERT ON publication_export_requests FOR EACH ROW EXECUTE FUNCTION validate_publication_export_request();

CREATE OR REPLACE FUNCTION validate_background_job_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_handler background_job_handlers%ROWTYPE; event_row outbox_events%ROWTYPE; resolved_book uuid; resolved_space uuid;
BEGIN
  SELECT * INTO expected_handler FROM background_job_handlers WHERE handler_key=NEW.handler_key AND job_kind=NEW.job_kind AND specialized_request_kind=NEW.specialized_request_kind AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'job handler or specialized request kind is not registered' USING ERRCODE='23514'; END IF;
  SELECT * INTO event_row FROM outbox_events WHERE id=NEW.outbox_event_id;
  IF NOT FOUND OR event_row.topic IS DISTINCT FROM expected_handler.topic OR event_row.event_version IS DISTINCT FROM expected_handler.event_version OR event_row.space_id IS DISTINCT FROM NEW.space_id OR event_row.book_id IS DISTINCT FROM NEW.book_id OR event_row.ordering_key IS DISTINCT FROM NEW.ordering_key OR event_row.aggregate_sequence IS DISTINCT FROM NEW.aggregate_sequence OR event_row.payload->>'specializedRequestKind' IS DISTINCT FROM NEW.specialized_request_kind OR event_row.payload->>'specializedRequestId' IS DISTINCT FROM NEW.specialized_request_id::text THEN RAISE EXCEPTION 'job and outbox event identity mismatch' USING ERRCODE='23514'; END IF;
  CASE NEW.specialized_request_kind
    WHEN 'dependency_recompute_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM dependency_recompute_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'asset_derivation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM asset_derivations request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'graph_projection_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM graph_projection_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_chunking_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM chunking_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM embedding_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'embedding_index_generation' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM embedding_index_generations request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
    WHEN 'ai_task' THEN SELECT request.book_id,request.space_id INTO resolved_book,resolved_space FROM ai_tasks request WHERE request.id=NEW.specialized_request_id;
    WHEN 'backup_request' THEN SELECT operation.book_id,operation.space_id INTO resolved_book,resolved_space FROM transfer_operations operation WHERE operation.id=NEW.specialized_request_id;
    WHEN 'publication_export_request' THEN SELECT request.book_id,book.space_id INTO resolved_book,resolved_space FROM publication_export_requests request JOIN books book ON book.id=request.book_id WHERE request.id=NEW.specialized_request_id;
  END CASE;
  IF resolved_space IS NULL OR resolved_book IS DISTINCT FROM NEW.book_id OR resolved_space IS DISTINCT FROM NEW.space_id THEN RAISE EXCEPTION 'job specialized request does not resolve in the same scope' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION bridge_publication_export_to_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE queued_job uuid; book_space uuid;
BEGIN
  SELECT space_id INTO book_space FROM books WHERE id=NEW.book_id;
  queued_job:=enqueue_registered_background_job('publication_export_request',NEW.id,book_space,NEW.book_id,NULL,NULL);
  UPDATE publication_export_requests SET job_id=queued_job WHERE id=NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_export_requests_outbox_bridge AFTER INSERT ON publication_export_requests FOR EACH ROW EXECUTE FUNCTION bridge_publication_export_to_outbox();

CREATE INDEX completion_snapshots_book_idx ON book_completion_snapshots(book_id,created_at DESC,id);
CREATE INDEX completion_results_snapshot_idx ON book_completion_check_results(snapshot_id,severity,ordinal,id);
CREATE INDEX book_lifecycle_events_book_idx ON book_lifecycle_events(book_id,created_at DESC,id);
CREATE INDEX publication_manifests_book_idx ON publication_export_manifests(book_id,created_at DESC,id);
CREATE INDEX publication_requests_book_idx ON publication_export_requests(book_id,created_at DESC,id);
CREATE INDEX release_gate_assessments_latest_idx ON release_gate_assessments(gate_key,assessed_at DESC,id);

INSERT INTO schema_migrations(id) VALUES('044_completion_export_release_gate') ON CONFLICT(id) DO NOTHING;
