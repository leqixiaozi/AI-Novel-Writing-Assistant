# 故事工作区整组候选

此模块只冻结来源、领取生成请求、保存和读取 AI 候选。正式资料由 authorMaterials／BusinessFormWorkspace 保存，正式规划由 planning／PlanningCenterPage 保存与采用；整组生成不直接写资料、规划版本、事实或初始状态。

请求使用显式 setting／planning 合同，不做关键词识别。setting 最多包含 20 项现有／新增资料，读取已发布类型和当前卡片独立字段，只补空白项。planning 按实际父子关系包含指定卷章及其后代，最多 30 项；全书没有规划时只建议一个故事总览，不虚构卷章层级。上下文超过上限直接返回范围问题，不暗中截断。

候选存在 ai_generation_batches，operation=form_assist、input_payload.contract=story_workspace_ai_v1；批次 UUID 等于原 requestKey。书籍／键的事务锁和主键保证原请求至多调用一次。不同输入复用键拒绝；GET、候选核对和运行记录读取不调用模型。独立 Prompt Registry 合同 story_workspace_batch 分别复用 form_assist／planning_candidate 的已生效模型路由，配置快照仍使用原受控路由键。

执行持有独立会话锁，结果写入使用同一连接，避免多请求占满连接池后互相等待。只有结构化执行证据确认未发送或已收到失败回复时才保存 failed；丢失回复或结果保存凭证时保持 running 与 result_unknown／result_pending，禁止自动重发。明确结束只能在获取执行锁后变更为 discarded／ended_unknown；原请求及未知用量保留，不构成未发送证明，也不删除资料。已明确结束的原键仍不会调用模型。

载入前核对资料修订、字段与关联指纹，或规划当前版本和上级采用版本，再核对外部参考／采用依据。整组内其他设定的独立保存不因全书材料列表而无条件阻断下一项，但关联指纹变化仍需复核。客户端仅向原编辑器传递勾选字段，人工修改不会被迟到读取覆盖；规划候选不代表事实已发生。

## 人物外显候选与原子保存

visible_prepare／visible_adjust 各自有已注册受控 PromptAsset，使用 form_assist 配置路由；只建议本书实际已发布外显字段。冻结标准资料全值、实际已选私有历史表单版本、字段定义、引用、资料修订和来源哈希；0／false 均为已填写。规格新增走显式参考发布及逐书安全字段同步，既有值不转换，结算策略 none。

逐字段采用保存 049 原输入哈希与冻结草稿，正式卡片由同一 authorMaterials 保存并记录实际 AI 来源。加载编辑器须在采用锁解除后通知父级保护；其他未确认操作仍阻止跳转，载入草稿保留直到父级接受。

批量写入是明确作者命令，visibleBatchWrites 在一条 SERIALIZABLE 物理事务中校验所有原来源、记录各角色草稿采用、调用 updateAuthorMaterialInTransaction 保存正常 card_versions／补充值／字典／AI 来源／逐项作者回执，再记录 candidate_id=null 的整批采用回执。不存在第二份角色正本，不把普通生成变成自动保存。根请求会话锁先于串行化快照，保证并发重复读取已提交原结果；释放锁失败销毁连接。任一项目失败全批回滚，提交响应未知只读原回执。049 草稿日志同时保留该明确整批采用的冻结保存凭证，根日志不作为单字段 AI 来源传入正常保存器。

客户端生成、单项采用和整批写入各自保留完整原命令；外显使用持久本机存储。已确认写入后的读取失败仍保留原请求，不能说未写入。运行记录只投影和返回带 batchMode、原人物／类型及 visible 详情的确切来源页；读取不触发模型或修改任务。
