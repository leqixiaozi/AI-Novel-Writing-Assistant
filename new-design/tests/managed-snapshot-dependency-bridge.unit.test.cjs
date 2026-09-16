const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const sql=fs.readFileSync(path.join(__dirname,"../migrations/060_managed_snapshot_dependency_bridge.sql"),"utf8");
const previous=fs.readFileSync(path.join(__dirname,"../migrations/037_context_binding_assembly_snapshots.sql"),"utf8");
const compact=value=>value.replace(/--[^\n]*/g,"").replace(/\s+/g," ").trim();
test("additive managed dependency repair keeps existing function OIDs and all triggers enabled",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION resolve_dependency_resource\(/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION bridge_dependency_creation\(\)/);
 assert.doesNotMatch(sql,/\b(?:DROP|ALTER)\s+(?:TRIGGER|FUNCTION)\b|DISABLE\s+TRIGGER/i);
 assert.equal((sql.match(/SET search_path TO new_design, ag_catalog, public/g)||[]).length,2);
 const registry=fs.readFileSync(path.join(__dirname,"../src/server/database/migrations.ts"),"utf8");
 assert.match(registry,/id: "060_managed_snapshot_dependency_bridge", fileName: "060_managed_snapshot_dependency_bridge.sql"/);
});
test("managed resolver uses exact persisted identity and hash without manufacturing book scope",()=>{
 const branch=sql.slice(sql.indexOf("IF requested_kind='model_route_snapshot'"),sql.indexOf("ELSIF requested_kind='context_binding_version'"));
 assert.match(branch,/snapshot.id=requested_stable_id AND snapshot.id=requested_version_id/);
 assert.match(branch,/snapshot.book_id IS NULL AND snapshot.task_contract_version_id IS NULL/);
 assert.match(branch,/SELECT NULL::uuid,NULL::uuid,snapshot.snapshot_hash/);
 assert.match(branch,/snapshot.managed_task_key IN \('directions','initial_content','form_assist','market_analysis','book_analysis','planning_candidate','chapter_settlement'\)/);
 assert.match(branch,/resolve_dependency_resource_pre037\(requested_kind,requested_stable_id,requested_version_id\)/);
 assert.doesNotMatch(branch,/gen_random_uuid|dependency_content_hash|INSERT INTO books|INSERT INTO task_contract/i);
});
test("only true pre-book managed snapshots bypass absent task contract; legacy bridge remains exact",()=>{
 const branch=sql.slice(sql.indexOf("ELSIF TG_TABLE_NAME='model_route_snapshots'"),sql.indexOf("ELSIF TG_TABLE_NAME='ai_task_attempts'"));
 assert.match(branch,/IF NEW.managed_task_key IS NOT NULL AND NEW.book_id IS NULL AND NEW.task_contract_version_id IS NULL THEN/);
 assert.match(branch,/PERFORM register_dependency_resource\('model_route_snapshot',NEW.id,NEW.id\)/);
 const beforeElse=branch.slice(0,branch.indexOf("    ELSE"));
 assert.doesNotMatch(beforeElse,/add_registered_dependency\(/);
 const original=previous.slice(previous.indexOf("ELSIF TG_TABLE_NAME='model_route_snapshots'"),previous.indexOf("ELSIF TG_TABLE_NAME='ai_task_attempts'"));
 const legacy=branch.slice(branch.indexOf("    ELSE")+8,branch.lastIndexOf("    END IF;"));
 assert.equal(compact(legacy),compact(original.slice(original.indexOf("THEN")+4)));
});
test("all other creation bridges and latest resolver cases remain unchanged",()=>{
 const marker="  ELSIF TG_TABLE_NAME='ai_task_attempts'";
 const tail=value=>value.slice(value.indexOf(marker),value.indexOf("END $$;",value.indexOf(marker))+8);
 assert.equal(compact(tail(sql)),compact(tail(previous)));
 const from="requested_kind='context_binding_version'",to="CREATE OR REPLACE FUNCTION bridge_dependency_creation";
 const resolverTail=value=>value.slice(value.indexOf(from),value.indexOf(to));
 assert.equal(compact(resolverTail(sql)),compact(resolverTail(previous)));
 const start="  IF TG_TABLE_NAME='context_manifests'",end="  ELSIF TG_TABLE_NAME='model_route_snapshots'";
 const head=value=>{const owner=value.indexOf('CREATE OR REPLACE FUNCTION bridge_dependency_creation');assert.ok(owner>=0);const offset=value.indexOf(start,owner);assert.ok(offset>=owner);return value.slice(offset,value.indexOf(end,offset));};
 assert.equal(compact(head(sql)),compact(head(previous)));
});
