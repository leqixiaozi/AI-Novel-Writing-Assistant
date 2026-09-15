# 重复故障模式与排查路径

## 背景

项目多次出现的故障往往不是单点 bug，而是边界被绕过：重型任务跑在 API 进程、状态多源推断、Prompt 绕过 registry、章节热路径过长、RAG 检索范围不一致。把这些排查结论沉淀下来，可以避免每次重新定位同类问题。

## 决策

调试时先确认事实源、执行面、投影和治理入口，再看具体代码。不要先用 UI 补丁、关键词兜底或局部 try/catch 掩盖系统性问题。

## 当前规则

- API 卡死先查是否有长任务仍在 Web API 进程执行。
- 状态不一致先查 `DirectorRun / StepRun / Event / Artifact` 与 projection，而不是先改前端显示。
- Prompt 输出问题先查 PromptAsset、schema、repair、semantic retry 和 provider capability。
- 章节产出慢先查热路径是否重新串入多次 LLM 后处理。
- RAG 不命中先查显式文档、绑定文档、全局启用文档和 context resolver。
- 数据破坏风险操作必须先备份、验证备份，再取得明确批准。

## 示例

常见排查路径：

- 继续导演后所有接口变慢：检查 route 是否直接 await 长任务，Worker 是否独立 lease，SQLite/Prisma 写锁是否被长链路占用。
- 任务中心显示失败但小说页显示运行中：检查 projection 是否由旧 task status、runtime command 和产物事实混合推断。
- 章节正文为空还继续推进：检查 writer 空返回防线、单章自动重试和失败落态。
- 章节审校反复进入修复循环：检查后置质量闭环是否已经封顶为一次修复，最终结果是否已收敛到“未通过但继续生产”，以及工作区是否还把终态章节算成 repair ticket。
- 长弧伏笔被当成当前章阻断：检查时间线钩子的 `resolveMode` 和 `blocking` 是否被误标成 `immediate + blocking`，以及检测器是否把 `short_arc` / `long_arc` 升级成硬失败。
- 重新生成候选没有进入新一轮：检查 batch reuse、command idempotency 和候选阶段运行态。
- 生成没有使用知识库资料：检查 `knowledgeDocumentIds`、小说/世界绑定、启用状态和 prompt context requirement。

## 失败模式

不能用来替代根因修复的手段：

- 降低前端轮询频率来掩盖 API 执行面阻塞。
- UI 禁用按钮来避免重复执行，而不处理 command 幂等。
- 给意图识别加关键词 fallback 来掩盖 AI schema 或上下文问题。
- 在业务 service 里补局部 JSON parse 分支来绕过 Prompt Registry。
- 把后台资产回灌失败显示成正文生成失败。

## 新增 Prisma 模型后热更新仍报错

业务代码、生成的 Prisma Client 和实际数据库结构是三个分别更新的对象。`ts-node-dev` 重载 TypeScript 不会重新执行开发启动前的数据库准备；`ensureRuntimeDatabaseReady` 在 web 模式直接返回，不能把桌面版自动迁移能力当作 web 开发环境已完成的保障。

> 🏠 **白话比喻**：菜单加了新菜，收银系统和厨房还得同步。对应这里：schema有模型，不代表客户端已有访问方法，也不代表数据库已有表。
> 🧠 **速记方法**：代码、客户端、表，三处分别查。

以热门题材收藏为例：`prisma.marketSavedTopic.findMany` 报 `Cannot read properties of undefined` 时，先核实已生成客户端的模型列表；重新生成后若变成 `MarketSavedTopic does not exist`，说明第二个问题是实际数据库缺表，不应在接口返回空数组掩盖它。

排查顺序：确认运行实例使用的数据库与Node版本，检查生成客户端，重启以载入新客户端，再检查表与索引。数据库结构修复前备份并验证完整性；只应用已审查的相应迁移，不能为补一张表重置数据库。开发环境通常走 `server/scripts/ensure-dev-prisma.cjs` 的generate/push；使用正式迁移管理的环境应同时遵循其迁移历史，不能混用两套状态。

恢复检查应通过前端代理调用 `/api/market-radar/sources`、`/api/market-radar/scans/latest` 和 `/api/market-radar/saved-topics`，分别检查HTTP状态及业务success。前端HTML返回200不足以证明数据功能正常；这些只读检查也不代表已测试收费AI分析或外部采集。

发现一次缺表／缺列后，还需做整个实际数据库到当前schema的只读diff，不能只补第一个报错对象。例如收藏接口恢复后，运行记录仍可能因为GenerationJob执行租约字段或ChapterAutomaticAttempt表缺失而失败。使用当前环境的Prisma CLI，在server目录执行 `prisma migrate diff --from-config-datasource --to-schema src/prisma/schema.sqlite.prisma --exit-code`；SQLite示例不能用于其他数据库。先审阅SQL差异，备份后仅执行已核实的无损增补；差异包含删表、重建或类型变更时不能直接整份执行。验收要求结构diff无差异，并同时检查任务列表、overview、recovery-candidates与原故障模块；读取恢复候选不等于执行恢复。

实现定位：`server/scripts/ensure-dev-prisma.cjs`、`server/src/db/runtimeMigrations.ts`、`server/src/prisma/migrations.sqlite/20260912190000_market_saved_topics/migration.sql`。

## 相关模块

- `server/src/routes/`
- `server/src/workers/`
- `server/src/services/novel/director/`
- `server/src/services/novel/runtime/`
- `server/src/services/rag/`
- `server/src/prompting/`
- `client/src/pages/tasks/`
- `client/src/pages/novels/`

## 来源文档

- [自动导演执行面隔离与 API 保活计划](../../plans/auto-director-execution-plane-isolation-plan.md)
- [导演模式模块化与状态治理改造清单](../../plans/director-mode-module-state-refactor-checklist.md)
- [正文产出链路瘦身与资产回灌优化计划](../../plans/chapter-output-pipeline-optimization-plan.md)
- [Prompt Governance Audit 2026-05-08](../../checkpoints/prompt-governance-audit-2026-05-08.md)
- [README 最新更新](../../../README.md)
