# 备份、恢复与可移植导入导出

源码开发阶段可用的独立逻辑dump＋受控文件快照、SHA只读校验与55584/tmpfs恢复演练说明，见 [开发交付与同步](development-delivery.md)。它要求操作者停止全部写入者，不是下文031跨模块冻结／原子发布运行时，不宣称已完成真实备份或恢复验收。

## 目标与真相边界

031 为跨机器同步建立统一传输账本。完整备份由 PostgreSQL 逻辑数据、应用管理附件和不可变 manifest 组成；AGE 图、pgvector 向量、缓存以及运行队列是可重建派生数据，不是作品正本。

> 🏠 **白话比喻**：搬家时，数据库是装有原稿的文件柜，受管附件是画稿箱，manifest 是逐箱清单。搜索索引和任务队列像旧办公室的便利贴，到新地点可以重做，不能拿便利贴代替原件。

> 🧠 **速记方法**：**库、件、清单一起走；图、向量、缓存重新建**。

Git 会同步迁移 SQL、内置模板和本说明，不会同步作者已经写入 PostgreSQL 的业务数据。跨机器开发需要先生成完整备份，在目标机器执行恢复预检并显式确认，再把新产生的数据继续备份。

## 开发数据与原回复同步

开发环境的 Docker 构建来源保存在 `docker/dev-postgres/Dockerfile` 与 `docker-compose.dev.yml`，目标机器重建镜像即可；镜像本身不代替数据库数据，不能只同步 Dockerfile 就认为小说数据已搬走。

本地受控视觉原文件位于 `data/assets`；章节模型原回复凭证位于 `data/ai-receipts`。跨机器继续开发须与对应 PostgreSQL 逻辑备份、迁移版本清单一起保存。原回复凭证只是收到输出的执行证据，不证明数据库候选、采用或结算已提交。迁移注册也不表示源库已经升级，迁移清单必须记录备份时实际数据库状态。

备份前先在原来源页核对在途或未知请求，明确保留结果；复制本地凭证后，目标机器仅核对原请求，不自动恢复领取或重调模型。凭证中的原 UUID、输入 hash 和版本不能为了另一台机器方便而改写。数据含作者全文及来源历史，加入 Git 前须确认备份范围不含密钥、凭据、连接串或无关私人文件；不得把镜像层当数据备份提交。

> 白话比喻：搬厨房时，菜谱、订单账和已经做好的菜要对应装箱；只带炉子的安装说明，菜并不会自动跟过去。对应到系统：Dockerfile 是重建环境的说明，数据库与受控附件／回复凭证才是要搬的数据。

> 速记方法：环境重建看 Dockerfile，作品同步带库和件；回单可验来源，不替代采用。

本轮编码阶段没有执行备份、迁移或还原；此说明不冒充已生成新的可恢复备份。受控传输运行时的能力限制仍以下文 Release Gate 为准。

## 固定配置

| profile | 用途 | 主要内容 |
|---|---|---|
| `full_system` | 整库备份／恢复 | PostgreSQL 逻辑数据、受管附件、迁移与扩展兼容快照 |
| `compact_continue` | 单书继续创作 | 当前采用链、必要历史、来源证据、运行快照和附件 |
| `full_audit` | 单书完整审计 | 单书全部版本、采用记录、证据、运行历史和附件 |
| `template_bundle` | 模板搬运 | 类型、字段、字典、关系、表单、模板和提示词版本 |
| `resource_bundle` | 资源搬运 | 稳定 portable key、资源版本和显式依赖 |

模板与资源不能依赖某台机器的 UUID 身份完成合并。包内用稳定 portable key 与版本识别对象，导入时把来源 ID 映射为目标 ID，并记录 `transfer_id_mappings`。

## 执行流程

```text
请求 → Outbox/job → running → 生成或扫描包 → verifying
                                      ↓
导入：dry-run → 冲突处理 → 用户确认 → 新 staging → 校验 → 显式发布
导出：manifest + package + checksum → ready → 受控下载
```

