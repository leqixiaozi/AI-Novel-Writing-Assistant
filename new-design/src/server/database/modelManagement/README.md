# 模型与知识语义索引连接

稳定资源修正使用专属注册资产`new_design.character.stable_resource_correction@v1`，仅绑定既有`chapter_settlement`受控任务组，不开放通用研究入口。`stableCorrection`与普通v1的`stableSupplement`互斥；完整原资源范围、原正文计划／SHA、当前会话修订、实际issue-owned章前证明和当前正常发布目录全部核验。候选仅限唯一冲突字段，模型输出仍走原结构化字段、字典、证据、差值验证与治理用量原记录。旧v1资产、输入、哈希和领取保护保持。

## 唯一正本

文字模型与专属向量模型都使用原 `model_route_configs / model_route_versions` 和 `model_credential_refs`，发布使用原 `ai_contract_publications`。不增加第二连接表或端点配置。手动迁移 105 为凭据引用增加数据库密文；新设置页将密钥加密保存到原凭据行，连接版本仍只冻结凭据 ID，目录和公开版本不返回密钥。旧环境变量引用只作为历史兼容路径；新建凭据使用数据库密文。

白话比喻：同一家车行分别登记载客车与运货车，仍用同一本车辆档案，不另开私人账本。对应代码：向量模型用途由原配置 `scope=task_group, task_group=knowledge_embedding, task_key=null` 与版本 `required_capabilities=['embedding']` 明确声明，文字任务列表不增加向量任务。速记：同正本、分用途、选原版、不借默认。

## 独立向量协议

`ManagedEmbeddingConnectionVersion` 继承原连接字段（服务、端点、模型、凭据 ID），附 `connectionVersionId / connectionHash / configId / configRevision / version / label / timeoutMs / maxRetries / retryDelayMs`。版本 ID 就是原 `model_route_versions.id`，hash 就是不可变原版本 `content_hash`。

模型 façade 导出 `getManagedEmbeddingCatalog`、`listManagedEmbeddingConnectionVersions`、`readManagedEmbeddingConnectionVersion`、`saveManagedEmbeddingConnection`、`readManagedEmbeddingSaveReceipt`。专属 Reader 必须按显式 UUID 读取发布或历史已发布版本，核对用途、参数和原备用记录；拒绝文字默认、不支持参数和任意备用。它不调用模型，不通过文字 Prompt 执行器，不建立文字模型快照。

070 由索引模块持有：原 embedding profile version 通过 FK 绑定精确原连接版本，索引请求和尝试冻结原版本 hash、provider/model/dimensions。旧未绑定 profile 可展示，不得假装可执行；查询必须匹配激活索引的 profile，不换模型或维度。此模型模块不执行 070 或复制向量事实。

## 保存与恢复

保存输入是原连接字段、超时/技术重试、预期配置修订和原 UUID 请求键。按原 publication key 与专属配置范围串行锁定；同键只返回同一原版本，不接受不同 payload。配置版本与回执同事务写入，结果在 COMMIT 前读取；确认回滚才能标 `not_written`，提交应答不明为 `unknown`。读取空回执不能证明未提交。

HTTP 路由前缀 `/models`：GET `/embedding/catalog`；POST `/embedding/connections`；GET `/embedding/connections/by-request/:key`；GET `/embedding/connections/:id`。GET 只读，不承接保存或模型执行。`ManagedEmbeddingConfigurationError` 是可信事务结果证明，普通 Error 属性不被当作回滚证明。

模型页专属面板显式选择历史版本或填新连接，列表读取不选第一模型，不声称列表即向量能力。待核对请求随草稿保留，恢复只 GET 原 key；确认未写且已核对后才允许保留填写、明确采用最新配置修订准备新保存。成功回执先保留，后续刷新失败不改称保存失败。

浏览器恢复必须分别校验可编辑草稿与完整原保存输入：原 UUID key、expectedConfigId／expectedRevision 的成对条件、连接和策略字段缺一不可。返回原 input，不剥离原 key 或套用当前修订；本地 notWritten／checked 不作为服务器证明，重开均重置。非空坏存储由原面板锁定且不覆盖，不能按空白草稿解锁。

新保存准备只按原 connectionSchema 去除 endpoint／model 前后空白，原填写另随 draft 保留；不改 URL 路径、原 key 或配置修订。历史待核对 input 不重写，仅在只读匹配时按同规则规范化比较，并核对 connectionHash 等于含原 key／预期修订的完整规范化输入 hash。回执使用原 publication 的 entity_revision，不用当前配置修订冒充原提交；原配置初始 revision=1，首次 publication 回执为 2。

本阶段仅编码、静态审阅和用例编写；未执行测试、类型检查、构建、迁移、运行 GET 或模型调用。
