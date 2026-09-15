# 章节采用与稳定检查点合同

## 一句话定义

“写完一章”不是正文文件存在，而是正文、事实、角色所知和状态变化经过确认后形成一个可追溯、可供下一章读取的稳定检查点。

> 🏠 **白话比喻**：章节候选像施工草图，事实和状态变化像水电改动清单，稳定检查点像验收签字。下一支施工队只能按验收图施工，不能拿草图或尚未签字的改动继续盖楼。对应到小说系统：下一章只读取 `chapter_stable_checkpoints` 指向的正式数据。

> 🧠 **速记方法**：**候选不外溢，提案不当真，签字才续写。**

## 不变量

1. 未采用正文不能进入下一章上下文。
2. AI 只能提交候选变化，不能把重要变化直接写成正式事实。
3. 每项变化都能回到正文精确字符范围、摘录、计划预期和 AI task／attempt（如适用）。
4. 事实、知识和状态各自保留唯一领域正本，统一清单只负责编排审核。
5. 稳定检查点与正式结算同事务提交；半成功不能对外表现为稳定。
6. 稳定章节换稿先走影响预览；F4 不执行下游重算。
7. 图和语义索引只是可重建派生物，不反写小说正本。

## 读取规则

章节 N+1 的上下文构建器先找到章节顺序小于 N 的最近 `stable` 检查点，然后读取该检查点关联的采用正文、结算、确认事实、状态变化和知识变化。`proposed/rejected/defer`、其他正文候选、失效检查点一律排除。

## 代码入口

- SQL：`new-design/migrations/040_chapter_adoption_settlement.sql`
- 服务：`new-design/src/server/database/chapterSettlement/store.ts`
- 路由：`new-design/src/server/http/router.ts`
- 界面：`new-design/src/client/chapterWriting/AdoptionSettlementPanel.tsx`
- 详细说明：`new-design/docs/chapter-adoption-settlement.md`

## 与后续阶段的接口

F5 使用 `ChapterBodySwitchImpactContract` 获取旧／新正文、旧结算、旧检查点和下游依赖。合同明确 `executionAllowed: false`，直到作者完成影响预览并发起单独确认动作。
