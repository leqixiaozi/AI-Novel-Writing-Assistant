# 可选人工调整实施检查点（2026-09-13）

分支：`codex/optional-manual-adjustments`。基准提交：`0a164f7e035783bd44c75386a94741891a2d4cbd`。实际合同与模块边界见 [开发说明](../wiki/workflows/optional-writing-adjustments.md)。本次没有部署、迁移真实作品或进行真实模型文学效果评测。

> 🏠 白话比喻：先在试车场检验刹车、交接钥匙和仪表，再进入真实道路。对应本记录：可控模型与隔离数据库验证程序行为，不能替代真实长篇创作质量评估。
> 🧠 速记：代码、流程、文学效果三种证据分开记。

## 变更范围与默认行为

原八步流程、URL、默认提示词、保存行为和自动导演质量政策保留。旧请求未显式带调整合同，不加载新要求或增加模型调用。折叠入口只读，明确保存／执行才生效。本次设置与书章默认分开；候选、手改稿与正式正文分开持久化。新范围保护不恢复被撤销的旧运行许可。

P0—P3 均接入代码：设置／预设和五维度、选区／场景候选、编辑版本与核对、历史证据、章／导演交接、幂等采纳与剩余同步、多章规划选择采纳、原人物／事件／时间锚点联动。相关增量由新合同启用，没有增加任务引擎、编辑器或事实库。

## 实际执行结果

环境：Windows，Node `v24.19.0`，复用项目 pnpm 和依赖。数据库模型生成及业务事务使用 SQLite Prisma adapter；两种 schema 都单独验证。测试不以真实模型输出作为断言。

| 检查 | 命令／入口 | 结果 |
|---|---|---|
| 服务端编译 | `pnpm --filter @ai-novel/server build` | 通过 |
| 客户端类型与生产构建 | `pnpm --filter @ai-novel/client build` | 通过；现有包体积／Browserslist 提示仍在 |
| 数据库 schema | server 目录 `pnpm exec prisma validate --schema src/prisma/schema.prisma` 及 SQLite 对应文件 | 两者通过 |
| 新功能服务端专项 | `node --test tests/writingAdjustmentContracts.test.js tests/writingAdjustmentFence.test.js tests/writingAdjustmentMigrations.test.js tests/writingAdjustmentServices.test.js tests/writingAdjustmentRoutes.test.js tests/writingAdjustmentScene.test.js tests/novelProduction/writingAdjustmentRuntime.test.js` | **85 / 85** 通过 |
| 其中真实数据库业务 | `writingAdjustmentServices.test.js` | **21** 项真实隔离 SQLite／Prisma；包含租约、回放、回滚、同步、规划／事件与场景依赖 |
| 导演命令 | `directorRunCommandService.test.js` | **27 / 27** 通过；包括会话稳定键与原无会话复用 |
| 旧审核／生命周期 | `node --test tests/novelReviewContext.test.js tests/chapterLifecycleService.test.js` | **7 / 7** 通过 |
| 正式状态提交 | `node --test tests/stateCommitService.test.js` | **12 / 12** 通过 |
| 客户端全量 | `pnpm --filter @ai-novel/client test` | **222** 项：216 通过、6 原有失败 |
| 服务端 fast 全量 | `pnpm --filter @ai-novel/server test:node` | **1467** 项：1421 通过、34 原有失败、12 跳过 |
| 浏览器 | `node client/scripts/qa-writing-adjustments.mjs` | **13** 组通过，39 次隔离 HTTP，`pageErrors=[]` |
| 补丁检查 | `git diff --check` | 通过；Windows 换行提示不属于空白错误 |

专项中的 7 个迁移测试包含 SQLite 执行及两份增量结构对照；这不是 PostgreSQL 实机迁移或并发事务验证。没有运行全部外部服务／模型集成套件。

原回归测试中的章节事务替身补齐交互事务、guard 和原始行锁能力；保留业务断言，没有改断言去掩盖产品行为回归。新增行锁在生产写事务中执行，单测不会触及真实数据库。

## 独立审查与关闭项

| 审查发现 | 修复 | 验证 |
|---|---|---|
| PostgreSQL 首次接管时 guard 不存在，缺少共同锁 | 自动写入与接管先锁相同 Chapter 行，再验 guard | 锁顺序单测及代码复查；尚无 PostgreSQL 并发实测 |
| 场景范围可能扩大成整章 | 注册场景定位提示词，唯一连续原文校验，只替换该片段 | 前后相邻场景逐字保留；无匹配／虚构引用拒绝 |
| 未完成同步被规划／接管推进代次，重试永久失效 | 事务锁内检查未完成同步；新稿替代旧稿时标 superseded | 三个入口被阻止且目标未修改；剩余阶段恢复 |
| 进程中断后 running 操作不能重试 | 120 秒租约、15 秒续租、CAS 接手、业务事务内记录准确 DTO | 有效租约拒抢、过期接手、旧执行者回滚、响应丢失回放；deferred 同样验所有权 |

