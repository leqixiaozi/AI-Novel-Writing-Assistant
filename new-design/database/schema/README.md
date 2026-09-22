# 新版数据库结构快照

本目录保存作者库历史导出，不代表当前纯表源码结构。`132` 独立空库基线已通过 PostgreSQL 结构及人工主流程验证，权威定义见 [`132_card_kernel_tables_only.sql`](../../migrations/132_card_kernel_tables_only.sql)，验证边界见[开发交付记录](../../docs/development-delivery.md#当前数据库更新方式)。本轮未修改作者库，也未重新导出或还原历史快照；不得把以下兼容结构作为 `132` 的安装入口。

`2026-09-22-new-design-schema.sql` 是最近一次作者库快照：2026-09-22 从本机新版作者库 `ai_novel_new_design` 以 PostgreSQL 17.11 `pg_dump --schema-only --no-owner --no-privileges --schema=new_design --schema=new_design_projection --schema=new_design_compat` 导出并移除行尾空白，SHA-256 为 `4291D43ED79B0D1EE1C1A5AE04AFA0A168EEA3FA16B075221C247336366099D5`，文件大小为 1,760,237 字节。`2026-09-21-new-design-schema.sql` 和 `2026-09-20-new-design-schema.sql` 保留为收敛前历史基线。

当前快照导出时作者库登记 128 项迁移，并已安装 `123`—`131` 卡片内核 v2 收敛。`new_design` 有 79 张应用表、344 个兼容视图和 245 个索引；`new_design_projection` 有 4 张 AGE 投影表、7 个索引和 5 个序列；`new_design_compat` 有 324 个兼容复合类型、不含物理表。总物理表数为 83。结构-only 快照不含能力行及迁移账本数据；目标结构仍以 `migrations/` 中的 SQL 为准，快照本身不能证明功能调用或作者验收。

文件只包含三个新版 schema 的对象定义，不含表数据、小说正文、模型凭据行或临时测试 schema。`new_design_compat` 只保存兼容视图所需的行类型，用于在业务仓储尚未全部改写为卡片仓储时还原结构；它不增加物理表。它不是完整备份：未包含扩展安装、迁移账本数据、附件与 AI 原回复。还原前需在新的空 PostgreSQL 17 数据库安装 AGE 1.7、pgvector 0.8.6 和 pg_trgm，并按项目恢复流程处理运行数据；不得覆盖现有作者库。

当前快照已在独立空库 `schema_verify_card_kernel_v2_20260922` 还原并核对上述对象数量；隔离库未导入任何作者数据。只导出 `new_design` 和 `new_design_projection` 会漏掉兼容视图引用的复合类型，因此当前快照明确包含 `new_design_compat`。
