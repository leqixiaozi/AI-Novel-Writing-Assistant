# 新版承接旧版功能价值实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不调用旧版业务、数据库和模型运行时的前提下，让新版完整承接旧版有效功能，并按新版信息架构、版本、候选、采用、来源和恢复合同完成必要适配。

**Architecture:** 旧版代码只作为业务规则和用户结果的只读依据；新版继续由 `new-design/src/client`、`new-design/src/server/http`、专业数据库模块、独立 AI 网关和 PostgreSQL `new_design` schema 实现。现有资料、规划、正文、任务、图片和导出底座优先复用；只有创作中枢会话、世界生成会话、漫画成图／导出和短剧领域缺少正本时才增加手动迁移。

**Tech Stack:** React 19、TypeScript、Express、Zod、PostgreSQL 17、Node test runner、Vite、新版独立 AI PromptAsset／managed execution。

**Spec:** `doc/10产品/旧版功能价值迁移.md`

## Global Constraints

- 旧版 `client/`、`server/`、`shared/` 业务代码只读；新版不得调用旧版 API、SQLite、Prisma、模型配置或任务运行时。
- 旧版校验条件、状态流转、错误语义、恢复方式和最终结果默认保留；只有新版底层约束、明确体验证据或已证实缺陷允许调整。
- 页面和菜单按新版信息架构组织，不恢复第二套书内主线；现有八步工作流仍是唯一书内主线。
- AI 结果先保存为可追溯候选；正式来源只能经作者明确采用，来源变化必须失效或进入待复核。
- 未知模型或后台结果只允许按原请求键核对／恢复，不得换键重发。
- 新增 SQL 均列入手动迁移清单；本计划只编写迁移和隔离验证，不安装作者数据库。
- 实现期间编写目标合同测试；全部功能接线完成后再统一执行构建、边界、回归和浏览器调试。
- 不调用真实模型，不创建或修改作者作品，不推送、不合并、不部署、不打包。
- 保留当前工作树的无关修改；每次提交仅暂存本任务文件，提交主题使用 `新增：`、`优化：` 或 `修复：`。

## Read-only Legacy Logic Sources

| 迁移模块 | 旧版逻辑依据（只读） |
| --- | --- |
| 创作中枢 | `client/src/pages/creativeHub/`、`client/src/api/creativeHub.ts`、`server/src/routes/creativeHub.ts`、旧版 Agent 工具与 workspace 投影 |
| 世界样本 | `client/src/pages/worlds/`、`client/src/api/world.ts`、`server/src/modules/setup/world/http/`、`server/src/services/world/` |
| 书架与小说 | `client/src/pages/novels/NovelList.tsx`、`client/src/pages/novels/components/list/`、`client/src/pages/novels/NovelPreview.tsx`、简易／专业章节页面 |
| 公共资源与设置 | `client/src/pages/genres/`、`storyModes/`、`titles/`、`knowledge/`、`writingFormula/`、`antiAiRules/`、`characters/`、`promptWorkbench/`、`settings/` |
| 漫画 | `client/src/pages/comic/`、`server/src/modules/comic/http/comicRoutes.ts`、`server/src/services/comic/`、旧版漫画 PromptAsset |
| 短剧 | `client/src/pages/drama/`、`client/src/api/drama.ts`、`server/src/modules/drama/http/dramaRoutes.ts`、`server/src/services/drama/`、旧版短剧 PromptAsset |

执行每个任务时先从上述来源提取前置条件、状态、错误、恢复和结果，再映射到任务所列新版接口；不得直接 import 或复制旧版业务模块。

---

### Task 1: 新版创作中枢会话与只读诊断底座

**Files:**
- Create: `new-design/migrations/115_creative_hub.sql`
- Create: `new-design/src/common/creativeHub.ts`
- Create: `new-design/src/server/database/creativeHub/index.ts`
- Create: `new-design/src/server/http/creativeHub/index.ts`
- Create: `new-design/src/server/ai/prompts/creativeHub.ts`
- Modify: `new-design/src/server/ai/prompts/index.ts`
- Modify: `new-design/src/server/http/router.ts`
- Modify: `new-design/src/server/runtime/manifest.ts`
- Create: `new-design/tests/creative-hub.unit.test.cjs`
- Create: `new-design/tests/creative-hub.postgres.test.cjs`

**Interfaces:**
- Consumes: `AiGateway`, `preparePrompt`, `authorTasks`、`directorFollowup`、`bookshelf`、`multiviewAuthor` 的只读查询。
- Produces: `CreativeHubThread`, `CreativeHubBinding`, `CreativeHubTurn`, `CreativeHubState`, `CreativeHubDiagnosticAction`; `listCreativeHubThreads()`, `createCreativeHubThread()`, `updateCreativeHubThread()`, `archiveCreativeHubThread()`, `readCreativeHubState()`, `listCreativeHubTurns()`, `startCreativeHubTurn()`, `resumeCreativeHubTurn()`。

- [ ] **Step 1: 写会话、绑定、迟到回复和只读动作的失败测试**

```js
test("creative hub keeps one active book binding and never exposes a write tool", async () => {
  const thread = await fixture.createThread({ bookId: book.id });
  assert.equal(thread.binding.bookId, book.id);
  assert.deepEqual(thread.availableActions.map(item => item.kind).sort(), [
    "explain_failure", "find_entry", "impact_analysis", "query_status",
  ]);
});

test("late assistant result stays on the original turn", async () => {
  const first = await fixture.startTurn({ requestKey: "hub-request-001" });
  await fixture.startTurn({ requestKey: "hub-request-002" });
  const recovered = await fixture.recover("hub-request-001");
  assert.equal(recovered.turnId, first.turnId);
  assert.equal(recovered.repeated, true);
});
```

