const test = require("node:test");
const assert = require("node:assert/strict");
const { aiAttemptFailureSchema, aiAttemptStartSchema, aiAttemptUsageSchema, aiTaskCreateSchema, bookChangePreviewSchema, bookCreationReviewSchema, bookCreationSessionInputSchema, completeBookCreationSchema, bookViewConfigSchema, canonicalFactInputSchema, canonicalFactReviewSchema, chapterBodyAdoptionSchema, chapterBodyVersionInputSchema, chapterTextAnchorInputSchema, contextManifestCreateSchema, knowledgeStateProposalInputSchema, modelCredentialRefSchema, modelRouteCreateSchema, planningObjectInputSchema, planningVersionInputSchema, promptRecipeCreateSchema, qualityAuditReportCreateSchema, qualityRecheckSchema, researchDocumentInputSchema, stateChangeProposalInputSchema, stateValueMappingSchema, storyRelationProposalInputSchema, storyTimeProposalInputSchema, validateCardValues, validatePublishedEvolution } = require("../dist/server/domain/validation.js");
const { buildCardTypeTree } = require("../dist/common/cardTypeTree.js");
const { selectableTreeNodeIds, treeDescendantIds, validateTreeSelection, wouldCreateTreeCycle } = require("../dist/common/treePolicy.js");
const { normalizeBookCreationReview, validateBookCreationReviewCards } = require("../dist/server/domain/bookCreation/index.js");
const { isPrimaryMarketList,parseFanqieDetail,parseFanqieRanking,parseQidianRanking,parseJinjiangRanking } = require("../dist/server/research/marketSources.js");

const fields = [
  { key: "name", name: "姓名", description: "", type: "short_text", required: true, defaultValue: null, options: [], group: "基本信息", order: 0 },
  { key: "age", name: "年龄", description: "", type: "number", required: false, defaultValue: null, options: [], group: "基本信息", order: 1 },
];

test("card validation rejects missing, invalid and unknown values", () => {
  const result = validateCardValues(fields, { age: "十八", surprise: true });
  assert.equal(result.issues.name, "姓名为必填项。");
  assert.equal(result.issues.age, "年龄需要填写有效数字。");
  assert.match(result.issues.surprise, /不在当前元卡片定义中/);
});

test("tree rules keep cycles, branches, levels and selection counts deterministic",()=>{
  const nodes=[
    {id:"root",parentId:null,status:"active"},
    {id:"branch",parentId:"root",status:"active"},
    {id:"leaf",parentId:"branch",status:"active"},
    {id:"other",parentId:"root",status:"active"},
    {id:"archived",parentId:"branch",status:"archived"},
  ];
  assert.deepEqual([...treeDescendantIds(nodes,"branch")].sort(),["archived","leaf"]);
  assert.equal(wouldCreateTreeCycle(nodes,"root","leaf"),true);
  const direct={mode:"multiple",rootNodeId:"root",depthMode:"direct_children",relativeDepth:null,leafOnly:false,allowParentSelection:true,showFullPath:true,allowInlineCreate:false,aiSuggestible:true,minSelections:1,maxSelections:2};
  assert.deepEqual([...selectableTreeNodeIds(nodes,direct)].sort(),["branch","other"]);
  assert.equal(validateTreeSelection(nodes,direct,["branch"]).valid,true);
  assert.match(validateTreeSelection(nodes,direct,["leaf"]).message,/允许分支或层级/);
  assert.match(validateTreeSelection(nodes,direct,[]).message,/至少选择 1 项/);
  const relative={...direct,depthMode:"relative_depth",relativeDepth:2};
  assert.deepEqual([...selectableTreeNodeIds(nodes,relative)].sort(),["branch","leaf","other","root"]);
});

test("dictionary-backed fields validate stored stable node ids instead of display labels",()=>{
  const dictionaryField={key:"location",name:"地点",description:"",type:"select",required:true,defaultValue:null,options:[],group:"场景",order:0,optionSource:{kind:"dictionary_tree",dictionaryId:"10000000-0000-4000-8000-000000000001",rule:{mode:"single",rootNodeId:null,depthMode:"whole_tree",relativeDepth:null,leafOnly:false,allowParentSelection:true,showFullPath:true,allowInlineCreate:false,aiSuggestible:true,minSelections:1,maxSelections:1},settleOnChapter:false}};
  assert.deepEqual(validateCardValues([dictionaryField],{location:"20000000-0000-4000-8000-000000000001"}).issues,{});
  assert.match(validateCardValues([dictionaryField],{location:["20000000-0000-4000-8000-000000000001"]}).issues.location,/选择无效/);
});

