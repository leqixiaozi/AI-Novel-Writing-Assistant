# 新版 AI 写作产品总览

## 定位与目标

本篇描述 `new-design/` 的产品目标与入口，不把旧版能力、设计目标或静态源码发现写成已通过的新版验收。主要用户是没有小说创作经验、希望在 AI 引导或自动推进下完成整本小说的作者。产品应给出可理解的默认选择、当前进展和下一步，让作者能够从想法、开书、规划、章节创作推进到完本与导出；复杂设置按需开放，不成为开篇门槛。依据见[新手优先原则](../../docs/wiki/product/beginner-first-novel-completion.md)。

## 角色、范围与不做项

- 作者决定创作方向、正式资料和正文的采用、修订及有影响的恢复动作；AI 可形成结构化建议、草案与候选，不能把候选保存等同于正式采用。
- 系统负责保存来源与版本、组织上下文、执行可恢复的任务，并解释失败和下游影响。安全、权限、幂等及持久化由确定性代码保证；创作意图、规划与推荐以 AI 结构化理解为主。
- 新版使用自己的页面、服务、模型路由与 PostgreSQL 资料，不借旧版 SQLite 业务作为隐藏运行依赖。旧版是同仓参考与兼容对象，不表示需要删除现有作品或重做已有能力。详见[独立开发与运行](../../new-design/docs/standalone-development.md)。
- 本篇不规定具体按钮、字段、模型供应商或发布时间；这些由相应专题和当前实现给出。公开发布、生产数据迁移与真实模型质量不能仅凭设计文本判定完成。

## 核心概念与模块地图

| 面向作者的概念 | 作用 | 进一步阅读 |
| --- | --- | --- |
| 创作资源、开书模板 | 复用题材、写法、资料规格和起点；加入本书时保留独立来源 | [导航与术语](../../new-design/docs/navigation-and-terminology.md)、[数据模型](../../new-design/docs/data-model.md) |
| 我的书籍、本书资料 | 每本书自己的资料、人物、世界和关联内容；与公共资源区分 | [业务表单外壳](../../new-design/docs/business-form-shell.md) |
| 规划与章节 | 从故事、卷、章、场景规划到正文候选、采用和后续复核 | [规划中心](../../new-design/docs/book-overview-and-planning-center.md)、[章节工作区](../../new-design/docs/chapter-writing-workspace.md) |
| 研究与分析 | 从可追溯参考生成报告及候选，明确选择后才影响本书 | [研究工作流](../../new-design/docs/research-prompt-runtime-orchestration.md) |
| 模型、上下文与运行 | 执行前选定模型与资料来源，记录结果、失败位置和恢复入口 | [上下文管理](../../new-design/docs/context-management-and-assembly.md)、[模型运行](../../new-design/docs/model-route-runtime-review.md) |
| 完本与导出 | 检查当前采用内容、影响与输出范围 | [完本与导出](../../new-design/docs/completion-export-runtime-maintenance.md) |

作者界面使用“资料、内容类型、创作表单、本书资料”等词；`Card`、`CardType` 等仍是内部稳定合同。具体路由与深链以[导航与术语](../../new-design/docs/navigation-and-terminology.md)为准，不在这里维护第二张菜单表。

## 主要创作流程

作者给出想法或选择资源 → 确认方向和开书内容 → 建立本书资料及规划 → 人工或 AI 生成章节候选 → 审阅、采用与结算变化 → 继续章节、处理影响 → 完本检查与导出。不同创作入口可以有不同交互，但应回到同一书籍事实和正式采用边界。失败时保留已有产物，说明局部影响和来源页面的恢复动作；“运行记录”只用于查看状态与返回来源页，不承担重试或审批。相关规则见[任务中心角色](../../docs/wiki/product/task-center-role.md)与[新版运行编排](../../docs/wiki/workflows/new-design-ai-run-orchestration.md)。

此流程是产品判断基线，不是“每一步已完成”的声明。具体可用范围以当前源码、数据结构、配置启用及实际验证共同确认；未验证的跨章连续生产、真实模型输出质量或发布包不能因为页面可见就视为验收通过。