- [ ] **Step 2: 运行定向测试并确认缺少合同**

Run: `node --test tests/creative-hub.unit.test.cjs tests/creative-hub.postgres.test.cjs`（工作目录 `new-design`）
Expected: FAIL，提示迁移、模块或导出尚不存在；不得因数据库连接配置缺失而提前失败。

- [ ] **Step 3: 实现最小会话正本、只读工具目录和 PromptAsset**

```ts
export type CreativeHubActionKind =
  | "query_status"
  | "explain_failure"
  | "impact_analysis"
  | "find_entry";

export interface CreativeHubBinding {
  bookId: string | null;
  chapterDocumentId: string | null;
  taskKind: string | null;
  taskId: string | null;
}

export interface CreativeHubDiagnosticAction {
  kind: CreativeHubActionKind;
  title: string;
  summary: string;
  href: string | null;
  evidence: readonly { source: string; id: string; label: string }[];
}
```

`115_creative_hub.sql` 只保存线程、绑定、turn、原请求键、冻结输入、回复和归档事件；业务事实继续从现有只读投影读取。工具注册表不得提供生成、保存、采用、恢复、重试、取消或审批写入工具。

- [ ] **Step 4: 验证会话、只读边界和原键恢复**

Run: `npm run build:server && node --test tests/creative-hub.unit.test.cjs tests/creative-hub.postgres.test.cjs`（工作目录 `new-design`）
Expected: PASS；跨书绑定、迟到回复、相同键不同输入和写入工具拒绝均有断言。

- [ ] **Step 5: 提交创作中枢底座**

```powershell
git add -- new-design/migrations/115_creative_hub.sql new-design/src/common/creativeHub.ts new-design/src/server/database/creativeHub new-design/src/server/http/creativeHub new-design/src/server/ai/prompts new-design/src/server/http/router.ts new-design/src/server/runtime/manifest.ts new-design/tests/creative-hub.unit.test.cjs new-design/tests/creative-hub.postgres.test.cjs
git commit -m "新增：建立新版创作中枢只读诊断底座"
```

### Task 2: 创作中枢页面、持续会话和准确导航

**Files:**
- Create: `new-design/src/client/creativeHub/api.ts`
- Create: `new-design/src/client/creativeHub/CreativeHubPage.tsx`
- Create: `new-design/src/client/creativeHub/CreativeHubThreadList.tsx`
- Create: `new-design/src/client/creativeHub/CreativeHubConversation.tsx`
- Create: `new-design/src/client/creativeHub/creative-hub.css`
- Modify: `new-design/src/client/api.ts`
- Modify: `new-design/src/client/NewDesignPage.tsx`
- Modify: `new-design/src/client/navigation.ts`
- Create: `new-design/tests/creative-hub-navigation.unit.test.cjs`

**Interfaces:**
- Consumes: Task 1 的 `/creative-hub/threads`、`/state`、`/turns`、`/runs`、`/original-receipt`。
- Produces: `/new-design/creative-hub`; `creativeHubApi`; 书籍、章节、任务和来源页面的稳定深链。

- [ ] **Step 1: 写路由、会话切换和只读动作测试**

```js
test("creative hub route keeps the shell and maps actions to source pages", () => {
  assert.match(source, /path==="\/new-design\/creative-hub"/);
  assert.match(source, /href=\{action\.href\}/);
  assert.doesNotMatch(source, /continueDirector|saveChapter|approve/);
});
```

- [ ] **Step 2: 运行测试确认页面尚未接线**

Run: `node --test tests/creative-hub-navigation.unit.test.cjs`（工作目录 `new-design`）
Expected: FAIL，缺少路由和页面。

- [ ] **Step 3: 实现持续会话 UI**

页面分为线程列表、当前绑定与对话主区；线程切换以 `threadId` 深链保持，书籍／章节／任务绑定显示来源并可明确更换。状态解释和建议动作展示证据与正式入口，所有写操作按钮只导航，不在中枢执行。

```ts
export const creativeHubApi = {
  listThreads,
  createThread,
  updateThread,
  archiveThread,
  readState,
  listTurns,
  startTurn,
  readOriginalReceipt,
};
```

- [ ] **Step 4: 验证客户端类型和导航合同**