test("published schema only accepts new optional fields", () => {
  const optional = { key: "secret", name: "秘密", description: "", type: "long_text", required: false, defaultValue: null, options: [], group: "人物内核", order: 2 };
  assert.deepEqual(validatePublishedEvolution(fields, [...fields, optional]), {});
  assert.ok(validatePublishedEvolution(fields, fields.slice(0, 1)).fields);
  assert.ok(validatePublishedEvolution(fields, [...fields, { ...optional, required: true }]).secret);
});

test("book creation inputs keep entry method separate from template structure", () => {
  const common = { templateVersionId: "40000000-0000-4000-8000-000000000002", description: "", sourceReference: "", inputPayload: {} };
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "blank", bookName: "" }).success, false);
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "blank", bookName: "新书" }).success, true);
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "idea", bookName: "", inputPayload: { idea: "一条真实灵感" } }).success, true);
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "market", bookName: "" }).success, false);
  assert.equal(bookCreationSessionInputSchema.safeParse({ ...common, method: "reference", bookName: "", researchVersionIds:["10000000-0000-4000-8000-000000000001"] }).success, true);
});

test("book creation review validates one editable contract before creation",()=>{
  const card={id:"10000000-0000-4000-8000-000000000001",typeKey:"character",title:"主角",values:{name:"林川"},sourceKind:"ai",sourceId:null,sourceVersionId:null,originalTitle:"主角",originalValues:{name:"林川"}};
  const review={bookName:"守脉者",description:"仙侠悬疑",reviewCards:[card],revision:2};
  assert.equal(bookCreationReviewSchema.safeParse(review).success,true);
  assert.equal(bookCreationReviewSchema.safeParse({...review,bookName:""}).success,false);
  assert.equal(bookCreationReviewSchema.safeParse({...review,reviewCards:[card,card]}).success,false);
  assert.equal(completeBookCreationSchema.safeParse({expectedRevision:3}).success,true);
  assert.equal(completeBookCreationSchema.safeParse({}).success,false);
});

test("book creation review locks provenance and permits incomplete drafts only",()=>{
  const original={id:"10000000-0000-4000-8000-000000000001",typeKey:"character",title:"主角",values:{name:"林川"},sourceKind:"ai",sourceId:null,sourceVersionId:null,originalTitle:"主角",originalValues:{name:"林川"}};
  const edited={...original,typeKey:"location",title:"新的标题",values:{name:"周宁"},sourceKind:"research",originalValues:{name:"伪造初稿"}};
  const normalized=normalizeBookCreationReview([edited,{...edited,id:"20000000-0000-4000-8000-000000000001"}],[original]);
  assert.equal(normalized[0].typeKey,"character");
  assert.equal(normalized[0].sourceKind,"ai");
  assert.deepEqual(normalized[0].originalValues,{name:"林川"});
  assert.deepEqual(normalized[0].values,{name:"周宁"});
  assert.equal(normalized[1].sourceKind,"manual");
  assert.equal(normalized[1].sourceId,null);
  const types=[{key:"character",name:"人物",description:"",fields}];
  const empty={...original,values:{}};
  assert.deepEqual(validateBookCreationReviewCards([empty],types,[],false).issues,{});
  assert.match(validateBookCreationReviewCards([empty],types,[],true).issues[`${original.id}.name`],/必填/);
  assert.match(validateBookCreationReviewCards([{...original,values:{age:"十八"}}],types,[],false).issues[`${original.id}.age`],/有效数字/);
});

test("card type tree keeps matching leaves with their ancestor path", () => {
  const category = { id: "cat-world", key: "world", name: "世界设定", parentId: null, sortOrder: 10, status: "active", isSystem: true, revision: 1, createdAt: "", updatedAt: "" };
  const type = { id: "type-power", categoryId: category.id, key: "power_system", name: "能力体系", description: "修炼与科技", sortOrder: 10 };
  assert.equal(buildCardTypeTree([category], [type]).at(0).typeCount, 1);
  const searched = buildCardTypeTree([category], [type], "修炼");
  assert.equal(searched.length, 1);
  assert.equal(searched[0].cardTypes[0].id, type.id);
  assert.equal(buildCardTypeTree([category], [type], "人物").length, 0);
});

