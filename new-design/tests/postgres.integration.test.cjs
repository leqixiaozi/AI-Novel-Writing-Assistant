const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

process.env.NEW_DESIGN_DATA_DIR = path.resolve(
  __dirname,
  `../.data/integration-postgres/run-${Date.now()}-${process.pid}`,
);
delete process.env.NEW_DESIGN_DATABASE_URL;

const runtime = require("../dist/server/database/runtime.js");
const store = require("../dist/server/database/store.js");
const composition = require("../dist/server/database/compositionStore.js");
const templates = require("../dist/server/database/templateStore.js");
const bookCreation = require("../dist/server/database/bookCreationStore.js");
const categoriesStore = require("../dist/server/database/categoryStore.js");
const resources = require("../dist/server/database/resourceStore.js");
const bookViews = require("../dist/server/database/bookViewStore.js");
const changeSets = require("../dist/server/database/changeSetStore.js");
const research = require("../dist/server/database/researchStore.js");
const market = require("../dist/server/database/marketStore.js");
const bookAnalysis = require("../dist/server/database/bookAnalysisStore.js");
const referencePacks = require("../dist/server/database/referencePackStore.js");
const chapterBodies = require("../dist/server/database/chapterBodyStore.js");
const facts = require("../dist/server/database/factStore.js");
const states = require("../dist/server/database/stateStore.js");
const knowledge = require("../dist/server/database/knowledgeStore.js");
const storyTimeline = require("../dist/server/database/storyTimeline/index.js");
const planning = require("../dist/server/database/planning/index.js");
const aiContracts = require("../dist/server/database/aiContracts/index.js");
const aiTasks = require("../dist/server/database/aiTasks/index.js");
const qualityAudits = require("../dist/server/database/qualityAudits/index.js");
const bookAnalysisService = require("../dist/server/research/bookAnalysisService.js");
const { validateCardValues } = require("../dist/server/domain/validation.js");

function personFields() {
  return [
    { key: "name", name: "姓名", description: "人物姓名", type: "short_text", required: true, defaultValue: null, options: [], group: "基本信息", order: 0 },
    { key: "story_role", name: "人物定位", description: "故事职责", type: "short_text", required: true, defaultValue: null, options: [], group: "故事职责", order: 1 },
    { key: "personality", name: "性格", description: "性格特点", type: "long_text", required: false, defaultValue: null, options: [], group: "人物内核", order: 2 },
    { key: "age", name: "年龄", description: "当前年龄", type: "number", required: false, defaultValue: null, options: [], group: "基本信息", order: 3 },
  ];
}

