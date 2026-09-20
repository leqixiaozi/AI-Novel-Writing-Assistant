# 新版 AI 写作项目文档工作台

## 项目与文档范围

本入口面向 `AI-Novel-Writing-Assistant` 仓库中的 `new-design/` 新版写作底座，供开发者和 AI 在产品判断、架构修改与实施前定位当前有效依据。目标是帮助写作新手从想法推进到完整小说，同时保持作者对正式内容和重要采用动作的控制。旧版 `client/`、`server/` 和 `desktop/` 仍属于同一产品仓库，但不能直接用其实现证明新版功能已可用。

`doc/` 是本仓库的新版项目文档入口，不取代已有 `docs/` 和 `new-design/docs/` 的专题合同，也不是运行验收报告。事实、目标、计划和验证结论须分别看待：源码与迁移说明当前实现；已确认设计说明目标；测试或真实运行记录才说明相应范围的可用性。

## 目录与权威内容

| 任务 | 入口 | 权威细节 |
| --- | --- | --- |
| 理解产品定位、用户与创作主链 | [产品总览](10产品/overview.md) | [新手优先原则](../docs/wiki/product/beginner-first-novel-completion.md)、[新版导航与术语](../new-design/docs/navigation-and-terminology.md) |
| 判断新版模块、数据正本和运行边界 | [架构总览](20架构/overview.md) | [新版数据模型](../new-design/docs/data-model.md)、[新版独立开发与运行](../new-design/docs/standalone-development.md) |
| 数据库设计、迁移与数据恢复 | [数据库架构](20架构/database.md) | [数据字典](../new-design/docs/data-model.md)、[开发快照与恢复](../new-design/docs/development-delivery.md) |
| 开发、检查、文档和交付 | [开发规范](30规范/development.md) | 仓库 [AGENTS.md](../AGENTS.md)、[旧版与全仓 Wiki 索引](../docs/wiki/README.md) |
| 查询某一功能或既有设计 | [新版专题索引](../new-design/docs/README.md)、[全仓文档索引](../docs/README.md) | 对应源码、迁移及经核实的运行证据 |
| 查询当前执行优先级或已完成阶段 | [项目任务入口](../TASK.md)、[新版阶段记录](../new-design/docs/legacy-page-replication-progress.md) | 以相关任务的最新状态与当前工作区为准；不在本工作台复制进度 |

仓库根 `AGENTS.md` 是机器必须遵守的项目约束；本工作台解释文档位置与项目层面的判断，不覆盖它。机器专属路径、端口占用、凭据可用状态等应留在受忽略的 `AGENTS.local.md`，不写入共享规范，也不能当作跨机器事实。本机入口缺失时按仓库 `AGENTS.md` 的规则核实和建立。

## 按任务读取

- 新增页面或操作：先看[产品总览](10产品/overview.md)和[导航与术语](../new-design/docs/navigation-and-terminology.md)，再看对应业务表单、工作流专题及现有页面源码。
- 修改资料、章节或 AI 执行：先看[架构总览](20架构/overview.md)，按影响进入数据模型、采用结算、上下文、模型路由或后台任务专题；接口和字段以目标提交的源码及迁移核对。
- 修改数据库结构或迁移数据：先看[数据库架构](20架构/database.md)，再核对应 SQL、注册清单、数据字典和实际数据库状态；不以源码中的迁移文件推断作者库已安装。
- 排障或准备交付：先看[开发规范](30规范/development.md)中的证据与检查边界，再进入相关运行手册或阶段记录。静态说明不能替代真实数据库、模型或桌面运行验收。
- 维护旧版：从[全仓文档索引](../docs/README.md)和旧版模块 Wiki 入手；不要把本入口的新设计边界直接套到旧版实现。

## 当前有效结论入口

- 产品定位与创作主链：[产品总览](10产品/overview.md)；具体页面与称谓以[新版导航与术语](../new-design/docs/navigation-and-terminology.md)为准。
- 正本、候选、采用和后台执行的架构边界：[架构总览](20架构/overview.md)；字段及迁移以[新版数据模型](../new-design/docs/data-model.md)和实际 SQL 为准。
- 数据库隔离、迁移分层与数据保全：[数据库架构](20架构/database.md)；表关系和字段仍以[数据字典](../new-design/docs/data-model.md)及实际 SQL 为准。
- 实施及检查口径：[开发规范](30规范/development.md)；当前任务优先级仍看[项目任务入口](../TASK.md)，不在此处留阶段完成清单。

## 阅读与维护

同一主题只维护一处正文；本入口保留稳定结论和定位链接，专题继续在原处维护。每次只读任务相关入口和必要上下游；已有证据未变化时复用，证据矛盾时核源码、版本、配置与运行范围。目标与现状不一致，先说明差距及是否属于本次授权，不为了让文档“对上”而擅改设计或代码。Git 保存历史，不新增日期副本、执行流水或秘密信息。