test("book view config accepts presentation state but rejects fact copies", () => {
  assert.equal(bookViewConfigSchema.safeParse({ config:{ groupBy:"story_time",sort:"start_order",expanded:[] },revision:1 }).success,true);
  assert.equal(bookViewConfigSchema.safeParse({ config:{ copiedEvent:{ title:"不应进入视图配置" } },revision:1 }).success,false);
});

test("high-impact book changes require a typed preview payload", () => {
  const cardId = "10000000-0000-4000-8000-000000000001";
  assert.equal(bookChangePreviewSchema.safeParse({
    operationKey:"story_time",
    input:{ cardId,startOrder:8,endOrder:10,startLabel:"初八",endLabel:"初十",uncertainty:"" },
  }).success,true);
  assert.equal(bookChangePreviewSchema.safeParse({
    operationKey:"story_time",
    input:{ cardId,startOrder:10,endOrder:8,startLabel:"初十",endLabel:"初八",uncertainty:"" },
  }).success,false);
  assert.equal(bookChangePreviewSchema.safeParse({
    operationKey:"character_relation",
    input:{ cardId,startOrder:8,endOrder:10 },
  }).success,false);
});

test("research text intake rejects empty placeholders", () => {
  assert.equal(researchDocumentInputSchema.safeParse({ title:"样章",content:"太短",sourceKind:"paste",sourceUrl:"" }).success,false);
  assert.equal(researchDocumentInputSchema.safeParse({ title:"样章",content:"这是一段真实可分析的测试文本，长度足以形成不可变来源版本。",sourceKind:"paste",sourceUrl:"" }).success,true);
});

test("chapter body versions and exact anchors require explicit immutable inputs",()=>{
  assert.equal(chapterBodyVersionInputSchema.safeParse({content:"第一章正文",source:"ai_candidate",createdByKind:"ai"}).success,true);
  assert.equal(chapterBodyVersionInputSchema.safeParse({content:"",source:"ai_candidate",createdByKind:"ai"}).success,false);
  assert.equal(chapterBodyAdoptionSchema.safeParse({versionId:"10000000-0000-4000-8000-000000000001",expectedRevision:1,idempotencyKey:"adopt-chapter-1"}).success,true);
  assert.equal(chapterTextAnchorInputSchema.safeParse({startOffset:5,endOffset:3,label:"错误锚点"}).success,false);
});

test("canonical facts always enter through a typed evidence-backed proposal",()=>{
  const common={subjectCardId:"10000000-0000-4000-8000-000000000001",predicate:"current_location",valueKind:"text",value:"白水驿",sourceMethod:"ai_extract",evidence:[{chapterTextAnchorId:"20000000-0000-4000-8000-000000000001",extractionMethod:"ai_extract"}]};
  assert.equal(canonicalFactInputSchema.safeParse(common).success,true);
  assert.equal(canonicalFactInputSchema.safeParse({...common,value:undefined}).success,false);
  assert.equal(canonicalFactInputSchema.safeParse({...common,evidence:[]}).success,false);
  assert.equal(canonicalFactInputSchema.safeParse({...common,evidence:[{...common.evidence[0],researchEvidenceId:"30000000-0000-4000-8000-000000000001"}]}).success,false);
  assert.equal(canonicalFactReviewSchema.safeParse({action:"confirm",expectedRevision:1,idempotencyKey:"confirm-fact-1"}).success,true);
});

test("state proposals require explicit before and after values",()=>{
  const common={chapterDocumentId:"10000000-0000-4000-8000-000000000001",bodyVersionId:"20000000-0000-4000-8000-000000000001",subjectKind:"card",subjectId:"30000000-0000-4000-8000-000000000001",stateKey:"energy",beforeValue:100,afterValue:72,delta:-28,reason:"施法消耗",source:"ai"};
  assert.equal(stateChangeProposalInputSchema.safeParse(common).success,true);
  const {beforeValue,...withoutBefore}=common;
  assert.equal(stateChangeProposalInputSchema.safeParse(withoutBefore).success,false);
  assert.equal(stateChangeProposalInputSchema.safeParse({...common,beforeValue:null,afterValue:"held"}).success,true);
  assert.equal(stateValueMappingSchema.safeParse({spaceId:"40000000-0000-4000-8000-000000000001",typeKey:"character",fieldKey:"energy",ranges:[{min:0,max:30,label:"低",value:"需要恢复"}]}).success,true);
});

