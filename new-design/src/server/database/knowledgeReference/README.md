# 知识参考后端

文本/Markdown 原文件仍是 `assets → asset_versions → asset_content_objects`，解析仍是 `asset_derivations → asset_derivation_results → 派生 asset_versions`。UTF-8 换行规范化得到真实解析文件，解析正文只保存在该派生版本 metadata，供关键词查找；没有新增研究正文副本、向量结果或模型服务。

原文件像收到的快递，解析正文像拆箱后可阅读的说明书。对应技术上，上传成功只登记 pending 解析请求；作者点击解析，校验原文件 SHA-256/字节数/UTF-8，才记录真实派生版本和 succeeded。速记：“收到不等于拆好，解析不等于向量索引”。本模块负责文件／解析／关键词检索，语义执行由原 `knowledgeIndex` 专属向量配置、请求／尝试／回复及分代链消费，不借默认文字模型；真实模型未验收，模型设置入口为 `/new-design/structure/models`。

文件仅落 `new-design/data/assets/knowledge-<sha256>.utf8`，路径由服务端生成，不接受浏览器 locator、绝对路径或外部 URL。仅非空有效 UTF-8，最大 2 MiB，拒二进制控制字符、目录链接、非普通文件、哈希不符和同路径覆盖。独占创建并同步文件；相同内容重复核对。损坏文件不自动删除或覆盖。迁移机器时应连同 `data/assets` 文件和数据库备份搬迁，单独 SQL 不能恢复附件内容。

存储定位符的长度和安全路径分别校验：075 保留 027 的 1..1000 长度、首字符、字符白名单及遍历／绝对路径／URL 排除，只把 PostgreSQL 不支持的重复上限改为无界重复；无界字符重复并不取消独立长度限制。像快递柜分别检查包裹尺寸和危险品：对应数据库，长度合格和路径安全必须同时满足。速记：“长度一关，路径一关，两关都过”。共享资产归档触发器另由 074 固定函数 schema，知识路径仍执行原预览、失效桥及历史保护，不绕过视觉标记检查。

绑定像给说明书写收件人和版次：对应到系统，只选择真实本书、当前资料版本、采用正文版本或真实任务尝试，写原 `asset_mounts`，不凭标题猜对象。稳定 ID 与精确版本一起核对；对象切版后历史绑定仍保留，但不能假装绑定到新版。速记：“绑定说明用途，引用才选内容”。挂载不会自动成为模型上下文；`loadKnowledgeReferenceContext` 只提供显式相同 owner 的真实活跃解析引用，信任为 reference。

显式引用像在备课讲义里写清“采用哪本书的哪一版”：对应技术上，作者从真实解析候选选择 sourceVersion/parsedVersion/hash，再选择已完成的基础 manifest 和实际配方位置。只有原配方明确允许 `asset_version`，才克隆同一上下文账本、保留原条目并追加精确引用；不修改或发布作者配方，不把附件搬成研究全文。速记：“先声明位置，再选版本，最后冻结”。`loadKnowledgeManifestSupplement(bookId,manifestId)` 对调用方明确选择的 finalized manifest 读取实际精确正文，返回 user 消息，绝不提升 system 信任。消费者必须显式接入此加载方法，不能将挂载成功等同于模型已阅读。

全文查看按精确解析版本分段返回，每段最多 100000 字符，明确总长度、偏移、下一段和截断；引用候选摘要最多 1000 字符，不把摘要当完整正文。查询严格要求原件、请求、派生版本、真实 applied 结果、内容 SHA-256 和依赖状态全部属于同书且精确匹配当前解析。缺失状态不是有效状态：061 只在真实新知识版本与新 complete manifest 的首次冻结事务中登记 fresh，不更新任何历史投影；历史缺状态需要重新实际冻结，不能批量提升。

归档像撤回一本说明书的使用资格，而不是烧掉它。对应技术上，先只读依赖影响，作者确认同版本和 previewHash 后，再提交原资产 archive 事件，沿统一依赖失效桥使下游过期；历史版本和绑定不删除。检索和上下文加载排除归档、失效、缺状态或待重建来源。速记：“撤资格，留历史”。影响超过 200 条或依赖路径超过 40 层均标明截断，不能在截断清单上盲目确认。

