# 新版数据库结构快照

`2026-09-20-new-design-schema.sql` 是 2026-09-20 从本机新版作者库 `ai_novel_new_design` 以 PostgreSQL 17.11 `pg_dump --schema-only --no-owner --no-privileges --schema=new_design --schema=new_design_projection` 导出的结构快照，SHA-256 为 `1DFAEA8861687510BBF97A9A040304E8277B85EE38D42D20A1EDA0FE54EB725E`。

导出时作者库登记 104 项迁移，包含手动安装的 `106_world_usage_scope` 与 `107_payoff_ledger_windows`；世界范围能力行在作者库启用，但结构-only 快照不含这条运行数据。目标结构仍以 `migrations/` 中的 SQL 为准，快照本身不能证明功能调用或作者验收。

文件只包含这两个新版 schema 的对象定义，不含表数据、小说正文、模型凭据行或临时测试 schema。它不是完整备份：未包含扩展安装、迁移账本数据、附件与 AI 原回复。还原前需在新的空 PostgreSQL 17 数据库安装 AGE 1.7、pgvector 0.8.6 和 pg_trgm，并按项目恢复流程处理运行数据；不得覆盖现有作者库。

本快照已在独立空库 `nd_schema_verify_20260920_02` 还原并核对对象数量：`new_design` 为 351 张表、2 个视图、913 个索引、5 个序列；`new_design_projection` 为 4 张表、7 个索引、5 个序列。隔离库未导入任何作者数据。