test("AI knowledge proposals require a holder and exact adopted-body evidence",()=>{
  const common={holderKind:"character",holderCardId:"10000000-0000-4000-8000-000000000001",claim:{subjectCardId:"20000000-0000-4000-8000-000000000001",predicate:"knows_secret",valueKind:"boolean",value:true},source:"ai",stance:"suspects",acquisitionMethod:"inferred",chapterDocumentId:"30000000-0000-4000-8000-000000000001",bodyVersionId:"40000000-0000-4000-8000-000000000001",textAnchorId:"50000000-0000-4000-8000-000000000001",effectiveNarrativeOrder:8,reason:"正文证据"};
  assert.equal(knowledgeStateProposalInputSchema.safeParse(common).success,true);
  assert.equal(knowledgeStateProposalInputSchema.safeParse({...common,textAnchorId:null}).success,false);
  assert.equal(knowledgeStateProposalInputSchema.safeParse({...common,holderCardId:null}).success,false);
  assert.equal(knowledgeStateProposalInputSchema.safeParse({...common,holderKind:"reader",holderCardId:null,holderKey:"default"}).success,true);
});

test("complete story time keeps unknown values null and rejects illegal ranges",()=>{
  const base={eventCardId:"10000000-0000-4000-8000-000000000001",proposalSource:"manual",lifecycle:"planned",startCertainty:"unknown",endCertainty:"unknown",evidenceKind:"manual",reason:"时间待定"};
  assert.equal(storyTimeProposalInputSchema.safeParse({...base,timeMode:"unknown"}).success,true);
  assert.equal(storyTimeProposalInputSchema.safeParse({...base,timeMode:"unknown",normalizedStart:0}).success,false);
  assert.equal(storyTimeProposalInputSchema.safeParse({...base,timeMode:"custom_calendar",startCertainty:"known",endCertainty:"known",calendarKey:"jinghe",startLabel:"初十",endLabel:"初八",normalizedStart:10,normalizedEnd:8}).success,false);
  assert.equal(storyTimeProposalInputSchema.safeParse({...base,timeMode:"relative",relativeToEventCardId:"20000000-0000-4000-8000-000000000001",relativeRelation:"after"}).success,true);
});

test("story relations separate temporal and causal semantics",()=>{
  const base={proposalSource:"ai",sourceEventCardId:"10000000-0000-4000-8000-000000000001",targetEventCardId:"20000000-0000-4000-8000-000000000001",evidenceKind:"body",chapterDocumentId:"30000000-0000-4000-8000-000000000001",bodyVersionId:"40000000-0000-4000-8000-000000000001",textAnchorId:"50000000-0000-4000-8000-000000000001",reason:"正文关系"};
  assert.equal(storyRelationProposalInputSchema.safeParse({...base,relationFamily:"temporal",relationType:"before"}).success,true);
  assert.equal(storyRelationProposalInputSchema.safeParse({...base,relationFamily:"causal",relationType:"causes"}).success,true);
  assert.equal(storyRelationProposalInputSchema.safeParse({...base,relationFamily:"causal",relationType:"overlaps"}).success,false);
  assert.equal(storyRelationProposalInputSchema.safeParse({...base,relationFamily:"causal",relationType:"causes",targetEventCardId:base.sourceEventCardId}).success,false);
});

test("planning objects enforce the story-volume-chapter-scene ownership shape",()=>{
  const content={goal:"完成当前层计划"};
  assert.equal(planningObjectInputSchema.safeParse({level:"story",title:"总计划",sortOrder:0,content,source:"manual"}).success,true);
  assert.equal(planningObjectInputSchema.safeParse({level:"story",parentObjectId:"10000000-0000-4000-8000-000000000001",title:"错误总计划",sortOrder:0,content,source:"manual"}).success,false);
  assert.equal(planningObjectInputSchema.safeParse({level:"chapter",title:"缺少归属",sortOrder:0,content,source:"ai"}).success,false);
});

test("body-origin planning revisions require an exact adopted body version reference",()=>{
  const base={content:{goal:"依据正文修正规划"},source:"body_revision",expectedRevision:1};
  assert.equal(planningVersionInputSchema.safeParse(base).success,false);
  assert.equal(planningVersionInputSchema.safeParse({...base,sourceBodyVersionId:"10000000-0000-4000-8000-000000000001"}).success,true);
  assert.equal(planningVersionInputSchema.safeParse({...base,source:"manual",sourceBodyVersionId:"10000000-0000-4000-8000-000000000001"}).success,false);
});