Run: `npm run typecheck:client && node --test tests/creative-hub-navigation.unit.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交创作中枢页面**

```powershell
git add -- new-design/src/client/creativeHub new-design/src/client/api.ts new-design/src/client/NewDesignPage.tsx new-design/src/client/navigation.ts new-design/tests/creative-hub-navigation.unit.test.cjs
git commit -m "新增：接入新版创作中枢持续会话"
```

### Task 3: 独立世界样本生成与深化工作区

**Files:**
- Create: `new-design/migrations/116_world_generation_sessions.sql`
- Create: `new-design/src/common/worldGeneration.ts`
- Create: `new-design/src/server/database/worldGeneration/index.ts`
- Create: `new-design/src/server/http/worldGeneration/index.ts`
- Create: `new-design/src/server/ai/prompts/worldGeneration.ts`
- Create: `new-design/src/client/worldGenerator/api.ts`
- Create: `new-design/src/client/worldGenerator/WorldGeneratorPage.tsx`
- Create: `new-design/src/client/worldGenerator/WorldWorkspacePage.tsx`
- Create: `new-design/src/client/worldGenerator/world-generator.css`
- Modify: `new-design/src/server/ai/prompts/index.ts`
- Modify: `new-design/src/server/http/router.ts`
- Modify: `new-design/src/server/runtime/manifest.ts`
- Modify: `new-design/src/client/api.ts`
- Modify: `new-design/src/client/NewDesignPage.tsx`
- Modify: `new-design/src/client/worldCatalog/WorldCatalogPage.tsx`
- Create: `new-design/tests/world-generation.unit.test.cjs`
- Create: `new-design/tests/world-generation.postgres.test.cjs`

**Interfaces:**
- Consumes: 公共世界根档案、`worldPackages`、`worldConsistency`、公共资料版本和新版 AI 网关。
- Produces: `WorldGenerationSession`, `WorldGenerationBlueprint`, `WorldGenerationCandidate`; `startWorldGeneration()`, `readWorldGenerationOriginal()`, `saveWorldGenerationCandidate()`, `publishWorldCandidate()`。

- [ ] **Step 1: 写旧版世界逻辑映射测试**

```js
test("world wizard freezes template references and publishes only by explicit command", async () => {
  const run = await fixture.start({ inspiration: "浮空群岛", templateKey: "fantasy" });
  assert.equal(run.candidate.status, "candidate");
  assert.equal(run.publicRootCardId, null);
  const published = await fixture.publish({ sessionId: run.sessionId, candidateId: run.candidate.id });
  assert.ok(published.publicRootCardId);
});
```

覆盖灵感分析、模板／参考选择、属性建议、蓝图、骨架、六层深化、规则／势力／地点／关系、手工修改、重新生成、来源变化拒绝和明确发布。

- [ ] **Step 2: 运行测试确认生成会话不存在**

Run: `node --test tests/world-generation.unit.test.cjs tests/world-generation.postgres.test.cjs`（工作目录 `new-design`）
Expected: FAIL，缺少会话和命令。

- [ ] **Step 3: 以新版候选和世界包实现生成链**

```ts
export interface WorldGenerationBlueprint {
  premise: string;
  templateKey: string | null;
  references: readonly { cardId: string; versionId: string }[];
  properties: Readonly<Record<string, string | readonly string[]>>;
  layers: readonly "overview" | "rules" | "factions" | "locations" | "relations" | "tensions"[];
}
```

生成回复写入会话候选，不创建正式世界；作者发布时复用 `worldPackages` 的公共根档案与版本命令。深化和一致性修复继续生成新候选，不覆盖已发布版本。

- [ ] **Step 4: 接入两页工作区并验证**

`/new-design/resources/worlds/new` 承载三步生成，`/new-design/resources/worlds/:rootCardId` 承载手册、六层、关系和历史；从目录进入时保持原版本。
Run: `npm run build:server && npm run typecheck:client && node --test tests/world-generation.unit.test.cjs tests/world-generation.postgres.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交世界样本生成**

```powershell
git add -- new-design/migrations/116_world_generation_sessions.sql new-design/src/common/worldGeneration.ts new-design/src/server/database/worldGeneration new-design/src/server/http/worldGeneration new-design/src/server/ai/prompts new-design/src/server/http/router.ts new-design/src/server/runtime/manifest.ts new-design/src/client/worldGenerator new-design/src/client/api.ts new-design/src/client/NewDesignPage.tsx new-design/src/client/worldCatalog/WorldCatalogPage.tsx new-design/tests/world-generation.unit.test.cjs new-design/tests/world-generation.postgres.test.cjs
git commit -m "新增：补齐新版世界样本生成与深化"
```

### Task 4: 首页、向导、公共资产与系统设置价值迁移

**Files:**
- Create: `new-design/src/client/guide/NewDesignGuidePage.tsx`
- Create: `new-design/src/client/guide/guide.css`
- Create: `new-design/src/client/systemSettings/SystemSettingsPage.tsx`
- Create: `new-design/src/client/systemSettings/preferences.ts`
- Modify: `new-design/src/client/NewDesignLanding.tsx`
- Modify: `new-design/src/client/ResourceCenterPage.tsx`
- Modify: `new-design/src/client/StrategyResourcesPage.tsx`
- Modify: `new-design/src/client/modelSettings/index.tsx`
- Modify: `new-design/src/client/ContextManagementPage.tsx`
- Modify: `new-design/src/client/operations/OperationsMaintenancePage.tsx`
- Modify: `new-design/src/client/ResearchRecordsPage.tsx`
- Modify: `new-design/src/client/MarketRadarPage.tsx`
- Modify: `new-design/src/client/BookAnalysisPage.tsx`
- Modify: `new-design/src/client/ReferencePacksPage.tsx`
- Modify: `new-design/src/client/knowledgeReference/index.tsx`
- Modify: `new-design/src/client/NewDesignPage.tsx`
- Modify: `new-design/src/client/navigation.ts`
- Create: `new-design/tests/global-legacy-value.unit.test.cjs`

**Interfaces:**
- Consumes: `home`、`creationDirector`、`professionalResources`、`promptManagement`、`modelSettings`、`researchAdoption`、`knowledgeReference`、`knowledgeIndex`、`authorTasks` 的现有接口。
- Produces: `/new-design/guide`, `/new-design/structure/settings`; 题材、推进模式、写法、反 AI 规则、人物、世界、标题、视觉、提示词、市场雷达、拆书、研究记录、参考包和知识文档的新版来源入口。

- [ ] **Step 1: 写五里程碑向导和资源入口失败测试**

```js
test("guide derives all milestones from real new-design state", () => {
  assert.match(guideSource, /创作环境/);
  assert.match(guideSource, /灵感与方向/);
  assert.match(guideSource, /开书准备/);
  assert.match(guideSource, /生产方式/);
  assert.match(guideSource, /首章成稿/);
  assert.doesNotMatch(guideSource, /useState\([^)]*completed/);
});
```

资源入口测试逐项要求题材基底、推进模式、标题、知识、世界、写法、反 AI 规则、人物和视觉资源可发现，并指向现有新版来源，不新增重复正本。研究测试覆盖雷达选择作品、拆书原请求恢复、研究记录、参考包固定版本、明确目标书采用、知识上传／解析／索引／引用／归档和跨书拒绝。

