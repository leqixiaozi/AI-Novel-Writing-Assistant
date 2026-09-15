# 新设计 P0 静态总核对

核对范围为迁移 001—032、服务端调用链、类型合同、路径／进程／凭据边界和同步文档。本轮按开发策略没有运行测试、构建、服务、真实 PostgreSQL、扩展、打包、备份或升级演练。

## 唯一正本与派生层

| 领域 | 唯一正本 | 可重建／运行层 | 静态结论 |
|---|---|---|---|
| 卡片、表单、模板、研究、正文、事实、状态、知情、时间、规划 | PostgreSQL `new_design` 业务表与不可变版本 | 页面视图、当前投影 | 没有新增 SQLite／Prisma 写链 |
| 依赖失效 | 026 资源、边、失效与回执 | 待重算状态 | 上游换版只标陈旧，不覆盖下游正本 |
| 附件 | 027 content object、asset version、mount | 缩略图、OCR、转码等 derivation | 跨机备份必须带受管附件 |
| 关系检索 | PostgreSQL 关系及版本 | 028 AGE generation | AGE 不反写正本，失败保留旧代 |
| 语义检索 | 精确来源版本与 chunk 账本 | 029 pgvector generation | 向量索引按书与世代隔离 |
| 后台执行 | 专业 request 与 030 Outbox/job/attempt | worker 租约 | 同事务投递、至少一次、幂等回执 |
| 搬家与恢复 | 031 operation/manifest/artifact | staging 与执行器 | 普通 HTTP 不提供 full restore |
| 本机运行 | 032 installation/lifecycle/upgrade + bootstrap | PostgreSQL 进程和临时 passfile | 固定包、固定目录、失败关闭 |

> 🏠 **白话比喻**：正本像档案馆原件，AGE、向量和页面是不同用途的目录，Outbox 是派工单，运行状态是机房值班簿。目录、派工单和登记簿都能帮助生产，但都不能偷偷改原件。

> 🧠 **速记方法**：**业务只认表，关系重建图，相似重建向量，任务走 Outbox，搬家看 031，启停看 032。**

## 连续调用链

1. `runtime-package.spec.json` 冻结版本、文件、许可证和 001—032。
2. `assemble-runtime.cjs` 从显式 source manifest 装配到空目录并生成最终 manifest。
3. `PrivateRuntimeManager` 校验包、数据目录、磁盘、凭据 ACL、世代 owner token 和 PostgreSQL 身份。
4. `database/runtime.ts` 创建应用库，检查并加载 AGE/vector/pg_trgm，按序应用 001—032，然后写 032 运行审计。
5. `startNewDesignRuntimeServices` 只为宿主明确注册的 030 handler 创建 runner；没有 handler 时不把完整运行时标为 ready。
6. 031 备份入口复用 `backup.run`；pg_dump、pg_restore 与 bsdtar 只能来自已验证运行包。
7. 普通 HTTP 只增加私有运行时 status/doctor 只读接口；升级和整库恢复保持本机维护入口。

## 静态门禁结论

- 迁移清单与运行包都要求 001—032 连续，不只比较数量。
- 运行包文件路径限制为固定前缀，拒绝绝对路径、`..`、设备名、大小写碰撞、符号链接／重解析点和 SHA-256 不符。
- 数据路径只能由受信宿主根或 `%LOCALAPPDATA%` 推导；客户端与 CLI 不能提交 data dir、端口、SQL、程序路径或 shell 命令。
- PostgreSQL 只监听 `127.0.0.1`，使用 SCRAM；随机口令只落独立 ACL 文件或短期 passfile，不进入 API、manifest、URL 和子进程参数。
- `stop` 先排空 worker，再核对 instance token、generation、PID、start time 和 data dir；没有完全匹配时拒绝停止，也不调用强制 kill。
- 032 生命周期、升级计划和只追加事件由 SQL CHECK／trigger 限制；版本和 active generation 只能从 upgrading 状态切到已验证目标。
- AGE 1.6.0 的 PG17 发布没有升级脚本，版本变化必须走 staging／重建，不能默认原地升级。

## 动态 Release Gate 债务

以下全部是**未验证**，不得写成已通过：

- 干净 Windows x64 离线安装，Node/PostgreSQL/AGE/pgvector/pg_trgm/bsdtar 二进制和全部许可证装配，以及安装器／运行包代码签名与本地篡改模型。
- 首次 `initdb`、随机凭据 ACL、本机监听、端口冲突、长路径、中文用户目录、杀毒软件和受限权限。
- AGE/vector/pg_trgm 创建与 `LOAD`，001—032 实库迁移、重启读回和 SQL trigger 状态机。
- 正常启动／停止、异常退出、重复启动、陈旧锁、PID 复用和错误 PID 防误杀。
- 030 runner handler 完整注册、租约超时恢复、fencing、停止排空、死信和积压恢复。
- 031 `pg_dump`／`pg_restore`、数据库＋附件一致性、checksum／空间／版本预检、路径穿越／压缩炸弹和中断清理。
- 单书两种 profile、模板冲突、portable ID remap、AGE／pgvector 恢复后重建、失败恢复不污染旧数据。
- 同主版本升级、跨主版本 `pg_upgrade`／逻辑恢复、扩展先行兼容、切换原子性、失败回滚和禁止自动降级。
- 覆盖安装与卸载保留用户数据、磁盘不足、日志轮转／脱敏、大书性能和完整安全审计。
