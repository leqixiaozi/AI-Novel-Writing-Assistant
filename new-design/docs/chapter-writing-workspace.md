# 章节创作工作台

## 作者流程

书内“章节创作”按卷章目录、正文编辑、本章资料和候选比较组织。作者选择章节后，工作台只读取该章明确采用的计划；没有采用计划时给出故事规划入口，不用空白数据假装可写。

人工起稿、继续编辑历史稿和复制候选都会新增正文版本。切换章节前若存在未保存内容，作者必须选择保存、放弃或取消。多页面同时保存触发 `409` 时，本地稿件保持在编辑器中，刷新只更新服务器候选，作者可比较后另存。

AI 操作包括续写、改写、扩写、缩写、对白调整、冲突增强、问题修复和整章重生成。每次请求冻结以下来源：

- 当前采用的章节计划 ID、内容哈希和精确资料引用；
- 本章已定稿的上下文清单；
- 任务合同、提示词配方和模型路由快照；
- 输入正文版本、内容哈希和可选选区。

任务沿用通用 AI 任务账本，写入任务后由 PostgreSQL Outbox 自动登记后台作业。执行能力、任务合同或上下文缺失时，界面展示具体阻断原因，不生成示例正文。AI 返回内容必须先调用结果接收接口保存为 `ai_candidate`，随后任务才能把该候选登记为结果。

## 正文候选规则

`chapter_documents` 仍是章节正文档案，`chapter_body_versions` 仍是唯一正文版本正本。`039_chapter_writing_workspace.sql` 只为既有版本补充操作类型和来源链，没有新增平行正文表。

- 正文、来源和哈希写入后不可修改；归档只允许从未归档变为已归档。
- 人工保存和复制必须提交 `expectedRevision` 与幂等键；成功后正文档案修订号加一。
- AI 候选必须引用同一次任务尝试及其计划、上下文、合同、配方和模型快照。
- 候选比较以整章为单位。逐段选择、局部合并和自由拖拽属于 P3。
- 复制候选会形成新的人工版本，来源候选保持不变。

## API 边界

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/books/:id/chapter-writing` | 读取卷章、计划、正文、任务和质量问题聚合 |
| `POST` | `/chapter-documents/:id/candidates` | 幂等保存人工候选或复制候选 |
| `GET` | `/chapter-documents/:id/writing-requests` | 读取本章 AI 请求及真实任务状态 |
| `POST` | `/chapter-documents/:id/writing-requests` | 冻结来源并创建 AI 任务 |
| `GET` | `/chapter-writing-requests/:id` | 运行器读取一次请求的冻结输入 |
| `POST` | `/chapter-writing-requests/:id/result` | 运行器把正文结果入库为候选 |
| `POST` | `/chapter-documents/:id/adoption-preparations` | 为 F4 生成采用确认资料，不切换正式正文 |
| `GET` | `/chapter-adoption-preparations/:id` | F4 读取并重新校验采用确认资料 |

结果接收成功后，运行器应把任务尝试登记为 `resultKind=chapter_body_version`、`resultStableId=<chapter_document_id>`、`resultVersionId=<chapter_body_version_id>`。通用任务账本会再次校验结果确实是未归档的 AI 正文候选。

## F4 采用确认合同

“进入采用确认”创建不可变准备记录，固定章节、候选正文、预期正文档案修订、采用计划、上下文和依赖哈希。F3 不调用正文采用接口，也不写事实、人物状态、道具、伏笔、时间线或质量结算。

F4 消费准备记录前必须重新校验：

1. 准备记录仍是 `prepared`；
2. 正文档案修订号与 `expectedDocumentRevision` 相同；
3. 候选未归档，采用计划和依赖哈希未变化；
4. 用户确认事实与状态变化后，才在同一流程中切换正文并结算；
5. 成功后把准备记录改为 `consumed`，来源变化则改为 `stale`，用户取消则改为 `cancelled`。

## 跨机器同步

迁移 `039`、运行包清单、接口代码和本文随 Git 同步。作者的正文候选、AI 请求、任务记录与采用准备属于 PostgreSQL 业务数据，必须使用项目的逻辑备份／恢复合同同步；只拉 Git 不会同步作者数据，也不能复制运行中的数据库目录代替备份。