test("portable PostgreSQL persists the complete card slice across restart", async (t) => {
  t.after(async () => { await runtime.stopNewDesignDatabase(); });

  const status = await runtime.getDatabaseRuntimeStatus();
  assert.equal(status.mode, "bundled");
  assert.match(status.postgresVersion, /^17\./);
  assert.notEqual(status.port, 5432);

  let researchDocument = await research.createResearchDocument({ title:"集成测试参考文本",sourceKind:"paste",sourceUrl:"user-owned-test",content:"第一章 山门夜雨。沈砚在旧钟楼发现一枚裂纹铜铃，由此卷入失踪案。" });
  assert.equal(researchDocument.currentVersion.version,1);
  researchDocument = await research.addResearchDocumentVersion(researchDocument.id,{content:"第一章 山门夜雨。沈砚在旧钟楼发现一枚裂纹铜铃。第二章 铜铃指向封存十年的失踪案。",revision:researchDocument.revision});
  assert.equal(researchDocument.currentVersion.version,2);
  assert.equal(researchDocument.versionCount,2);
  const researchClient = await (await runtime.getNewDesignPool()).connect();
  let foundationRun;
  try {
    await researchClient.query("BEGIN");
    foundationRun = await research.createResearchRun(researchClient,{type:"book_analysis",title:"集成测试拆书记录",sourceDocumentVersionId:researchDocument.currentVersion.id,sourceScope:{mode:"full"},templateKey:"book_analysis.quick",templateVersion:1,budgetTokens:3000,inputSnapshot:{purpose:"reference"}});
    await research.setResearchRunState(researchClient,foundationRun.versionId,{status:"completed",progress:100,usedTokens:180,structuredResult:{overview:"测试结论"},report:"# 测试拆书\n\n持久化报告。"});
    await researchClient.query("COMMIT");
  } catch (error) {
    await researchClient.query("ROLLBACK");
    throw error;
  } finally { researchClient.release(); }
  let foundationRecord = await research.getResearchRecord(foundationRun.recordId);
  assert.equal(foundationRecord.currentVersion.runStatus,"completed");
  foundationRecord = {...foundationRecord,...await research.updateResearchRecord(foundationRecord.id,{title:foundationRecord.title,tags:["测试","可恢复"],favorite:true,notes:"验证研究元数据。",revision:foundationRecord.revision})};
  assert.equal(foundationRecord.favorite,true);
  const persistedResearchId = foundationRecord.id;

  const builtInTypes = await store.listCardTypes();
  const systemTypes = builtInTypes.filter((cardType) => cardType.isSystem);
  assert.equal(systemTypes.length, 31);
  assert.equal(new Set(systemTypes.map((cardType) => cardType.key)).size, 31);
  for (const key of ["character", "organization", "world_rule", "event", "volume", "scene", "genre_strategy", "progression_mode", "writing_config", "quality_rule", "reference_material", "world_overview", "power_system", "race", "culture", "religion", "prompt_component", "market_signal"]) {
    assert.ok(systemTypes.some((cardType) => cardType.key === key), `missing built-in type ${key}`);
  }
  assert.ok(!systemTypes.some((cardType) => ["base_character", "historical_event", "timeline"].includes(cardType.key)));
  const categories = await categoriesStore.listCardTypeCategories();
  assert.deepEqual(categories.map((category) => category.name), ["创作策略", "人物与组织", "世界设定", "剧情结构", "篇章结构", "参考资料", "AI 资源"]);
  assert.ok(systemTypes.every((cardType) => cardType.categoryId));
  assert.deepEqual(
    systemTypes.find((cardType) => cardType.key === "event").semanticCapabilities,
    ["timeline", "state_change", "canonical_fact"],
  );
  const scanSource={platform:"qidian",platformLabel:"起点中文网",listKey:"test",listLabel:"集成榜",channel:"male",sourceUrl:"https://example.test/rank"};
  const marketRun=await market.beginMarketScan({sources:[scanSource]});
  await market.persistMarketSource(marketRun.versionId,scanSource,{items:[{rank:1,title:"问剑山河",author:"测试作者",category:"仙侠",tags:["成长"],synopsis:"少年查明山门旧案。",heatLabel:"榜首",serialStatus:"连载中",sourceUrl:"https://example.test/book/1"}]},95);
  await market.finishMarketScan(marketRun.versionId);
  const marketScan=await market.getMarketScan(marketRun.recordId);
  assert.equal(marketScan.record.currentVersion.runStatus,"completed");
  assert.equal(marketScan.snapshots[0].items[0].title,"问剑山河");
  assert.equal(marketScan.snapshots[0].items[0].listLabel,"集成榜");
  assert.equal(marketScan.snapshots[0].items[0].evidenceTier,"supporting");
  const failedRefresh=await market.beginMarketScan({sources:[scanSource],recordId:marketRun.recordId,parentVersionId:marketRun.versionId});
  await market.persistMarketSource(failedRefresh.versionId,scanSource,{error:"测试来源暂时不可用"},95);
  await market.finishMarketScan(failedRefresh.versionId);
  assert.equal((await market.getMarketScan(marketRun.recordId)).record.currentVersion.runStatus,"failed");
  const previousMarketScan=await market.getMarketScan(marketRun.recordId,marketRun.versionId);
  assert.equal(previousMarketScan.isCurrent,false);
  assert.equal(previousMarketScan.snapshots[0].items[0].title,"问剑山河");
  const marketAnalysisRun=await market.beginMarketAnalysis({scanRecordId:marketRun.recordId,scanVersionId:marketRun.versionId,itemIds:[marketScan.snapshots[0].items[0].id],focus:"仙侠成长",budgetTokens:3000});
  await market.completeMarketAnalysis(marketAnalysisRun.versionId,{genre:["仙侠"],protagonistIdentities:["山门少年"],coreAdvantages:["成长解谜"],openingPatterns:["旧案切入"],relationshipHooks:["师徒互疑"],titlePatterns:["意象加动作"],readerPayoffs:["升级与真相"],crowdedTropes:["天才觉醒"],differentiationOpportunities:["代价式突破"],evidenceBoundary:"仅基于一条测试榜单元数据，不能判断真实销量和跨期趋势。",signals:[{title:"仙侠成长解谜信号",signalType:"genre",summary:"仙侠升级与旧案解谜可以并行。",heat:"medium",crowding:"high",trend:"uncertain",platforms:["qidian"],audience:"喜欢升级与真相回收的读者",differentiation:"让每次突破付出会改变查案路径的代价",sourceRefs:"起点中文网／集成榜／问剑山河",observedAt:"2026-09-15",effectiveUntil:"2026-10-15"}]},{usedTokens:240,promptSnapshot:{promptId:"new_design.research.market_analysis",promptVersion:"v1"},modelSnapshot:{provider:"test",model:"test-model"}});
  const marketAnalysis=await research.getResearchRecord(marketAnalysisRun.recordId);
  assert.equal(marketAnalysis.candidates.length,1);
  const adoptedMarketSignal=await market.adoptMarketSignal(marketAnalysis.candidates[0].id);
  assert.equal(adoptedMarketSignal.values.trend,"uncertain");
  const persistedMarketSignalId=adoptedMarketSignal.id;
  assert.deepEqual(
    systemTypes.find((cardType) => cardType.key === "scene").semanticCapabilities,
    ["body_text", "timeline", "state_change", "creative_goal"],
  );
  const promptType = systemTypes.find((cardType) => cardType.key === "prompt_component");
  assert.ok(promptType);
  assert.deepEqual(promptType.draftFields.map((field) => field.key), ["component_key", "component_type", "content", "task_families", "binding_status", "edit_policy", "trust_level", "enabled", "notes"]);
  assert.deepEqual(promptType.draftFields.find((field) => field.key === "component_type").options.map((option) => option.value), ["system_role", "task_instruction", "business_constraint", "creative_strategy_reference", "writing_reference", "quality_rule_reference", "context_instruction", "output_requirement", "example", "optional_addition"]);

  const promptSpaceId = "63000000-0000-4000-8000-000000000001";
  const promptSeeds = await store.listCards({ cardTypeId: promptType.id, spaceId: promptSpaceId });
  assert.deepEqual(promptSeeds.map((card) => card.title).sort(), ["严格依据已确认事实", "只返回表单 Schema", "避免擅自新增设定", "长篇小说创作助手角色"].sort());
  const promptVersion = (await store.listCardTypeVersions(promptType.id))[0];
  assert.ok(promptSeeds.every((card) => Object.keys(validateCardValues(promptVersion.fields, card.values).issues).length === 0));
  let customPrompt = await store.createCard({
    cardTypeId: promptType.id,
    spaceId: promptSpaceId,
    title: "集成测试组件",
    values: { component_key: "test.integration_component", component_type: "example", content: "仅用于验证动态表单持久化。", task_families: ["form_card"], binding_status: "not_applicable", edit_policy: "editable", trust_level: "editor_trusted", enabled: true, notes: "测试后随临时数据库销毁。" },
  });
  customPrompt = await store.updateCard(customPrompt.id, { ...customPrompt, values: { ...customPrompt.values, content: "已完成一次版本修订。" } });
  customPrompt = await store.archiveCard(customPrompt.id, customPrompt.revision);
  assert.equal(customPrompt.status, "archived");
  assert.equal((await store.listCardVersions(customPrompt.id)).length, 3);
  customPrompt = await store.restoreCard(customPrompt.id, customPrompt.revision);
  assert.equal(customPrompt.status, "active");

  const starterCards = await store.listCards({});
  for (const title of ["主世界观", "主线时间规则", "新书创作约定", "核心故事构思"]) {
    assert.ok(starterCards.some((card) => card.title === title));
  }

  const books = await templates.listBooks();
  const sampleBook = books.find((book) => book.name === "照骨山河");
  assert.ok(sampleBook);
  const bookTypes = await store.listCardTypes(sampleBook.spaceId);
  const demoCards = await store.listCards({ spaceId: sampleBook.spaceId });
  assert.equal(demoCards.length, 55);
  assert.equal(bookTypes.length, 19);
  assert.ok(demoCards.every((card) => !card.title.startsWith("《照骨山河》")));
  assert.deepEqual(
    [...new Set(demoCards.map((card) => bookTypes.find((type) => type.id === card.cardTypeId)?.key))].sort(),
    systemTypes.filter((cardType)=>["character", "organization", "location", "prop", "world_rule", "event", "goal_task", "conflict", "secret_truth", "clue_evidence", "foreshadow", "suspense_question", "plotline", "plot_beat", "arc", "theme", "volume", "chapter", "scene"].includes(cardType.key)).map((cardType) => cardType.key).sort(),
  );
  for (const cardType of bookTypes) {
    const currentVersion = (await store.listCardTypeVersions(cardType.id)).find((version) => version.id === cardType.currentVersionId);
    assert.ok(currentVersion, `missing current version for ${cardType.key}`);
    for (const card of demoCards.filter((candidate) => candidate.cardTypeId === cardType.id)) {
      assert.deepEqual(validateCardValues(currentVersion.fields, card.values).issues, {}, `${card.title} should match ${cardType.key}`);
    }
  }

  const referencePlan = await bookAnalysisService.buildBookAnalysisPlan("reference_learning", "quick");
  const continuationPlan = await bookAnalysisService.buildBookAnalysisPlan("continuation", "standard");
  const diagnosisPlan = await bookAnalysisService.buildBookAnalysisPlan("diagnosis", "full");
  assert.ok(referencePlan.plan.targets.some((target) => target.typeKey === "genre_strategy"));
  assert.ok(referencePlan.plan.targets.every((target) => ["genre_strategy", "progression_mode", "writing_config", "quality_rule", "reference_material"].includes(target.typeKey)));
  assert.ok(continuationPlan.plan.targets.some((target) => target.typeKey === "character"));
  assert.ok(!continuationPlan.plan.targets.some((target) => ["prompt_component", "market_signal"].includes(target.typeKey)));
  assert.equal(diagnosisPlan.plan.candidateLimit, 0);
  assert.deepEqual(diagnosisPlan.plan.targets, []);

  const analysisRun = await bookAnalysis.beginBookAnalysisRun({
    title:"集成测试证据化拆书",
    type:"book_analysis",
    sourceDocumentVersionId:researchDocument.currentVersion.id,
    sourceScope:{documentId:researchDocument.id,documentVersionId:researchDocument.currentVersion.id,rangeMode:"range",startOffset:3,endOffset:researchDocument.currentVersion.characterCount},
    plan:continuationPlan.plan,
    focus:"提炼可复用的仙侠成长方法",
    budgetTokens:3000,
  });
  const dimensionKeys = ["story_structure","characters","world","conflict","pacing","hooks_payoffs","writing_technique","quality_risks"];
  const strategyValues = (promise) => ({genre:"仙侠成长",subgenres:["growth","mystery"],target_audience:"喜欢成长解谜的读者",core_promise:promise,market_position:"每次突破都解开一层旧案",forbidden_drift:"不复制原作专有名称"});
  const analysisCharacterSeed = demoCards.find((card)=>bookTypes.find((type)=>type.id===card.cardTypeId)?.key==="character");
  assert.ok(analysisCharacterSeed);
  await bookAnalysis.completeBookAnalysis(analysisRun.versionId,{
    overview:"以铜铃旧案承载成长兑现，结论仅提炼结构方法。",
    dimensions:dimensionKeys.map((key,index)=>({key,title:`维度 ${index+1}`,summary:"根据所选文本形成的结构观察。",strengths:["线索与成长同步"],risks:["样本较短"],opportunities:["扩展可验证的阶段回报"]})),
    evidence:[{fieldPath:"candidates[0].core_promise",excerpt:"铜铃指向封存十年的失踪案",startOffset:30,endOffset:44,certainty:"explicit",note:"原文直接支持旧案推进。"}],
    candidates:[
      {targetTypeKey:"character",title:"续写候选人物",values:{...analysisCharacterSeed.values},evidenceIndexes:[0],confidence:.86},
      {targetTypeKey:"character",title:"续写人物合并补充",values:{...analysisCharacterSeed.values,personality:"谨慎追查铜铃旧案，并在每次选择后承担可见代价"},evidenceIndexes:[0],confidence:.8},
      {targetTypeKey:"genre_strategy",title:"可复用旧案策略",values:strategyValues("局部答案与长期谜团交替兑现"),evidenceIndexes:[0],confidence:.78},
      {targetTypeKey:"genre_strategy",title:"低置信度备选",values:strategyValues("只作备选，不进入正式资料"),evidenceIndexes:[0],confidence:.4},
    ],
    copyrightBoundary:"只学习抽象结构，不复制原文表达、角色和专有设定。",
  },{usedTokens:360,promptSnapshot:{promptId:"new_design.research.book_analysis",promptVersion:"v1"},modelSnapshot:{provider:"test",model:"test-model"}});
  let analysisRecord = await research.getResearchRecord(analysisRun.recordId);
  assert.equal(analysisRecord.currentVersion.runStatus,"completed");
  assert.equal(analysisRecord.evidence.length,1);
  assert.equal(analysisRecord.candidates.length,4);
  assert.ok(analysisRecord.candidates.every((candidate)=>candidate.researchVersionId===analysisRun.versionId));
  const candidatesByTitle = new Map(analysisRecord.candidates.map((candidate)=>[candidate.title,candidate]));
  const originalCandidate=candidatesByTitle.get("续写候选人物");
  const editedCandidate=await bookAnalysis.updateResearchCandidate(analysisRecord.id,originalCandidate.id,{title:"续写候选人物（已校订）",values:{...originalCandidate.values,personality:"用户校订后的谨慎性格"},expectedRevision:originalCandidate.revision,actor:"integration-test",note:"AI 自动入库后由用户修改。"});
  assert.equal(editedCandidate.revision,2);
  assert.equal(editedCandidate.values.personality,"用户校订后的谨慎性格");
  assert.equal((await (await runtime.getNewDesignPool()).query("SELECT count(*)::int AS count FROM new_design.research_candidate_versions WHERE candidate_id=$1",[editedCandidate.id])).rows[0].count,2);
  const createOutput = await bookAnalysis.applyCandidateDecisions(analysisRecord.id,[{candidateId:editedCandidate.id,action:"create_card",targetSpaceId:sampleBook.spaceId}]);
  const persistedAnalysisCardId = createOutput[0].cardId;
  assert.ok(persistedAnalysisCardId);
  let analysisCard = await store.getCard(persistedAnalysisCardId);
  await bookAnalysis.applyCandidateDecisions(analysisRecord.id,[{candidateId:candidatesByTitle.get("续写人物合并补充").id,action:"merge_card",targetCardId:analysisCard.id,expectedRevision:analysisCard.revision}]);
  analysisCard = await store.getCard(persistedAnalysisCardId);
  assert.equal(analysisCard.revision,2);
  assert.equal(analysisCard.values.personality,"谨慎追查铜铃旧案，并在每次选择后承担可见代价");
  const mergedOrigin = await (await runtime.getNewDesignPool()).query("SELECT source_kind,source_id FROM new_design.card_field_origins WHERE card_id=$1 AND field_key='personality'",[analysisCard.id]);
  assert.deepEqual(mergedOrigin.rows[0],{source_kind:"research",source_id:analysisRun.versionId});
  await bookAnalysis.applyCandidateDecisions(analysisRecord.id,[
    {candidateId:candidatesByTitle.get("可复用旧案策略").id,action:"save_resource",targetSpaceId:"60000000-0000-4000-8000-000000000001"},
    {candidateId:candidatesByTitle.get("低置信度备选").id,action:"ignore"},
  ]);
  analysisRecord = await research.getResearchRecord(analysisRun.recordId);
  assert.deepEqual(new Set(analysisRecord.candidates.map((candidate)=>candidate.status)),new Set(["adopted","ignored"]));

  const directResearchPreview=await referencePacks.previewResearchReuse({templateVersionId:(await templates.listTemplateVersions((await templates.listTemplates()).find((item)=>item.name==="通用长篇小说模板").id))[0].id,researchVersionIds:[analysisRun.versionId],packVersionIds:[],includeTemplateSeed:false});
  assert.ok(directResearchPreview.suggestedCards.some((item)=>item.title==="可复用旧案策略"));
  let referencePack=await referencePacks.publishReferencePack({name:"仙侠旧案研究包",description:"锁定可复用的结构研究版本。",note:"首次发布",items:[{researchVersionId:analysisRun.versionId,purpose:"book_creation",weight:1,note:"用于开书预填"}]});
  const lockedPackVersionId=referencePack.currentVersionId;
  referencePack=await referencePacks.publishReferencePack({id:referencePack.id,name:referencePack.name,description:referencePack.description,note:"第二版说明",revision:referencePack.revision,items:[{researchVersionId:analysisRun.versionId,purpose:"book_creation",weight:1.2,note:"提高参考权重"}]});
  assert.equal(referencePack.versionCount,2);
  assert.equal(referencePack.versions[1].id,lockedPackVersionId);

  const dictionaries = await composition.listDictionaries(sampleBook.spaceId);
  const relationTypes = await composition.listRelationTypes(sampleBook.spaceId);
  const forms = await composition.listCardGroupForms(sampleBook.spaceId);
  assert.equal(dictionaries.length, 3);
  assert.equal(relationTypes.length, 5);
  assert.ok(relationTypes.some((item) => item.key === "character_relationship"));
  assert.equal(forms.length, 1);
  const eventForm = forms[0];
  const formVersions = await composition.listCardGroupFormVersions(eventForm.id);
  assert.equal(formVersions.length, 1);

  const byTitle = new Map(demoCards.map((card) => [card.title, card]));
  const event = byTitle.get("殓舟夜泊白水驿");
  const character = byTitle.get("沈照微");
  const location = byTitle.get("白水驿");
  const prop = byTitle.get("照骨灯");
  const plotline = byTitle.get("主线：照骨灯与父亲旧案");
  assert.ok(event && character && location && prop && plotline);
  const originalCharacter = structuredClone(character.values);
  let formInstance = await composition.saveFormInstance({
    spaceId: sampleBook.spaceId,
    formVersionId: formVersions[0].id,
    primaryCardId: event.id,
    title: "殓舟逆水归驿 · 事件规划",
    mounts: [
      { slotKey: "participants", cardId: character.id, sortOrder: 0, localValues: { goal: "确认父亲旧案是否重现", stance: "先救镇民再交证据", result: "被迫点灯" } },
      { slotKey: "location", cardId: location.id, sortOrder: 0, localValues: {} },
      { slotKey: "props", cardId: prop.id, sortOrder: 0, localValues: { usage: "照见尸体与地脉旧伤" } },
      { slotKey: "plotline", cardId: plotline.id, sortOrder: 0, localValues: {} },
    ],
  });
  assert.equal(formInstance.mounts.length, 4);
  assert.equal((await composition.listFormInstances(formInstance.spaceId, eventForm.id)).length, 1);
  formInstance.mounts.find((mount) => mount.slotKey === "participants").localValues.result = "失去一段味觉记忆";
  formInstance = await composition.saveFormInstance(formInstance);
  assert.equal(formInstance.revision, 2);
  assert.deepEqual((await store.getCard(character.id)).values, originalCharacter);
  const relationRows = await (await runtime.getNewDesignPool()).query("SELECT status,properties FROM new_design.card_relations WHERE space_id=$1", [formInstance.spaceId]);
  assert.equal(relationRows.rows.filter((row) => row.status === "active").length, 4);
  assert.equal(relationRows.rows.filter((row) => row.status === "archived").length, 4);

  await assert.rejects(
    () => composition.saveFormInstance({ ...formInstance, mounts: formInstance.mounts.filter((mount) => mount.slotKey !== "location") }),
    (error) => Boolean(error.status === 422),
  );

  let viewWorkspace = await bookViews.getBookViewWorkspace(sampleBook.id);
  assert.deepEqual(viewWorkspace.viewConfigs.map((item) => item.key).sort(), ["chapters", "characters", "clues", "events", "resources", "world"]);
  const viewEvents = viewWorkspace.cards.filter((card) => card.typeKey === "event");
  const viewEvent = viewEvents[0];
  const viewChapters = viewWorkspace.cards.filter((card) => card.typeKey === "chapter");
  const viewVolumes = viewWorkspace.cards.filter((card) => card.typeKey === "volume");
  const viewScenes = viewWorkspace.cards.filter((card) => card.typeKey === "scene");
  const viewCharacters = viewWorkspace.cards.filter((card) => card.typeKey === "character");
  const viewClue = viewWorkspace.cards.find((card) => ["clue_evidence", "foreshadow"].includes(card.typeKey));
  assert.ok(viewEvents.length >= 4 && viewVolumes.length >= 1 && viewChapters.length >= 2 && viewScenes.length >= 1 && viewCharacters.length >= 2 && viewClue);

  let chapterDocument=await chapterBodies.createChapterDocument({bookId:sampleBook.id,chapterCardId:viewChapters[0].id,logicalOrder:1,title:"第一章正文"});
  const manualBody=await chapterBodies.addChapterBodyVersion(chapterDocument.id,{content:"沈照微在白水驿点亮照骨灯。",source:"manual",createdByKind:"user",createdBy:"integration-test"});
  const firstAdoptionKey=`chapter-adopt-${Date.now()}-manual`;
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:manualBody.id,expectedRevision:chapterDocument.revision,idempotencyKey:firstAdoptionKey,actor:"integration-test"});
  const manualAnchor=await chapterBodies.createChapterTextAnchor({bodyVersionId:manualBody.id,startOffset:0,endOffset:3,excerpt:"沈照微",label:"主角首次出现",role:"character_appearance",subjectCardId:viewCharacters[0].id});
  assert.equal(manualAnchor.isStale,false);
  const candidateA=await chapterBodies.addChapterBodyVersion(chapterDocument.id,{content:"沈照微在夜雨中的白水驿点亮照骨灯，灯火映出旧案残痕。",source:"ai_candidate",parentVersionId:manualBody.id,baseVersionId:manualBody.id,createdByKind:"ai",createdBy:"integration-model-a"});
  const candidateB=await chapterBodies.addChapterBodyVersion(chapterDocument.id,{content:"白水驿夜雨如幕，沈照微点灯后看见了父亲留下的旧案残痕。",source:"ai_candidate",parentVersionId:manualBody.id,baseVersionId:manualBody.id,createdByKind:"ai",createdBy:"integration-model-b"});
  assert.equal((await chapterBodies.getChapterDocument(chapterDocument.id)).adoptedVersionId,manualBody.id);
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:candidateA.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-a`,actor:"integration-test"});
  const adoptionCount=chapterDocument.adoptions.length,adoptCandidateKey=chapterDocument.adoptions[0].idempotencyKey;
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:candidateA.id,expectedRevision:1,idempotencyKey:adoptCandidateKey,actor:"integration-test"});
  assert.equal(chapterDocument.adoptions.length,adoptionCount);
  assert.equal(chapterDocument.anchors.find((item)=>item.id===manualAnchor.id).isStale,true);
  const candidateAnchor=await chapterBodies.createChapterTextAnchor({bodyVersionId:candidateA.id,startOffset:8,endOffset:11,label:"地点落点",role:"location",subjectCardId:location.id});
  assert.equal(candidateAnchor.excerpt,"白水驿");
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:manualBody.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-rollback`,actor:"integration-test"});
  assert.equal(chapterDocument.adoptions[0].action,"rollback");
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:candidateB.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-b`,actor:"integration-test"});
  chapterDocument=await chapterBodies.archiveChapterBodyVersion(candidateA.id,{expectedRevision:chapterDocument.revision});
  assert.ok(chapterDocument.versions.find((item)=>item.id===candidateA.id).archivedAt);
  await assert.rejects(()=>chapterBodies.archiveChapterBodyVersion(candidateB.id,{expectedRevision:chapterDocument.revision}),(error)=>error.status===409&&/当前采用版本/.test(error.message));
  const persistedChapterDocumentId=chapterDocument.id;
  const factAnchorStart=candidateB.content.indexOf("沈照微"),factAnchor=await chapterBodies.createChapterTextAnchor({bodyVersionId:candidateB.id,startOffset:factAnchorStart,endOffset:factAnchorStart+3,label:"人物位置事实",role:"fact_evidence",subjectCardId:viewCharacters[0].id});
  let locationFact=await facts.proposeCanonicalFact({bookId:sampleBook.id,subjectCardId:viewCharacters[0].id,predicate:"current_location",valueKind:"text",value:"白水驿",validStoryStart:10,validStoryEnd:20,confidence:.82,sourceMethod:"ai_extract",createdBy:"integration-model",evidence:[{chapterTextAnchorId:factAnchor.id,extractionMethod:"ai_extract",note:"正文明确出现人物。"}]});
  assert.equal(locationFact.status,"proposed");
  let conflictingFact=await facts.proposeCanonicalFact({bookId:sampleBook.id,subjectCardId:viewCharacters[0].id,predicate:"current_location",valueKind:"text",value:"青石镇",validStoryStart:15,validStoryEnd:25,confidence:1,sourceMethod:"manual",createdBy:"integration-test",evidence:[{chapterTextAnchorId:factAnchor.id,extractionMethod:"manual",note:"用于验证冲突记录。"}]});
  let factConflicts=await facts.listFactConflicts(sampleBook.id);
  assert.equal(factConflicts.filter((item)=>item.status==="open").length,1);
  const confirmLocationKey=`confirm-location-${Date.now()}`;
  locationFact=await facts.reviewCanonicalFact(locationFact.id,{action:"confirm",expectedRevision:locationFact.revision,idempotencyKey:confirmLocationKey,actor:"integration-test"});
  locationFact=await facts.reviewCanonicalFact(locationFact.id,{action:"confirm",expectedRevision:1,idempotencyKey:confirmLocationKey,actor:"integration-test"});
  assert.equal(locationFact.status,"confirmed");
  conflictingFact=await facts.reviewCanonicalFact(conflictingFact.id,{action:"reject",expectedRevision:conflictingFact.revision,idempotencyKey:`reject-location-${Date.now()}`,actor:"integration-test"});
  assert.equal(conflictingFact.status,"rejected");
  factConflicts=await facts.listFactConflicts(sampleBook.id);
  await facts.resolveFactConflict(factConflicts[0].id,{action:"dismiss",expectedRevision:factConflicts[0].revision});
  let correctedFact=await facts.proposeCanonicalFact({bookId:sampleBook.id,subjectCardId:viewCharacters[0].id,predicate:"current_location",valueKind:"text",value:"白水驿地下灯窟",validStoryStart:10,validStoryEnd:20,confidence:1,sourceMethod:"manual",supersedesFactId:locationFact.id,createdBy:"integration-test",evidence:[{chapterTextAnchorId:factAnchor.id,extractionMethod:"manual",note:"人工修正到更精确位置。"}]});
  correctedFact=await facts.reviewCanonicalFact(correctedFact.id,{action:"confirm",expectedRevision:correctedFact.revision,idempotencyKey:`confirm-correction-${Date.now()}`,actor:"integration-test"});
  assert.equal((await facts.getCanonicalFact(locationFact.id)).status,"superseded");
  assert.equal(correctedFact.status,"confirmed");
  let pendingFact=await facts.proposeCanonicalFact({bookId:sampleBook.id,subjectCardId:viewCharacters[0].id,predicate:"holds_secret",valueKind:"boolean",value:true,confidence:.6,sourceMethod:"ai_extract",createdBy:"integration-model",evidence:[{chapterTextAnchorId:factAnchor.id,extractionMethod:"ai_extract",note:"等待人工核对。"}]});
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:manualBody.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-fact-stale`,actor:"integration-test"});
  pendingFact=await facts.getCanonicalFact(pendingFact.id);
  assert.equal(pendingFact.status,"stale");
  assert.ok(pendingFact.evidence[0].staleAt);
  assert.equal(pendingFact.reviewActions.at(-1).action,"mark_stale");
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:candidateB.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-fact-return`,actor:"integration-test"});
  pendingFact=await facts.getCanonicalFact(pendingFact.id);
  assert.equal(pendingFact.status,"stale");
  assert.equal(pendingFact.evidence[0].staleAt,null);
  const persistedCorrectedFactId=correctedFact.id,persistedPendingFactId=pendingFact.id;

  let storyPlan=await planning.createPlanningObject({bookId:sampleBook.id,level:"story",title:"照骨山河总计划",sortOrder:0,content:{premise:"守灯人追查父亲旧案",ending:"以失去记忆为代价照见真相"},source:"manual",createdBy:"integration-test"});
  assert.equal(storyPlan.currentVersion.status,"draft");
  const storyAdoptKey=`plan-story-adopt-${Date.now()}`;
  storyPlan=await planning.adoptPlanningVersion(storyPlan.id,{versionId:storyPlan.currentVersionId,expectedRevision:storyPlan.revision,idempotencyKey:storyAdoptKey,actor:"integration-test"});
  storyPlan=await planning.adoptPlanningVersion(storyPlan.id,{versionId:storyPlan.adoptedVersionId,expectedRevision:1,idempotencyKey:storyAdoptKey,actor:"integration-test"});
  storyPlan=await planning.adoptPlanningVersion(storyPlan.id,{versionId:storyPlan.adoptedVersionId,expectedRevision:storyPlan.revision,idempotencyKey:`plan-story-readopt-${Date.now()}`,actor:"integration-test"});
  assert.equal(storyPlan.adoptions[0].action,"readopt");
  let volumePlan=await planning.createPlanningObject({bookId:sampleBook.id,level:"volume",parentObjectId:storyPlan.id,cardId:viewVolumes[0].id,title:"第一卷计划",sortOrder:0,content:{goal:"进入无灯观",climax:"白水封镇"},source:"ai",basedOnParentVersionId:storyPlan.adoptedVersionId,createdBy:"integration-model"});
  assert.equal(volumePlan.currentVersion.status,"proposed");
  assert.equal(volumePlan.adoptedVersionId,null);
  volumePlan=await planning.addPlanningVersion(volumePlan.id,{content:{goal:"进入无灯观并确认旧案",climax:"白水封镇"},source:"manual",basedOnParentVersionId:storyPlan.adoptedVersionId,expectedRevision:volumePlan.revision,createdBy:"integration-test"});
  assert.equal(volumePlan.versions.length,2);
  await assert.rejects(()=>planning.addPlanningVersion(volumePlan.id,{content:{goal:"过期修改"},source:"manual",basedOnParentVersionId:storyPlan.adoptedVersionId,expectedRevision:1,createdBy:"integration-test"}),(error)=>error.status===409&&/其他位置/.test(error.message));
  volumePlan=await planning.adoptPlanningVersion(volumePlan.id,{versionId:volumePlan.currentVersionId,expectedRevision:volumePlan.revision,idempotencyKey:`plan-volume-adopt-${Date.now()}`,actor:"integration-test"});
  let chapterPlan=await planning.createPlanningObject({bookId:sampleBook.id,level:"chapter",parentObjectId:volumePlan.id,cardId:viewChapters[0].id,title:"第一章计划",sortOrder:0,content:{goal:"点灯发现旧案残痕"},source:"manual",basedOnParentVersionId:volumePlan.adoptedVersionId,createdBy:"integration-test"});
  chapterPlan=await planning.adoptPlanningVersion(chapterPlan.id,{versionId:chapterPlan.currentVersionId,expectedRevision:chapterPlan.revision,idempotencyKey:`plan-chapter-adopt-${Date.now()}`,actor:"integration-test"});
  let scenePlan=await planning.createPlanningObject({bookId:sampleBook.id,level:"scene",parentObjectId:chapterPlan.id,cardId:viewScenes[0].id,title:"第一场计划",sortOrder:0,content:{beat:"夜雨点灯"},source:"ai",basedOnParentVersionId:chapterPlan.adoptedVersionId,createdBy:"integration-model"});
  scenePlan=await planning.adoptPlanningVersion(scenePlan.id,{versionId:scenePlan.currentVersionId,expectedRevision:scenePlan.revision,idempotencyKey:`plan-scene-adopt-${Date.now()}`,actor:"integration-test"});
  const originalBodyPointer=(await chapterBodies.getChapterDocument(chapterDocument.id)).adoptedVersionId;
  chapterPlan=await planning.addPlanningVersion(chapterPlan.id,{content:{goal:"正文揭示父亲旧案残痕"},source:"body_revision",sourceBodyVersionId:candidateB.id,basedOnParentVersionId:volumePlan.adoptedVersionId,expectedRevision:chapterPlan.revision,createdBy:"integration-test"});
  chapterPlan=await planning.adoptPlanningVersion(chapterPlan.id,{versionId:chapterPlan.currentVersionId,expectedRevision:chapterPlan.revision,idempotencyKey:`plan-chapter-body-adopt-${Date.now()}`,actor:"integration-test"});
  assert.equal((await chapterBodies.getChapterDocument(chapterDocument.id)).adoptedVersionId,originalBodyPointer);
  assert.ok((await planning.listPlanningImpacts(sampleBook.id)).some((item)=>item.targetKind==="chapter_body"&&item.targetId===candidateB.id));
  assert.ok((await planning.listStalePlanningVersions(sampleBook.id)).some((item)=>item.id===scenePlan.adoptedVersionId));
  scenePlan=await planning.addPlanningVersion(scenePlan.id,{content:{beat:"夜雨点灯后确认旧案"},source:"manual",basedOnParentVersionId:chapterPlan.adoptedVersionId,expectedRevision:scenePlan.revision,createdBy:"integration-test"});
  scenePlan=await planning.adoptPlanningVersion(scenePlan.id,{versionId:scenePlan.currentVersionId,expectedRevision:scenePlan.revision,idempotencyKey:`plan-scene-refresh-${Date.now()}`,actor:"integration-test"});
  const adoptedScenePlanVersionId=scenePlan.adoptedVersionId;
  const sceneContext=await planning.getPlanningVersionContext(adoptedScenePlanVersionId);
  assert.deepEqual(sceneContext.ancestors.map((item)=>item.object.level),["story","volume","chapter"]);
  scenePlan=await planning.addPlanningVersion(scenePlan.id,{content:{beat:"待驳回候选"},source:"ai",basedOnParentVersionId:chapterPlan.adoptedVersionId,expectedRevision:scenePlan.revision,createdBy:"integration-model"});
  scenePlan=await planning.rejectPlanningVersion(scenePlan.id,{versionId:scenePlan.currentVersionId,expectedRevision:scenePlan.revision,actor:"integration-test"});
  assert.equal(scenePlan.currentVersion.status,"rejected");
  const planTree=await planning.getAdoptedPlanningTree(sampleBook.id);
  assert.equal(planTree.object.level,"story");
  assert.equal(planTree.children[0].children[0].children[0].object.level,"scene");
  const persistedStoryPlanId=storyPlan.id,persistedScenePlanVersionId=adoptedScenePlanVersionId;

  let narrative = await bookViews.saveNarrativePlacement(sampleBook.id, { subjectCardId:viewEvent.id,chapterCardId:viewChapters[0].id,role:"appears",note:"首次出场" });
  let storyTime = await bookViews.saveStoryTimePosition(sampleBook.id, { cardId:viewEvent.id,startOrder:10,endOrder:12,startLabel:"宗门历七月初三",endLabel:"宗门历七月初五",uncertainty:"" });
  const narrativePreview = await changeSets.previewBookChangeSet(sampleBook.id, { operationKey:"narrative_placement",input:{ subjectCardId:viewEvent.id,chapterCardId:viewChapters[1].id,role:"appears",note:"改到下一章",revision:narrative.revision } });
  assert.equal(narrativePreview.status,"previewed");
  assert.match(narrativePreview.impacts[0].unchanged,/故事发生时间/);
  assert.equal((await bookViews.getBookViewWorkspace(sampleBook.id)).narrativePlacements.find((item) => item.id === narrative.id).chapterCardId, viewChapters[0].id);
  await changeSets.applyBookChangeSet(narrativePreview.id);
  viewWorkspace = await bookViews.getBookViewWorkspace(sampleBook.id);
  narrative = viewWorkspace.narrativePlacements.find((item) => item.id === narrative.id);
  assert.equal(narrative.chapterCardId, viewChapters[1].id);
  assert.equal(viewWorkspace.storyTimePositions.find((item) => item.id === storyTime.id).startOrder, 10);
  const timePreview = await changeSets.previewBookChangeSet(sampleBook.id, { operationKey:"story_time",input:{ cardId:viewEvent.id,startOrder:20,endOrder:21,startLabel:"宗门历八月",endLabel:"宗门历八月",uncertainty:"约",revision:storyTime.revision } });
  assert.equal((await bookViews.getBookViewWorkspace(sampleBook.id)).storyTimePositions.find((item) => item.id === storyTime.id).startOrder, 10);
  const appliedTimePreview = await changeSets.applyBookChangeSet(timePreview.id);
  assert.equal(appliedTimePreview.status,"applied");
  await assert.rejects(() => changeSets.applyBookChangeSet(timePreview.id), (error) => error.status === 409 && /不能重复/.test(error.message));
  viewWorkspace = await bookViews.getBookViewWorkspace(sampleBook.id);
  storyTime = viewWorkspace.storyTimePositions.find((item) => item.id === storyTime.id);
  assert.equal(viewWorkspace.narrativePlacements.find((item) => item.id === narrative.id).chapterCardId, viewChapters[1].id);
  assert.equal(storyTime.startOrder,20);

  const staleTimePreview = await changeSets.previewBookChangeSet(sampleBook.id, { operationKey:"story_time",input:{ cardId:viewEvent.id,startOrder:30,endOrder:31,startLabel:"宗门历九月",endLabel:"宗门历九月",uncertainty:"",revision:storyTime.revision } });
  storyTime = await bookViews.saveStoryTimePosition(sampleBook.id, { cardId:viewEvent.id,startOrder:40,endOrder:41,startLabel:"宗门历十月",endLabel:"宗门历十月",uncertainty:"",revision:storyTime.revision });
  await assert.rejects(() => changeSets.applyBookChangeSet(staleTimePreview.id), (error) => error.status === 409 && /其他视图/.test(error.message));
  assert.equal((await storyTimeline.listCurrentStoryTimings(sampleBook.id)).find((item)=>item.eventCardId===viewEvent.id).normalizedStart,40);

  const parallelEventA=viewEvents[1],parallelEventB=viewEvents[2],unknownTimeEvent=viewEvents[3];
  let plannedTimingProposal=await storyTimeline.proposeStoryTime({bookId:sampleBook.id,eventCardId:parallelEventA.id,proposalSource:"ai",lifecycle:"planned",timeMode:"custom_calendar",startCertainty:"known",endCertainty:"known",calendarKey:"jinghe",startLabel:"景和二十二年七月十四日",endLabel:"景和二十二年七月十五日",normalizedStart:20,normalizedEnd:21,durationValue:2,durationUnit:"day",evidenceKind:"body",chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,reason:"正文给出白水封镇的起止范围。",editor:"integration-model"});
  assert.equal(plannedTimingProposal.status,"proposed");
  assert.ok((await storyTimeline.listStoryTimeProposals(sampleBook.id,"proposed")).some((item)=>item.id===plannedTimingProposal.id));
  plannedTimingProposal=await storyTimeline.editStoryTimeProposal(plannedTimingProposal.id,{...plannedTimingProposal.currentVersion,normalizedEnd:22,endLabel:"景和二十二年七月十六日",durationValue:3,reason:"用户把封镇范围校订为三日。",expectedRevision:plannedTimingProposal.revision,actor:"integration-test",note:"校订结束时间。"});
  assert.equal(plannedTimingProposal.versions.length,2);
  await assert.rejects(()=>storyTimeline.editStoryTimeProposal(plannedTimingProposal.id,{...plannedTimingProposal.currentVersion,expectedRevision:1,actor:"integration-test"}),(error)=>error.status===409&&/已更新/.test(error.message));
  plannedTimingProposal=await storyTimeline.reviewStoryTimeProposal(plannedTimingProposal.id,{action:"confirm",expectedRevision:plannedTimingProposal.revision,idempotencyKey:`story-time-plan-${Date.now()}`,actor:"integration-test"});
  const plannedTiming=(await storyTimeline.listCurrentStoryTimings(sampleBook.id)).find((item)=>item.eventCardId===parallelEventA.id);
  assert.equal(plannedTiming.lifecycle,"planned");
  assert.equal(plannedTiming.normalizedEnd,22);

  let parallelTimingProposal=await storyTimeline.proposeStoryTime({bookId:sampleBook.id,eventCardId:parallelEventB.id,proposalSource:"ai",lifecycle:"planned",timeMode:"custom_calendar",startCertainty:"known",endCertainty:"known",calendarKey:"jinghe",startLabel:"景和二十二年七月十五日",endLabel:"景和二十二年七月十七日",normalizedStart:21,normalizedEnd:23,evidenceKind:"body",chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,reason:"另一事件与封镇并行。",editor:"integration-model"});
  parallelTimingProposal=await storyTimeline.reviewStoryTimeProposal(parallelTimingProposal.id,{action:"confirm",expectedRevision:parallelTimingProposal.revision,idempotencyKey:`story-time-parallel-${Date.now()}`,actor:"integration-test"});
  assert.deepEqual(new Set((await storyTimeline.listStoryTimingsInRange(sampleBook.id,{normalizedStart:20.5,normalizedEnd:21.5})).map((item)=>item.eventCardId)),new Set([parallelEventA.id,parallelEventB.id]));
  assert.ok((await storyTimeline.listConcurrentEvents(sampleBook.id,parallelEventA.id)).some((item)=>item.eventCardId===parallelEventB.id));
  assert.deepEqual(new Set((await storyTimeline.listStoryOccurrencesByChapter(sampleBook.id,viewChapters[0].id)).filter((item)=>[parallelEventA.id,parallelEventB.id].includes(item.eventCardId)).map((item)=>item.eventCardId)),new Set([parallelEventA.id,parallelEventB.id]));

  const secondChapterOccurrence=await storyTimeline.saveStoryNarrativeOccurrence({bookId:sampleBook.id,eventCardId:parallelEventA.id,chapterCardId:viewChapters[1].id,role:"retell",narrativeOrder:2,sourceKind:"manual",note:"第二章再次讲述封镇经过。"});
  assert.equal((await storyTimeline.listStoryOccurrencesByChapter(sampleBook.id,viewChapters[0].id)).filter((item)=>item.eventCardId===parallelEventA.id).length,1);
  assert.equal((await storyTimeline.listStoryOccurrencesByChapter(sampleBook.id,viewChapters[1].id)).find((item)=>item.id===secondChapterOccurrence.id).role,"retell");

  let temporalProposal=await storyTimeline.proposeStoryRelation({bookId:sampleBook.id,proposalSource:"ai",relationFamily:"temporal",relationType:"after",sourceEventCardId:parallelEventB.id,targetEventCardId:parallelEventA.id,evidenceKind:"body",chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,confidence:.9,reason:"并行事件在封镇开始后进入高潮。",editor:"integration-model"});
  temporalProposal=await storyTimeline.reviewStoryRelationProposal(temporalProposal.id,{action:"confirm",expectedRevision:temporalProposal.revision,idempotencyKey:`story-temporal-${Date.now()}`,actor:"integration-test"});
  assert.equal((await storyTimeline.listTemporalNeighbors(sampleBook.id,parallelEventA.id))[0].relationType,"before");
  let causalProposal=await storyTimeline.proposeStoryRelation({bookId:sampleBook.id,proposalSource:"ai",relationFamily:"causal",relationType:"causes",sourceEventCardId:parallelEventA.id,targetEventCardId:parallelEventB.id,evidenceKind:"plan_version",planVersionId:adoptedScenePlanVersionId,confidence:.86,reason:"场景计划规定封镇迫使队伍进入无灯观。",editor:"integration-model"});
  causalProposal=await storyTimeline.reviewStoryRelationProposal(causalProposal.id,{action:"confirm",expectedRevision:causalProposal.revision,idempotencyKey:`story-causal-${Date.now()}`,actor:"integration-test"});
  assert.ok((await storyTimeline.listCausalGraph(sampleBook.id,parallelEventB.id,"upstream")).some((item)=>item.id===causalProposal.confirmedRelationId));
  let duplicateCausalProposal=await storyTimeline.proposeStoryRelation({bookId:sampleBook.id,proposalSource:"manual",relationFamily:"causal",relationType:"causes",sourceEventCardId:parallelEventA.id,targetEventCardId:parallelEventB.id,evidenceKind:"manual",reason:"用于验证重复关系保护。",editor:"integration-test"});
  await assert.rejects(()=>storyTimeline.reviewStoryRelationProposal(duplicateCausalProposal.id,{action:"confirm",expectedRevision:duplicateCausalProposal.revision,idempotencyKey:`story-causal-duplicate-${Date.now()}`,actor:"integration-test"}),(error)=>error.status===409&&/已经生效/.test(error.message));
  await assert.rejects(()=>storyTimeline.proposeStoryRelation({bookId:sampleBook.id,proposalSource:"manual",relationFamily:"causal",relationType:"causes",sourceEventCardId:parallelEventA.id,targetEventCardId:parallelEventA.id,evidenceKind:"manual",reason:"非法自环"}),(error)=>error.status===422&&/自己/.test(error.message));

  let occurredTimingProposal=await storyTimeline.proposeStoryTime({bookId:sampleBook.id,eventCardId:parallelEventA.id,proposalSource:"manual",lifecycle:"occurred",timeMode:"custom_calendar",startCertainty:"known",endCertainty:"known",calendarKey:"jinghe",startLabel:"景和二十二年七月十四日",endLabel:"景和二十二年七月十六日",normalizedStart:20,normalizedEnd:22,durationValue:3,durationUnit:"day",evidenceKind:"fact",factId:correctedFact.id,replacesTimingId:plannedTiming.id,reason:"用户依据已确认事实把计划转为实际发生。",editor:"integration-test"});
  occurredTimingProposal=await storyTimeline.reviewStoryTimeProposal(occurredTimingProposal.id,{action:"confirm",expectedRevision:occurredTimingProposal.revision,idempotencyKey:`story-time-occurred-${Date.now()}`,actor:"integration-test"});
  assert.equal((await storyTimeline.listCurrentStoryTimings(sampleBook.id)).find((item)=>item.eventCardId===parallelEventA.id).lifecycle,"occurred");
  assert.equal((await (await runtime.getNewDesignPool()).query("SELECT status FROM new_design.story_event_timings WHERE id=$1",[plannedTiming.id])).rows[0].status,"superseded");

  let unknownTimingProposal=await storyTimeline.proposeStoryTime({bookId:sampleBook.id,eventCardId:unknownTimeEvent.id,proposalSource:"manual",lifecycle:"planned",timeMode:"unknown",startCertainty:"unknown",endCertainty:"unknown",evidenceKind:"plan_version",planVersionId:adoptedScenePlanVersionId,reason:"场景计划保留该事件，但具体发生时间尚未决定。",editor:"integration-test"});
  unknownTimingProposal=await storyTimeline.reviewStoryTimeProposal(unknownTimingProposal.id,{action:"confirm",expectedRevision:unknownTimingProposal.revision,idempotencyKey:`story-time-unknown-${Date.now()}`,actor:"integration-test"});
  assert.ok((await storyTimeline.listCurrentStoryTimings(sampleBook.id)).some((item)=>item.eventCardId===unknownTimeEvent.id&&item.normalizedStart===null));
  assert.ok(!(await storyTimeline.listStoryTimingsInRange(sampleBook.id,{normalizedStart:-100,normalizedEnd:100})).some((item)=>item.eventCardId===unknownTimeEvent.id));
  const persistedParallelTimeProposalId=parallelTimingProposal.id,persistedCausalProposalId=causalProposal.id,persistedOccurredTimeProposalId=occurredTimingProposal.id;
  storyPlan=await planning.addPlanningVersion(storyPlan.id,{content:{premise:"守灯人追查山门与父亲两代旧案",ending:"保留记忆并公开真相"},source:"manual",expectedRevision:storyPlan.revision,createdBy:"integration-test"});
  storyPlan=await planning.adoptPlanningVersion(storyPlan.id,{versionId:storyPlan.currentVersionId,expectedRevision:storyPlan.revision,idempotencyKey:`plan-story-switch-${Date.now()}`,actor:"integration-test"});
  const stalePlans=await planning.listStalePlanningVersions(sampleBook.id);
  assert.ok(stalePlans.some((item)=>item.objectId===volumePlan.id));
  assert.ok(stalePlans.some((item)=>item.objectId===chapterPlan.id));
  assert.ok(stalePlans.some((item)=>item.id===adoptedScenePlanVersionId));
  assert.equal((await storyTimeline.getStoryTimeProposal(unknownTimingProposal.id)).status,"stale");
  assert.equal((await storyTimeline.getStoryRelationProposal(causalProposal.id)).status,"stale");
  assert.equal((await chapterBodies.getChapterDocument(chapterDocument.id)).adoptedVersionId,candidateB.id);
  assert.ok((await planning.listPlanningImpacts(sampleBook.id,"pending_review")).some((item)=>item.targetKind==="story_time"));
  const storyVersionOne=storyPlan.versions.find((item)=>item.version===1);
  storyPlan=await planning.adoptPlanningVersion(storyPlan.id,{versionId:storyVersionOne.id,expectedRevision:storyPlan.revision,idempotencyKey:`plan-story-rollback-${Date.now()}`,actor:"integration-test"});
  assert.equal(storyPlan.adoptions[0].action,"rollback");
  storyPlan=await planning.adoptPlanningVersion(storyPlan.id,{versionId:storyPlan.currentVersionId,expectedRevision:storyPlan.revision,idempotencyKey:`plan-story-readopt-history-${Date.now()}`,actor:"integration-test"});
  assert.equal(storyPlan.adoptedVersionId,storyPlan.currentVersionId);

  const relationship = await bookViews.saveCharacterRelation(sampleBook.id, { sourceCardId:viewCharacters[0].id,targetCardId:viewCharacters[1].id,sourceLabel:"师父",inverseLabel:"弟子",note:"共同守护山门" });
  const reversePerspective = relationship.sourceCardId === viewCharacters[1].id ? relationship.sourceLabel : relationship.inverseLabel;
  assert.equal(reversePerspective, "弟子");
  assert.equal((await (await runtime.getNewDesignPool()).query("SELECT count(*)::int AS count FROM new_design.card_relations relation JOIN new_design.relation_types type ON type.id=relation.relation_type_id WHERE relation.space_id=$1 AND type.relation_key='character_relationship' AND relation.status='active'", [sampleBook.spaceId])).rows[0].count, 1);

  await bookViews.saveClueLifecycle(sampleBook.id, { clueCardId:viewClue.id,plantChapterId:viewChapters[0].id,revealChapterId:viewChapters[1].id,plantAnchor:"开场第三段",revealAnchor:"章末灯纹" });
  viewWorkspace = await bookViews.getBookViewWorkspace(sampleBook.id);
  const plantPlacement = viewWorkspace.narrativePlacements.find((item) => item.subjectCardId === viewClue.id && item.role === "plant");
  const revealPlacement = viewWorkspace.narrativePlacements.find((item) => item.subjectCardId === viewClue.id && item.role === "reveal");
  const plantAnchor = viewWorkspace.textAnchors.find((item) => item.subjectCardId === viewClue.id && item.role === "plant");
  const revealAnchor = viewWorkspace.textAnchors.find((item) => item.subjectCardId === viewClue.id && item.role === "reveal");
  const cluePreview = await changeSets.previewBookChangeSet(sampleBook.id, { operationKey:"clue_lifecycle",input:{ clueCardId:viewClue.id,plantChapterId:viewChapters[1].id,revealChapterId:viewChapters[0].id,plantAnchor:"中段铜铃",revealAnchor:"结尾回响",plantPlacementRevision:plantPlacement.revision,revealPlacementRevision:revealPlacement.revision,plantAnchorRevision:plantAnchor.revision,revealAnchorRevision:revealAnchor.revision } });
  assert.equal(cluePreview.impacts.length,2);
  await changeSets.applyBookChangeSet(cluePreview.id);
  const lifecycleCounts = await (await runtime.getNewDesignPool()).query("SELECT (SELECT count(*) FROM new_design.narrative_placements WHERE subject_card_id=$1 AND role IN ('plant','reveal') AND status='active')::int AS placements,(SELECT count(*) FROM new_design.text_anchors WHERE subject_card_id=$1 AND role IN ('plant','reveal'))::int AS anchors", [viewClue.id]);
  assert.deepEqual(lifecycleCounts.rows[0], { placements:2, anchors:2 });

  const stateCapabilities = await states.getStateCapabilities(sampleBook.spaceId);
  assert.equal(stateCapabilities.types.find((item) => item.typeKey === "character").settlementCapability, "required");
  assert.equal(stateCapabilities.types.find((item) => item.typeKey === "prop").settlementCapability, "required");
  assert.equal(stateCapabilities.types.find((item) => item.typeKey === viewClue.typeKey).stateMode, "lifecycle");
  assert.equal(stateCapabilities.relations.find((item) => item.relationKey === "character_relationship").dimensions[0].direction, "bidirectional");

  const initialEnergy = await states.saveInitialState({ bookId:sampleBook.id,subjectKind:"card",subjectId:viewCharacters[0].id,stateKey:"energy",value:100,actor:"integration-test",note:"开篇体力" });
  const initialRelationship = await states.saveInitialState({ bookId:sampleBook.id,subjectKind:"relation",subjectId:relationship.id,stateKey:"relationship_state",value:"互相试探",actor:"integration-test" });
  const initialHolder = await states.saveInitialState({ bookId:sampleBook.id,subjectKind:"card",subjectId:prop.id,stateKey:"holder",value:viewCharacters[0].id,actor:"integration-test" });
  const initialClueLifecycle = await states.saveInitialState({ bookId:sampleBook.id,subjectKind:"card",subjectId:viewClue.id,stateKey:"lifecycle",value:"planted",actor:"integration-test" });
  assert.deepEqual([initialEnergy.currentValue,initialRelationship.currentValue,initialHolder.currentValue,initialClueLifecycle.currentValue],[100,"互相试探",viewCharacters[0].id,"planted"]);
  const initialStateMilestone = await states.createStateMilestone({ bookId:sampleBook.id,kind:"initial",label:"开篇状态" });
  assert.equal(initialStateMilestone.snapshot.states.length,4);

  const promptComponentVersionId = (await store.listCardVersions(customPrompt.id))[0].id;
  const energyMapping = await states.publishStateValueMapping({ spaceId:sampleBook.spaceId,typeKey:"character",fieldKey:"energy",ranges:[{min:null,max:30,label:"濒临耗尽",value:"动作迟滞，需要恢复"},{min:31,max:70,label:"明显消耗",value:"仍可行动，但连续爆发受限"},{min:71,max:null,label:"状态充足",value:"可承受常规战斗"}],promptComponentVersionId,note:"章节结算把数值翻译成写作语义。" });
  assert.equal(energyMapping.currentVersion,1);
  assert.equal(energyMapping.promptComponentVersionId,promptComponentVersionId);

  const proposalInputs = [
    { subjectKind:"card",subjectId:viewCharacters[0].id,stateKey:"energy",beforeValue:100,afterValue:72,delta:-28,reason:"点亮照骨灯消耗体力。" },
    { subjectKind:"relation",subjectId:relationship.id,stateKey:"relationship_state",beforeValue:"互相试探",afterValue:"建立信任",reason:"共同确认旧案线索。" },
    { subjectKind:"card",subjectId:prop.id,stateKey:"holder",beforeValue:viewCharacters[0].id,afterValue:null,reason:"照骨灯被敌人夺走。" },
    { subjectKind:"card",subjectId:viewClue.id,stateKey:"lifecycle",beforeValue:"planted",afterValue:"revealed",reason:"正文揭示铜铃与旧案的联系。" },
  ];
  const proposals=[];
  for (const proposal of proposalInputs) proposals.push(await states.proposeStateChange({ bookId:sampleBook.id,chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,causeEventCardId:viewEvent.id,effectiveStoryOrder:20,source:"ai",...proposal }));
  assert.ok(proposals.every((proposal) => proposal.status === "proposed"));
  proposals[0]=await states.editStateChangeProposal(proposals[0].id,{beforeValue:100,afterValue:70,delta:-30,reason:"用户把照骨灯消耗修正为三十点。",effectiveStoryOrder:20,expectedRevision:proposals[0].revision,actor:"integration-test"});
  assert.equal(proposals[0].revision,2);
  assert.equal((await (await runtime.getNewDesignPool()).query("SELECT count(*)::int AS count FROM new_design.state_change_proposal_versions WHERE proposal_id=$1",[proposals[0].id])).rows[0].count,2);
  const settlementKey=`state-settlement-${Date.now()}-first`;
  let settlement=await states.commitChapterSettlement({ bookId:sampleBook.id,chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,proposalIds:proposals.map((proposal)=>proposal.id),idempotencyKey:settlementKey,actor:"integration-test",milestone:{kind:"manual",label:"第一章结算"} });
  assert.equal(settlement.changes.length,4);
  settlement=await states.commitChapterSettlement({ bookId:sampleBook.id,chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,proposalIds:proposals.map((proposal)=>proposal.id),idempotencyKey:settlementKey,actor:"integration-test" });
  assert.equal(settlement.changes.length,4);
  let projections=await states.listCurrentState(sampleBook.id);
  const projectionValue=(kind,id,key)=>projections.find((item)=>item.subjectKind===kind&&item.subjectId===id&&item.stateKey===key)?.value;
  assert.equal(projectionValue("card",viewCharacters[0].id,"energy"),70);
  assert.equal(projectionValue("relation",relationship.id,"relationship_state"),"建立信任");
  assert.equal(projectionValue("card",prop.id,"holder"),null);
  assert.equal(projectionValue("card",viewClue.id,"lifecycle"),"revealed");

  const revertKey=`state-revert-${Date.now()}`;
  settlement=await states.revertChapterSettlement(settlement.id,{expectedRevision:settlement.revision,idempotencyKey:revertKey,actor:"integration-test"});
  settlement=await states.revertChapterSettlement(settlement.id,{expectedRevision:1,idempotencyKey:revertKey,actor:"integration-test"});
  assert.equal(settlement.status,"reverted");
  projections=await states.listCurrentState(sampleBook.id);
  assert.equal(projections.find((item)=>item.subjectId===viewCharacters[0].id&&item.stateKey==="energy").value,100);
  assert.equal(projections.find((item)=>item.subjectId===relationship.id&&item.stateKey==="relationship_state").value,"互相试探");
  assert.equal(projections.find((item)=>item.subjectId===prop.id&&item.stateKey==="holder").value,viewCharacters[0].id);
  assert.equal(projections.find((item)=>item.subjectId===viewClue.id&&item.stateKey==="lifecycle").value,"planted");

  const secondProposals=[];
  for (const proposal of proposalInputs) secondProposals.push(await states.proposeStateChange({ bookId:sampleBook.id,chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,causeEventCardId:viewEvent.id,effectiveStoryOrder:20,source:"manual",...proposal }));
  let supersededSettlement=await states.commitChapterSettlement({ bookId:sampleBook.id,chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,proposalIds:secondProposals.map((proposal)=>proposal.id),idempotencyKey:`state-settlement-${Date.now()}-second`,actor:"integration-test" });
  const persistedSupersededSettlementId=supersededSettlement.id,persistedStateMappingId=energyMapping.id;
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:manualBody.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-state-stale`,actor:"integration-test"});
  supersededSettlement=await states.getSettlement(supersededSettlement.id);
  assert.equal(supersededSettlement.status,"superseded");
  assert.ok(supersededSettlement.changes.every((change)=>change.status==="invalidated"));
  assert.ok((await states.listStateMilestones(sampleBook.id)).some((item)=>item.kind==="body_switch"));
  assert.equal((await states.listCurrentState(sampleBook.id)).find((item)=>item.subjectId===viewCharacters[0].id&&item.stateKey==="energy").value,100);
  assert.equal((await storyTimeline.getStoryTimeProposal(persistedParallelTimeProposalId)).status,"stale");
  assert.equal((await storyTimeline.getStoryRelationProposal(persistedCausalProposalId)).status,"stale");
  assert.equal((await storyTimeline.getStoryTimeProposal(persistedOccurredTimeProposalId)).status,"confirmed");
  assert.equal((await storyTimeline.listStoryOccurrencesByChapter(sampleBook.id,viewChapters[0].id)).filter((item)=>item.eventCardId===parallelEventA.id).length,0);
  assert.equal((await storyTimeline.listStoryOccurrencesByChapter(sampleBook.id,viewChapters[1].id)).find((item)=>item.id===secondChapterOccurrence.id).status,"active");
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:candidateB.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-state-return`,actor:"integration-test"});
  assert.equal((await states.getSettlement(persistedSupersededSettlementId)).status,"superseded");

  let characterKnowledge=await knowledge.proposeKnowledgeState({
    bookId:sampleBook.id,holderKind:"character",holderCardId:viewCharacters[0].id,
    claim:{subjectCardId:viewCharacters[0].id,predicate:"current_location",valueKind:"text",value:"青石镇",truthFactId:correctedFact.id},
    source:"ai",stance:"suspects",confidence:.55,acquisitionMethod:"inferred",sourceEventCardId:viewEvent.id,
    chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,effectiveStoryOrder:20,effectiveNarrativeOrder:8,
    reason:"人物根据旧案残痕得出了尚未核实的错误地点。",editor:"integration-model",
  });
  assert.equal(characterKnowledge.status,"proposed");
  assert.ok((await knowledge.listKnowledgeStateProposals(sampleBook.id,"proposed")).some((item)=>item.id===characterKnowledge.id));
  characterKnowledge=await knowledge.editKnowledgeStateProposal(characterKnowledge.id,{
    stance:"misunderstands",confidence:.8,acquisitionMethod:"inferred",sourceEventCardId:viewEvent.id,
    chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,effectiveStoryOrder:20,effectiveNarrativeOrder:8,
    reason:"用户核对后确认这是人物坚信的误判，而不只是怀疑。",expectedRevision:characterKnowledge.revision,actor:"integration-test",note:"修正人物认知姿态。",
  });
  assert.equal(characterKnowledge.versions.length,2);
  assert.equal(characterKnowledge.currentVersion.stance,"misunderstands");
  const characterConfirmKey=`knowledge-character-${Date.now()}`;
  characterKnowledge=await knowledge.reviewKnowledgeStateProposal(characterKnowledge.id,{action:"confirm",expectedRevision:characterKnowledge.revision,idempotencyKey:characterConfirmKey,actor:"integration-test"});
  characterKnowledge=await knowledge.reviewKnowledgeStateProposal(characterKnowledge.id,{action:"confirm",expectedRevision:1,idempotencyKey:characterConfirmKey,actor:"integration-test"});
  assert.equal(characterKnowledge.status,"confirmed");
  assert.equal((await knowledge.listKnowledgeStateAt(sampleBook.id,{holderKind:"character",holderKey:viewCharacters[0].id,narrativeOrder:3})).length,0);
  assert.equal((await knowledge.listKnowledgeStateAt(sampleBook.id,{holderKind:"character",holderKey:viewCharacters[0].id,narrativeOrder:8}))[0].stance,"misunderstands");

  let readerKnowledge=await knowledge.proposeKnowledgeState({
    bookId:sampleBook.id,holderKind:"reader",holderKey:"default",
    claim:{subjectCardId:viewCharacters[0].id,predicate:"current_location",valueKind:"text",value:"白水驿地下灯窟",truthFactId:correctedFact.id},
    source:"ai",stance:"knows",confidence:1,acquisitionMethod:"narration",chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,
    effectiveStoryOrder:20,effectiveNarrativeOrder:5,reason:"叙述已经向读者明示真实地点。",editor:"integration-model",
  });
  readerKnowledge=await knowledge.reviewKnowledgeStateProposal(readerKnowledge.id,{action:"confirm",expectedRevision:readerKnowledge.revision,idempotencyKey:`knowledge-reader-${Date.now()}`,actor:"integration-test"});
  assert.equal((await knowledge.listKnowledgeStateAt(sampleBook.id,{holderKind:"reader",holderKey:"default",narrativeOrder:5}))[0].stance,"knows");
  let unknownTimeKnowledge=await knowledge.proposeKnowledgeState({
    bookId:sampleBook.id,holderKind:"character",holderCardId:viewCharacters[1].id,
    claim:{subjectCardId:viewEvent.id,predicate:"has_seen_old_case_trace",valueKind:"boolean",value:true},source:"manual",stance:"suspects",confidence:.4,acquisitionMethod:"manual",
    chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id,textAnchorId:factAnchor.id,reason:"已知人物有怀疑，但暂不编造具体获知章节。",editor:"integration-test",
  });
  unknownTimeKnowledge=await knowledge.reviewKnowledgeStateProposal(unknownTimeKnowledge.id,{action:"confirm",expectedRevision:unknownTimeKnowledge.revision,idempotencyKey:`knowledge-unknown-time-${Date.now()}`,actor:"integration-test"});
  assert.equal((await knowledge.listCurrentKnowledgeState(sampleBook.id)).length,3);
  assert.equal((await knowledge.listKnowledgeStateAt(sampleBook.id,{holderKind:"character",holderKey:viewCharacters[1].id,narrativeOrder:999})).length,0);
  assert.equal((await facts.getCanonicalFact(correctedFact.id)).status,"confirmed");
  const persistedKnowledgeProposalId=characterKnowledge.id;
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:manualBody.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-knowledge-stale`,actor:"integration-test"});
  assert.equal((await knowledge.getKnowledgeStateProposal(characterKnowledge.id)).status,"invalidated");
  assert.equal((await knowledge.listCurrentKnowledgeState(sampleBook.id)).length,0);
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:candidateB.id,expectedRevision:chapterDocument.revision,idempotencyKey:`chapter-adopt-${Date.now()}-knowledge-return`,actor:"integration-test"});
  assert.equal((await knowledge.getKnowledgeStateProposal(characterKnowledge.id)).status,"invalidated");

  await assert.rejects(() => bookViews.saveStoryTimePosition(sampleBook.id, { cardId:viewEvent.id,startOrder:50,endOrder:20,startLabel:"",endLabel:"",uncertainty:"",revision:storyTime.revision }), (error) => error.status === 422 && /不能早于/.test(error.message));
  await assert.rejects(() => bookViews.saveNarrativePlacement(sampleBook.id, { subjectCardId:viewEvent.id,chapterCardId:viewChapters[0].id,role:"appears",note:"过期写入",revision:1 }), (error) => error.status === 409 && /其他视图/.test(error.message));

  const priorVersionId = formInstance.formVersionId;
  let changedForm = await composition.saveCardGroupForm({
    id: eventForm.id,
    key: eventForm.key,
    name: eventForm.name,
    description: eventForm.description,
    definition: { ...eventForm.draftDefinition, groups: [...eventForm.draftDefinition.groups] },
    revision: eventForm.revision,
  });
  changedForm = await composition.publishCardGroupForm(changedForm.id, changedForm.revision);
  assert.equal(changedForm.currentVersion, 2);
  assert.equal((await composition.listFormInstances(formInstance.spaceId, eventForm.id))[0].formVersionId, priorVersionId);

  const templateGroups = await templates.listTemplates();
  const defaultTemplate = templateGroups.find((template) => template.name === "通用长篇小说模板");
  assert.ok(defaultTemplate);
  const initialTemplateVersion = (await templates.listTemplateVersions(defaultTemplate.id))[0];
  assert.equal(initialTemplateVersion.payload.cardTypes.length, 29);
  assert.ok(!initialTemplateVersion.payload.cardTypes.some((cardType) => cardType.key === "prompt_component"));
  assert.deepEqual(initialTemplateVersion.payload.viewConfigs.map((view) => view.key), ["chapters", "clues", "characters", "events", "world", "resources"]);
  assert.ok(initialTemplateVersion.payload.relationTypes.some((relation) => relation.key === "character_relationship"));

  const inspirationCandidates = await bookCreation.listInspirationCandidates();
  assert.equal(inspirationCandidates.length, 6);
  const strategyResources = await resources.listStrategyResources();
  assert.equal(strategyResources.length, 13);
  assert.deepEqual(
    Object.fromEntries(["genre_strategy", "progression_mode", "writing_config", "quality_rule"].map((typeKey) => [typeKey, strategyResources.filter((item) => item.typeKey === typeKey).length])),
    { genre_strategy: 4, progression_mode: 3, writing_config: 2, quality_rule: 4 },
  );
  let blankSession = await bookCreation.createBookCreationSession({
    method: "blank",
    templateVersionId: initialTemplateVersion.id,
    bookName: "空白流程样书",
    description: "验证空白入口安装统一结构。",
    sourceReference: "",
    inputPayload: {},
  });
  blankSession = await bookCreation.completeBookCreation(blankSession.id);
  assert.ok(blankSession.bookId);
  const blankBook = await templates.getBook(blankSession.bookId);
  assert.equal((await store.listCards({ spaceId: blankBook.spaceId })).length, 0);
  assert.equal((await composition.listCardGroupForms(blankBook.spaceId)).length, 1);
  assert.equal((await composition.listRelationTypes(blankBook.spaceId)).length, 5);
  assert.equal((await bookViews.getBookViewWorkspace(blankBook.id)).viewConfigs.length, 6);

  const publicGenre = strategyResources.find((item) => item.typeKey === "genre_strategy");
  assert.ok(publicGenre);
  const installed = await resources.installStrategyResource(blankBook.id, publicGenre.id);
  assert.equal(installed.adoption.action, "install_snapshot");
  assert.equal(installed.target.title, publicGenre.title);
  assert.deepEqual(installed.target.values, publicGenre.values);
  await (await runtime.getNewDesignPool()).query("UPDATE new_design.cards SET title='公共资源已更新' WHERE id=$1", [publicGenre.id]);
  const independentSnapshot = await store.getCard(installed.target.id);
  assert.equal(independentSnapshot.title, publicGenre.title);
  assert.deepEqual(independentSnapshot.values, publicGenre.values);

  let resourceSession = await bookCreation.createBookCreationSession({
    method: "blank",
    templateVersionId: initialTemplateVersion.id,
    bookName: "带策略开书样书",
    description: "验证开书时安装策略快照。",
    sourceReference: "",
    inputPayload: { strategyResourceIds: strategyResources.filter((item) => ["progression_mode", "quality_rule"].includes(item.typeKey)).slice(0, 2).map((item) => item.id) },
  });
  resourceSession = await bookCreation.completeBookCreation(resourceSession.id);
  const resourceBook = await templates.getBook(resourceSession.bookId);
  assert.equal((await store.listCards({ spaceId: resourceBook.spaceId })).length, 2);
  const adoptionRows = await (await runtime.getNewDesignPool()).query("SELECT action,snapshot FROM new_design.resource_adoptions WHERE book_id=$1", [resourceBook.id]);
  assert.equal(adoptionRows.rowCount, 2);
  assert.ok(adoptionRows.rows.every((row) => row.action === "install_snapshot"));

  let researchSession=await bookCreation.createBookCreationSession({
    method:"reference",
    templateVersionId:initialTemplateVersion.id,
    bookName:"研究复用样书",
    description:"",
    sourceReference:"",
    inputPayload:{},
    researchPackVersionIds:[lockedPackVersionId],
  });
  assert.deepEqual(researchSession.researchPackVersionIds,[lockedPackVersionId]);
  assert.ok(researchSession.researchPreview.suggestedCards.some((item)=>item.title==="可复用旧案策略"));
  const researchBatchId=await bookCreation.beginSessionGeneration(researchSession.id,"initial_content");
  const authorConfirmedPromise="作者已经填写的主承诺，研究建议不能覆盖。";
  researchSession=await bookCreation.saveInitialCards(researchSession.id,researchBatchId,[{typeKey:"genre_strategy",title:"可复用旧案策略",values:strategyValues(authorConfirmedPromise)}]);
  researchSession=await bookCreation.completeBookCreation(researchSession.id);
  const researchBook=await templates.getBook(researchSession.bookId);
  const reusedCards=(await store.listCards({spaceId:researchBook.spaceId})).filter((item)=>item.title==="可复用旧案策略");
  assert.equal(reusedCards.length,1);
  assert.equal(reusedCards[0].values.core_promise,authorConfirmedPromise);
  const researchOrigins=await (await runtime.getNewDesignPool()).query("SELECT DISTINCT source_kind FROM new_design.card_field_origins WHERE card_id=$1",[reusedCards[0].id]);
  assert.deepEqual(researchOrigins.rows.map((row)=>row.source_kind),["ai"]);
  const bookResearchReferences=await referencePacks.listBookResearchReferences(researchBook.id);
  assert.equal(bookResearchReferences.length,1);
  assert.equal(bookResearchReferences[0].packVersionId,lockedPackVersionId);
  let isolatedStoryPlan=await planning.createPlanningObject({bookId:researchBook.id,level:"story",title:"研究书独立总计划",sortOrder:0,content:{premise:"独立测试"},source:"manual",createdBy:"integration-test"});
  isolatedStoryPlan=await planning.adoptPlanningVersion(isolatedStoryPlan.id,{versionId:isolatedStoryPlan.currentVersionId,expectedRevision:isolatedStoryPlan.revision,idempotencyKey:`plan-isolated-${Date.now()}`,actor:"integration-test"});
  assert.equal((await planning.getAdoptedPlanningTree(researchBook.id)).object.id,isolatedStoryPlan.id);
  assert.equal((await planning.getAdoptedPlanningTree(sampleBook.id)).object.id,persistedStoryPlanId);

  let aiSession = await bookCreation.createBookCreationSession({
    method: "idea",
    templateVersionId: initialTemplateVersion.id,
    bookName: "",
    description: "",
    sourceReference: "用户输入",
    inputPayload: { idea: "一个失去记忆的守灯人必须找回被篡改的旧案" },
  });
  const directionBatchId = await bookCreation.beginSessionGeneration(aiSession.id, "directions");
  const directionCandidates = [
    { id: "memory-lamp", title: "守灯旧案", premise: "守灯人每次点灯都会失去记忆，却必须借灯火查清一宗被篡改的旧案。", protagonist: "失去部分童年记忆的守灯人", centralConflict: "救人需要继续点灯，追查真相却会让他忘记查案目的", readerPromise: "在持续失去中拼回真相", styleKeywords: ["悬疑", "成长"] },
    { id: "mirror-city", title: "镜城残卷", premise: "一座靠记忆维持的城市即将崩塌，抄书人发现自己的家族负责删除危险历史。", protagonist: "负责誊抄禁书的年轻抄书人", centralConflict: "公开历史会摧毁城市秩序，隐瞒则会让灾难重演", readerPromise: "层层解密并重建秩序", styleKeywords: ["奇幻", "解谜"] },
    { id: "river-oath", title: "逆河之誓", premise: "逆流而上的摆渡人能够送亡者回到一个遗憾发生前，却要承担改变历史的代价。", protagonist: "拒绝接受妹妹死亡的摆渡人", centralConflict: "挽回亲人会让更多陌生人失去原有命运", readerPromise: "选择、牺牲与情感兑现", styleKeywords: ["冒险", "情感"] },
  ];
  aiSession = await bookCreation.saveDirectionCandidates(aiSession.id, directionBatchId, directionCandidates);
  aiSession = await bookCreation.selectBookDirection(aiSession.id, directionCandidates[0].id);
  const initialBatchId = await bookCreation.beginSessionGeneration(aiSession.id, "initial_content");
  aiSession = await bookCreation.saveInitialCards(aiSession.id, initialBatchId, initialTemplateVersion.payload.seedCards.slice(0, 6));
  aiSession = await bookCreation.completeBookCreation(aiSession.id);
  assert.ok(aiSession.bookId);
  const aiBook = await templates.getBook(aiSession.bookId);
  const aiCards = await store.listCards({ spaceId: aiBook.spaceId });
  assert.equal(aiCards.length, 6);
  const provenance = await (await runtime.getNewDesignPool()).query("SELECT confirmation_status FROM new_design.card_field_origins WHERE card_id=ANY($1::uuid[])", [aiCards.map((card) => card.id)]);
  assert.ok(provenance.rowCount > 0);
  assert.ok(provenance.rows.every((row) => row.confirmation_status === "ai_draft"));
  const sourceRows = await (await runtime.getNewDesignPool()).query("SELECT method,confirmation_status FROM new_design.book_content_sources WHERE book_id=$1", [aiBook.id]);
  assert.deepEqual(sourceRows.rows[0], { method: "idea", confirmation_status: "confirmed" });

  const assistCard = aiCards.find((card) => Object.keys(card.values).length > 0);
  assert.ok(assistCard);
  const assistContext = await bookCreation.getCardAssistContext(aiBook.id, assistCard.id);
  const assistFieldKey = Object.keys(assistCard.values)[0];
  const formAssistId = await bookCreation.beginFormAssist({ bookId: aiBook.id, cardId: assistCard.id, formKey: "event_planning", instruction: "补充细节", baseRevision: assistCard.revision });
  await bookCreation.saveFormAssist(formAssistId, { [assistFieldKey]: assistCard.values[assistFieldKey] });
  const assistedCard = await bookCreation.applyFormAssist(formAssistId, [assistFieldKey], assistCard.revision);
  assert.equal(assistedCard.revision, 2);
  assert.equal(assistContext.bookName, "守灯旧案");

  const recipeInput={source:"ai",variablesSchema:{type:"object",properties:{book_name:{type:"string"}}},slots:[{slotKey:"instructions",sortOrder:0,required:true,allowedContentTypes:["prompt_component"],variableContract:{required:["book_name"]},components:[{componentCardId:customPrompt.id,componentVersionId:promptComponentVersionId,sortOrder:0,required:true}]},{slotKey:"sources",sortOrder:1,required:false,allowedContentTypes:["body_version","canonical_fact","planning_version","research_version"],variableContract:{},components:[]}],createdBy:"integration-ai"};
  let promptRecipe=await aiContracts.createPromptRecipe({recipeKey:`chapter.generate.${Date.now()}`,name:"章节生成配方",description:"冻结章节生产提示词依赖。",...recipeInput});
  assert.equal(promptRecipe.currentVersion.status,"proposed");
  promptRecipe=await aiContracts.addPromptRecipeVersion(promptRecipe.id,{...recipeInput,source:"manual",baseVersionId:promptRecipe.currentVersionId,expectedRevision:promptRecipe.revision,createdBy:"integration-editor"});
  await assert.rejects(()=>aiContracts.addPromptRecipeVersion(promptRecipe.id,{...recipeInput,source:"manual",expectedRevision:1}),error=>error.status===409);
  promptRecipe=await aiContracts.publishPromptRecipeVersion(promptRecipe.id,{versionId:promptRecipe.currentVersionId,expectedRevision:promptRecipe.revision,idempotencyKey:`publish-recipe-${Date.now()}`,actor:"integration-test"});
  assert.equal(promptRecipe.publishedVersion.status,"published");
  const publishedRecipeVersionId=promptRecipe.publishedVersionId;
  const taskInput={source:"ai",taskGroup:"chapter_production",inputSchema:{type:"object",required:["chapterId"]},inputSchemaVersion:"1",outputSchema:{type:"object",required:["content"]},outputSchemaVersion:"1",contextPolicyVersion:"chapter-context-v1",promptRecipeVersionId:publishedRecipeVersionId,requiredCapabilities:["structured_output"],budgetPolicy:{maxTokens:6000},timeoutMs:120000,retryPolicy:{maxAttempts:2},confirmationPolicy:"before_adopt",createdBy:"integration-ai"};
  let taskContract=await aiContracts.createTaskContract({taskKey:`chapter.generate.${Date.now()}`,name:"章节生成合同",description:"冻结章节生成输入输出与运行策略。",...taskInput});
  assert.equal(taskContract.currentVersion.status,"proposed");
  taskContract=await aiContracts.publishTaskContractVersion(taskContract.id,{versionId:taskContract.currentVersionId,expectedRevision:taskContract.revision,idempotencyKey:`publish-task-${Date.now()}`,actor:"integration-test"});
  const publishedTaskVersionId=taskContract.publishedVersionId;
  assert.equal((await aiContracts.getPublishedTaskContract(taskContract.taskKey)).versions.length,1);
  assert.equal((await aiContracts.listPromptRecipeDependencies(publishedRecipeVersionId)).taskContracts.length,1);

  const manifest=await aiContracts.createContextManifest({bookId:sampleBook.id,taskContractVersionId:publishedTaskVersionId,nodeKey:"draft",createdBy:"integration-test",slots:[{slotKey:"instructions",tokenBudget:500,entries:[{sourceType:"prompt_component",stableObjectId:customPrompt.id,exactVersionId:promptComponentVersionId,inclusionReason:"章节写法约束",priority:100,tokenEstimate:80,transformStatus:"full",sortOrder:0}],exclusions:[]},{slotKey:"sources",tokenBudget:2000,entries:[{sourceType:"body_version",stableObjectId:chapterDocument.id,exactVersionId:candidateB.id,inclusionReason:"当前采用正文",priority:90,tokenEstimate:700,transformStatus:"full",sortOrder:0},{sourceType:"planning_version",stableObjectId:storyPlan.id,exactVersionId:storyPlan.adoptedVersionId,inclusionReason:"当前采用总计划",priority:80,tokenEstimate:300,transformStatus:"summarized",sortOrder:1}],exclusions:[{sourceType:"research_version",stableObjectId:null,exactVersionId:null,reasonCode:"unavailable",reasonDetail:"本次章节未选择研究资产。",priority:20,tokenEstimate:400,sortOrder:0}]}]});
  assert.equal(manifest.status,"complete");
  assert.equal(manifest.slots[1].exclusions[0].reasonCode,"unavailable");
  assert.ok(manifest.slots.flatMap(slot=>slot.entries).every(entry=>entry.contentHash.length===64));
  await assert.rejects(()=>aiContracts.createContextManifest({bookId:sampleBook.id,taskContractVersionId:publishedTaskVersionId,slots:[{slotKey:"instructions",entries:[{sourceType:"prompt_component",stableObjectId:customPrompt.id,exactVersionId:"10000000-0000-4000-8000-000000000001",inclusionReason:"错误版本",priority:1,tokenEstimate:1,transformStatus:"full",sortOrder:0}],exclusions:[]},{slotKey:"sources",entries:[],exclusions:[]}]}),error=>error.status===422);
  await assert.rejects(()=>(async()=>{const pool=await runtime.getNewDesignPool();await pool.query("UPDATE new_design.context_manifests SET manifest_hash=$2 WHERE id=$1",[manifest.id,"0".repeat(64)]);})(),/immutable/);

  const credential=await aiContracts.saveModelCredentialRef({credentialKey:`integration.${Date.now()}`,provider:"openai",secretLocator:"env://INTEGRATION_MODEL_KEY"});
  assert.equal(credential.hasLocator,true);assert.equal(Object.hasOwn(credential,"secretLocator"),false);
  const routeBase={source:"system",fallbackMode:"replace",createdBy:"integration-test"};
  const createAndPublish=async(input)=>{let config=await aiContracts.createModelRouteConfig(input);config=await aiContracts.publishModelRouteVersion(config.id,{versionId:config.currentVersionId,expectedRevision:config.revision,idempotencyKey:`publish-route-${config.id}`,actor:"integration-test"});return config;};
  const systemRoute=await createAndPublish({scope:"system_default",name:"系统默认",...routeBase,provider:"openai",model:"gpt-default",parameters:{temperature:0.7},requiredCapabilities:["text"],credentialRefId:credential.id,budgetPolicy:{maxTokens:5000},timeoutMs:90000,retryPolicy:{maxAttempts:1},fallbacks:[{provider:"openai",model:"gpt-backup",parameters:{},credentialRefId:credential.id,technicalFailureCategories:["timeout","rate_limit"],sortOrder:0}]});
  await createAndPublish({scope:"task_group",taskGroup:"chapter_production",name:"章节任务组",...routeBase,source:"manual",model:"gpt-group",parameters:{temperature:0.6},fallbackMode:"inherit",fallbacks:[]});
  await createAndPublish({scope:"node",taskGroup:"chapter_production",nodeKey:"draft",name:"正文节点",...routeBase,source:"manual",parameters:{temperature:0.5},fallbackMode:"inherit",fallbacks:[]});
  let bookRoute=await createAndPublish({scope:"book",bookId:sampleBook.id,name:"本书路由",...routeBase,source:"manual",model:"gpt-book",fallbackMode:"inherit",fallbacks:[]});
  await createAndPublish({scope:"one_time",bookId:sampleBook.id,overrideKey:"run-once",name:"单次覆盖",...routeBase,source:"manual",parameters:{temperature:0.2},budgetPolicy:{maxTokens:7000},fallbackMode:"inherit",fallbacks:[]});
  const resolvedRoute=await aiContracts.resolveModelRoute({bookId:sampleBook.id,taskContractVersionId:publishedTaskVersionId,nodeKey:"draft",oneTimeOverrideKey:"run-once"});
  assert.equal(resolvedRoute.sourceLayers.length,5);assert.equal(resolvedRoute.model,"gpt-book");assert.equal(resolvedRoute.parameters.temperature,0.2);assert.equal(resolvedRoute.hasCredential,true);assert.equal(JSON.stringify(resolvedRoute).includes("INTEGRATION_MODEL_KEY"),false);
  const routeSnapshot=await aiContracts.createModelRouteSnapshot({bookId:sampleBook.id,taskContractVersionId:publishedTaskVersionId,nodeKey:"draft",oneTimeOverrideKey:"run-once"});
  assert.equal(routeSnapshot.sourceLayers.length,5);assert.equal(JSON.stringify(routeSnapshot).includes("INTEGRATION_MODEL_KEY"),false);
  bookRoute=await aiContracts.addModelRouteVersion(bookRoute.id,{source:"manual",model:"gpt-book-v2",fallbackMode:"inherit",fallbacks:[],expectedRevision:bookRoute.revision,createdBy:"integration-test"});
  bookRoute=await aiContracts.publishModelRouteVersion(bookRoute.id,{versionId:bookRoute.currentVersionId,expectedRevision:bookRoute.revision,idempotencyKey:`publish-route-v2-${bookRoute.id}`,actor:"integration-test"});
  assert.equal((await aiContracts.resolveModelRoute({bookId:sampleBook.id,taskContractVersionId:publishedTaskVersionId,nodeKey:"draft"})).model,"gpt-book-v2");
  assert.equal((await aiContracts.getModelRouteSnapshot(routeSnapshot.id)).model,"gpt-book");

  const secondBook = await templates.createBook({
    key: `parallel_${Date.now().toString(36)}`,
    name: "并行样书",
    description: "验证两本书互不污染。",
    templateVersionId: initialTemplateVersion.id,
  });
  assert.equal((await store.listCards({ spaceId: secondBook.spaceId })).length, 55);

  const proposedRuntimeFact=await facts.proposeCanonicalFact({bookId:sampleBook.id,subjectCardId:viewCharacters[0].id,predicate:`runtime_candidate_${Date.now()}`,valueKind:"text",value:"等待审批的执行结果",sourceMethod:"ai_extract",createdBy:"integration-ai",evidence:[{chapterTextAnchorId:factAnchor.id,extractionMethod:"ai_extract",note:"任务账本只引用候选，不直接确认。"}]});
  const runtimeTaskInput={spaceId:sampleBook.spaceId,bookId:sampleBook.id,taskKey:taskContract.taskKey,taskContractVersionId:publishedTaskVersionId,sourceRoute:`/new-design/books/${sampleBook.id}/cards`,sourceKind:"chapter_document",sourceId:chapterDocument.id,requestIdempotencyKey:`ai-task-${Date.now()}`,priority:20,createdBy:"integration-test",steps:[{stepKey:"draft",sortOrder:0,maxAttempts:3}]};
  let runtimeTask=await aiTasks.createAiTask(runtimeTaskInput);
  const repeatedRuntimeTask=await aiTasks.createAiTask(runtimeTaskInput);
  assert.equal(repeatedRuntimeTask.id,runtimeTask.id);
  await assert.rejects(()=>aiTasks.createAiTask({...runtimeTaskInput,priority:21}),error=>error.status===409);
  let runtimeStep=runtimeTask.steps[0];
  const frozenAttempt={taskId:runtimeTask.id,stepId:runtimeStep.id,taskContractVersionId:publishedTaskVersionId,promptRecipeVersionId:publishedRecipeVersionId,contextManifestId:manifest.id,modelRouteSnapshotId:routeSnapshot.id,inputHash:"a".repeat(64),outputSchemaVersion:"1",checkpointKey:"draft-ready"};
  let attemptLease=await aiTasks.startAiTaskAttempt({...frozenAttempt,expectedStepRevision:runtimeStep.revision,triggerKind:"initial",owner:"worker-a",actorKind:"worker",leaseMs:60000});
  runtimeTask=await aiTasks.failAiTaskAttempt({taskId:runtimeTask.id,stepId:runtimeStep.id,attemptId:attemptLease.attempt.id,leaseToken:attemptLease.leaseToken,expectedStepRevision:attemptLease.step.revision,errorCategory:"timeout",errorSummary:"Bearer secret-token sk-should-redact",providerRequestId:"provider-request-sensitive-1",backoffMs:0,actor:"worker-a"});
  assert.equal(runtimeTask.status,"retry_scheduled");assert.equal(runtimeTask.steps[0].attempts[0].retryEligibility,"technical");assert.equal(runtimeTask.steps[0].attempts[0].errorSummary.includes("secret-token"),false);
  const usage=await aiTasks.recordAiAttemptUsage({attemptId:attemptLease.attempt.id,inputTokens:5000,outputTokens:3000,cachedInputTokens:null,durationMs:1234,estimatedCost:0.12,currency:"USD",fallbackCount:1});
  assert.equal(usage.budgetDecision,"exceeded");
  runtimeStep=runtimeTask.steps[0];
  attemptLease=await aiTasks.startAiTaskAttempt({...frozenAttempt,expectedStepRevision:runtimeStep.revision,triggerKind:"technical_retry",owner:"worker-b",actorKind:"worker",leaseMs:60000});
  runtimeTask=await aiTasks.failAiTaskAttempt({taskId:runtimeTask.id,stepId:runtimeStep.id,attemptId:attemptLease.attempt.id,leaseToken:attemptLease.leaseToken,expectedStepRevision:attemptLease.step.revision,errorCategory:"content_unsatisfactory",errorSummary:"作者认为内容方向不合适",actor:"worker-b"});
  assert.equal(runtimeTask.status,"paused");assert.equal(runtimeTask.steps[0].attempts[1].retryEligibility,"manual");
  await assert.rejects(()=>aiTasks.startAiTaskAttempt({...frozenAttempt,expectedStepRevision:runtimeTask.steps[0].revision,triggerKind:"manual_retry",owner:"worker-c",actorKind:"worker",leaseMs:60000}),error=>error.status===403);
  attemptLease=await aiTasks.startAiTaskAttempt({...frozenAttempt,expectedStepRevision:runtimeTask.steps[0].revision,triggerKind:"manual_retry",owner:"author",actorKind:"user",leaseMs:60000});
  runtimeTask=await aiTasks.succeedAiTaskAttempt({taskId:runtimeTask.id,stepId:runtimeStep.id,attemptId:attemptLease.attempt.id,leaseToken:attemptLease.leaseToken,expectedStepRevision:attemptLease.step.revision,resultKind:"canonical_fact",resultStableId:proposedRuntimeFact.id,resultVersionId:proposedRuntimeFact.id,resultHash:"b".repeat(64),providerRequestId:"provider-request-sensitive-2",checkpointKey:"candidate-saved",requiresApproval:true,actor:"worker-c"});
  assert.equal(runtimeTask.status,"waiting_approval");assert.equal(runtimeTask.steps[0].attempts.length,3);assert.equal(JSON.stringify(runtimeTask).includes("provider-request-sensitive"),false);
  const approval=await aiTasks.requestAiApproval({taskId:runtimeTask.id,stepId:runtimeStep.id,attemptId:attemptLease.attempt.id,scopeKind:"result_candidate",scopeId:proposedRuntimeFact.id,reasonCode:"canonical_adoption",reasonDetail:"候选事实需要作者确认后才能进入正典。",requestedByKind:"policy",requestedBy:"fact-policy-v1"});
  assert.ok((await aiTasks.listPendingAiApprovals({bookId:sampleBook.id})).some(item=>item.id===approval.id));
  const decidedApproval=await aiTasks.decideAiApproval({requestId:approval.id,decision:"approved",decidedByKind:"user",decidedBy:"integration-author",reason:"同意候选，采用仍交给事实领域事务。"});
  assert.equal(decidedApproval.decision.decision,"approved");assert.equal((await facts.getCanonicalFact(proposedRuntimeFact.id)).status,"proposed");
  assert.equal((await aiTasks.listPendingAiApprovals({bookId:sampleBook.id})).some(item=>item.id===approval.id),false);
  await assert.rejects(()=>aiTasks.decideAiApproval({requestId:approval.id,decision:"rejected",decidedByKind:"user",decidedBy:"other"}),error=>error.status===409);
  assert.equal((await aiTasks.summarizeAiUsage({taskId:runtimeTask.id})).estimatedCost,0.12);
  assert.ok((await aiTasks.listFailedAiAttempts({bookId:sampleBook.id,category:"timeout"})).some(item=>item.taskId===runtimeTask.id));
  assert.ok((await aiTasks.listAiTasks({bookId:sampleBook.id,sourceRoute:runtimeTask.sourceRoute,limit:1})).items.some(item=>item.id===runtimeTask.id));

  const finishAuditAttempt=async({reportId,contextManifestId,inputHash,suffix})=>{let task=await aiTasks.createAiTask({...runtimeTaskInput,requestIdempotencyKey:`quality-task-${suffix}-${Date.now()}`,sourceRoute:`/new-design/books/${sampleBook.id}/quality`,sourceKind:"quality_audit",sourceId:chapterDocument.id,steps:[{stepKey:"audit",sortOrder:0,maxAttempts:1}]});const lease=await aiTasks.startAiTaskAttempt({taskId:task.id,stepId:task.steps[0].id,expectedStepRevision:task.steps[0].revision,triggerKind:"initial",owner:`quality-worker-${suffix}`,actorKind:"worker",leaseMs:60000,taskContractVersionId:publishedTaskVersionId,promptRecipeVersionId:publishedRecipeVersionId,contextManifestId,modelRouteSnapshotId:routeSnapshot.id,inputHash,outputSchemaVersion:"1",checkpointKey:"audit-ready"});task=await aiTasks.succeedAiTaskAttempt({taskId:task.id,stepId:lease.step.id,attemptId:lease.attempt.id,leaseToken:lease.leaseToken,expectedStepRevision:lease.step.revision,resultKind:"quality_audit_report",resultStableId:reportId,resultHash:"9".repeat(64),actor:`quality-worker-${suffix}`});return{task,lease};};
  const qualityReportId=randomUUID(),qualityInputHash="e".repeat(64),qualityRun=await finishAuditAttempt({reportId:qualityReportId,contextManifestId:manifest.id,inputHash:qualityInputHash,suffix:"initial"});
  const reportInput={id:qualityReportId,bookId:sampleBook.id,scopeKind:"composite",scopeId:chapterDocument.id,taskId:qualityRun.task.id,stepId:qualityRun.lease.step.id,attemptId:qualityRun.lease.attempt.id,taskContractVersionId:publishedTaskVersionId,promptRecipeVersionId:publishedRecipeVersionId,contextManifestId:manifest.id,modelRouteSnapshotId:routeSnapshot.id,ruleSetKey:"chapter.audit",ruleSetVersion:"quality-2026-09",inputHash:qualityInputHash,policyMode:"completion_first",policyDecision:"record_quality_debt",summary:"保留局部质量债，继续完成全书。",idempotencyKey:`quality-report-${qualityReportId}`,createdBy:"integration-quality",bodyVersions:[{chapterDocumentId:chapterDocument.id,bodyVersionId:candidateB.id}],planningVersions:[{planningObjectId:storyPlan.id,planningVersionId:storyPlan.adoptedVersionId}],factIds:[proposedRuntimeFact.id],issues:[{stableKey:"turn-density",categoryKey:"pacing.scene_turn_density",severity:"medium",confidence:null,title:"场景转折密度偏低",description:"本章转折少于创作目标。",detectionSource:"ai",impactScope:{chapterDocumentId:chapterDocument.id},suggestedAction:"在旧案残痕处补充一次认知转折。",targetValue:3,observedValue:0,scaleVersion:"turn-density-v2",interpretation:"空值与零值分开；这里实测为零。",isQualityDebt:true,evidence:[{evidenceKind:"text_anchor",textAnchorId:factAnchor.id,note:"正文选区显示当前段落只有一次信息揭示。"},{evidenceKind:"rule",ruleKey:"chapter.turn-density",ruleVersion:"2",note:"目标量表要求每章至少三次有效转折。"}],fixCandidate:{targetChapterDocumentId:chapterDocument.id,targetBodyVersionId:candidateB.id,targetAnchorId:factAnchor.id,patch:{operation:"replace_selection",replacement:"沈照微看见旧案残痕时，照骨灯忽然映出第二层字迹。"},source:"ai",createdBy:"quality-worker"}},{stableKey:"voice-observation",categoryKey:"style.voice_distance",severity:"low",confidence:.55,title:"叙述距离可能偏远",description:"这是尚无正本证据支持的模型观察。",detectionSource:"ai",impactScope:{chapterDocumentId:chapterDocument.id},targetValue:null,observedValue:null,scaleVersion:null,interpretation:"未验证观察不升级为事实或阻断项。",evidence:[{evidenceKind:"observation",note:"模型主观观察，等待人工判断。",isUnverifiedObservation:true}]}]};
  let qualityReport=await qualityAudits.createQualityAuditReport(reportInput);
  assert.equal((await qualityAudits.createQualityAuditReport(reportInput)).id,qualityReport.id);
  await assert.rejects(()=>qualityAudits.createQualityAuditReport({...reportInput,summary:"不同结果"}),error=>error.status===409);
  const pauseReportId=randomUUID(),pauseHash="7".repeat(64),pauseRun=await finishAuditAttempt({reportId:pauseReportId,contextManifestId:manifest.id,inputHash:pauseHash,suffix:"pause"});
  const pauseReport=await qualityAudits.createQualityAuditReport({...reportInput,id:pauseReportId,taskId:pauseRun.task.id,stepId:pauseRun.lease.step.id,attemptId:pauseRun.lease.attempt.id,inputHash:pauseHash,idempotencyKey:`quality-report-${pauseReportId}`,policyMode:"quality_first",policyDecision:"pause_for_manual",summary:"质量优先模式在本章边界等待人工判断。",issues:[{stableKey:"manual-pause",categoryKey:"continuity.manual_review",severity:"high",confidence:.8,title:"连续性需要人工判断",description:"证据与规划目标存在需要人工解释的差异。",detectionSource:"rule",impactScope:{chapterDocumentId:chapterDocument.id},evidence:[{evidenceKind:"planning_version",planningVersionId:storyPlan.adoptedVersionId,note:"当前正文走向与冻结总计划需要人工核对。"}],fixCandidate:{targetChapterDocumentId:chapterDocument.id,targetBodyVersionId:candidateB.id,targetAnchorId:factAnchor.id,patch:{operation:"replace_selection",replacement:"等待人工判断的备选文本。"},source:"ai",createdBy:"quality-worker"}}]});
  assert.equal(pauseReport.executionEffect,"pause_for_manual");
  const rejectedFix=await qualityAudits.decideQualityFixCandidate(pauseReport.issues[0].fixCandidates[0].id,{decision:"reject",expectedRevision:1,actor:"integration-author",reason:"不采用这条修复建议。"});assert.equal(rejectedFix.status,"rejected");assert.equal(rejectedFix.events.at(-1).reason,"不采用这条修复建议。");
  const stopReportId=randomUUID(),stopHash="8".repeat(64),stopRun=await finishAuditAttempt({reportId:stopReportId,contextManifestId:manifest.id,inputHash:stopHash,suffix:"replan"});
  const stopReport=await qualityAudits.createQualityAuditReport({...reportInput,id:stopReportId,taskId:stopRun.task.id,stepId:stopRun.lease.step.id,attemptId:stopRun.lease.attempt.id,inputHash:stopHash,idempotencyKey:`quality-report-${stopReportId}`,policyDecision:"replan_required",summary:"明确检测到相邻章节规划必须重排。",issues:[{stableKey:"replan-required",categoryKey:"planning.structure_dependency",severity:"critical",confidence:.95,title:"相邻章节规划依赖失效",description:"当前证据明确要求重新规划后续章节。",detectionSource:"rule",impactScope:{planningObjectId:storyPlan.id},evidence:[{evidenceKind:"planning_version",planningVersionId:storyPlan.adoptedVersionId,note:"冻结规划版本与当前章节结果存在结构性冲突。"}]}]});
  assert.equal(stopReport.executionEffect,"global_stop");
  assert.equal(qualityReport.executionEffect,"quality_debt");assert.equal(qualityReport.issues.find(item=>item.stableKey==="turn-density").currentVersion.targetValue,3);assert.equal(qualityReport.issues.find(item=>item.stableKey==="turn-density").currentVersion.observedValue,0);assert.equal(qualityReport.issues.find(item=>item.stableKey==="voice-observation").currentVersion.evidence[0].isUnverifiedObservation,true);
  assert.equal((await chapterBodies.getChapterDocument(chapterDocument.id)).adoptedVersionId,candidateB.id);
  assert.ok((await qualityAudits.listQualityIssues({bookId:sampleBook.id,bodyVersionId:candidateB.id,categoryKey:"pacing.scene_turn_density",severity:"medium",status:"open",qualityDebtOnly:true})).some(item=>item.reportId===qualityReportId));
  assert.ok((await qualityAudits.listQualityAuditReports({bookId:sampleBook.id,chapterDocumentId:chapterDocument.id,limit:1})).nextCursor);
  await assert.rejects(()=>(async()=>{const pool=await runtime.getNewDesignPool();await pool.query("UPDATE new_design.quality_audit_reports SET summary='覆盖报告' WHERE id=$1",[qualityReportId]);})(),/immutable/);
  let revisedIssue=qualityReport.issues.find(item=>item.stableKey==="turn-density");
  revisedIssue=await qualityAudits.reviseQualityIssue(revisedIssue.id,{categoryKey:"pacing.scene_turn_density",severity:"medium",confidence:.76,title:"场景转折密度偏低",description:"作者核对后保留问题并补充解释。",detectionSource:"manual",impactScope:{chapterDocumentId:chapterDocument.id},suggestedAction:"补充一次认知转折。",targetValue:3,observedValue:0,scaleVersion:"turn-density-v2",interpretation:"人工确认目标与实测口径。",createdBy:"integration-author",evidence:[{evidenceKind:"text_anchor",textAnchorId:factAnchor.id,note:"人工复核同一正文锚点。"}],expectedRevision:revisedIssue.revision});
  assert.equal(revisedIssue.versions.length,2);
  await assert.rejects(()=>qualityAudits.reviseQualityIssue(revisedIssue.id,{...reportInput.issues[0],evidence:reportInput.issues[0].evidence,expectedRevision:1}),error=>error.status===409);
  await facts.reviewCanonicalFact(proposedRuntimeFact.id,{action:"reject",expectedRevision:proposedRuntimeFact.revision,idempotencyKey:`quality-fact-stale-${Date.now()}`,actor:"integration-author",note:"该候选事实不再作为审计依据。"});
  qualityReport=await qualityAudits.getQualityAuditReport(qualityReportId);assert.ok(qualityReport.staleAt);assert.match(qualityReport.staleReason,/事实/);
  const planReportId=randomUUID(),planHash="6".repeat(64),planRun=await finishAuditAttempt({reportId:planReportId,contextManifestId:manifest.id,inputHash:planHash,suffix:"plan-stale"});
  await qualityAudits.createQualityAuditReport({id:planReportId,bookId:sampleBook.id,scopeKind:"planning",scopeId:storyPlan.id,taskId:planRun.task.id,stepId:planRun.lease.step.id,attemptId:planRun.lease.attempt.id,taskContractVersionId:publishedTaskVersionId,promptRecipeVersionId:publishedRecipeVersionId,contextManifestId:manifest.id,modelRouteSnapshotId:routeSnapshot.id,ruleSetKey:"plan.audit",ruleSetVersion:"1",inputHash:planHash,policyMode:"completion_first",policyDecision:"continue",summary:"冻结当前总计划检查结果。",idempotencyKey:`quality-report-${planReportId}`,createdBy:"integration-quality",bodyVersions:[],planningVersions:[{planningObjectId:storyPlan.id,planningVersionId:storyPlan.adoptedVersionId}],factIds:[],issues:[{stableKey:"plan-check",categoryKey:"planning.custom_consistency",severity:"low",confidence:1,title:"规划检查样本",description:"用于验证规划依赖失效。",detectionSource:"rule",impactScope:{planningObjectId:storyPlan.id},evidence:[{evidenceKind:"planning_version",planningVersionId:storyPlan.adoptedVersionId,note:"确切规划版本。"}]}]});
  await (await runtime.getNewDesignPool()).query("UPDATE new_design.planning_versions SET stale_at=now(),stale_reason='集成测试规划依赖失效' WHERE id=$1",[storyPlan.adoptedVersionId]);
  assert.ok((await qualityAudits.getQualityAuditReport(planReportId)).staleAt);
  let qualityIssue=qualityReport.issues.find(item=>item.stableKey==="turn-density"),fixCandidate=qualityIssue.fixCandidates[0];
  fixCandidate=await qualityAudits.reviseQualityFixCandidate(fixCandidate.id,{targetChapterDocumentId:chapterDocument.id,targetBodyVersionId:candidateB.id,targetAnchorId:factAnchor.id,patch:{operation:"replace_selection",replacement:"沈照微看见旧案残痕时，灯影又翻出一行被抹去的字。"},source:"user",createdBy:"integration-author",expectedRevision:fixCandidate.revision});
  await assert.rejects(()=>qualityAudits.reviseQualityFixCandidate(fixCandidate.id,{targetChapterDocumentId:chapterDocument.id,targetBodyVersionId:candidateB.id,targetAnchorId:factAnchor.id,patch:{operation:"replace_selection",replacement:"冲突修订"},source:"user",expectedRevision:1}),error=>error.status===409);
  fixCandidate=await qualityAudits.decideQualityFixCandidate(fixCandidate.id,{decision:"accept",expectedRevision:fixCandidate.revision,actor:"integration-author",reason:"接受修订后的局部补丁。"});
  const fixedBody=await chapterBodies.addChapterBodyVersion(chapterDocument.id,{content:"白水驿夜雨如幕，沈照微点灯后看见了父亲留下的旧案残痕，灯影又翻出一行被抹去的字。",source:"revision",parentVersionId:candidateB.id,baseVersionId:candidateB.id,createdByKind:"user",createdBy:"integration-author"});
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:fixedBody.id,expectedRevision:chapterDocument.revision,idempotencyKey:`quality-fix-body-${Date.now()}`,actor:"integration-author"});
  qualityReport=await qualityAudits.getQualityAuditReport(qualityReportId);assert.ok(qualityReport.staleAt);assert.ok(qualityReport.issues[0].events.some(event=>event.toStatus==="stale"));
  const fixBodyAdoption=chapterDocument.adoptions.find(item=>item.toVersionId===fixedBody.id);
  fixCandidate=await qualityAudits.recordQualityFixAdoption(fixCandidate.id,{candidateVersionId:fixCandidate.acceptedVersionId,chapterBodyAdoptionId:fixBodyAdoption.id,idempotencyKey:`quality-fix-adoption-${Date.now()}`,actor:"integration-author"});
  qualityIssue=await qualityAudits.getQualityIssue(qualityIssue.id);assert.equal(fixCandidate.status,"applied");assert.equal(qualityIssue.currentStatus,"fixed");
  const recheckManifest=await aiContracts.createContextManifest({bookId:sampleBook.id,taskContractVersionId:publishedTaskVersionId,nodeKey:"draft",createdBy:"integration-recheck",slots:[{slotKey:"instructions",entries:[{sourceType:"prompt_component",stableObjectId:customPrompt.id,exactVersionId:promptComponentVersionId,inclusionReason:"复检规则",priority:100,tokenEstimate:80,transformStatus:"full",sortOrder:0}],exclusions:[]},{slotKey:"sources",entries:[{sourceType:"body_version",stableObjectId:chapterDocument.id,exactVersionId:fixedBody.id,inclusionReason:"修复后当前正文",priority:100,tokenEstimate:800,transformStatus:"full",sortOrder:0}],exclusions:[]} ]});
  const recheckReportId=randomUUID(),recheckHash="f".repeat(64),recheckRun=await finishAuditAttempt({reportId:recheckReportId,contextManifestId:recheckManifest.id,inputHash:recheckHash,suffix:"recheck"});
  await qualityAudits.createQualityAuditReport({id:recheckReportId,bookId:sampleBook.id,scopeKind:"body",scopeId:chapterDocument.id,taskId:recheckRun.task.id,stepId:recheckRun.lease.step.id,attemptId:recheckRun.lease.attempt.id,taskContractVersionId:publishedTaskVersionId,promptRecipeVersionId:publishedRecipeVersionId,contextManifestId:recheckManifest.id,modelRouteSnapshotId:routeSnapshot.id,ruleSetKey:"chapter.audit",ruleSetVersion:"quality-2026-09",inputHash:recheckHash,policyMode:"completion_first",policyDecision:"continue",summary:"复检未再发现原问题。",idempotencyKey:`quality-report-${recheckReportId}`,createdBy:"integration-recheck",bodyVersions:[{chapterDocumentId:chapterDocument.id,bodyVersionId:fixedBody.id}],planningVersions:[],factIds:[],issues:[]});
  const recheck=await qualityAudits.recordQualityRecheck({issueId:qualityIssue.id,fixCandidateId:fixCandidate.id,recheckReportId,checkedBodyVersionId:fixedBody.id,outcome:"supports_verified",evidenceSummary:"复检报告绑定修复后正文，原转折密度问题不再出现。",idempotencyKey:`quality-recheck-${Date.now()}`,actor:"integration-author"});
  assert.equal((await qualityAudits.getQualityIssue(qualityIssue.id)).currentStatus,"verified");assert.equal(recheck.status,"active");
  assert.deepEqual(await qualityAudits.listQualityIssues({bookId:secondBook.id}),[]);
  chapterDocument=await chapterBodies.adoptChapterBodyVersion(chapterDocument.id,{versionId:candidateB.id,expectedRevision:chapterDocument.revision,idempotencyKey:`quality-recheck-stale-${Date.now()}`,actor:"integration-author"});
  assert.equal((await qualityAudits.listQualityRechecks(qualityIssue.id))[0].status,"stale");assert.equal((await qualityAudits.getQualityIssue(qualityIssue.id)).currentStatus,"stale");
  const staleReports=await qualityAudits.listQualityAuditReports({bookId:sampleBook.id,staleOnly:true});assert.ok(staleReports.items.some(item=>item.id===qualityReportId)&&staleReports.items.some(item=>item.id===recheckReportId));
  const persistedQualityReportId=qualityReportId,persistedQualityIssueId=qualityIssue.id;

  const recoveryTaskInput={...runtimeTaskInput,requestIdempotencyKey:`ai-recovery-${Date.now()}`,sourceRoute:`/new-design/books/${sampleBook.id}/recovery`};
  let recoveryTask=await aiTasks.createAiTask(recoveryTaskInput),recoveryStep=recoveryTask.steps[0];
  assert.ok((await aiTasks.listAiTasks({bookId:sampleBook.id,limit:1})).nextCursor);
  const oldLease=await aiTasks.startAiTaskAttempt({...frozenAttempt,taskId:recoveryTask.id,stepId:recoveryStep.id,expectedStepRevision:recoveryStep.revision,triggerKind:"initial",owner:"worker-old",actorKind:"worker",leaseMs:60000});
  recoveryTask=await aiTasks.heartbeatAiTaskStep({taskId:recoveryTask.id,stepId:recoveryStep.id,attemptId:oldLease.attempt.id,leaseToken:oldLease.leaseToken,owner:"worker-old",expectedStepRevision:oldLease.step.revision,leaseMs:60000,checkpointKey:"draft-halfway"});
  assert.equal(recoveryTask.currentCheckpoint,"draft-halfway");
  await (await runtime.getNewDesignPool()).query("UPDATE new_design.ai_task_steps SET status='running',lease_expires_at=now()-interval '1 second',revision=revision+1,updated_at=now() WHERE id=$1",[recoveryStep.id]);
  assert.ok((await aiTasks.listRecoverableAiTasks({bookId:sampleBook.id})).some(item=>item.id===recoveryTask.id));
  const recoveredLease=await aiTasks.recoverExpiredAiTaskStep({taskId:recoveryTask.id,stepId:recoveryStep.id,owner:"worker-new",leaseMs:60000,actor:"recovery-test"});
  assert.equal(recoveredLease.attempt.attemptNumber,2);assert.equal(recoveredLease.attempt.triggerKind,"recovery");
  await assert.rejects(()=>aiTasks.succeedAiTaskAttempt({taskId:recoveryTask.id,stepId:recoveryStep.id,attemptId:oldLease.attempt.id,leaseToken:oldLease.leaseToken,expectedStepRevision:oldLease.step.revision,resultKind:"test_result",resultStableId:proposedRuntimeFact.id,resultHash:"c".repeat(64)}),error=>error.status===409);
  recoveryTask=await aiTasks.succeedAiTaskAttempt({taskId:recoveryTask.id,stepId:recoveryStep.id,attemptId:recoveredLease.attempt.id,leaseToken:recoveredLease.leaseToken,expectedStepRevision:recoveredLease.step.revision,resultKind:"test_result",resultStableId:proposedRuntimeFact.id,resultHash:"d".repeat(64),actor:"worker-new"});
  assert.equal(recoveryTask.status,"succeeded");
  await assert.rejects(()=>(async()=>{const pool=await runtime.getNewDesignPool();await pool.query("UPDATE new_design.ai_tasks SET status='running',revision=revision+1,updated_at=now() WHERE id=$1",[recoveryTask.id]);})(),/illegal AI task status transition/);
  await assert.rejects(()=>aiTasks.createAiTask({...runtimeTaskInput,spaceId:sampleBook.spaceId,bookId:secondBook.id,requestIdempotencyKey:`wrong-book-task-${Date.now()}`}),/book and space mismatch/);
  const persistedRuntimeTaskId=runtimeTask.id,persistedRecoveryTaskId=recoveryTask.id;

  let localCharacterType = bookTypes.find((type) => type.key === "character");
  const secondCharacterType = (await store.listCardTypes(secondBook.spaceId)).find((type) => type.key === "character");
  assert.ok(localCharacterType && secondCharacterType);
  localCharacterType = await store.updateCardType(localCharacterType.id, {
    name: "本书人物",
    description: "只属于照骨山河的角色称呼。",
    semanticCapabilities: localCharacterType.semanticCapabilities,
    fields: localCharacterType.draftFields.map((field) => field.key === "story_role"
      ? { ...field, name: "本书身份", options: field.options.map((option) => option.value === "protagonist" ? { ...option, label: "提灯主角" } : option) }
      : field),
    revision: localCharacterType.revision,
  });
  localCharacterType = await store.publishCardType(localCharacterType.id, localCharacterType.revision);
  assert.equal(localCharacterType.name, "本书人物");
  assert.equal(localCharacterType.draftFields.find((field) => field.key === "story_role").name, "本书身份");
  assert.equal((await store.getCardType(secondCharacterType.id)).name, "人物");
  assert.equal((await store.getCardType(secondCharacterType.id)).draftFields.find((field) => field.key === "story_role").name, "人物定位");

  let systemEventType = await store.getCardType(systemTypes.find((type) => type.key === "event").id);
  systemEventType = await store.updateCardType(systemEventType.id, {
    name: systemEventType.name,
    description: systemEventType.description,
    semanticCapabilities: systemEventType.semanticCapabilities,
    fields: [...systemEventType.draftFields, {
      key: "production_note", name: "生产备注", description: "模板后续新增的可选字段", type: "long_text",
      required: false, defaultValue: null, options: [], group: "生产管理", order: 9_900,
    }],
    revision: systemEventType.revision,
  });
  await store.publishCardType(systemEventType.id, systemEventType.revision);
  const currentTemplate = (await templates.listTemplates()).find((template) => template.id === defaultTemplate.id);
  const publishedTemplate = await templates.publishTemplate(currentTemplate.id, currentTemplate.revision);
  assert.equal(publishedTemplate.currentVersion, initialTemplateVersion.version + 1);
  const templateVersion2 = (await templates.listTemplateVersions(defaultTemplate.id))[0];
  const syncPreview = await templates.previewBookSync(sampleBook.id, templateVersion2.id);
  assert.ok(syncPreview.additions.some((addition) => addition.typeKey === "event" && addition.fields.some((field) => field.key === "production_note")));
  assert.equal(syncPreview.conflicts.length, 0);
  await templates.applyBookSync(syncPreview.id);
  assert.ok((await store.listCardTypes(sampleBook.spaceId)).find((type) => type.key === "event").draftFields.some((field) => field.key === "production_note"));
  assert.ok(!(await store.listCardTypes(secondBook.spaceId)).find((type) => type.key === "event").draftFields.some((field) => field.key === "production_note"));

  const suffix = Date.now().toString(36);
  let cardType = await store.createCardType({
    key: `character_${suffix}`,
    name: "人物",
    description: "人物卡片集成验证",
    semanticCapabilities: ["relation_subject", "state_change"],
    fields: personFields(),
  });
  cardType = await store.publishCardType(cardType.id, cardType.revision);
  assert.equal(cardType.currentVersion, 1);

  await assert.rejects(
    () => store.createCard({ cardTypeId: cardType.id, title: "错误人物", values: { age: "十八", unknown: true } }),
    (error) => Boolean(error.status === 422 && error.issues.age && error.issues.name && error.issues.unknown),
  );

  let card = await store.createCard({
    cardTypeId: cardType.id,
    title: "林雾",
    values: { name: "林雾", story_role: "主角", personality: "谨慎但执着", age: 18 },
  });
  card = await store.updateCard(card.id, { ...card, title: "林雾（成年）", values: { ...card.values, age: 19 } });

  cardType = await store.updateCardType(cardType.id, {
    name: cardType.name,
    description: cardType.description,
    semanticCapabilities: cardType.semanticCapabilities,
    fields: [...cardType.draftFields, { key: "secret", name: "秘密", description: "尚未公开的信息", type: "long_text", required: false, defaultValue: null, options: [], group: "人物内核", order: 4 }],
    revision: cardType.revision,
  });
  cardType = await store.publishCardType(cardType.id, cardType.revision);
  assert.equal(cardType.currentVersion, 2);

  card = await store.updateCard(card.id, { ...card, values: { ...card.values, secret: "来自旧城" } });
  assert.equal(card.typeVersion, 2);
  card = await store.archiveCard(card.id, card.revision);
  assert.equal(card.status, "archived");
  card = await store.restoreCard(card.id, card.revision);
  assert.equal(card.status, "active");
  assert.equal((await store.listCardVersions(card.id)).length, 5);

  const persistedId = card.id;
  await runtime.stopNewDesignDatabase();
  const restarted = await store.getCard(persistedId);
  assert.equal(restarted.title, "林雾（成年）");
  assert.equal(restarted.values.secret, "来自旧城");
  assert.equal(restarted.status, "active");
  const restartedPrompt = await store.getCard(customPrompt.id);
  assert.equal(restartedPrompt.values.content, "已完成一次版本修订。");
  assert.equal(restartedPrompt.status, "active");
  const persistedChangeSet = await (await runtime.getNewDesignPool()).query("SELECT status FROM new_design.book_change_sets WHERE id=$1", [timePreview.id]);
  assert.equal(persistedChangeSet.rows[0].status, "applied");
  const restartedResearch = await research.getResearchRecord(persistedResearchId);
  assert.equal(restartedResearch.currentVersion.report,"# 测试拆书\n\n持久化报告。");
  assert.deepEqual(restartedResearch.tags,["测试","可恢复"]);
  assert.equal((await store.getCard(persistedMarketSignalId)).title,"仙侠成长解谜信号");
  const restartedAnalysisCard = await store.getCard(persistedAnalysisCardId);
  assert.equal(restartedAnalysisCard.values.personality,"谨慎追查铜铃旧案，并在每次选择后承担可见代价");
  assert.equal((await research.getResearchRecord(analysisRun.recordId)).currentVersion.report.startsWith("# 拆书报告"),true);
  assert.equal((await referencePacks.getReferencePack(referencePack.id)).versionCount,2);
  assert.equal((await referencePacks.listBookResearchReferences(researchBook.id))[0].packVersionId,lockedPackVersionId);
  const restartedChapterDocument=await chapterBodies.getChapterDocument(persistedChapterDocumentId);
  assert.equal(restartedChapterDocument.versions.length,4);
  assert.equal(restartedChapterDocument.adoptedVersionId,candidateB.id);
  assert.equal(restartedChapterDocument.anchors.find((item)=>item.id===manualAnchor.id).isStale,true);
  assert.equal((await facts.getCanonicalFact(persistedCorrectedFactId)).status,"confirmed");
  assert.equal((await facts.getCanonicalFact(persistedPendingFactId)).status,"stale");
  assert.equal((await states.getSettlement(persistedSupersededSettlementId)).status,"superseded");
  assert.equal((await states.getStateValueMapping(persistedStateMappingId)).currentVersion,1);
  assert.equal((await states.listCurrentState(sampleBook.id)).find((item)=>item.subjectId===viewCharacters[0].id&&item.stateKey==="energy").value,100);
  const restartedKnowledge=await knowledge.getKnowledgeStateProposal(persistedKnowledgeProposalId);
  assert.equal(restartedKnowledge.status,"invalidated");
  assert.equal(restartedKnowledge.versions.length,2);
  assert.equal((await storyTimeline.getStoryTimeProposal(persistedParallelTimeProposalId)).status,"stale");
  assert.equal((await storyTimeline.getStoryTimeProposal(persistedOccurredTimeProposalId)).status,"confirmed");
  assert.equal((await storyTimeline.listCurrentStoryTimings(sampleBook.id)).find((item)=>item.eventCardId===parallelEventA.id).lifecycle,"occurred");
  const restartedStoryPlan=await planning.getPlanningObject(persistedStoryPlanId);
  assert.equal(restartedStoryPlan.versions.length,2);
  assert.ok((await planning.getPlanningVersionContext(persistedScenePlanVersionId)).ancestors.length===3);
  assert.equal((await aiContracts.getContextManifest(manifest.id)).manifestHash,manifest.manifestHash);
  assert.equal((await aiContracts.getModelRouteSnapshot(routeSnapshot.id)).snapshotHash,routeSnapshot.snapshotHash);
  assert.equal((await aiContracts.getPublishedTaskContract(taskContract.taskKey)).publishedVersionId,publishedTaskVersionId);
  assert.equal((await aiTasks.getAiTask(persistedRuntimeTaskId)).steps[0].attempts.length,3);
  assert.equal((await aiTasks.getAiTask(persistedRecoveryTaskId)).steps[0].attempts[0].status,"discarded");
  assert.equal((await qualityAudits.getQualityAuditReport(persistedQualityReportId)).issues.find(item=>item.stableKey==="turn-density").id,persistedQualityIssueId);
  assert.equal((await qualityAudits.listQualityRechecks(persistedQualityIssueId))[0].status,"stale");
  await assert.rejects(()=>aiContracts.createContextManifest({bookId:secondBook.id,taskContractVersionId:publishedTaskVersionId,slots:[{slotKey:"instructions",entries:[{sourceType:"prompt_component",stableObjectId:customPrompt.id,exactVersionId:promptComponentVersionId,inclusionReason:"公共提示词",priority:1,tokenEstimate:1,transformStatus:"full",sortOrder:0}],exclusions:[]},{slotKey:"sources",entries:[{sourceType:"body_version",stableObjectId:chapterDocument.id,exactVersionId:candidateB.id,inclusionReason:"错误书籍正文",priority:1,tokenEstimate:1,transformStatus:"full",sortOrder:0}],exclusions:[]}]}),error=>error.status===422);
});