- [ ] **Step 2: 运行测试确认缺少向导和统一设置**

Run: `node --test tests/global-legacy-value.unit.test.cjs`（工作目录 `new-design`）
Expected: FAIL，缺少向导／设置路由或资源映射。

- [ ] **Step 3: 实现真实状态向导和聚合设置**

向导只读取模型可用性、开书会话、导演运行和采用正文；始终给出一个推荐下一步。系统设置聚合模型／任务路由、知识索引、问题策略、维护和本机会话级界面偏好，不复制旧设置存储。研究与知识页面保留旧版可完成的操作，但采用和引用统一走新版确切版本及目标书合同。

- [ ] **Step 4: 验证入口、术语和类型**

Run: `npm run typecheck:client && node --test tests/global-legacy-value.unit.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交全局功能入口**

```powershell
git add -- new-design/src/client/guide new-design/src/client/systemSettings new-design/src/client/NewDesignLanding.tsx new-design/src/client/ResourceCenterPage.tsx new-design/src/client/StrategyResourcesPage.tsx new-design/src/client/modelSettings new-design/src/client/ContextManagementPage.tsx new-design/src/client/operations/OperationsMaintenancePage.tsx new-design/src/client/ResearchRecordsPage.tsx new-design/src/client/MarketRadarPage.tsx new-design/src/client/BookAnalysisPage.tsx new-design/src/client/ReferencePacksPage.tsx new-design/src/client/knowledgeReference new-design/src/client/NewDesignPage.tsx new-design/src/client/navigation.ts new-design/tests/global-legacy-value.unit.test.cjs
git commit -m "优化：补齐新版向导资源与设置入口"
```

### Task 5: 书架、简易／专业创作、封面与导出差项闭合

**Files:**
- Modify: `new-design/src/client/BooksPage.tsx`
- Modify: `new-design/src/client/bookshelf/index.tsx`
- Modify: `new-design/src/client/bookshelf/ReadingPage.tsx`
- Modify: `new-design/src/client/simpleCreation/index.tsx`
- Modify: `new-design/src/client/storyWorkspace/index.ts`
- Modify: `new-design/src/client/planningCenter/PlanningCenterPage.tsx`
- Modify: `new-design/src/client/bookComposition/BookCompositionPage.tsx`
- Modify: `new-design/src/client/productionDirector/index.tsx`
- Modify: `new-design/src/client/chapterWriting/ChapterWritingPage.tsx`
- Modify: `new-design/src/client/BookWorkspacePage.tsx`
- Modify: `new-design/src/client/visualAssets/index.tsx`
- Modify: `new-design/src/client/imageGeneration/index.tsx`
- Modify: `new-design/src/client/completionExport/CompletionExportPage.tsx`
- Modify: `new-design/src/common/bookshelf/presentation.ts`
- Modify: `new-design/src/server/database/bookshelf/index.ts`
- Modify: `new-design/src/server/http/bookshelf/index.ts`
- Create: `new-design/tests/book-workflow-legacy-value.unit.test.cjs`
- Create: `new-design/tests/book-workflow-legacy-value.postgres.test.cjs`

**Interfaces:**
- Consumes: 书籍分类正式来源、八步采用状态、规划／正文版本、导演投影、质量账本、视觉资产、图片原回复、完本检查和 publication export。
- Produces: 新版书架的形式／来源／平台／发布筛选，精确继续／恢复入口，保存稿阅读，完整八步操作，封面生成状态和 TXT／Markdown／DOCX 导出反馈。

- [ ] **Step 1: 写筛选、任务状态、阅读版本和封面恢复测试**

```js
test("bookshelf filters only by adopted classification values", async () => {
  const result = await fixture.list({ form: "long", sourceMode: "original" });
  assert.deepEqual(result.items.map(item => item.id), [classifiedBook.id]);
  assert.equal(result.items[0].classificationSource, "adopted_book_contract");
});
```

覆盖 24 本分页、运行态只读刷新、继续卡最多三本、失败／暂停／待确认、saved/adopted 阅读稿、章节与整本下载、封面原键恢复及主图绑定。八步测试逐项覆盖创作方向、故事设定、世界／人物、故事／卷／章规划、编排、正文候选／编辑／比较／采用／结算、质量诊断／修复／复检、多维视图、历史和完本导出；辅助工具不增加新主步骤。

- [ ] **Step 2: 运行测试确认现存差项**

Run: `node --test tests/book-workflow-legacy-value.unit.test.cjs tests/book-workflow-legacy-value.postgres.test.cjs`（工作目录 `new-design`）
Expected: FAIL 在尚未等价的正式分类、任务投影或封面状态断言。

- [ ] **Step 3: 复用现有新版正本闭合操作**

不得增加旧版式 `draft/published` 推断；筛选只读作品约定或正式分类。继续、恢复和任务详情使用原导演／任务 ID。八步沿用旧版成熟的前置、状态和操作结果，但保存到新版规划、正文、质量与结算正本。封面生成仍先候选再明确绑定；阅读与导出明确 saved/adopted/formal/review_draft 范围。

- [ ] **Step 4: 验证书架和业务接口**

Run: `npm run build:server && npm run typecheck:client && node --test tests/book-workflow-legacy-value.unit.test.cjs tests/book-workflow-legacy-value.postgres.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交小说入口差项**

```powershell
git add -- new-design/src/client/BooksPage.tsx new-design/src/client/bookshelf new-design/src/client/simpleCreation new-design/src/client/storyWorkspace new-design/src/client/planningCenter/PlanningCenterPage.tsx new-design/src/client/bookComposition new-design/src/client/productionDirector new-design/src/client/chapterWriting new-design/src/client/BookWorkspacePage.tsx new-design/src/client/visualAssets new-design/src/client/imageGeneration new-design/src/client/completionExport new-design/src/common/bookshelf new-design/src/server/database/bookshelf new-design/src/server/http/bookshelf new-design/tests/book-workflow-legacy-value.unit.test.cjs new-design/tests/book-workflow-legacy-value.postgres.test.cjs
git commit -m "优化：闭合新版书架与创作入口能力"
```