限定范围的独立只读复查确认四项关闭；该结论没有替代实际测试。

## 浏览器证据

真实 React 组件、CSS、前端 API 客户端，隔离 Vite 和内存 HTTP 替身。主程序未接收测试请求。1440 像素和 390 像素检查没有横向溢出；人工查看了展开面板、窄屏与候选核对截图。

13 组包括：折叠无请求；键盘打开只读；收起保留输入；宽窄屏；合法 0 与选区；失败重试同键；候选／稿件／核对不改原正文；刷新恢复版本绑定核对；独立交接；事件调整保留原 ID 与正文；场景 ID 与实际输入；原导演命令交接；普通任务参数不误认导演。

本机证据目录：`D:/cache/Node/ai-novel-writing-adjustments/browser-p1Uhzx`，内有 `result.json` 和 10 张截图。原 UI 外壳未完整端到端跑真实数据库，故这里的“真实界面”指真实组件与浏览器，不指真实模型和数据库联调。

## 原有失败登记

原提交在独立 worktree `D:/cache/writing-adjustments-baseline` 检查，复用依赖但单独编译输出。客户端原提交 **209 项 / 203 通过 / 6 失败**，失败名称与现在相同：自动导演 dashboard 状态、路由移动 CSS 覆盖、移动任务筛选布局、移动路由元数据、更多菜单覆盖、旧设置路由跳转约定。新增客户端 13 项均通过。

服务端原提交在空的隔离数据库环境运行：**1380 项 / 1300 通过 / 68 失败 / 12 跳过**；原 runner 结束后仍有句柄，使用 `node --test --test-force-exit scripts/run-tests.cjs` 取得最终结果。因为数据库环境和执行入口不同，不把两次总数当成严格的一一性能／行为对照。当前 34 个失败名称全部能在原提交失败中找到；本次新增的事务替身问题已修复，最终不在失败列表。

当前服务端失败名称（便于后续单独追踪）：

```text
auto director auto-approval audit loads the latest 10 records per novel
NovelExportService exports generated chapters as a knowledge document for diagnosis
NovelReferenceService formats structured timeline nodes by phase
identifyCharacterCandidates dedupes candidates and keeps generated rows intact
generateCharacterProfile transitions candidate to generated with arcs and scenes
generateAllCandidates skips generated rows and processes failed candidates
legacy generateCharacters identifies then generates profiles
artifact delta only applies accepted influence proposals that are active in this chapter
artifact delta expires accepted influence proposals once their window has passed
character resource extraction schemas cap resource deltas at eight items
character mind persistence archives the old current snapshot before creating a replacement
chapter character context includes compact visible profile summary
director root stays limited to compatibility facades
display state maps chapter draft execution into chapter stage and uses fact progress
display state keeps running mode when task is running despite stale approval projection
drama service pipeline keeps repairable quality issues before storyboard and video tasks
director character phase applies an existing draft cast option without regenerating
director planning stages expose standard node adapter contracts
runDirectorStructuredOutlinePhase persists chapter detail after each completed chapter
runDirectorStructuredOutlinePhase resumes from the next incomplete chapter
continue_existing chapter takeover does not reuse the requested auto execution range
buildExportContent uses novel title plus timestamp as export filename
checkpoint: active running claim does not start another extraction
pipeline execution lease: ownership storage failure pauses before executor work
pipeline execution lease: non-schema claim failure does not pause a valid owner
novel workflow continue route accepts range and full-book continuation modes
novel theme world prompt stays within a one-shot JSON budget
buildPayoffLedgerResponse orders items by risk and computes summary counts
RagRetrievalTracer writes sampled trace summaries without chunk text
novel routes preserve book framing fields through create-get-update cycle
StyleRewriteService includes preview anti-ai rules in the repair prompt
sanitizeStyleContextForGeneration redacts source entities before writer context
agent tool definitions keep zod declarations in dedicated schema modules
gateway delegates novel theme world generation through novel world service
```

日志保存在本机 `D:/cache/writing-adjustments-{server-final,client-final,targeted-final,baseline-forced,client-baseline}.log`。全量没有全绿，本轮没有修改这些无关断言或把失败改为跳过。

## 发布与后续验证

两份增量迁移为 `20260913160000_optional_writing_adjustments`。没有正文回填、历史证据补造或真实库写入。部署时先备份实际数据库并验证恢复路径，再使用项目原迁移入口执行对应数据库迁移；不要用 reset 或 db push 替代生产增量迁移。

尚需真实环境验证：PostgreSQL 首次接管与自动写入并发、真实数据库下完整 UI 到同步链，以及固定长篇样本的五档表达效果、人物知情和连续多章质量。停用要求不撤回已采纳正文，撤回应走正常版本修改。
