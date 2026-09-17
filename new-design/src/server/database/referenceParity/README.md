# 参考页面的规格与安装边界

本模块把旧版人物／世界操作接入新版已发布规格、冻结版本与原请求合同。展示沿用 storyWorkspace；资料正本仍为 card_types/card_type_versions、card_group_forms/card_group_form_versions、cards/card_versions，不建立镜像档案。

## 人物语义

`gender` 和 `background` 属于档案。`development_plan` 是成长方向规划，`current_action_goal` 是当前行动规划，`initial_situation_draft` 是起始处境设想。`goal` 始终是长期目标，不改键或改称当前目标。上述新增字段可选，明确 `stateSettlement=none`，并在实际 state_field_policies 中设置 none；显示标记本身不能代替正式结算策略。正式当前状态、成长、资源持有仍由初始状态确认和确切已采用正文的结算拥有。

## 发布与逐书采用

预览人物来源、现有字段、未发布草稿和当前冻结模板，发布命令核对原预览哈希并锁来源，在一个事务追加公共人物规格、对应表单与模板版本。模板回执复用 071，保留完整输入哈希与当次结果。没有人物表单时创建真实已发布的主卡表单；后续关联安装独立执行。

发布不向现有书籍写值。旧书显式预览再应用只新增可选稳定字段；同键、必填和修改既有规格产生冲突。预览保存书籍修订与实际类型版本，应用前重新校验；已有未发布规格草稿不会被覆盖。已应用的原升级返回当次结果，不重复追加。`installed_payload` 仅登记本次实际新增的字段、字典与标签，未安装表单和关系保留旧基线，避免“模板版本号更新”被误解成所有构件都已安装。

## 字段扩展回执

fieldExtensions 复用不可变 field_scope_adoptions.impact JSONB 存完整原输入、哈希和当次字段结果，无需新列。请求级事务锁先于修订检查；同键同输入返回当次结果，同键不同输入／跨书／历史缺少完整回执保持 unknown。映射响应发生在 COMMIT 前，COMMIT 回执中断后即使 ROLLBACK 成功也不能报告 not_written。原请求只读核对不读取最新定义代替原结果。

## 验证边界

reference-specification.postgres 用现有 PostgreSQL 服务上的新空数据库执行完整真实迁移与业务事务，保留测试库，不复制、迁移或清理用户库，不启动应用 runtime。单元故障注入覆盖提交响应中断和回滚证明。通过这些检查只证明隔离合同；用户库安装发布、在线模型和页面操作验收需分别报告，不能用代码完成代替。
