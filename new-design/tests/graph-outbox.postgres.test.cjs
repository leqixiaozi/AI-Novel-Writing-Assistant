const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { isolatedDatabase, compiled } = require("./support/isolatedDatabase.cjs");

test("graph Outbox builds the first generation and drains earlier incremental requests", { timeout: 180000 }, async t => {
  if (!process.env.ND_REFERENCE_TEST_BUILD) { t.skip("Requires isolated final build"); return; }
  require.resolve("../dist/server/graph/outboxHandler.js");
  const { pool } = await isolatedDatabase(t);
  const templates = compiled("server/database/templateStore");
  const cards = compiled("server/database/store");
  const author = compiled("server/database/authorMaterials");
  const dependencies = compiled("server/database/dependencies");
  const graph = compiled("server/database/graph");
  const { BackgroundJobRunner } = compiled("server/database/outbox");
  const { createGraphProjectionBackgroundHandlers } = compiled("server/graph/outboxHandler");

  let template = await templates.saveTemplate({ key: `graph_${randomUUID().replaceAll("-", "")}`, name: "Graph test template", description: "", draftConfig: {}, requestKey: randomUUID() });
  template = await templates.publishTemplate(template.id, template.revision, randomUUID());
  const book = await templates.createBook({ key: `graph_${randomUUID().replaceAll("-", "")}`, name: "Graph test book", description: "", templateVersionId: template.currentVersionId });
  const types = await cards.listCardTypes(book.spaceId);
  const material = await author.createAuthorMaterial(book.id, { requestKey: randomUUID(), cardTypeId: types.find(item => item.key === "chapter").id, title: "First chapter", values: { chapter_name: "First chapter", chapter_goal: "Reach the station" } });
  await dependencies.registerDependencyResource({resourceKind:"card_version",stableObjectId:material.card.id,exactVersionId:material.cardVersionId});
  const before = await pool.query("SELECT count(*)::int n FROM new_design.background_jobs WHERE book_id=$1 AND handler_key='graph.project' AND status='queued'", [book.id]);
  assert.ok(before.rows[0].n > 0);

  const runner = new BackgroundJobRunner("runtime.graph-project", `isolated-${randomUUID()}`, createGraphProjectionBackgroundHandlers());
  let drained = false;
  for (let i = 0; i < 20; i++) { if (!(await runner.runOnce())) { drained = true; break; } }
  assert.equal(drained, true);
  const health = await graph.getGraphProjectionHealth(book.id);
  assert.ok(health.state.activeGenerationId);
  assert.equal(health.pendingRequests, 0);
  const after = await pool.query("SELECT status,count(*)::int n FROM new_design.background_jobs WHERE book_id=$1 AND handler_key='graph.project' GROUP BY status", [book.id]);
  assert.equal(after.rows.some(row => ["queued", "retry_scheduled", "dead_letter"].includes(row.status)), false);

  const second = await author.createAuthorMaterial(book.id, { requestKey: randomUUID(), cardTypeId: types.find(item => item.key === "chapter").id, title: "Second chapter", values: { chapter_name: "Second chapter", chapter_goal: "Leave the station" } });
  await dependencies.registerDependencyResource({resourceKind:"card_version",stableObjectId:second.card.id,exactVersionId:second.cardVersionId});
  const interrupted = (await pool.query("SELECT id FROM new_design.graph_projection_requests WHERE book_id=$1 AND source_id=$2",[book.id,second.card.id])).rows[0];
  assert.ok(interrupted);
  await pool.query("UPDATE new_design.graph_projection_requests SET status='processing',attempt_count=1,started_at=now() WHERE id=$1",[interrupted.id]);
  const interruptedBatchId=randomUUID();
  await pool.query("INSERT INTO new_design.graph_projection_batches(id,request_id,book_id,generation_id,mode) VALUES($1,$2,$3,$4,'incremental')",[interruptedBatchId,interrupted.id,book.id,health.state.activeGenerationId]);
  for(let i=0;i<10;i++){if(!(await runner.runOnce()))break;}
  const recovered=(await pool.query("SELECT status,attempt_count FROM new_design.graph_projection_requests WHERE id=$1",[interrupted.id])).rows[0];
  const oldBatch=(await pool.query("SELECT status FROM new_design.graph_projection_batches WHERE id=$1",[interruptedBatchId])).rows[0];
  assert.equal(recovered.status,"succeeded");
  assert.equal(recovered.attempt_count,2);
  assert.equal(oldBatch.status,"failed");

  const orphanBook=await templates.createBook({ key: `graph_${randomUUID().replaceAll("-", "")}`, name: "Interrupted graph book", description: "", templateVersionId: template.currentVersionId });
  const orphanTypes=await cards.listCardTypes(orphanBook.spaceId);
  const orphan=await author.createAuthorMaterial(orphanBook.id,{requestKey:randomUUID(),cardTypeId:orphanTypes.find(item=>item.key==="chapter").id,title:"Orphan chapter",values:{chapter_name:"Orphan chapter",chapter_goal:"Recover graph"}});
  await dependencies.registerDependencyResource({resourceKind:"card_version",stableObjectId:orphan.card.id,exactVersionId:orphan.cardVersionId});
  const generationId=randomUUID(),fullRequestId=randomUUID(),fullBatchId=randomUUID();
  await pool.query("INSERT INTO new_design.graph_projection_generations(id,book_id,generation,mapping_version) VALUES($1,$2,1,1)",[generationId,orphanBook.id]);
  await pool.query("INSERT INTO new_design.graph_projection_requests(id,book_id,generation_id,request_kind,reason,idempotency_key,status,attempt_count,started_at) VALUES($1,$2,$3,'full_rebuild','Interrupted test',$4,'processing',1,now())",[fullRequestId,orphanBook.id,generationId,randomUUID()]);
  await pool.query("INSERT INTO new_design.graph_projection_batches(id,request_id,book_id,generation_id,mode) VALUES($1,$2,$3,$4,'full_rebuild')",[fullBatchId,fullRequestId,orphanBook.id,generationId]);
  for(let i=0;i<10;i++){if(!(await runner.runOnce()))break;}
  const orphanState=await graph.getGraphProjectionHealth(orphanBook.id);
  assert.ok(orphanState.state.activeGenerationId);
  assert.notEqual(orphanState.state.activeGenerationId,generationId);
  assert.equal((await pool.query("SELECT status FROM new_design.graph_projection_generations WHERE id=$1",[generationId])).rows[0].status,"failed");
  assert.equal((await pool.query("SELECT status FROM new_design.graph_projection_batches WHERE id=$1",[fullBatchId])).rows[0].status,"failed");

  const archivedMaterial=await author.createAuthorMaterial(orphanBook.id,{requestKey:randomUUID(),cardTypeId:orphanTypes.find(item=>item.key==="chapter").id,title:"Archived chapter",values:{chapter_name:"Archived chapter",chapter_goal:"Archive test"}});
  await dependencies.registerDependencyResource({resourceKind:"card_version",stableObjectId:archivedMaterial.card.id,exactVersionId:archivedMaterial.cardVersionId});
  await pool.query("UPDATE new_design.books SET status='archived' WHERE id=$1",[orphanBook.id]);
  for(let i=0;i<10;i++){if(!(await runner.runOnce()))break;}
  assert.equal((await pool.query("SELECT status FROM new_design.graph_projection_requests WHERE book_id=$1 AND source_id=$2",[orphanBook.id,archivedMaterial.card.id])).rows[0].status,"superseded");

  const fullOnlyBook=await templates.createBook({key:`graph_${randomUUID().replaceAll("-","")}`,name:"Full recovery book",description:"",templateVersionId:template.currentVersionId});
  const fullOnlyGeneration=randomUUID(),fullOnlyRequest=randomUUID();
  await pool.query("INSERT INTO new_design.graph_projection_generations(id,book_id,generation,mapping_version) VALUES($1,$2,1,1)",[fullOnlyGeneration,fullOnlyBook.id]);
  await pool.query("INSERT INTO new_design.graph_projection_requests(id,book_id,generation_id,request_kind,reason,idempotency_key,status,attempt_count,started_at) VALUES($1,$2,$3,'full_rebuild','Interrupted full only',$4,'processing',1,now())",[fullOnlyRequest,fullOnlyBook.id,fullOnlyGeneration,randomUUID()]);
  await pool.query("INSERT INTO new_design.graph_projection_batches(id,request_id,book_id,generation_id,mode) VALUES($1,$2,$3,$4,'full_rebuild')",[randomUUID(),fullOnlyRequest,fullOnlyBook.id,fullOnlyGeneration]);
  for(let i=0;i<10;i++){if(!(await runner.runOnce()))break;}
  const fullOnlyState=await graph.getGraphProjectionHealth(fullOnlyBook.id);
  assert.ok(fullOnlyState.state.activeGenerationId);
  assert.notEqual(fullOnlyState.state.activeGenerationId,fullOnlyGeneration);
});
