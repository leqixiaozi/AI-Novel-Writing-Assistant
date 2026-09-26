/** All counts are pre-aggregated by book: joining independent ledgers never multiplies facts. */
export const HOME_BOOKS_QUERY = `WITH
records AS (
 SELECT COALESCE((version.values->>'id')::uuid,card.id) id,type.type_key,version.values payload,
 COALESCE((version.values->>'created_at')::timestamptz,card.created_at) created_at,
 COALESCE((version.values->>'updated_at')::timestamptz,card.updated_at) updated_at
 FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active'
),
plan_heads AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,(payload->>'card_id')::uuid card_id,(payload->>'parent_object_id')::uuid parent_object_id,payload->>'level' level,(payload->>'adopted_version_id')::uuid adopted_version_id,payload->>'status' status FROM records WHERE type_key='planning_object'),
plan_history AS (SELECT id,created_at,updated_at,(payload->>'object_id')::uuid object_id,(payload->>'book_id')::uuid book_id,(payload->>'based_on_parent_version_id')::uuid based_on_parent_version_id,payload->>'status' status,(payload->>'stale_at')::timestamptz stale_at,payload->>'content_hash' content_hash FROM records WHERE type_key='planning_version'),
writing_claims AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,(payload->>'chapter_document_id')::uuid chapter_document_id,payload->>'status' status,(payload->>'result_body_version_id')::uuid result_body_version_id FROM records WHERE type_key='chapter_writing_request'),
plan_refs AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,(payload->>'planning_version_id')::uuid planning_version_id,(payload->>'card_version_id')::uuid card_version_id,(payload->>'card_id')::uuid card_id FROM records WHERE type_key='planning_version_reference'),
checkpoints AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,(payload->>'chapter_document_id')::uuid chapter_document_id,(payload->>'body_version_id')::uuid body_version_id,payload->>'status' status FROM records WHERE type_key='chapter_stable_checkpoint'),
fact_records AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,payload->>'status' status FROM records WHERE type_key='canonical_fact'),
adoption_sessions AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id FROM records WHERE type_key='chapter_adoption_session'),
issue_records AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,payload->>'current_status' current_status FROM records WHERE type_key='quality_issue'),
dependency_states AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,payload->>'state' state FROM records WHERE type_key='dependency_resource_state'),
recompute_records AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,payload->>'status' status,payload->>'strategy_key' strategy_key FROM records WHERE type_key='dependency_recompute_request'),
director_runs AS (SELECT id,created_at,updated_at,(payload->>'book_id')::uuid book_id,payload->>'status' status,(payload->>'lease_expires_at')::timestamptz lease_expires_at FROM records WHERE type_key='production_director_run'),
director_chapters AS (SELECT id,created_at,updated_at,(payload->>'run_id')::uuid run_id,(payload->>'book_id')::uuid book_id,(payload->>'chapter_card_id')::uuid chapter_card_id,(payload->>'current_request_id')::uuid current_request_id FROM records WHERE type_key='production_director_chapter'),
active_books AS (SELECT id,space_id,name,description,created_at,updated_at FROM new_design.books WHERE status='active'),
formal_cards AS (
 SELECT book.id book_id,card.id,card.values,type.type_key,type.status type_status,version.fields
 FROM active_books book JOIN new_design.cards card ON card.space_id=book.space_id AND card.status='active'
 JOIN new_design.card_types type ON type.id=card.card_type_id AND NOT type.is_internal
 LEFT JOIN new_design.card_type_versions version ON version.id=type.current_version_id
),
card_counts AS (SELECT book_id,count(*) card_count,count(*) FILTER(WHERE type_key='character') character_count,
 count(*) FILTER(WHERE type_key='world_overview') world_count FROM formal_cards GROUP BY book_id),
field_counts AS (
 SELECT card.book_id,count(*) required_field_count,
 count(*) FILTER(WHERE card.values ? (field->>'key') AND card.values->(field->>'key') NOT IN ('null'::jsonb,'""'::jsonb,'[]'::jsonb)) filled_required_field_count
 FROM formal_cards card CROSS JOIN LATERAL jsonb_array_elements(COALESCE(card.fields,'[]'::jsonb)) field
 WHERE card.type_status='published' AND field->>'required'='true' AND COALESCE(field->>'key','')<>'' GROUP BY card.book_id
),
plans AS (
 SELECT object.id,object.book_id,object.card_id,object.parent_object_id,object.level,object.adopted_version_id,
 version.based_on_parent_version_id,
 (version.id IS NOT NULL AND version.status='adopted' AND version.stale_at IS NULL AND version.content_hash IS NOT NULL) valid
 FROM plan_heads object JOIN active_books book ON book.id=object.book_id
 LEFT JOIN plan_history version ON version.id=object.adopted_version_id AND version.object_id=object.id AND version.book_id=object.book_id
 WHERE object.status='active'
),
plan_counts AS (SELECT book_id,count(*) FILTER(WHERE level='story' AND valid) story_plan_count,
 count(*) FILTER(WHERE level='volume' AND valid) volume_plan_count,count(*) FILTER(WHERE level='chapter') chapter_plan_count,
 count(*) FILTER(WHERE level='chapter' AND valid) adopted_chapter_plan_count FROM plans GROUP BY book_id),
scene_counts AS (SELECT book_id,parent_object_id,count(*) total,bool_and(valid) valid FROM plans WHERE level='scene' GROUP BY book_id,parent_object_id),
writable_counts AS (
 SELECT chapter.book_id,count(*) writable_chapter_plan_count FROM plans chapter
 JOIN active_books book ON book.id=chapter.book_id
 JOIN plans volume ON volume.id=chapter.parent_object_id AND volume.book_id=chapter.book_id AND volume.level='volume' AND volume.valid
 JOIN plans story ON story.id=volume.parent_object_id AND story.book_id=chapter.book_id AND story.level='story' AND story.valid AND story.parent_object_id IS NULL
 JOIN new_design.cards card ON card.id=chapter.card_id AND card.space_id=book.space_id AND card.status='active'
 JOIN new_design.card_versions card_version ON card_version.id=card.current_version_id AND card_version.card_id=card.id
 LEFT JOIN scene_counts scenes ON scenes.parent_object_id=chapter.id AND scenes.book_id=chapter.book_id
 WHERE chapter.level='chapter' AND chapter.valid AND chapter.based_on_parent_version_id=volume.adopted_version_id
 AND COALESCE(scenes.total,0)<=297 AND COALESCE(scenes.valid,true)
 AND NOT EXISTS(SELECT 1 FROM new_design.chapter_documents document WHERE document.book_id=chapter.book_id AND document.chapter_card_id=chapter.card_id AND document.status='active' AND document.adopted_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM writing_claims request JOIN new_design.chapter_documents document ON document.id=request.chapter_document_id WHERE document.book_id=chapter.book_id AND document.chapter_card_id=chapter.card_id AND request.status IN ('preparing','queued','running'))
 AND (SELECT count(*) FROM new_design.cards material JOIN new_design.card_types material_type ON material_type.id=material.card_type_id AND NOT material_type.is_internal JOIN new_design.card_versions current_version ON current_version.id=material.current_version_id WHERE material.space_id=book.space_id AND material.status='active')<=300
 AND (SELECT count(*) FROM plan_refs reference WHERE reference.book_id=book.id
   AND (reference.planning_version_id IN (chapter.adopted_version_id,volume.adopted_version_id,story.adopted_version_id)
     OR reference.planning_version_id IN (SELECT scene.adopted_version_id FROM plans scene WHERE scene.book_id=book.id AND scene.parent_object_id=chapter.id AND scene.level='scene')))<=300
 AND NOT EXISTS(SELECT 1 FROM plan_refs reference WHERE reference.book_id=book.id
   AND (reference.planning_version_id IN (chapter.adopted_version_id,volume.adopted_version_id,story.adopted_version_id)
     OR reference.planning_version_id IN (SELECT scene.adopted_version_id FROM plans scene WHERE scene.book_id=book.id AND scene.parent_object_id=chapter.id AND scene.level='scene'))
   AND NOT EXISTS(SELECT 1 FROM new_design.card_versions exact JOIN new_design.cards material ON material.id=exact.card_id
     WHERE exact.id=reference.card_version_id AND exact.card_id=reference.card_id AND material.space_id=book.space_id AND material.status='active'))
 GROUP BY chapter.book_id
),
body_counts AS (
 SELECT document.book_id,count(*) written_chapter_count,count(*) FILTER(WHERE EXISTS(
 SELECT 1 FROM checkpoints checkpoint WHERE checkpoint.book_id=document.book_id
 AND checkpoint.chapter_document_id=document.id AND checkpoint.body_version_id=document.adopted_version_id AND checkpoint.status='stable')) stable_chapter_count
 FROM new_design.chapter_documents document JOIN active_books book ON book.id=document.book_id
 JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id
 WHERE document.status='active' AND body.archived_at IS NULL AND length(btrim(body.content))>0 GROUP BY document.book_id
),
fact_counts AS (SELECT book_id,count(*) pending_facts FROM fact_records WHERE status='proposed' GROUP BY book_id),
change_counts AS (SELECT session.book_id,count(*) pending_changes FROM new_design.chapter_settlement_items item JOIN adoption_sessions session ON session.id=item.session_id WHERE item.decision IN ('pending','defer') GROUP BY session.book_id),
issue_counts AS (SELECT book_id,count(*) open_quality_issues FROM issue_records WHERE current_status IN ('open','acknowledged','deferred','fix_proposed') GROUP BY book_id),
stale_counts AS (SELECT book_id,count(*) stale_resources FROM dependency_states WHERE state IN ('stale','invalid','needs_review','recompute_pending','recomputing') GROUP BY book_id),
manual_review_counts AS (SELECT book_id,count(*) pending_dependency_reviews FROM recompute_records WHERE status='pending' AND strategy_key='manual_review' GROUP BY book_id),
task_counts AS (SELECT book_id,count(*) FILTER(WHERE status='running') running_tasks,count(*) FILTER(WHERE status IN ('queued','retry_scheduled')) queued_tasks,count(*) FILTER(WHERE status IN ('waiting_approval','paused')) waiting_tasks FROM new_design.ai_tasks GROUP BY book_id),
latest_tasks AS (SELECT DISTINCT ON (book_id) book_id,id,status,source_route,updated_at FROM new_design.ai_tasks ORDER BY book_id,updated_at DESC,id DESC),
latest_directors AS (SELECT DISTINCT ON (book_id) book_id,id,status,lease_expires_at FROM director_runs ORDER BY book_id,created_at DESC,id DESC),
director_counts AS (SELECT director.id,count(chapter.chapter_card_id) chapter_count,count(*) FILTER(WHERE request.result_body_version_id IS NOT NULL) saved_candidate_count
 FROM latest_directors director LEFT JOIN director_chapters chapter ON chapter.run_id=director.id AND chapter.book_id=director.book_id
 LEFT JOIN writing_claims request ON request.id=chapter.current_request_id AND request.book_id=director.book_id GROUP BY director.id)
SELECT book.*,cards.card_count,cards.character_count,cards.world_count,fields.required_field_count,fields.filled_required_field_count,
 plans.story_plan_count,plans.volume_plan_count,plans.chapter_plan_count,plans.adopted_chapter_plan_count,writable.writable_chapter_plan_count,
 bodies.written_chapter_count,bodies.stable_chapter_count,facts.pending_facts,changes.pending_changes,issues.open_quality_issues,stale.stale_resources,manual_reviews.pending_dependency_reviews,
 tasks.running_tasks,tasks.queued_tasks,tasks.waiting_tasks,
 task.id task_id,task.status task_status,task.source_route task_source_route,task.updated_at task_updated_at,
 director.id director_id,director.status director_status,
 (director.status='running' AND director.lease_expires_at IS NOT NULL AND director.lease_expires_at<=CURRENT_TIMESTAMP) director_lease_expired,
 director_counts.chapter_count director_chapter_count,director_counts.saved_candidate_count director_saved_candidate_count
FROM active_books book
LEFT JOIN card_counts cards ON cards.book_id=book.id LEFT JOIN field_counts fields ON fields.book_id=book.id
LEFT JOIN plan_counts plans ON plans.book_id=book.id LEFT JOIN writable_counts writable ON writable.book_id=book.id
LEFT JOIN body_counts bodies ON bodies.book_id=book.id LEFT JOIN fact_counts facts ON facts.book_id=book.id
LEFT JOIN change_counts changes ON changes.book_id=book.id LEFT JOIN issue_counts issues ON issues.book_id=book.id
LEFT JOIN stale_counts stale ON stale.book_id=book.id LEFT JOIN manual_review_counts manual_reviews ON manual_reviews.book_id=book.id LEFT JOIN task_counts tasks ON tasks.book_id=book.id
LEFT JOIN latest_tasks task ON task.book_id=book.id LEFT JOIN latest_directors director ON director.book_id=book.id
LEFT JOIN director_counts ON director_counts.id=director.id ORDER BY book.updated_at DESC,book.id DESC`;

/** Select just the structured director metadata, never the source manuscript or full input payload. */
export const HOME_CREATION_QUERY = `SELECT COALESCE((version.values->>'id')::uuid,card.id) id,
 version.values->>'book_name' book_name,version.values->>'status' status,version.values->>'stage' stage,
 (version.values->>'progress')::integer progress,version.values->>'selected_direction_id' selected_direction_id,
 version.values->'input_payload'->'creationDirector' director_state,
 COALESCE((version.values->>'updated_at')::timestamptz,card.updated_at) updated_at
 FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='book_creation_session'
 JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 WHERE card.status='active' AND version.values->>'book_id' IS NULL AND version.values->>'status'<>'completed'
 ORDER BY updated_at DESC,id DESC LIMIT 1`;