- 所有操作先写 `transfer_operations`，再由 030 的 `backup.requested / backup.run` 处理，不创建第二套队列。
- 导入只接受上传层签发的 UUID 票据。客户端不能提交文件路径、命令、环境变量、数据表清单或任意数据库工具参数。
- 每次导入必须先 `dry_run`。未知必需能力、缺失能力、未知格式或不可用检查一律失败关闭。
- `apply` 只能引用同种类型、同 profile、已经 ready 的 dry-run；未解决冲突会阻止确认。
- 导入和恢复先写全新 staging。失败或取消只废弃 staging，不能覆盖当前数据库或当前附件目录。
- 整库恢复没有普通 HTTP 路由，只能由本机维护模式、高权限确认和固定运行时合同发起。

## 包与路径安全

归档只允许跨平台相对路径。绝对路径、盘符、`..`、反斜杠、UNC、Windows 设备名、控制字符、符号链接、重解析点和仅大小写不同的重复路径都会被拒绝。每次操作冻结条目数、单文件大小、解压总量与压缩比上限，用来阻断路径穿越和压缩炸弹。

产物下载先从数据库取得 ready 记录，再在固定私有运行目录下解析 locator，并同时检查普通文件、符号链接和 realpath 边界。数据库或客户端都不能指定任意本机路径。

SHA-256 用于发现文件损坏和内容不一致，不提供保密性。

> 🏠 **白话比喻**：校验和像封箱后贴的重量和封条编号，能看出箱子是否被换过，却不能阻止旁人看见箱中内容。对应到系统：需要保密时仍要使用受控存储、权限和后续加密能力。

> 🧠 **速记方法**：**哈希验真，不等于加密；路径只相对，解包先限额**。

## 兼容性清单

manifest 固定记录包格式版本、应用版本范围、schema 版本、迁移序列及哈希、PostgreSQL 版本、AGE/pgvector 版本、编码、平台限制，以及卡片、表单、模板和提示词 schema 版本。`transfer_compatibility_snapshots` 记录目标机器的实际比较结果。

`explicit_upgrade` 只允许执行已经由代码注册并审计的升级路径，不能把未知能力当成警告跳过。秘密、数据库连接串、绝对路径、临时签名 URL 和凭据不会写入 manifest；只保存需要在目标机器重新配置的安全引用名称。

## 数据表职责

- `transfer_operations / transfer_operation_events`：状态机、修订号和审计事件。
- `transfer_manifests / transfer_artifacts / transfer_archive_entries`：包规格、文件校验和与安全归档清单。
- `transfer_compatibility_snapshots / transfer_validation_results`：兼容性和各阶段门禁证据。
- `transfer_steps / transfer_checkpoints`：后台执行进度与可恢复边界。
- `transfer_conflicts / transfer_id_mappings`：预检冲突、用户决定和目标 ID 映射。
- `transfer_staging_scopes / transfer_import_sources`：隔离区和导入来源审计。
- `transfer_restore_drills`：正式发布前的恢复演练记录。

终态为 `ready / failed / cancelled / imported / restored / archived`。清单、兼容结果、校验、映射、来源和事件只追加；ready 产物与已完成 staging 不再修改。

## 当前可用性与 Release Gate

当前代码已经具备数据库合同、类型合同、API 边界、路径校验和可注入后台执行器，但受控打包／解包与原子切换运行时尚未接入。因此运行时探测必须返回明确的 `package_runtime_unavailable`，创建操作不能伪装成功。

发布前必须完成以下验证债务：

1. 接入固定版本归档打包／解包器，禁止 shell 字符串、用户命令和用户路径透传。
2. 用匹配 PostgreSQL 主版本的固定 `pg_dump / pg_restore` 完成真实逻辑备份和恢复。
3. 完成数据库与附件一致性快照、staging 原子发布和失败回滚。
4. 验证 AGE、pgvector 与其他派生数据可从正本重建，队列不会被当作需要恢复的业务真相。
5. 覆盖大包、压缩炸弹、路径碰撞、损坏校验和、未知 capability、跨版本升级、进程中断和磁盘不足。
6. 执行定期恢复演练并记录 `transfer_restore_drills`；只“备份成功”不算可恢复。

本轮按开发约束只做静态审查，没有运行真实迁移、数据库工具、打包器、服务、构建或测试。
