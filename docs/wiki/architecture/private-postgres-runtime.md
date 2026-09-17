# 新设计私有 PostgreSQL 运行时

新设计把 PostgreSQL 17、Apache AGE、pgvector、`pg_trgm`、迁移和应用产物视为一个带哈希清单的 Windows x64 私有运行包。运行时只读取应用包内固定路径，不下载、不扫描系统 PostgreSQL，也不读取外部数据库连接串。

本地开发采用单独入口：`pnpm dev` 显式启用仓库内的 `new-design/docker-compose.dev.yml`，构建包含 AGE、pgvector 与 `pg_trgm` 的 PostgreSQL 17 容器，并执行相同的连续迁移。开发容器是真实功能环境，但不具备发布 manifest、离线装配和 Windows 二进制验收含义；未带开发标记的运行仍严格走私有运行包。

## 开发数据库的存储与网络边界

`new-design/.env` 是开发数据库的唯一运行配置来源，`.env.example` 是不含凭据的模板。`scripts/development/environment.cjs` 负责读取、校验及构建 Compose 子进程环境，供应用与备份共用；不能再把环境变量固化到 JSON 后继续优先读取旧值。应用启动显式传入 `--env-file` 并用同份解析结果覆盖残留 shell 变量，防止容器与连接池使用不同端口或凭据。直接手工调用 Compose 则遵循 Docker 自身的 shell 优先级。

未指定监听地址或数据源时保留回环与原命名卷，绝对路径表示 bind mount，`0.0.0.0` 表示明确开放所有 IPv4 网卡。应用连接地址仍为 `127.0.0.1`，对外发布地址不等于应用连接地址。修改文件后重启应用生效，不热切换运行中的连接池。旧 `.data/runtime.json` 只由显式 `--import-runtime-json` 原样转写为 `.env`，不覆盖已有环境文件、不改数据库密码、不删除旧文件；运行时不做静默回退。

`scripts/development/docker-target.cjs` 统一定义启动与逻辑备份的目标校验。同一数据库存储和身份下允许重新发布端口；存储或身份改变则停止并要求受控迁移。备份必须核对完整的实际挂载与监听目标。Windows 路径和 Docker Desktop 的宿主机路径前缀在比较时规范化，但其他目录不能替代目标目录。没有容器时，非空绑定目录与链接不能作为新实例接管；变更已有存储须先备份，不能让 Compose 重建掩盖目标切换。

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