### Task 6: 漫画来源、大纲与整话分镜 AI 候选

**Files:**
- Create: `new-design/src/server/ai/prompts/comic.ts`
- Modify: `new-design/src/server/ai/prompts/index.ts`
- Modify: `new-design/src/common/comicSourceBundle.ts`
- Modify: `new-design/src/common/comicEpisodes.ts`
- Modify: `new-design/src/common/comicPanels.ts`
- Modify: `new-design/src/server/database/comicSourceBundle/index.ts`
- Modify: `new-design/src/server/database/comicEpisodes/index.ts`
- Modify: `new-design/src/server/database/comicPanels/index.ts`
- Modify: `new-design/src/server/http/comicSourceBundle/index.ts`
- Modify: `new-design/src/server/http/comicEpisodes/index.ts`
- Modify: `new-design/src/server/http/comicPanels/index.ts`
- Modify: `new-design/src/client/comicProjects/ComicSourceBundleEditor.tsx`
- Modify: `new-design/src/client/comicProjects/ComicEpisodePlanner.tsx`
- Modify: `new-design/src/client/comicProjects/ComicPanelEditor.tsx`
- Create: `new-design/tests/comic-ai-generation.unit.test.cjs`
- Create: `new-design/tests/comic-ai-generation.postgres.test.cjs`

**Interfaces:**
- Consumes: 漫画冻结来源 109、分集版本 110、分镜版本 111、来源整理 113、新版 managed AI execution。
- Produces: `startComicSourceExtraction()`, `startComicEpisodeOutline()`, `startComicPanelScript()`, `readComicGenerationOriginal()`；结果只写现有候选版本。

- [ ] **Step 1: 写三类 AI 候选和旧来源失效测试**

```js
test("comic panel generation cannot adopt or overwrite an older outline", async () => {
  const run = await fixture.generatePanels({ episodeVersionId: outlineV1.id });
  await fixture.adoptOutline(outlineV2.id);
  const result = await fixture.readResult(run.requestKey);
  assert.equal(result.readiness, "stale_source");
  assert.equal(result.panelSet.adopted, false);
});
```

- [ ] **Step 2: 运行测试确认只有人工候选**

Run: `node --test tests/comic-ai-generation.unit.test.cjs tests/comic-ai-generation.postgres.test.cjs`（工作目录 `new-design`）
Expected: FAIL，缺少 PromptAsset 和开始生成命令。

- [ ] **Step 3: 实现 PromptAsset、冻结上下文和候选写入**

```ts
export type ComicGenerationOperation =
  | "source_extract"
  | "episode_outline"
  | "panel_script";

export interface ComicGenerationReceipt {
  requestKey: string;
  operation: ComicGenerationOperation;
  sourceVersionIds: readonly string[];
  candidateVersionId: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "unknown";
  repeated: boolean;
}
```

旧版节奏、付费卡点、角色／场景连续性和分镜字段作为结构化输出要求迁移；任务结果调用现有保存候选命令，不自动采用。

- [ ] **Step 4: 验证三条生成链**

Run: `npm run build:server && npm run typecheck:client && node --test tests/comic-ai-generation.unit.test.cjs tests/comic-ai-generation.postgres.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交漫画文本生成链**

```powershell
git add -- new-design/src/server/ai/prompts/comic.ts new-design/src/server/ai/prompts/index.ts new-design/src/common/comicSourceBundle.ts new-design/src/common/comicEpisodes.ts new-design/src/common/comicPanels.ts new-design/src/server/database/comicSourceBundle new-design/src/server/database/comicEpisodes new-design/src/server/database/comicPanels new-design/src/server/http/comicSourceBundle new-design/src/server/http/comicEpisodes new-design/src/server/http/comicPanels new-design/src/client/comicProjects new-design/tests/comic-ai-generation.unit.test.cjs new-design/tests/comic-ai-generation.postgres.test.cjs
git commit -m "新增：补齐漫画来源大纲与分镜生成"
```

### Task 7: 漫画角色场景成图、分格成图、批次与导出

**Files:**
- Create: `new-design/migrations/117_comic_rendering_exports.sql`
- Create: `new-design/src/common/comicRendering.ts`
- Create: `new-design/src/server/database/comicRendering/index.ts`
- Create: `new-design/src/server/http/comicRendering/index.ts`
- Create: `new-design/src/server/comicExport/index.ts`
- Create: `new-design/src/client/comicProjects/ComicRenderWorkspace.tsx`
- Create: `new-design/src/client/comicProjects/ComicExportPanel.tsx`
- Modify: `new-design/src/client/comicProjects/ComicBibleEditor.tsx`
- Modify: `new-design/src/client/comicProjects/ComicPanelsWorkspace.tsx`
- Modify: `new-design/src/client/comicProjects/ComicProjectDetail.tsx`
- Modify: `new-design/src/server/http/router.ts`
- Modify: `new-design/src/server/runtime/manifest.ts`
- Create: `new-design/tests/comic-rendering.unit.test.cjs`
- Create: `new-design/tests/comic-rendering.postgres.test.cjs`

**Interfaces:**
- Consumes: 采用的角色／场景 Bible 版本、视觉锚点、采用分镜、图片模型版本、generic asset bytes、Outbox。
- Produces: `ComicRenderBatch`, `ComicPanelImageVersion`, `ComicFactSnapshot`, `ComicExportManifest`; `startComicRenderBatch()`, `adoptComicPanelImage()`, `createComicExport()`。

- [ ] **Step 1: 写视觉锚点、分格版本、气泡和导出冻结测试**

```js
test("comic export freezes adopted panel images and refuses changed sources", async () => {
  const manifest = await fixture.previewExport(project.id);
  await fixture.adoptAnotherPanelImage(panel.id);
  await assert.rejects(
    fixture.submitExport(manifest.id, manifest.sourceHash),
    /来源已变化/,
  );
});
```

覆盖角色三视图／表情／服装、场景图、分格图、事实连续性、批次停止位置、文字气泡版、原图版和项目导出。

- [ ] **Step 2: 运行测试确认视觉账本缺失**

Run: `node --test tests/comic-rendering.unit.test.cjs tests/comic-rendering.postgres.test.cjs`（工作目录 `new-design`）
Expected: FAIL，缺少 117 和渲染命令。

- [ ] **Step 3: 复用新版图片运行和资产存储实现**

`117` 保存渲染批次、分格图片版本／采用、事实快照、气泡产物、导出 manifest／artifact；图片字节继续进入受管资产，不写数据库 locator 之外的本机绝对路径。每格生成冻结采用分镜、人物视觉和场景视觉版本。

- [ ] **Step 4: 验证渲染、恢复和导出**

Run: `npm run build:server && npm run typecheck:client && node --test tests/comic-rendering.unit.test.cjs tests/comic-rendering.postgres.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交漫画完整视觉产线**