test("AI execution contracts reject ambiguous slots, raw secrets and quality fallbacks",()=>{
  const component={componentCardId:"10000000-0000-4000-8000-000000000001",componentVersionId:"20000000-0000-4000-8000-000000000001",sortOrder:0,required:true};
  const recipe={recipeKey:"chapter.generate",name:"章节生成",source:"manual",variablesSchema:{type:"object",properties:{book_name:{type:"string"}}},slots:[{slotKey:"instructions",sortOrder:0,required:true,allowedContentTypes:["prompt_component"],variableContract:{required:["book_name"]},components:[component]}]};
  assert.equal(promptRecipeCreateSchema.safeParse(recipe).success,true);
  assert.equal(promptRecipeCreateSchema.safeParse({...recipe,slots:[...recipe.slots,{...recipe.slots[0]}]}).success,false);
  assert.equal(modelCredentialRefSchema.safeParse({credentialKey:"openai.primary",provider:"openai",secretLocator:"env://OPENAI_API_KEY"}).success,true);
  assert.equal(modelCredentialRefSchema.safeParse({credentialKey:"openai.primary",provider:"openai",secretLocator:"sk-raw-secret"}).success,false);
  const route={scope:"system_default",name:"默认路由",source:"system",provider:"openai",model:"gpt",parameters:{},requiredCapabilities:[],budgetPolicy:{maxTokens:1000},timeoutMs:30000,retryPolicy:{maxAttempts:1},fallbackMode:"replace",fallbacks:[{provider:"openai",model:"backup",parameters:{},technicalFailureCategories:["timeout"],sortOrder:0}]};
  assert.equal(modelRouteCreateSchema.safeParse(route).success,true);
  assert.equal(modelRouteCreateSchema.safeParse({...route,fallbacks:[{...route.fallbacks[0],technicalFailureCategories:["content_quality"]}]}).success,false);
  assert.equal(contextManifestCreateSchema.safeParse({bookId:"10000000-0000-4000-8000-000000000001",taskContractVersionId:"20000000-0000-4000-8000-000000000001",slots:[{slotKey:"sources",entries:[],exclusions:[{sourceType:"research_version",stableObjectId:null,exactVersionId:null,reasonCode:"unavailable",reasonDetail:"未选择研究资料",priority:null,tokenEstimate:null,sortOrder:0}]}]}).success,true);
});

test("AI task ledger inputs keep frozen references and unknown usage explicit",()=>{
  const ids=[1,2,3,4,5].map(value=>`${value}0000000-0000-4000-8000-000000000001`),hash="a".repeat(64);
  assert.equal(aiTaskCreateSchema.safeParse({spaceId:ids[0],bookId:ids[1],taskKey:"chapter.generate",taskContractVersionId:ids[2],sourceRoute:"/new-design/books/1/cards",sourceKind:"chapter",sourceId:ids[3],requestIdempotencyKey:"task-request-1",steps:[{stepKey:"draft",sortOrder:0,maxAttempts:3}]}).success,true);
  const start={taskId:ids[0],stepId:ids[1],expectedStepRevision:1,triggerKind:"initial",owner:"worker",actorKind:"worker",leaseMs:30000,taskContractVersionId:ids[2],promptRecipeVersionId:ids[3],contextManifestId:ids[4],modelRouteSnapshotId:ids[0],inputHash:hash,outputSchemaVersion:"1"};
  assert.equal(aiAttemptStartSchema.safeParse(start).success,true);
  assert.equal(aiAttemptStartSchema.safeParse({...start,inputHash:"raw input"}).success,false);
  assert.equal(aiAttemptFailureSchema.safeParse({taskId:ids[0],stepId:ids[1],attemptId:ids[2],leaseToken:ids[3],expectedStepRevision:2,errorCategory:"content_unsatisfactory",errorSummary:"用户不满意"}).success,true);
  assert.equal(aiAttemptFailureSchema.safeParse({taskId:ids[0],stepId:ids[1],attemptId:ids[2],leaseToken:ids[3],expectedStepRevision:2,errorCategory:"quality_fallback",errorSummary:"错误回退"}).success,false);
  assert.equal(aiAttemptUsageSchema.safeParse({attemptId:ids[0],inputTokens:null,outputTokens:null,cachedInputTokens:null,durationMs:null}).success,true);
  assert.equal(aiAttemptUsageSchema.safeParse({attemptId:ids[0],estimatedCost:0.1}).success,false);
});

