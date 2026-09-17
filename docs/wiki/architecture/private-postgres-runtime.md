# 新设计私有 PostgreSQL 运行时

新设计把 PostgreSQL 17、Apache AGE、pgvector、`pg_trgm`、迁移和应用产物视为一个带哈希清单的 Windows x64 私有运行包。运行时只读取应用包内固定路径，不下载、不扫描系统 PostgreSQL，也不读取外部数据库连接串。

本地开发采用单独入口：`pnpm dev` 显式启用仓库内的 `new-design/docker-compose.dev.yml`，构建包含 AGE、pgvector 与 `pg_trgm` 的 PostgreSQL 17 容器，并执行相同的连续迁移。开发容器是真实功能环境，但不具备发布 manifest、离线装配和 Windows 二进制验收含义；未带开发标记的运行仍严格走私有运行包。

## 开发数据库的存储与网络边界

`.data/runtime.json` 是开发实例的本机目标配置。未指定 `bindAddress` / `dataDirectory` 时保留原回环监听及命名卷；指定宿主机绝对目录时使用 bind mount，对外监听必须明确设为 `0.0.0.0`。Compose 的环境变量由保存配置生成，不能靠临时 shell 环境悄悄改变已有数据库目标。应用连接地址仍为 `127.0.0.1`，对外发布地址不等于应用连接地址。

`scripts/development/docker-target.cjs` 统一定义启动、初始化和逻辑备份的目标校验。启动前检查已有容器的持久挂载与端口配置，备份前检查实际运行目标；Windows 路径和 Docker Desktop 的宿主机路径前缀在比较时规范化，但其他目录不能替代目标目录。新环境初始化拒绝非空目录与链接，旧环境变更存储必须经过备份和显式迁移，不能让 Compose 自动重建掩盖目标切换。

Docker 镜像磁盘、宿主机数据库目录和逻辑备份分别管理。Windows 的 TCP 保留端口段可能覆盖默认 `55432`，即使没有进程监听也会拒绝绑定；应检查系统排除范围并保存另一个空闲端口，不删除系统保留规则。容器健康、宿主机监听、防火墙许可和另一设备连通性是四项不同证据，不能互相替代。本边界仅适用于开发 Docker 运行时，发布运行包规则保持独立。

> 🏠 **白话比喻**：开发容器像厨房里的试菜台，炉灶和食材都是真实的，适合反复试做；发布运行包像封装后送到门店的标准餐包，还必须核对批次、保质期和封签。对应到系统：开发态能真实验证图与向量能力，但发布态仍必须独立验证清单、二进制和许可证。

> 🧠 **速记方法**：**开发容器验功能，发布清单验交付。**

> 🏠 **白话比喻**：应用程序是旅馆，私有数据库是旅馆自己的机房，用户数据是寄存柜。装修旅馆可以替换设备，但不能顺手清空寄存柜。对应到系统：程序包可覆盖升级，用户数据目录独立保留，并按 data generation 切换。

核心调用链：

```text
PowerShell / desktop host
  → runtime CLI / startNewDesignRuntimeServices
  → PrivateRuntimeManager
  → manifest + layout + state + controlled command
  → PostgreSQL/AGE/pgvector
  → 001—036 migrations
  → PostgreSQL Outbox runners
```

`bootstrap/state.json` 只保存未连库前所需的本机协调状态，并使用格式版本、稳定序列化 checksum 和原子替换。数据库可用后，032 的 installation、lifecycle、health 与 upgrade plan 表承担持久审计；它们不保存小说业务正本。

升级与恢复只允许固定候选包和本机维护执行器。031 提供完整备份、兼容预检和 staging 证据，032 记录升级状态机；真正切换必须在目标世代校验完成后进行，失败回到旧世代。AGE 与向量是可重建投影，不替代 PostgreSQL 关系正本。

运行与故障处理见 [Windows 私有 PostgreSQL 运行时手册](../../../new-design/docs/private-runtime-runbook.md)，备份边界见 [传输与恢复架构](transfer-portability-and-restore.md)。
