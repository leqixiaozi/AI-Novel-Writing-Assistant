# 写法提炼、正文清洗、中文标题

本模块只使用新设计自有受控提示词、已启用模型路由和原任务账本。没有模型配置时保存 `blocked` 审阅预览，作者可以人工填写；不会借环境里的默认模型。外部参考始终是不可信用户数据，不提升为系统指令。

> 白话比喻：预览像盖章的材料清单，候选像编辑的修改意见；只有作者再次明确确认，才写入正式稿件。对应到代码：冻结精确来源和合同，运行只保存候选，`commands` 才修改原资源、原正文候选或书名。

## 正本与明确动作

- 写法：选择当前已发布 `writing_config` 实际字段，字典值来自真实树规则；候选回同一个 `DynamicForm`。确认后通过 `createProfessionalResourceInTransaction` 写原 `cards/card_versions`、专业资源回执及字段来源。书内安装继续原专业资源明确安装动作，资源更新不修改书内副本。
- 仿写/清洗：冻结本章原正文、目录代次、实际已采用章计划及哈希。确认只写原 `chapter_body_versions/chapter_body_operations` 候选。回本章选择候选，经过既有正文采用/结算流程，不在专项页采用正文。
- 标题：人工/AI候选在同一中文比较表单。明确采用只更新原 `books.name/revision`；不建标题正本库，不改规划或正文，不声称联网核验撞名或商业效果。

## 精确来源

粘贴参考最多三万字；知识参考必须是同书真实解析、有效依赖状态、精确 source/parsed 版本和校验值；拆书参考必须是原研究正文当前有效版本。知识/拆书选区由作者明确给出，超出原文或三万字拒绝，不静默截断。目录范围不足会报错或明确 `truncated`，不得当成全量目录。

预览合同冻结真值输入 schema、动态实际输出 schema、固定资产版本、消息、来源 manifest 和本书精确模型快照。领取前重新核对来源、正文/计划、规格、完整 manifest entries 和快照参数。未知字段拒绝而不是 strip。参考不能执行网页里的指令。

## 回执与失败恢复

`prepare`、`run`、`commands` 都使用原 key 和完整 payload 哈希。同 key 不同输入拒绝并保留原凭证。纯数据库命令只有 COMMIT 尚未开始且 ROLLBACK 明确 ACK，才报告 `not_written`；提交不明或原 key 已有不同回执报告 `unknown`。模型操作有外部副作用，不能用局部数据库回滚冒充未发送。

原模型回复先写受控本地证据文件（UUID定位、普通目录/文件检查、排除符号链接、UTF-8、大小限制、exclusive临时写入、文件sync、no-replace发布），再保存数据库候选，最后同事务完成原 attempt/task/events/usage。实际用量缺失为NULL，不猜成本。

作者点击“只读核对原请求回执”只查原结果。GET-null不证明未提交，running也不解锁原key；完整原输入、原run key、task/attempt及正式保存结果全部匹配才清本地凭证。点击“读取原回复并完成保存（不调用模型）”只读取已保留证据、补候选和账本，绝不再次调用模型。没有原回复证据时仍保留原领取，提示核对运行维护；不自动后台重试。

## Facade / 中央挂载

公共合同：`common/creativeExtraction.ts`；客户端 `CreativeExtractionPage({bookId,api,initialMode?})`。HTTP `creativeExtractionRouter(dependencies?)` 相对 `/creative-extraction`：

- GET `/catalog/:bookId`、`/by-key/:key`、`/:id`、`/commands/by-key/:key`。
- POST `/previews`、`/:id/run`、`/:id/complete-saved`（空对象）、`/:id/commands`。

根任务登记 `creative_extraction`、`creativeExtractionAsset`、模型受控scope和078迁移，并挂API/页面/路由。只读按原key查询在恢复中不得调用模型或开发启动器。

## 当前交付与验证

源码、UI、078 SQL和 `tests/creative-extraction.unit.test.cjs` 已编写；仅静态审阅，未执行测试、构建、迁移、模型或页面验证。078尚未应用。统一验证需检查真实PG约束/并发原key、真实资源/正文/书名回执、回复保留故障恢复以及中央注册/路由。单元中注入Pool仅模拟事务，不称真实数据库或模型验收。
