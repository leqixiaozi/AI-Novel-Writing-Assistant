# 新设计专题文档索引

这里存放 `new-design/` 的功能设计、数据合同和运行说明。先从[项目文档工作台](../../doc/README.md)确认产品、架构与开发规范，再按任务读取下列专题。设计目标、当前源码、数据库迁移和运行验收分别核对；旧版页面与代码仅作只读参考。

| 任务 | 主要入口 |
| --- | --- |
| 菜单、术语与页面对标 | [导航与术语](navigation-and-terminology.md)、[对照入口](comparison-entry.md)、[逐页施工记录](legacy-page-replication-progress.md) |
| 资料、表单和开书 | [业务表单外壳](business-form-shell.md)、[统一开书表单](unified-book-creation-form.md)、[资料管理](material-management-and-safe-archive.md) |
| 书籍规划与章节 | [规划中心](book-overview-and-planning-center.md)、[章节工作区](chapter-writing-workspace.md)、[采用结算](chapter-adoption-settlement.md)、[旧章修订](chapter-revision-recompute.md) |
| 数据正本与迁移 | [数据库架构](../../doc/20架构/database.md)、[数据字典](data-model.md)、`../migrations/` 中的 SQL；字段和约束以当前迁移为准 |
| 页面与 API 接线 | [导航与术语](navigation-and-terminology.md)、`../src/client/api.ts`、`../src/server/http/` 的目标路由；逐项追踪用户操作到新版回执 |
| AI、上下文与运行 | [上下文组装](context-management-and-assembly.md)、[模型路由](model-route-runtime-review.md)、[研究运行](research-prompt-runtime-orchestration.md)、[后台投递](outbox-runtime.md) |
| Story Runtime 研究 | [Story Runtime 适配判断](story-runtime-research.md)：提炼 Story OS 材料，区分已有基础、研究缺口和未批准的提案 |
| 独立开发与数据交付 | [独立开发](standalone-development.md)、[开发与数据交付](development-delivery.md)、[备份和导入导出](transfer-backup-import-export.md) |

`*-review.md`、`*-static-review.md` 与阶段记录保留对应范围的检查证据，不自动代表当前分支或作者环境已经验收。长期通用规则在对应专题或 `wiki/` 原位维护；执行进度以[逐页施工记录](legacy-page-replication-progress.md)和当前任务为准。
