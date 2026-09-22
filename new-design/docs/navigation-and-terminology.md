# 新设计导航与客户术语

## 目标

作者看到的是创作任务、资料和表单，而不是底层存储结构。数据库、API 和 TypeScript 合同继续使用 `Card`、`CardType` 等稳定内部名称，避免为了改界面文案破坏数据兼容性。

> 白话理解：仓库可以用货号管理商品，但顾客看到的仍是“书籍、人物、世界设定”。对应到本模块：内部标识保持稳定，界面统一说创作语言。

## 客户术语

| 内部或旧称 | 客户界面用语 |
| --- | --- |
| 卡片 | 资料，或具体业务名称 |
| 元卡片类型 | 内容类型 |
| 卡片组表单 | 创作表单 |
| 模板组 | 开书模板 |
| 我的卡片、公共卡片库 | 创作资源 |
| 书内卡片库、全部卡片 | 本书资料 |
| 卡片关系 | 资料关联，或具体关系名称 |
| 卡片挂载 | 关联资料、加入…… |
| 卡片版本 | 修改记录、历史版本 |
| 候选卡片 | 候选资料 |
| 固定卡片集合 | 资料分组 |

高级设置可解释稳定键、数据类型和发布版本，但普通创作路径不展示 `card_type_id`、关系边或 JSON Schema 等实现术语。

## 顶层导航

独立侧栏按“开始与创作、衍生工作台、资源与研究、运行与设置”四组呈现；分组只是信息架构，不建立第二套业务正本，也不增加书内主步骤。

- 创作首页：`/new-design`
- 我的书籍：`/new-design/books`
- 创作向导：`/new-design/guide`
- 创作中枢：`/new-design/creative-hub`
- 漫画工作台：`/new-design/comic`
- 短剧工作台：`/new-design/drama`
- 创作资源：`/new-design/resources`
- 开书前标题：`/new-design/resources/titles`
- 资源工作台：`/new-design/resources/professional`
- 研究与分析：`/new-design/research`
- 知识与参考：`/new-design/knowledge`
- 运行记录：`/new-design/operations/records`
- 导演总控台：`/new-design/operations/director`
- 高级设置：默认收起；当前地址位于 `/new-design/structure/*` 时自动展开
  - 内容类型：`/new-design/structure/card-types`
  - 选项与关联：`/new-design/structure/dictionaries-relations`
  - 创作表单：`/new-design/structure/forms`
  - 开书模板：`/new-design/structure/templates`
  - 上下文管理：`/new-design/structure/context`
  - 模型设置：`/new-design/structure/models`
  - 运行维护：`/new-design/structure/maintenance`

以上是 `src/client/navigation.ts` 的主菜单和高级设置入口；子页面与书内深链仍须按实际路由核对。高级设置开关必须是可聚焦按钮，并通过 `aria-expanded` 暴露展开状态。

## 书籍任务导航

| 客户入口 | 路由 |
| --- | --- |
| 创作概览 | `/new-design/books/:bookId/overview` |
| 创作方向 | `/new-design/books/:bookId/setting` |
| 故事设定 | `/new-design/books/:bookId/story-setting` |
| 故事规划 | `/new-design/books/:bookId/planning` |
| 全书编排 | `/new-design/books/:bookId/composition` |
| 全书导演 | `/new-design/books/:bookId/director` |
| 世界设定 | `/new-design/books/:bookId/world` |
| 人物维护 | `/new-design/books/:bookId/characters` |
| 人物对话模拟 | `/new-design/books/:bookId/character-dialogue` |
| 视觉资产 | `/new-design/books/:bookId/visual-assets` |
| 章节创作 | `/new-design/books/:bookId/writing` |
| 多维视图 | `/new-design/books/:bookId/views/chapters` |
| 专业图形 | `/new-design/books/:bookId/professional-views` |
| 本书资料 | `/new-design/books/:bookId/cards` |
| 知识与参考 | `/new-design/books/:bookId/knowledge` |
| 本书设置 | `/new-design/books/:bookId/fields` |
| 整书历史 | `/new-design/books/:bookId/history` |
| 完本与导出 | `/new-design/books/:bookId/completion` |

书内八步工作流由 `src/client/bookNavigation/workflow.ts` 按页面和查询参数定位，辅助入口不应被误算成八步中的新阶段。`/new-design/books/:bookId/forms` 仍保留兼容路由；直接打开书籍根路径进入概览。`/cards`、`/fields`、`/views/*` 等深链按实际路由保留。资料表单的解析与保存合同见 [业务表单外壳](business-form-shell.md)；页面外观与操作是否复刻旧版，按 [逐页施工记录](legacy-page-replication-progress.md) 核对，不能由导航表判定完成。

## 资源边界

“创作资源”保存可跨书复用的策略、写法、质量规则、AI 指令、标题候选、公共人物和公共世界包等来源。一本书正式使用的人物、世界、剧情、章节与线索有本书独立身份；从公共来源安装或采用时锁定确切版本和来源映射，不会随公共版本变化静默覆盖作品。资料、规划、正文、事实与状态各按 [数据模型](data-model.md) 的正本归属保存，页面统一用作者熟悉的业务名称呈现。

## 跨机器同步

导航与术语配置位于 `src/client/navigation.ts`，会随 Git 同步。数据库结构、内置数据和迁移 SQL 位于 `migrations/`；普通启动的注册清单到 `083_character_dialogue.sql`，独立安装的手动迁移当前到 `131_card_kernel_v2_cutover.sql`。数据归属、手动启用边界及权威清单见 [新设计数据模型](data-model.md)。

作者实际填写的数据不进入 Git。换机器时应使用 PostgreSQL 逻辑备份，并连同受管附件和 manifest 一起迁移；不要复制正在运行的数据目录，也不要只同步代码后假定作品数据已经到位。完整流程见 `docs/transfer-backup-import-export.md` 与 `docs/private-runtime-runbook.md`。

## 页面与数据验收边界

主菜单、八步工作流、辅助入口及其子页面要分别核对可见状态和操作。入口可打开、路由存在或 PostgreSQL 表已建，不等于保存、采用、恢复、错误处理及旧版外观已验收。逐页状态与尚未验证的动作以 [逐页施工记录](legacy-page-replication-progress.md) 和实际页面证据为准；普通创作页继续按已发布规格显示类型化表单，内容规格设计在高级设置中完成。
