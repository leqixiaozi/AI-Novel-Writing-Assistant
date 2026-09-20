# 新版数据库结构快照

`2026-09-20-new-design-schema.sql` 是 2026-09-20 从本机新版作者库 `ai_novel_new_design` 以 PostgreSQL 17.11 `pg_dump --schema-only --no-owner --no-privileges --schema=new_design --schema=new_design_projection` 导出的结构快照，SHA-256 为 `84B31D0DA5813D39E6CC50B6452DAD1EEF4A51053DDA4B58AA5DA6460050694B`。

导出时作者库登记 102 项迁移；`106_world_usage_scope` 与 `107_payoff_ledger_windows` 尚未安装，因此快照不包含这两项目标结构。目标结构继续以 `migrations/` 中的 SQL 为准，不能把本快照当成已启用证明。

文件只包含这两个新版 schema 的对象定义，不含表数据、小说正文、模型凭据行或临时测试 schema。它不是完整备份：未包含扩展安装、迁移账本数据、附件与 AI 原回复。还原前需在新的空 PostgreSQL 17 数据库安装 AGE 1.7、pgvector 0.8.6 和 pg_trgm，并按项目恢复流程处理运行数据；不得覆盖现有作者库。

本快照已在独立空库 `nd_schema_verify_20260920_01` 还原并核对对象数量：`new_design` 为 346 张表、2 个视图、899 个索引、5 个序列；`new_design_projection` 为 4 张表、7 个索引、5 个序列。隔离库未导入任何作者数据，也未安装 106／107。
