# 章节写作候选与采用边界

## 背景

章节写作同时涉及计划、上下文、模型执行、正文、质量问题和事实状态。如果 AI 直接覆盖正文，或编辑器把本地草稿当作正式事实，迟到结果和多人并发会破坏后续章节依据。

## 决策

正文以 `chapter_documents` 和不可变 `chapter_body_versions` 为唯一正本。人工保存、历史复制和 AI 生成都先形成候选。AI 任务只引用冻结来源并通过通用任务账本与 Outbox 执行；采用和事实／状态结算由独立确认流程处理。

## 当前规则

1. 工作台只读取明确采用的章节计划；未采用计划不能作为 AI 或人工候选的生产依据。
2. 每次人工保存都新增版本，要求正文档案修订号和幂等键，历史内容不原地覆盖。
3. AI 请求必须冻结计划、上下文清单、任务合同、提示词配方、模型路由、输入正文与选区。
4. AI 输出必须先入库为 `ai_candidate`，通用任务账本只接受未归档且属于目标章节的候选结果。
5. F3 的采用入口只创建 `chapter_adoption_preparations`。F4 重新校验修订号和依赖后才能切换采用正文并处理事实、状态和质量结算。
6. 首版比较单位是整章。逐段挑选、局部合并和自由编排不得借用采用接口实现。

## 失败模式

- **迟到结果覆盖新稿**：结果接收比较请求保存的正文档案修订号；不同则拒绝。
- **重复点击产生多个候选**：业务操作与 AI 请求分别使用书内唯一幂等键和请求哈希。
- **计划换版后采用旧候选**：采用准备要求候选记录的计划版本仍等于章节采用计划。
- **模型未配置却展示成功**：工作台读取真实任务合同；缺失时禁用 AI 操作并显示修复入口。
- **任务成功但候选不存在**：`chapter_body_version` 结果类型在任务账本中校验候选身份、章节和归档状态。
- **任务中心承担创作动作**：重试、取消、比较和采用均留在章节工作台；运行记录只展示状态和返回来源页。

## 相关模块

- `new-design/src/server/database/chapterWriting/`
- `new-design/src/server/database/chapterBodyStore.ts`
- `new-design/src/server/database/aiTasks/`
- `new-design/src/server/database/contextManagement/`
- `new-design/migrations/039_chapter_writing_workspace.sql`
- `new-design/docs/chapter-writing-workspace.md`
