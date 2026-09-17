# 故事工作区整组候选

此模块只冻结来源、领取生成请求、保存和读取 AI 候选。正式资料由 authorMaterials／BusinessFormWorkspace 保存，正式规划由 planning／PlanningCenterPage 保存与采用；整组生成不直接写资料、规划版本、事实或初始状态。

请求使用显式 setting／planning 合同，不做关键词识别。setting 最多包含 20 项现有／新增资料，读取已发布类型和当前卡片独立字段，只补空白项。planning 按实际父子关系包含指定卷章及其后代，最多 30 项；全书没有规划时只建议一个故事总览，不虚构卷章层级。上下文超过上限直接返回范围问题，不暗中截断。

候选存在 ai_generation_batches，operation=form_assist、input_payload.contract=story_workspace_ai_v1；批次 UUID 等于原 requestKey。书籍／键的事务锁和主键保证原请求至多调用一次。不同输入复用键拒绝；GET、候选核对和运行记录读取不调用模型。独立 Prompt Registry 合同 story_workspace_batch 分别复用 form_assist／planning_candidate 的已生效模型路由，配置快照仍使用原受控路由键。

执行持有独立会话锁，结果写入使用同一连接，避免多请求占满连接池后互相等待。只有结构化执行证据确认未发送或已收到失败回复时才保存 failed；丢失回复或结果保存凭证时保持 running 与 result_unknown／result_pending，禁止自动重发。明确结束只能在获取执行锁后变更为 discarded／ended_unknown；原请求及未知用量保留，不构成未发送证明，也不删除资料。已明确结束的原键仍不会调用模型。

载入前核对资料修订、字段与关联指纹，或规划当前版本和上级采用版本，再核对外部参考／采用依据。整组内其他设定的独立保存不因全书材料列表而无条件阻断下一项，但关联指纹变化仍需复核。客户端仅向原编辑器传递勾选字段，人工修改不会被迟到读取覆盖；规划候选不代表事实已发生。
