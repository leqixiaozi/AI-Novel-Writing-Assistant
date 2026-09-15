const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

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
  assert.equal(systemTypes.length, 30);
  assert.equal(new Set(systemTypes.map((cardType) => cardType.key)).size, 30);
  for (const key of ["character", "organization", "world_rule", "event", "volume", "scene", "genre_strategy", "progression_mode", "writing_config", "quality_rule", "reference_material", "world_overview", "power_system", "race", "culture", "religion", "prompt_component"]) {
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
  const viewEvent = viewWorkspace.cards.find((card) => card.typeKey === "event");
  const viewChapters = viewWorkspace.cards.filter((card) => card.typeKey === "chapter");
  const viewCharacters = viewWorkspace.cards.filter((card) => card.typeKey === "character");
  const viewClue = viewWorkspace.cards.find((card) => ["clue_evidence", "foreshadow"].includes(card.typeKey));
  assert.ok(viewEvent && viewChapters.length >= 2 && viewCharacters.length >= 2 && viewClue);

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
  assert.equal(strategyResources.length, 12);
  assert.deepEqual(
    Object.fromEntries(["genre_strategy", "progression_mode", "writing_config", "quality_rule"].map((typeKey) => [typeKey, strategyResources.filter((item) => item.typeKey === typeKey).length])),
    { genre_strategy: 3, progression_mode: 3, writing_config: 2, quality_rule: 4 },
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

  const secondBook = await templates.createBook({
    key: `parallel_${Date.now().toString(36)}`,
    name: "并行样书",
    description: "验证两本书互不污染。",
    templateVersionId: initialTemplateVersion.id,
  });
  assert.equal((await store.listCards({ spaceId: secondBook.spaceId })).length, 55);

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
});