```powershell
git add -- new-design/migrations/117_comic_rendering_exports.sql new-design/src/common/comicRendering.ts new-design/src/server/database/comicRendering new-design/src/server/http/comicRendering new-design/src/server/comicExport new-design/src/client/comicProjects new-design/src/server/http/router.ts new-design/src/server/runtime/manifest.ts new-design/tests/comic-rendering.unit.test.cjs new-design/tests/comic-rendering.postgres.test.cjs
git commit -m "新增：完成漫画成图批次与导出"
```

### Task 8: 短剧项目、来源、策略、人物和分集台本底座

**Files:**
- Create: `new-design/migrations/118_drama_projects_sources.sql`
- Create: `new-design/migrations/119_drama_strategy_episodes.sql`
- Create: `new-design/migrations/120_drama_scripts_quality.sql`
- Create: `new-design/src/common/drama.ts`
- Create: `new-design/src/server/database/dramaProjects/index.ts`
- Create: `new-design/src/server/database/dramaEpisodes/index.ts`
- Create: `new-design/src/server/http/dramaProjects/index.ts`
- Create: `new-design/src/server/http/dramaEpisodes/index.ts`
- Create: `new-design/src/server/ai/prompts/drama.ts`
- Modify: `new-design/src/server/ai/prompts/index.ts`
- Modify: `new-design/src/server/http/router.ts`
- Modify: `new-design/src/server/runtime/manifest.ts`
- Create: `new-design/tests/drama-projects.postgres.test.cjs`
- Create: `new-design/tests/drama-generation.unit.test.cjs`

**Interfaces:**
- Consumes: 小说采用正文、原创输入、本地文本、新版模型路由和 managed AI execution。
- Produces: `DramaProject`, `DramaSourceVersion`, `DramaStrategyVersion`, `DramaCharacterVersion`, `DramaEpisodeVersion`, `DramaScriptVersion`; 项目、策略、分集、台本候选与采用命令。

- [ ] **Step 1: 写来源冻结、赛道推荐、策略、分集和台本测试**

```js
test("drama scripts remain candidates until adopted", async () => {
  const result = await fixture.generateScript({ episodeVersionId: episode.id });
  assert.equal(result.script.status, "candidate");
  assert.equal(await fixture.readAdoptedScript(episode.id), null);
});
```

来源覆盖小说、原创和文本；业务字段覆盖赛道、目标集数、单集时长、付费卡点、开场钩子、结尾悬念、角色目标、世界硬事实和前集连续性。

- [ ] **Step 2: 运行测试确认短剧领域不存在**

Run: `node --test tests/drama-projects.postgres.test.cjs tests/drama-generation.unit.test.cjs`（工作目录 `new-design`）
Expected: FAIL，缺少迁移与模块。

- [ ] **Step 3: 按新版版本／采用语义实现短剧核心**

```ts
export type DramaSourceType = "novel" | "original" | "text";
export interface DramaEpisodeCandidate {
  order: number;
  title: string;
  hookOpening: string;
  cliffhanger: string;
  durationSec: number;
  sourceRefs: readonly { kind: string; id: string; versionId: string }[];
}
```

旧版 direct update 改为新候选版本；人物、策略、分集、台本分别采用，后级始终绑定上级确切版本。质量表随 120 建立，但 Task 9 才接完整质量操作。

- [ ] **Step 4: 验证短剧核心链**

