/** One read-only projection. JSON carries only bounded public provenance, not domain payloads. */
export const AUTHOR_TASK_SOURCE_QUERY=`
SELECT 'ai_task'::text kind,task.id,'execution'::text domain,task.book_id,task.status,
 contract.name title,task.updated_at,task.source_route route,NULL::integer progress,
 jsonb_build_object('requestKey',task.request_idempotency_key,'step',task.current_step_key,
 'saved',EXISTS(SELECT 1 FROM new_design.ai_task_attempts a WHERE a.task_id=task.id AND a.result_version_id IS NOT NULL),
 'leaseExpired',EXISTS(SELECT 1 FROM new_design.ai_task_steps step WHERE step.task_id=task.id AND step.status='running' AND step.lease_expires_at<=now())) meta
FROM new_design.ai_tasks task JOIN new_design.task_contract_versions version ON version.id=task.task_contract_version_id
JOIN new_design.task_contracts contract ON contract.id=version.contract_id
WHERE NOT EXISTS(SELECT 1 FROM new_design.chapter_writing_requests r WHERE r.ai_task_id=task.id)
AND NOT EXISTS(SELECT 1 FROM new_design.chapter_proposal_extraction_requests r WHERE r.ai_task_id=task.id)
UNION ALL
SELECT 'creation_session',s.id,'creation',s.book_id,s.status,NULLIF(s.book_name,''),s.updated_at,
 '/new-design/books/new?session='||s.id::text,s.progress,
 jsonb_build_object('stage',COALESCE(s.last_failed_stage,s.stage),'saved',true,'bookId',s.book_id,'activeCommand',s.director_active_command_key IS NOT NULL,
 'manual',s.input_payload->'creationDirector'->>'mode'='manual','requestKey',COALESCE(s.director_active_command_key,s.director_command_failure->>'requestKey'))
FROM new_design.book_creation_sessions s
UNION ALL
SELECT 'creation_batch',b.id,'creation',COALESCE(b.book_id,s.book_id),
 COALESCE(b.preparation_terminal,b.status),COALESCE(NULLIF(s.book_name,''),'开书候选'),b.updated_at,
 '/new-design/books/new?session='||s.id::text,NULL::integer,
 jsonb_build_object('requestKey',b.preparation_request_key,'stage',b.stage,'sessionId',s.id,
 'saved',b.preparation_generated_output IS NOT NULL,'reviewSaved',b.output_payload<>'{}'::jsonb,
 'superseded',b.preparation_superseded_by IS NOT NULL,'failure',b.preparation_failure IS NOT NULL,'leaseExpired',b.preparation_lease_until<=now())
FROM new_design.ai_generation_batches b JOIN new_design.book_creation_sessions s ON s.id=b.session_id
WHERE b.preparation_contract='creation_preparation_v1'
UNION ALL
SELECT 'planning_run',r.id,'planning',r.book_id,r.status,'AI 规划候选',COALESCE(r.completed_at,r.created_at),
 '/new-design/books/'||r.book_id::text||'/planning'||COALESCE('#plan-'||COALESCE(r.result_object_id,r.target_object_id)::text,''),NULL::integer,
 jsonb_build_object('saved',r.result_version_id IS NOT NULL,'resultId',r.result_version_id)
FROM new_design.planning_ai_candidate_runs r
UNION ALL
SELECT 'planning_review',o.id,'planning',o.book_id,'review',o.title,o.updated_at,
 '/new-design/books/'||o.book_id::text||'/planning#plan-'||o.id::text,NULL::integer,
 jsonb_build_object('saved',true,'resultId',o.current_version_id,'manual',v.source='manual')
FROM new_design.planning_objects o JOIN new_design.planning_versions v ON v.id=o.current_version_id
WHERE o.status='active' AND v.status IN ('draft','proposed') AND o.current_version_id IS DISTINCT FROM o.adopted_version_id
UNION ALL
SELECT 'production_director',run.id,'writing',run.book_id,run.status,'全书生产导演',
 GREATEST(run.updated_at,COALESCE(summary.latest_request_at,run.updated_at)),
 '/new-design/books/'||run.book_id::text||'/director?run='||run.id::text,
 CASE WHEN summary.total_count>0 THEN (summary.candidate_count*100/summary.total_count)::integer ELSE NULL::integer END,
 jsonb_build_object('requestKey',run.request_key,'saved',summary.candidate_count>0 OR summary.reply_count>0,
 'stage','production_director','targetCount',summary.total_count,'candidateCount',summary.candidate_count,
 'modelReplyCount',summary.reply_count,'ledgerPendingCount',summary.ledger_pending_count,'boundaryPendingCount',summary.boundary_pending_count,
 'replyPendingCount',summary.reply_pending_count,'warningCount',summary.warning_count,
 'unknownRequestCount',summary.unknown_count,'failedRequestCount',summary.failed_count,
 'endedUnknownCount',summary.ended_unknown_count,
 'failedChapterTitle',summary.failed_chapter_title,
 'leaseExpired',run.lease_expires_at IS NOT NULL AND run.lease_expires_at<=now(),'exact',true)
FROM new_design.production_director_runs run CROSS JOIN LATERAL (
 SELECT count(*) total_count,count(*) FILTER(WHERE request.result_body_version_id IS NOT NULL) candidate_count,
 count(*) FILTER(WHERE request.controlled_output IS NOT NULL) reply_count,
 count(*) FILTER(WHERE request.result_body_version_id IS NOT NULL AND step.status IS DISTINCT FROM 'succeeded') ledger_pending_count,
 count(*) FILTER(WHERE request.result_body_version_id IS NOT NULL AND NOT chapter.boundary_completed) boundary_pending_count,
 count(*) FILTER(WHERE request.controlled_output IS NOT NULL AND request.result_body_version_id IS NULL) reply_pending_count,
 count(*) FILTER(WHERE request.status IN ('failed','cancelled','stale','unavailable')) failed_count,
 count(*) FILTER(WHERE request.status='running' AND request.controlled_output IS NULL AND step.status='running' AND step.lease_expires_at<=now()) unknown_count,
 count(*) FILTER(WHERE request.status='cancelled' AND request.controlled_output IS NULL AND attempt.status='discarded' AND attempt.error_category='unknown') ended_unknown_count,
 COALESCE(sum(CASE WHEN jsonb_typeof(request.controlled_output->'warnings')='array' THEN jsonb_array_length(request.controlled_output->'warnings') ELSE 0 END),0) warning_count,
 (array_agg(chapter.title ORDER BY chapter.sort_order) FILTER(WHERE request.status IN ('failed','cancelled','stale','unavailable')))[1] failed_chapter_title,
 max(request.updated_at) latest_request_at
 FROM new_design.production_director_chapters chapter
 LEFT JOIN new_design.chapter_writing_requests request ON request.id=chapter.current_request_id AND request.book_id=chapter.book_id
 LEFT JOIN new_design.ai_task_steps step ON step.task_id=request.ai_task_id AND step.step_key='generate_candidate'
 LEFT JOIN new_design.ai_task_attempts attempt ON attempt.id=step.current_attempt_id AND attempt.task_id=request.ai_task_id AND attempt.step_id=step.id
 WHERE chapter.run_id=run.id AND chapter.book_id=run.book_id
) summary
UNION ALL
SELECT 'writing_request',r.id,'writing',r.book_id,r.status,'章节正文候选',r.updated_at,
 '/new-design/books/'||r.book_id::text||'/writing?chapterDocument='||r.chapter_document_id::text,NULL::integer,
 jsonb_build_object('requestKey',r.idempotency_key,'saved',r.result_body_version_id IS NOT NULL OR r.controlled_output IS NOT NULL,
 'baseline',r.input_body_version_id,'resultId',r.result_body_version_id,
 'modelReplySaved',r.controlled_output IS NOT NULL,'candidateSaved',r.result_body_version_id IS NOT NULL,
 'ledgerPending',r.result_body_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM new_design.ai_task_steps step WHERE step.task_id=r.ai_task_id AND step.step_key='generate_candidate' AND step.status='succeeded'),
 'warningCount',CASE WHEN jsonb_typeof(r.controlled_output->'warnings')='array' THEN jsonb_array_length(r.controlled_output->'warnings') ELSE 0 END,
 'endedUnknown',r.status='cancelled' AND r.controlled_output IS NULL AND EXISTS(SELECT 1 FROM new_design.ai_task_steps step JOIN new_design.ai_task_attempts attempt ON attempt.id=step.current_attempt_id AND attempt.task_id=r.ai_task_id AND attempt.step_id=step.id WHERE step.task_id=r.ai_task_id AND step.step_key='generate_candidate' AND attempt.status='discarded' AND attempt.error_category='unknown'),
 'leaseExpired',EXISTS(SELECT 1 FROM new_design.ai_task_steps step WHERE step.task_id=r.ai_task_id AND step.status='running' AND step.lease_expires_at<=now()))
FROM new_design.chapter_writing_requests r
UNION ALL
SELECT 'settlement_session',s.id,'writing',s.book_id,s.status,'章节采用与结算',s.updated_at,
 '/new-design/books/'||s.book_id::text||'/writing?chapterDocument='||s.chapter_document_id::text||'&session='||s.id::text,NULL::integer,
 jsonb_build_object('requestKey',s.idempotency_key,'saved',true,'resultId',s.body_version_id,'settlementId',s.settlement_id)
FROM new_design.chapter_adoption_sessions s
UNION ALL
SELECT 'settlement_extraction',r.id,'writing',r.book_id,r.status,'AI 整理章节变化',r.updated_at,
 '/new-design/books/'||r.book_id::text||'/writing?chapterDocument='||s.chapter_document_id::text||'&session='||s.id::text,NULL::integer,
 jsonb_build_object('requestKey',r.idempotency_key,'saved',r.generated_output IS NOT NULL,'resultId',r.body_version_id,
 'leaseExpired',EXISTS(SELECT 1 FROM new_design.ai_task_steps step WHERE step.task_id=r.ai_task_id AND step.status='running' AND step.lease_expires_at<=now()))
FROM new_design.chapter_proposal_extraction_requests r JOIN new_design.chapter_adoption_sessions s ON s.id=r.session_id
UNION ALL
SELECT 'research_version',v.id,'research',NULL::uuid,v.run_status,r.title,COALESCE(v.completed_at,v.created_at),
 '/new-design/research/records?record='||r.id::text||'&version='||v.id::text,v.progress,
 jsonb_build_object('saved',v.report<>'' OR v.structured_result<>'{}'::jsonb,'recordId',r.id,'resultId',v.id)
FROM new_design.research_record_versions v JOIN new_design.research_records r ON r.id=v.record_id WHERE r.status='active'
UNION ALL
SELECT 'research_adoption',a.id,'research',a.book_id,a.status,'本书研究资料采用',a.updated_at,
 '/new-design/research/reference-packs?book='||a.book_id::text||'&adoption='||a.id::text,NULL::integer,
 jsonb_build_object('requestKey',a.idempotency_key,'saved',true,'resultId',a.source_id)
FROM new_design.book_research_adoption_batches a
UNION ALL
SELECT 'export_request',r.id,'publication',r.book_id,CASE WHEN artifact.id IS NOT NULL THEN 'succeeded' ELSE COALESCE(job.status,'unknown') END,
 '作品导出',COALESCE(artifact.created_at,job.updated_at,r.created_at),
 '/new-design/books/'||r.book_id::text||'/completion?export='||r.id::text,NULL::integer,
 jsonb_build_object('requestKey',r.idempotency_key,'saved',true,'artifactId',artifact.id,'resultId',r.manifest_id)
FROM new_design.publication_export_requests r LEFT JOIN new_design.background_jobs job ON job.id=r.job_id
LEFT JOIN new_design.publication_export_artifacts artifact ON artifact.request_id=r.id
UNION ALL
SELECT 'completion_check',c.id,'publication',snapshot.book_id,CASE c.severity WHEN 'blocker' THEN 'failed' ELSE 'warning' END,
 c.title,c.created_at,COALESCE(NULLIF(c.source_route,''),'/new-design/books/'||snapshot.book_id::text||'/completion'),NULL::integer,
 jsonb_build_object('saved',true,'resultId',snapshot.id,'exact',false)
FROM new_design.book_completion_check_results c JOIN new_design.book_completion_snapshots snapshot ON snapshot.id=c.snapshot_id
WHERE c.severity IN ('blocker','warning') AND snapshot.id=(SELECT latest.id FROM new_design.book_completion_snapshots latest WHERE latest.book_id=snapshot.book_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
UNION ALL
SELECT 'quality_issue',q.id,'quality',q.book_id,CASE WHEN q.current_status IN ('fixed','verified') THEN 'completed' ELSE 'warning' END,
 v.title,q.updated_at,task.source_route,NULL::integer,
 jsonb_build_object('saved',true,'qualityDebt',q.is_quality_debt,'manual',v.detection_source='manual','resultId',v.id,'exact',false)
FROM new_design.quality_issues q JOIN new_design.quality_issue_versions v ON v.id=q.current_version_id
JOIN new_design.quality_audit_reports report ON report.id=q.report_id JOIN new_design.ai_tasks task ON task.id=report.task_id
WHERE q.current_status IN ('open','acknowledged','deferred','fix_proposed','fixed','verified')
`;
