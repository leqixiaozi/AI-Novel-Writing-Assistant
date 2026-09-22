-- 133：现有 131 开发库的纯表增量结构。由显式升级器在同一个事务内执行。
-- 不创建数据库／业务表，不重跑 132，不登记尚未执行的历史迁移。
-- 前置：核对 131、停写、保护副本、记录映射；后置：原生函数／保护和数据核对。
SET LOCAL search_path TO new_design,public;
ALTER TABLE card_types ADD COLUMN is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE card_version_actions ALTER COLUMN request_key TYPE text USING request_key::text;

ALTER TABLE embedding_chunks ADD COLUMN record_kind text NOT NULL DEFAULT 'chunk'
 CHECK(record_kind IN ('source','chunk'));
ALTER TABLE embedding_chunks DROP CONSTRAINT embedding_chunks_source_snapshot_id_profile_version_id_chun_key;
ALTER TABLE embedding_chunks ADD CONSTRAINT embedding_chunks_source_snapshot_id_profile_version_id_chun_key
 UNIQUE(source_snapshot_id,profile_version_id,chunker_version,ordinal,record_kind);
ALTER TABLE embedding_vectors
 ADD COLUMN record_kind text NOT NULL DEFAULT 'index' CHECK(record_kind IN ('attempt','result','index')),
 ADD COLUMN request_id uuid, ADD COLUMN attempt_id uuid, ADD COLUMN response_vector double precision[],
 ALTER COLUMN generation_id DROP NOT NULL, ALTER COLUMN result_id DROP NOT NULL;
ALTER TABLE embedding_vectors ADD CONSTRAINT embedding_vector_kind_scope CHECK(
 (record_kind='index' AND generation_id IS NOT NULL AND result_id IS NOT NULL)
 OR(record_kind IN ('attempt','result') AND generation_id IS NULL AND request_id IS NOT NULL
 AND attempt_id IS NOT NULL AND response_vector IS NOT NULL AND(record_kind='attempt' OR result_id IS NOT NULL)));
ALTER TABLE retrieval_runs ADD COLUMN query_vector double precision[];

ALTER TABLE text_anchors
 ALTER COLUMN space_id DROP NOT NULL, ALTER COLUMN subject_card_id DROP NOT NULL,
 ALTER COLUMN chapter_card_id DROP NOT NULL, ALTER COLUMN role SET DEFAULT 'reference',
 ADD COLUMN book_id uuid, ADD COLUMN chapter_document_id uuid, ADD COLUMN body_version_id uuid,
 ADD COLUMN label text NOT NULL DEFAULT '', ADD COLUMN start_offset integer, ADD COLUMN end_offset integer,
 ADD COLUMN excerpt text, ADD COLUMN fragment_hash char(64),
 ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale','archived'));
ALTER TABLE text_anchors DROP CONSTRAINT text_anchors_role_check;
ALTER TABLE text_anchors ADD CONSTRAINT text_anchor_shape CHECK(
 (body_version_id IS NULL AND book_id IS NULL AND chapter_document_id IS NULL
 AND space_id IS NOT NULL AND subject_card_id IS NOT NULL AND chapter_card_id IS NOT NULL
 AND role IN ('plant','reveal','evidence','mention')
 AND start_offset IS NULL AND end_offset IS NULL AND excerpt IS NULL AND fragment_hash IS NULL)
 OR(body_version_id IS NOT NULL AND book_id IS NOT NULL AND chapter_document_id IS NOT NULL
 AND space_id IS NULL AND chapter_card_id IS NULL AND scene_card_id IS NULL
 AND role IN ('reference','evidence','mention','plant','reveal')
 AND start_offset IS NOT NULL AND end_offset IS NOT NULL AND start_offset>=0 AND end_offset>start_offset
 AND excerpt IS NOT NULL AND fragment_hash IS NOT NULL AND fragment_hash ~ '^[a-f0-9]{64}$'
 AND fragment_hash=encode(sha256(convert_to(excerpt,'UTF8')),'hex')));
ALTER TABLE text_anchors ADD CONSTRAINT text_anchor_book_fkey FOREIGN KEY(book_id) REFERENCES books(id);
ALTER TABLE text_anchors ADD CONSTRAINT text_anchor_document_fkey FOREIGN KEY(chapter_document_id) REFERENCES chapter_documents(id);
ALTER TABLE text_anchors ADD CONSTRAINT text_anchor_body_fkey FOREIGN KEY(body_version_id) REFERENCES chapter_body_versions(id);
DROP INDEX new_design.text_anchors_subject_role_unique;
CREATE UNIQUE INDEX text_anchors_subject_role_unique ON new_design.text_anchors(space_id,subject_card_id,role) WHERE body_version_id IS NULL;
CREATE INDEX text_anchor_body_subject_idx ON new_design.text_anchors(book_id,body_version_id,subject_card_id) WHERE body_version_id IS NOT NULL;
CREATE INDEX record_card_type_current_idx ON new_design.cards(card_type_id,current_version_id) WHERE status='active';
CREATE INDEX record_card_values_idx ON new_design.cards USING gin(values jsonb_path_ops);
CREATE INDEX record_card_logical_id_idx ON new_design.cards(card_type_id,(values->>'id'));
CREATE INDEX card_action_owner_kind_idx ON new_design.card_version_actions(card_id,action_key,created_at,id);
CREATE UNIQUE INDEX kernel_card_type_version_owner ON new_design.card_type_versions(id,card_type_id);
ALTER TABLE cards ADD CONSTRAINT cards_current_version_owner_fk
 FOREIGN KEY(current_version_id,id) REFERENCES card_versions(id,card_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE card_types ADD CONSTRAINT card_types_current_version_owner_fk
 FOREIGN KEY(current_version_id,id) REFERENCES card_type_versions(id,card_type_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE cards ADD CONSTRAINT cards_type_version_owner_fk
 FOREIGN KEY(type_version_id,card_type_id) REFERENCES card_type_versions(id,card_type_id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX kernel_record_logical_identity ON new_design.cards(space_id,card_type_id,(values->>'id')) WHERE values ? 'id';
