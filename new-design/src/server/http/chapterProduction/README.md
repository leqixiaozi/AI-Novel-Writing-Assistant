# 原章节创作 HTTP

`chapterProductionRouter()` 承接原目录、正文、请求读取及人工候选保存和受控单章生成；中央路由前置挂载它，避免无关研究恢复阻挡章节来源。正文采用与结算仍走原工作流，本模块不新增正文或模型执行链。

白话比喻：同一张快递单换了专门的查询窗口，不另寄一份包裹。对应代码：模型仍由 `application/productionDirector` 执行，候选仍写原章节档案。速记：读原单、续原票、不重寄。

GET 路径：`/books/:id/chapter-writing`、`/chapter-documents/:id`、`/chapter-documents/:id/writing-requests`、`/chapter-writing-requests/:id`、`/chapter-writing-requests/:id/saved-reply`。全部只读，不调用模型，不续写结果。

POST 路径：`/chapter-documents/:id/candidates`、`/chapter-documents/:id/writing-requests`、`/chapter-writing-requests/:id/complete-saved-result`、`/end-expired`、`/end-unclaimed`、`/retain-reply-and-end`（后三项沿同一请求前缀）。保留原 schema、原请求标识和事务回执。恢复命令只接受空对象；结束领取或保留回复退出需来源页明确确认。

失败只转发可信领域错误的写入结果证明；未知提交不得说成回滚。来源补读失败不改变原结果。固定恢复链接仅指向本书本章或运行维护。原回复本地凭证允许查看复制，但不能证明数据库已入库；查看不会自动改变人工稿件、保存或采用正文。

`complete-saved-result` 应用流程可能先提交候选，再补记原运行账本；后一事务回滚不证明整个恢复未写入。因此此路径的领域失败统一保持未知原回执，只读核对已有候选／账本，不允许用局部 `not_written` 解除原操作锁。请求格式在进入应用前失败仍能标记未发送。导演原范围恢复链接保留 `run` 参数并由前端严格核对书籍／范围 UUID。

本阶段只编写静态与负向用例；未执行测试、构建、启动、模型请求或迁移。
