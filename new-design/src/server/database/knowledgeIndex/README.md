# 原知识索引事实与技术凭证

Facade `index.ts` 导出规格命令、准备/执行/分代/检索、严格输入 schema 与错误类型。仅修改原规格版本、分块请求、嵌入请求/尝试/结果/索引分代和语义检索运行/结果；070 不建新模型配置链或重复索引事实表。

> 🏠 白话比喻：连接版本像厂家封存的机器铭牌，规格像规定这台机器产出多少列的验收单。对应到数据库：profile 指向原 model_route_versions，冻结其真实 hash/provider/model/dimensions，不能临时拿另一机器代产。
> 🧠 速记方法：原键认操作，原版本认机器，原 hash 认内容；同键不同输入拒绝，历史版本不更新。

知识读取来自原 `readReadyKnowledgeRows/resolveReadyKnowledgeVersion`；同一本书、原资产版本、精确解析版本、内容完整性和依赖状态都必须成立。准备与原知识写入共享 `knowledge_book` advisory，原 key 锁先于 book 锁，原配置版本不可变；正式结果必须等于原尝试已保留向量。模型断线不进入原通用自动重试逻辑；controlled attempt 第二次发送由 070 拒绝。

初始 claim 专属纯 DB ACK 证明与原请求冲突分离：必须同锁读取成功并核实原领取确无，回调显式标记 absence，再提交未开始且回滚 ACK 才可标未写；锁／原键读取失败仍未知。分块还核对原完整冻结身份、pending、actual attempts=0 与 attempt_count=0；同键已有尝试返回原回执，绝不另插尝试。读取原键使用 READ ONLY 事务，不触发研究恢复，不发模型；阴性读取不证明未写入。执行与查询回复技术证据是原尝试/原运行字段，不证明正文、索引或检索事务已经提交。

重复准备相同精确正文时，复用分块只能读，不能执行 no-op UPDATE：原生命周期触发器仍会把 current→current 拒绝。准备书锁内使用 INSERT ON CONFLICT DO NOTHING，冲突后按完整唯一键只读锁定原行，复核书、正文、hash、锚点、类型和 current 状态，再创建本次原请求。像复印存档只取阅原件，不盖一次新修改章；对应这里不更新原 chunk，也不削弱不可变触发器。速记：“内容复用只读，新操作另留原单”。

`embeddings` facade 增补客户端注入的只读/原构建 in-transaction helpers 和 pool infrastructure，避免真实 PG 隔离来源与执行落不同 schema，并将多分块读取限制为批量查询。

语义命中携带原件版本、解析版本、全文校验及原分块精确字位／段落 SHA256。作者在原提示词组合中明确加入、保存并预览后，实际消息仅消费该片段；失效段落不得扩大为全文。SQL 081 只保存技术锚点，正文正本不复制。新增消费者仍待本批统一验证，见[消费者合同](../../../../docs/semantic-paragraph-consumer.md)。

SQL 函数必须保存自身的受控 `search_path`，不能只依赖迁移连接的临时设置：新 Pool 连接默认 public，首次编译 `%ROWTYPE` 会找不到原表。072 对 070 四个原知识函数设置 `pg_catalog, new_design, public, pg_temp`；073 对原验证函数的 `profile_id` 参数使用函数名限定，避免与原表同名列歧义，保留全部冻结约束。不重写来源、规格或历史版本，也不在测试连接偷偷补路径。白话像工作人员的办事地址和具体经办人必须印在岗位说明上，不能只靠当天带路的人；速记为“连接临时路，函数固定路；同名参数说全名”。隔离 PG 基线见[统一验证](../../../../docs/current-batch-unified-validation.md)，后续解析／租约／回复／向量分代补验见[知识索引核验](../../../../docs/knowledge-index-pipeline-review.md)，用户开发库未因此自动应用迁移。