Run: `npm run build:server && node --test tests/drama-projects.postgres.test.cjs tests/drama-generation.unit.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交短剧领域底座**

```powershell
git add -- new-design/migrations/118_drama_projects_sources.sql new-design/migrations/119_drama_strategy_episodes.sql new-design/migrations/120_drama_scripts_quality.sql new-design/src/common/drama.ts new-design/src/server/database/dramaProjects new-design/src/server/database/dramaEpisodes new-design/src/server/http/dramaProjects new-design/src/server/http/dramaEpisodes new-design/src/server/ai/prompts/drama.ts new-design/src/server/ai/prompts/index.ts new-design/src/server/http/router.ts new-design/src/server/runtime/manifest.ts new-design/tests/drama-projects.postgres.test.cjs new-design/tests/drama-generation.unit.test.cjs
git commit -m "新增：建立新版短剧项目与台本底座"
```

### Task 9: 短剧工作台页面与主流程

**Files:**
- Create: `new-design/src/client/dramaProjects/api.ts`
- Create: `new-design/src/client/dramaProjects/DramaProjectsPage.tsx`
- Create: `new-design/src/client/dramaProjects/DramaProjectDetail.tsx`
- Create: `new-design/src/client/dramaProjects/DramaSourcePanel.tsx`
- Create: `new-design/src/client/dramaProjects/DramaStrategyPanel.tsx`
- Create: `new-design/src/client/dramaProjects/DramaEpisodePanel.tsx`
- Create: `new-design/src/client/dramaProjects/DramaCharacterPanel.tsx`
- Create: `new-design/src/client/dramaProjects/drama-projects.css`
- Modify: `new-design/src/client/api.ts`
- Modify: `new-design/src/client/NewDesignPage.tsx`
- Modify: `new-design/src/client/navigation.ts`
- Create: `new-design/tests/drama-navigation.unit.test.cjs`

**Interfaces:**
- Consumes: Task 8 的项目、来源、策略、人物、分集和台本接口。
- Produces: `/new-design/drama`, `/new-design/drama/projects/:projectId`; 来源／策略／人物／分集／制作五个上下文页签。

- [ ] **Step 1: 写项目创建、非法页签、版本切换和未保存保护测试**

```js
test("drama deep links reject unknown tabs without silently selecting another tab", () => {
  assert.equal(resolveDramaTab("unknown").valid, false);
});
```

- [ ] **Step 2: 运行测试确认页面缺失**

Run: `node --test tests/drama-navigation.unit.test.cjs`（工作目录 `new-design`）
Expected: FAIL。

- [ ] **Step 3: 实现新版短剧工作台 UI**

创建页沿用旧版三种来源和赛道推荐逻辑；详情页不照搬旧大页面，以项目上下文页签组织。候选、采用版本、上游失效和下一步必须同时可见。

- [ ] **Step 4: 验证客户端类型和导航**

Run: `npm run typecheck:client && node --test tests/drama-navigation.unit.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交短剧工作台**

```powershell
git add -- new-design/src/client/dramaProjects new-design/src/client/api.ts new-design/src/client/NewDesignPage.tsx new-design/src/client/navigation.ts new-design/tests/drama-navigation.unit.test.cjs
git commit -m "新增：接入新版短剧创作工作台"
```

### Task 10: 短剧质量、修复、分镜、图片／音频／视频提示词和导出

**Files:**
- Create: `new-design/migrations/121_drama_storyboards_media.sql`
- Create: `new-design/migrations/122_drama_exports.sql`
- Create: `new-design/src/common/dramaProduction.ts`
- Create: `new-design/src/server/database/dramaProduction/index.ts`
- Create: `new-design/src/server/http/dramaProduction/index.ts`
- Create: `new-design/src/server/dramaExport/index.ts`
- Create: `new-design/src/client/dramaProjects/DramaQualityPanel.tsx`
- Create: `new-design/src/client/dramaProjects/DramaProductionPanel.tsx`
- Create: `new-design/src/client/dramaProjects/DramaExportPanel.tsx`
- Modify: `new-design/src/client/dramaProjects/DramaProjectDetail.tsx`
- Modify: `new-design/src/server/http/router.ts`
- Modify: `new-design/src/server/runtime/manifest.ts`
- Create: `new-design/tests/drama-production.unit.test.cjs`
- Create: `new-design/tests/drama-production.postgres.test.cjs`

**Interfaces:**
- Consumes: 采用短剧台本、人物视觉资产、新版图片模型、受管附件、Outbox。
- Produces: `DramaQualityReport`, `DramaRepairCandidate`, `DramaStoryboardVersion`, `DramaShotVersion`, `DramaVideoPromptVersion`, `DramaMediaTask`, `DramaExportManifest`。

- [ ] **Step 1: 写质量门禁、一次修复、镜头和导出测试**

```js
test("drama repair never overwrites the adopted script", async () => {
  const repair = await fixture.repair({ reportId: report.id });
  assert.notEqual(repair.scriptVersionId, adopted.id);
  assert.equal((await fixture.readAdoptedScript(episode.id)).id, adopted.id);
});
```

覆盖合规检查、质量问题、修复候选、分镜、关键帧、角色设计稿、对白音频、视频提示词、供应商任务、批次停止／恢复、SRT、timeline JSON、项目 Markdown／JSON 导出。

- [ ] **Step 2: 运行测试确认制作账本缺失**

Run: `node --test tests/drama-production.unit.test.cjs tests/drama-production.postgres.test.cjs`（工作目录 `new-design`）
Expected: FAIL。

- [ ] **Step 3: 实现制作链与版本冻结**

121 保存质量报告／修复引用、分镜／镜头版本、媒体任务和提示词版本；122 保存导出 manifest／artifact。外部供应商通过端口调用，未配置时返回明确不可运行状态，不用 mock 结果冒充成功。

- [ ] **Step 4: 验证短剧完整制作链**

Run: `npm run build:server && npm run typecheck:client && node --test tests/drama-production.unit.test.cjs tests/drama-production.postgres.test.cjs`（工作目录 `new-design`）
Expected: PASS。

- [ ] **Step 5: 提交短剧制作与导出**

```powershell
git add -- new-design/migrations/121_drama_storyboards_media.sql new-design/migrations/122_drama_exports.sql new-design/src/common/dramaProduction.ts new-design/src/server/database/dramaProduction new-design/src/server/http/dramaProduction new-design/src/server/dramaExport new-design/src/client/dramaProjects new-design/src/server/http/router.ts new-design/src/server/runtime/manifest.ts new-design/tests/drama-production.unit.test.cjs new-design/tests/drama-production.postgres.test.cjs
git commit -m "新增：完成短剧质量制作与导出"
```

