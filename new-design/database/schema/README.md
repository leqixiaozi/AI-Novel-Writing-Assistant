# 新版数据库结构快照

`2026-09-21-new-design-schema.sql` 是当前快照：2026-09-21 从本机新版作者库 `ai_novel_new_design` 以 PostgreSQL 17.11 `pg_dump --schema-only --no-owner --no-privileges --schema=new_design --schema=new_design_projection` 导出，移除行尾空白后的 SHA-256 为 `A84376016E16DA0D62D559CF816EDDA1CC34F1CBA832C160A5E3114585B01AA8`。`2026-09-20-new-design-schema.sql` 保留为安装漫画结构前的历史基线。

当前快照导出时作者库登记 119 项迁移，包含手动安装的 `106_world_usage_scope`、`107_payoff_ledger_windows` 与 `108`—`122`；结构-only 快照不含能力行及迁移账本数据。目标结构仍以 `migrations/` 中的 SQL 为准，快照本身不能证明功能调用或作者验收。

文件只包含这两个新版 schema 的对象定义，不含表数据、小说正文、模型凭据行或临时测试 schema。它不是完整备份：未包含扩展安装、迁移账本数据、附件与 AI 原回复。还原前需在新的空 PostgreSQL 17 数据库安装 AGE 1.7、pgvector 0.8.6 和 pg_trgm，并按项目恢复流程处理运行数据；不得覆盖现有作者库。

当前快照已在独立空库 `schema_verify_115_122_final` 还原并核对对象数量：`new_design` 为 398 张表、2 个视图、1053 个索引、5 个序列；`new_design_projection` 为 4 张表、0 个视图、7 个索引、5 个序列。隔离库未导入任何作者数据。
