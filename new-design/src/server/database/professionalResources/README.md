# 专业创作资源边界

入口 `index.ts`：`getProfessionalCatalog`、`executeProfessionalCommand`、`readProfessionalReceipt`。`withProfessionalResourcesPool` 仅基础设施隔离，不接受 HTTP 选连接。客户端入口 `ProfessionalResourcesPage({api,trialApi})`，页面 `/new-design/resources/professional`；HTTP `professionalResourcesRouter()` 挂 `/professional-resources`。

标题、写法、规则、策略内容始终使用原 `cards/card_versions`。063 仅增加标题候选正式字段规格和不可变技术操作回执：收藏／反馈是指向原版本和原结果的引用，不复制资源、质量状态或正文。编辑、归档、质量启停／范围继续形成原 Card 版本；质量提醒和质量债不是全书运行阻断。质量范围以原发布字段选项为准，包括资料字段。

每个修改先验证严格 DTO，按原请求键加事务锁、完整输入 hash 比较，再锁精确资源版本和目标书籍。书名采用只允许原标题候选，核对目标书籍 revision；组合安装至多 20 项，全部一起提交或回滚，书内新资料、版本、字典快照、字段来源及原 `resource_adoptions` 在同事务，未发布／不兼容字段明确拒绝，不静默过滤，不替换现有书内资料。原资源更新不自动改书内快照。

模型试验完全复用原提示词组合的冻结预览、受控 PromptAsset、managed executor、任务／attempt 和用量记录，没有新试验表、直接写正文或替代 provider。页面只选择真实已保存的稿件诊断组合，输入的原资源 ID／版本及中文字段与作者局部文本冻结到实际任务数据；没有兼容组合要去原组合来源配置，不能硬凑成功。诊断输出是建议而非质量审计报告。效果反馈要求真实成功试验已保存输出，或者真实质量 issue；它是作者个人观察，不能改变问题状态或假称已验证修复。

失败中文说明步骤、保留内容及具体核对按钮。纯数据库操作仅在 COMMIT 未开始且 ROLLBACK 收到 ACK 时证明 `not_written`；COMMIT 开始／回滚回执丢失仍为 unknown，保留原键只读核对，不能靠 SQL 错误码／文本猜测。来源页另有明确“按原凭证核对并完成原资源操作”：先读已保存回执，否则仅重放冻结完整纯数据库 payload 的同一原 key/fullhash，不能新建键、使用当前改动替代或发送模型。GET 只读，不终止任务、不重发模型。模型预览／调用未知按原键和原预览查结果，已收到输出保存不明也不再次调用。

> 白话比喻：资源库像菜谱书，安装给一本书就像抄一份独立菜单；试验是先尝一小勺，不会把整锅直接倒进客人的餐盘。对应系统：原 Card 是菜谱正本，书内快照独立，试验候选只供审阅。

> 速记方法：原资源保版本，安装抄快照；有凭证先核对，反馈不当修复。

静态 review 与 `tests/professional-resources.unit.test.cjs` 用例仅编写，063 未执行。所有任务完成编码后由主任务一次集中构建、类型、HTTP、真实 PG、浏览器及真实模型验收；未验证项不声称通过。