### Task 11: 统一导航、书内持续壳和功能矩阵收口

**Files:**
- Modify: `new-design/src/client/navigation.ts`
- Modify: `client/src/components/layout/Sidebar.tsx`
- Modify: `new-design/src/client/bookNavigation/index.tsx`
- Modify: `new-design/src/client/bookNavigation/workflow.ts`
- Modify: `new-design/src/client/new-design.css`
- Modify: `new-design/docs/navigation-and-terminology.md`
- Modify: `new-design/docs/legacy-page-replication-progress.md`
- Create: `new-design/tests/legacy-value-navigation.unit.test.cjs`

**Interfaces:**
- Consumes: Tasks 2–10 的正式路由。
- Produces: 开始与创作、衍生工作台、资源与研究、运行与设置四组导航；稳定书内壳和完整功能映射。

- [ ] **Step 1: 写唯一高亮、持续侧栏和全部路由覆盖测试**

```js
test("every primary feature route belongs to exactly one navigation group", () => {
  for (const route of expectedRoutes) {
    assert.equal(groups.filter(group => group.items.some(item => route.startsWith(item.href))).length, 1);
  }
});
```

- [ ] **Step 2: 运行测试确认新增入口尚未统一**

Run: `node --test tests/legacy-value-navigation.unit.test.cjs`（工作目录 `new-design`）
Expected: FAIL。

- [ ] **Step 3: 重组导航但不改业务路由**

主导航按四组展示，当前最长匹配项唯一高亮；书内侧栏继续驻留并只替换主内容，辅助工具折叠。旧版能力矩阵逐项填写新版入口、保留逻辑、必要调整和代码状态，不把待验证写成缺失或完成。

- [ ] **Step 4: 验证两套前端类型和导航合同**

Run: `npm run typecheck:client && node --test tests/legacy-value-navigation.unit.test.cjs`（工作目录 `new-design`）
Run: `pnpm --filter @ai-novel/client typecheck`（工作目录仓库根）
Expected: PASS。

- [ ] **Step 5: 提交统一导航和矩阵**

```powershell
git add -- new-design/src/client/navigation.ts client/src/components/layout/Sidebar.tsx new-design/src/client/bookNavigation new-design/src/client/new-design.css new-design/docs/navigation-and-terminology.md new-design/docs/legacy-page-replication-progress.md new-design/tests/legacy-value-navigation.unit.test.cjs
git commit -m "优化：统一新版功能导航与价值映射"
```

### Task 12: 全部功能统一调试、回归和交付文档

**Files:**
- Modify: `new-design/docs/data-model.md`
- Modify: `new-design/docs/development-delivery.md`
- Modify: `docs/releases/release-notes.md`
- Modify: `README.md`
- Modify: `doc/20架构/database.md`
- Modify: `doc/10产品/旧版功能价值迁移.md`

**Interfaces:**
- Consumes: Tasks 1–11 的组合代码和测试。
- Produces: 组合版本的构建、边界、隔离数据库、浏览器和文档证据；不安装作者库。

- [ ] **Step 1: 核对组合工作树和迁移清单**

Run: `git status --short`
Run: `node --test tests/runtime-migration-files.unit.test.cjs tests/standalone-boundary.test.cjs`（工作目录 `new-design`）
Expected: 新增 115–122 均只在手动清单；默认迁移 001–083 不变；旧版业务目录没有本任务修改（共享导航文件除外）。

- [ ] **Step 2: 运行全部新增合同和相关旧回归**

Run: `$tests = Get-ChildItem tests -File | Where-Object { $_.Name -match '^(creative-hub|world-generation|global-legacy-value|book-workflow-legacy-value|comic-|drama-|legacy-value-navigation).*\.test\.cjs$' } | Sort-Object Name | ForEach-Object FullName; node --test $tests`（PowerShell，工作目录 `new-design`）
Expected: PASS；测试文件列表非空且包含 Tasks 1–11 的新增测试及既有漫画回归，不跨 Shell 拼接路径。

- [ ] **Step 3: 运行组合构建和边界检查**

Run: `npm run build:server`（工作目录 `new-design`）
Run: `npm run typecheck:client`（工作目录 `new-design`）
Run: `npm run build:client`（工作目录 `new-design`）
Run: `npm run check:boundary`（工作目录 `new-design`）
Run: `pnpm --filter @ai-novel/client typecheck`（工作目录仓库根）
Expected: 全部退出 0；Vite chunk warning 可记录但不得掩盖 error。

- [ ] **Step 4: 启动本地源码服务并完成浏览器调试**

按 `new-design/docs/development-delivery.md` 使用不安装手动迁移、不执行后台写入的本地调试方式启动 5273／5301。逐项检查创作中枢、世界生成、向导、书架、八步与辅助入口、漫画、短剧、资源、设置和运行记录；检查 1280／1440／1920px、刷新恢复、无效深链和未保存保护。需要 115–122 的页面使用隔离测试数据库，不改作者库。

- [ ] **Step 5: 更新唯一长期文档和发布说明**

数据模型记录 115–122 的正本与手动启用边界；阶段记录只写组合版本实际证据。使用 `readme-release-updater` 从用户视角合并同日期发布说明，README 只保留最新日期块。

- [ ] **Step 6: 检查差异并提交最终组合收口**

```powershell
git diff --check
git status --short
git add -- new-design/docs/data-model.md new-design/docs/development-delivery.md docs/releases/release-notes.md README.md doc/20架构/database.md doc/10产品/旧版功能价值迁移.md
git commit -m "优化：完成新版功能迁移统一验证"
```

最终报告分别列出：代码完成、隔离数据库通过、本地页面已调试、作者数据库未安装、真实模型未调用、用户页面验收待确认、未推送。
