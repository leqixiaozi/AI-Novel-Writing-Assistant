# 新设计私有 PostgreSQL 运行时

新设计把 PostgreSQL 17、Apache AGE、pgvector、`pg_trgm`、迁移和应用产物视为一个带哈希清单的 Windows x64 私有运行包。运行时只读取应用包内固定路径，不下载、不扫描系统 PostgreSQL，也不读取外部数据库连接串。

> 🏠 **白话比喻**：应用程序是旅馆，私有数据库是旅馆自己的机房，用户数据是寄存柜。装修旅馆可以替换设备，但不能顺手清空寄存柜。对应到系统：程序包可覆盖升级，用户数据目录独立保留，并按 data generation 切换。

核心调用链：

```text
PowerShell / desktop host
  → runtime CLI / startNewDesignRuntimeServices
  → PrivateRuntimeManager
  → manifest + layout + state + controlled command
  → PostgreSQL/AGE/pgvector
  → 001—034 migrations
  → PostgreSQL Outbox runners
```

`bootstrap/state.json` 只保存未连库前所需的本机协调状态，并使用格式版本、稳定序列化 checksum 和原子替换。数据库可用后，032 的 installation、lifecycle、health 与 upgrade plan 表承担持久审计；它们不保存小说业务正本。

升级与恢复只允许固定候选包和本机维护执行器。031 提供完整备份、兼容预检和 staging 证据，032 记录升级状态机；真正切换必须在目标世代校验完成后进行，失败回到旧世代。AGE 与向量是可重建投影，不替代 PostgreSQL 关系正本。

运行与故障处理见 [Windows 私有 PostgreSQL 运行时手册](../../../new-design/docs/private-runtime-runbook.md)，备份边界见 [传输与恢复架构](transfer-portability-and-restore.md)。