076 对原归档桥使用无列歧义的局部 `invalidation_event_id`，两个相关查询明确匹配该原事件；不能把 `event_id=event_id` 当作有效过滤或依赖默认变量优先级。像查退件单时必须说明“这张退件单的号码”，不能笼统喊单号；对应原失效桥仍只处理本次事件命中的派生资料。速记：“列名带表，变量另名”。

请求回执像柜台原单号：对应技术上，上传/归档沿 asset_events，绑定沿 asset_mounts，解析沿 asset_derivation_results，引用沿 context_manifests；061 为原 append-only 账本增加 input hash/receipt。速记：“原单号查结果，不拿空查询猜失败”。跨操作统一请求锁，完整输入不同则 409；回执形成与事实同物理事务，提交后不再 GET 来猜成功。只读按原 key 查询，空结果不证明之前的 COMMIT 失败。只有未开始 COMMIT 且物理 ROLLBACK 已确认，才能标数据库 not_written；文件可能已保存，永不把文件副作用伪装回滚。无模型调用，因此不制造费用或向量完成记录。

解析读取失败会保存 failed 解析结果和回执，原文件引用保留；修复文件后由作者明确新请求重试，沿 failed → rebuild_pending → processing → terminal，最多处理一次，无后台模型重试。解析成功无重跑入口，保留旧精确派生版本。

历史正文缺状态或来源失效时，`parseAvailable=false` 与 `recoveryReason` 明确告知作者在本页重新上传原文件并解析新资料；本轮不新增同对象重解析合同，不改旧成功请求的冻结期望值，不把旧结果批量标有效。

提炼资料像把参考书里的信息抄进待审核的备课表，而不是直接涂改档案。对应技术上，知识页精确链接只提出候选，普通表单 `FormAiReferences` 必须从本书真实目录再次匹配四个精确来源字段，作者点击使用后 `FormAssistRequest.referenceKnowledgeSources` 进入原表单建议链。生成时冻结正式字段/字典/实际知识正文并纳 sourceHash，正文只在 `__readonly_context` 的 user 数据里；候选沿原 ai_generation_batches，勾选采用沿原 form_ai_draft_decisions，最后 authorMaterials 正常保存复核同 sourceHash、写原来源凭证。不增加候选事实表或研究全文副本。速记：“参考→候选→草稿→正常保存”，每一步都不替下一步假确认。

提示词组合也有实际消费者：作者明确加入知识选择并保存新 recipe 版本，才声明该版 explicit_context 允许 asset_version；compile 将完整精确正文冻结入消息，freeze 写同 context_manifest_entries，claim 对全量卡片/资产引用、版本、书、角色、SHA-256 与冻结哈希逐项核对，replay 重新按代码受控 PromptAsset 构造并比较完整消息。执行直接使用此冻结消息；旧组合版本/预览不修改、不提升合同规则。超过输入预算明确拒绝，不偷换为摘要。普通表单生成回执丢失时，原 key 保存在浏览器受控恢复标记，只读按原 key 查询；空查询仍未知，不重复发送模型。

061 还防止通用附件 API 或通用后台执行器冒充本模块解析：带知识标记的原件/派生版本、knowledge.utf8 请求只能由专属同事务路径写入；派生正文 SHA-256 必须和登记内容一致，且确实对应 processing 的同书精确来源。事务内写入标志仅在服务端设置，HTTP 不接受此字段；旧普通附件不变，旧版本历史不改写。归档桥先按实际表名分支后读取不同记录字段，保留原失效与派生过期语义。

HTTP 模块 `createKnowledgeReferenceRouter()` 无前缀挂主 API router：`/books/:bookId/knowledge/{workspace,search,uploads,receipts,reference-candidates,reference-targets,references}`，`/books/:bookId/knowledge/assets/:id/{parse,bind,archive-preview,archive,content}`。061 只替换保留全部旧取值的来源枚举约束，不删除任何事实或历史。迁移和运行证据仅来自隔离测试库；正式用户库升级与真实模型未验收。最新正向切片结果见[知识索引核验](../../../../docs/knowledge-index-pipeline-review.md)，本说明不等于运行验收。
