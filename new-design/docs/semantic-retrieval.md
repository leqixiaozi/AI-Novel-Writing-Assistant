# pgvector 语义检索数据契约

## 定位

`029_pgvector_semantic_retrieval.sql` 在新设计 PostgreSQL 中建立分块、嵌入和检索轨迹。小说事实、正文、规划、研究和附件解析文本仍由各自正本表负责；分块、向量与 HNSW 索引都是可以丢弃后重建的派生数据。

> 🏠 **白话比喻**：正文和卡片像档案馆里的原件，分块像复印后裁成的小纸条，向量与 HNSW 像按含义编好的检索目录。目录损坏可以重印，但不能拿目录里的摘要反过来修改原件。对应到系统：来源表是真相，`embedding_*` 是可重建索引账本。

> 🧠 **速记方法**：**原文是正本，分块锁锚点，向量锁配置，验数再换代，召回必留痕**。

事实、关系和相似度的职责严格分开：

- PostgreSQL 事实表回答“作品当前确认了什么”。
- Apache AGE 投影回答“这些对象怎样连接”。
- pgvector 投影回答“哪些内容在语义上相近”。

## 来源覆盖

每个 `embedding_source_snapshots` 必须属于一本书，并携带 `source_kind`、稳定 ID、精确版本 ID、修订号、SHA-256 内容哈希和 026 依赖资源。支持的来源包括卡片版本、章节正文、正典事实、知情与状态变化、故事时间与关系、规划版本、研究原文／运行／参考包、提示词组件、AI 结果、质量证据和附件解析文本。

公共研究或提示词对象要先通过书内采用、引用或上下文资源形成书籍作用域，再进入语义来源；不能把全局资源直接接到另一部书的检索索引。

## 主要表

| 表 | 正本或派生 | 关键职责 |
|---|---|---|
| `embedding_profiles` | 配置身份 | 稳定配置键、当前版本和归档状态 |
| `embedding_profile_versions` | 不可变配置 | 厂商能力键、模型、维度、距离算法、归一化与分块配方 |
| `embedding_source_snapshots` | 派生输入快照 | 冻结书籍、来源精确版本、修订、哈希和待分块文本 |
| `chunking_requests/results` | 运行账本 | 分块请求、幂等键、迟到拒绝和结果哈希 |
| `embedding_chunks` | 不可变派生 | 顺序、锚点、文本、token 估算、分块器版本和内容哈希 |
| `embedding_requests/attempts/results` | 运行账本 | 重试历史、冻结输入哈希、向量回执和迟到结果留痕 |
| `embedding_index_generations/vectors/states` | 可重建索引 | 按书和配置版本组装新世代、核对覆盖率、激活或保留旧世代 |
| `embedding_stale_reasons` | 失效账本 | 来源变化、归档、配方变化、迟到回执等原因 |
| `semantic_retrieval_runs/results` | 只追加轨迹 | 调用方、查询哈希、筛选、参数、耗时、命中版本与入选原因 |

## 一致性和安全边界

1. `vector` 列允许多维数据共表保存，但数据库触发器使用 `vector_dims()` 核对配置版本；每个 HNSW 索引按固定维度和固定 generation 建立，禁止混维度或混距离算法。
2. profile version、分块内容、嵌入结果和命中明细不可原地改写；状态字段只允许走受控生命周期。
3. 新 generation 先装载当前有效分块的最新成功向量，再核对期望数、实际数、覆盖率和校验和。只有覆盖率为 100% 的 `ready` 世代可以原子激活；构建失败不会替换旧索引。
4. HNSW 名称只能由服务端根据 generation UUID 生成，数据库函数只接受固定正则和固定三种 operator class，不接收客户端 SQL、列名、维度或运算符。
5. 检索固定书籍、当前激活 generation、来源白名单、`top_k`、候选数、阈值和超时；结构化条件先过滤，再按受控 vector、全文检索和 `pg_trgm` 权重混排。
6. 默认不保存原始查询文本，只保存查询哈希、可选脱敏摘要和上游引用。每条命中记录精确来源版本、修订、哈希、各路分数和入选原因。

## 与统一依赖账本联动

派生链通过 026 资源与边表达为：

`来源精确版本 → embedding_source_snapshot → embedding_chunk → embedding_result → embedding_index_generation`

上游换版或归档后，026 会沿链保存影响路径；029 的失效桥会把快照、分块、向量或 generation 标记为陈旧并记录原因。旧 worker 的迟到向量仍进入 `embedding_results` 留痕，但 outcome 为 `rejected_stale`，不会进入新索引。

## API 边界

服务端和客户端契约提供配置创建与读取、来源快照登记、分块回执、嵌入请求／尝试／回执、generation 构建／激活、覆盖率健康度、受控混合检索和检索轨迹读取。当前不包含真实 Embedding 模型调用、Outbox worker、RAG 页面或工作台 UI。

## 跨机器同步与备份

迁移 SQL 和本数据文档随 Git 同步，因此其他开发机能得到相同表结构和规则。作者实际内容、来源快照、分块、向量、generation 与检索轨迹存在 PostgreSQL 中，必须做逻辑备份；附件解析来源还要连同受管附件目录备份。

> 🏠 **白话比喻**：Git 只搬走空表格和填写说明，数据库备份才搬走已经填好的档案，附件备份则搬走档案袋里的实物。对应到系统：跨机器恢复必须同时考虑代码、PostgreSQL 数据和受管文件。

## Release Gate

- 安装包必须提供与 PostgreSQL 主版本匹配的 pgvector，并验证 `CREATE EXTENSION vector`、HNSW 构建和升级路径。
- 需要在真实 PostgreSQL 上验证多维 profile、三种距离算法、分代构建／失败保旧／激活、跨书隔离、超时、迟到回执、失效传播和重启回读。
- 需要补齐真实 Embedding provider、Outbox worker、限流／重试调度、覆盖率告警、索引回收、备份恢复演练和规模性能基线。
- 需要确认中文全文检索词典策略；当前 `simple` FTS 与 `pg_trgm` 是受控混合召回的基础能力，不宣称已经达到最终中文分词效果。