test("quality audit inputs keep targets, observations and evidence semantics separate",()=>{
  const ids=Array.from({length:10},(_,index)=>`${String(index+1).padStart(8,"0")}-0000-4000-8000-000000000001`),base={id:ids[0],bookId:ids[1],scopeKind:"body",scopeId:ids[2],taskId:ids[3],stepId:ids[4],attemptId:ids[5],taskContractVersionId:ids[6],promptRecipeVersionId:ids[7],contextManifestId:ids[8],modelRouteSnapshotId:ids[9],ruleSetKey:"chapter.audit",ruleSetVersion:"2026-09",inputHash:"c".repeat(64),policyMode:"completion_first",policyDecision:"record_quality_debt",idempotencyKey:"quality-report-1",bodyVersions:[{chapterDocumentId:ids[2],bodyVersionId:ids[3]}],planningVersions:[],factIds:[],issues:[{stableKey:"pacing.custom_dimension",categoryKey:"pacing.scene_turn_density",severity:"medium",confidence:null,title:"场景转折偏少",description:"检测观察",detectionSource:"ai",impactScope:{chapter:1},targetValue:3,observedValue:0,scaleVersion:"turn-count-v2",evidence:[{evidenceKind:"observation",note:"模型观察，尚无正本证据",isUnverifiedObservation:true}]}]};
  assert.equal(qualityAuditReportCreateSchema.safeParse(base).success,true);
  assert.equal(qualityAuditReportCreateSchema.safeParse({...base,policyDecision:"pause_for_manual"}).success,false);
  assert.equal(qualityAuditReportCreateSchema.safeParse({...base,issues:[{...base.issues[0],evidence:[{evidenceKind:"observation",note:"未标记"}]}]}).success,false);
  assert.equal(qualityAuditReportCreateSchema.safeParse({...base,bodyVersions:[],planningVersions:[],factIds:[]}).success,false);
  assert.equal(qualityRecheckSchema.safeParse({issueId:ids[0],recheckReportId:ids[1],checkedBodyVersionId:ids[2],outcome:"supports_verified",evidenceSummary:"复检报告已不再发现该问题。",idempotencyKey:"quality-recheck-1"}).success,true);
});

test("public ranking adapters only extract source metadata",()=>{
  const fanqie={platform:"fanqie",platformLabel:"番茄小说",listKey:"reading",listLabel:"阅读榜",channel:"general",sourceUrl:"https://fanqienovel.com/rank"};
  const qidian={platform:"qidian",platformLabel:"起点中文网",listKey:"hotsales",listLabel:"畅销榜",channel:"male",sourceUrl:"https://m.qidian.com/rank/hotsales/"};
  const jinjiang={platform:"jinjiang",platformLabel:"晋江文学城",listKey:"monthly",listLabel:"月度榜",channel:"female",sourceUrl:"https://m.jjwxc.net/rank/naturalmore/5"};
  assert.equal(parseFanqieRanking('<div class="rank-book-item"><div class="book-item-index"><h1>1</h1></div><div class="title"><a href="/page/1">山河问道</a></div><div class="author"><span>青石</span></div><div class="desc abstract">【仙侠＋成长】少年入山</div><div class="book-item-footer">10万人在读 连载中</div></div></main>',fanqie)[0].title,"山河问道");
  assert.equal(parseQidianRanking('<a href="/book/1"><h2 title="畅销榜第1位">星门</h2><p class="subTitle">作者甲 · 仙侠 · 热门</p></a>',qidian)[0].category,"仙侠");
  assert.equal(parseJinjiangRanking('<li><a href="/book2/123">长夜有灯</a></li>',jinjiang)[0].sourceUrl,"https://m.jjwxc.net/book2/123");
});

test("market radar keeps the old project's evidence hierarchy and Fanqie recovery",()=>{
  assert.equal(isPrimaryMarketList("new_book"),true);
  assert.equal(isPrimaryMarketList("new_author"),true);
  assert.equal(isPrimaryMarketList("monthly_ticket"),false);
  const recovered=parseFanqieDetail('<h1>问道长生</h1><a class="author-name-text">青山</a><div class="page-abstract-content"><p>【仙侠＋成长】少年守山。</p></div>',{rank:1,title:"\uE123\uE124",tags:[],sourceUrl:"https://fanqienovel.com/page/1"});
  assert.equal(recovered.title,"问道长生");
  assert.deepEqual(recovered.tags,["仙侠","成长"]);
});
