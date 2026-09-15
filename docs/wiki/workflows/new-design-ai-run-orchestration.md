# 新设计 AI 运行预览与研究采用边界

## 背景

研究域、提示词、上下文、模型路由和 AI 任务都拥有自己的版本。如果业务入口直接创建任务，用户看到的预览可能和真正执行的版本不同；如果研究候选直接写入书籍，共享素材会绕过作者确认并污染正式资料。

## 决策

所有接入统一编排的 AI 入口必须执行 `预览 → 人工确认 → AI task → Outbox`。预览是不可变执行收据，不是可继续编辑的草稿。研究结果进入书籍则执行 `共享候选 → 本书可编辑采用批次 → 正式卡片`，研究运行本身不并入小说生产任务。

> 🏠 **白话比喻**：统一运行预览像快递寄出前的面单确认，研究采用批次像把公共资料复印到项目文件夹后再审阅。对应到系统：执行来源先冻结再排队，共享研究先复制为书内候选再决定是否成为正式资料。

> 🧠 **速记方法**：**运行先验单，研究先选稿；确认后排队，采用后入书。**

## 当前规则

1. 运行预览必须冻结合同、配方、输入、上下文 manifest、模型路由、预算、安全检查点和阻断项。
2. 提交时必须重新核对可变化的来源；不一致返回 409，不得静默沿用旧预览。
3. 路由优先级为系统默认、任务组、具体任务、兼容节点、本书、本次覆盖。自动回退仅处理技术故障。
4. AI task 写入后复用既有 Outbox 触发器，不创建旁路队列。
5. AI 输出继续进入所属领域的 candidate／proposal；统一编排不能直接写正文或事实正本。
6. 研究候选进入书籍前必须生成本书采用批次。条目可以编辑、忽略或选择；正式采用在一个事务中完成。
7. 同一来源可被多本书独立采用。来源更新只提示新版本，旧批次和旧正式资料不被覆盖。
8. 稳定读取合同必须分别列出已接入和未接入入口，前端不能用计划状态冒充可用能力。

## 失败模式

- 预览后正文修订或采用正文变化：拒绝提交并重新预览。
- 上下文装配失效或模型路由快照哈希不一致：拒绝提交。
- 旧章换稿仍在执行或待复核：运行预览标记阻断，不创建 AI task。
- 研究候选规格与本书发布规格不兼容：整个采用事务回滚，不产生半批正式卡片。
- 来源发布新版本：旧采用批次保持可追溯，仅显示更新提示。
- 旧拆书接口尝试直接新建或合并本书资料：拒绝并引导使用采用预览。

## 相关模块

- `new-design/migrations/042_research_prompt_runtime_orchestration.sql`
- `new-design/src/server/database/aiRunOrchestration/`
- `new-design/src/server/database/researchAdoption/`
- `new-design/docs/research-prompt-runtime-orchestration.md`
- `new-design/docs/context-management-and-assembly.md`
- `docs/wiki/workflows/chapter-writing-candidate-contract.md`
- `docs/wiki/workflows/chapter-revision-selective-recompute-contract.md`
