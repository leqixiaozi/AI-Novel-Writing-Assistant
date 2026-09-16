const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../migrations/057_dependency_bridge_record_guards.sql'),'utf8');
test('dependency bridge selects actual table and operation before reading table-specific records',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION bridge_dependency_change_events\(\)/);
  assert.match(sql,/SET search_path TO new_design, ag_catalog, public/);
  assert.match(sql,/CASE TG_TABLE_NAME/);
  assert.doesNotMatch(sql,/(?:IF|ELSIF)\s+TG_TABLE_NAME[^\n]*(?:NEW|OLD)\./);
  assert.match(sql,/WHEN 'chapter_settlements' THEN\s+IF TG_OP='INSERT' THEN[\s\S]*?ELSIF TG_OP='UPDATE' THEN\s+IF NEW\.status IS DISTINCT FROM OLD\.status THEN/);
  assert.match(sql,/WHEN 'quality_audit_reports' THEN\s+IF TG_OP='UPDATE' THEN\s+IF OLD\.stale_at IS NULL AND NEW\.stale_at IS NOT NULL THEN/);
  for(const table of ['chapter_body_adoptions','planning_adoptions','canonical_fact_review_actions','knowledge_state_review_actions','story_time_review_actions','story_relation_review_actions','ai_contract_publications'])assert.ok(sql.includes(`WHEN '${table}' THEN\n    IF TG_OP='INSERT' THEN`),table);
});
test('additive bridge repair preserves original invalidation branches without replacing triggers or data',()=>{
  const original=fs.readFileSync(path.join(__dirname,'../migrations/026_dependency_invalidation_ledger.sql'),'utf8').split('CREATE FUNCTION bridge_dependency_change_events()')[1].split('CREATE TRIGGER')[0];
  const calls=text=>text.match(/PERFORM invalidate_registered_resource\([^;]+;/g);
  assert.deepEqual(calls(sql),calls(original));
  assert.doesNotMatch(sql,/\b(?:DROP|DELETE|TRUNCATE|DISABLE\s+TRIGGER)\b/i);
  assert.doesNotMatch(sql,/CREATE\s+TRIGGER/i);
  const registration=fs.readFileSync(path.join(__dirname,'../src/server/database/migrations.ts'),'utf8');
  assert.ok(registration.includes('057_dependency_bridge_record_guards.sql'));
});
test('database-only commands use acknowledged physical rollback, never a missing receipt, as the no-write proof',()=>{
  const commands=fs.readFileSync(path.join(__dirname,'../src/server/database/chapterSettlement/editingCommands.ts'),'utf8');
  assert.ok(commands.includes('if(committing||!rolledBack)throw'));
  assert.ok(commands.includes('if(committing||!rollback)throw'));
  assert.doesNotMatch(commands,/if\(committing\|\|!rolledBack\|\|!\(error instanceof NewDesignError\)\)/);
  assert.ok(commands.includes('服务器已确认回滚'));
  const policy=fs.readFileSync(path.join(__dirname,'../src/server/database/chapterSettlement/relationConfiguration/policy.ts'),'utf8');
  assert.ok(policy.includes('if(rolledBack&&!committing)'));
  assert.ok(policy.includes('wrapped.recovery.mutationOutcome="not_written"'));
});
