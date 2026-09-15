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

- 创作首页：`/new-design`
- 我的书籍：`/new-design/books`
- 创作资源：`/new-design/resources`
- 研究与分析：`/new-design/research`
- 高级设置：默认收起；当前地址位于 `/new-design/structure/*` 时自动展开
  - 内容类型：`/new-design/structure/card-types`
  - 选项与关联：`/new-design/structure/dictionaries-relations`
  - 创作表单：`/new-design/structure/forms`
  - 开书模板：`/new-design/structure/templates`

桌面和移动导航都遵循以上顺序。高级设置开关必须是可聚焦按钮，并通过 `aria-expanded` 暴露展开状态。

## 书籍任务导航

| 客户入口 | 路由 |
| --- | --- |
| 创作概览 | `/new-design/books/:bookId/forms` |
| 人物 | `/new-design/books/:bookId/views/characters` |
| 世界设定 | `/new-design/books/:bookId/views/world` |
| 剧情与事件 | `/new-design/books/:bookId/views/events` |
| 章节 | `/new-design/books/:bookId/views/chapters` |
| 线索与伏笔 | `/new-design/books/:bookId/views/clues` |
| 本书资料 | `/new-design/books/:bookId/cards` |
| 本书设置 | `/new-design/books/:bookId/fields` |

`/new-design/books/:bookId/forms` 继续作为开书后的默认入口。原有 `/cards`、`/fields`、`/views/*` 深链保持不变，因此旧书签和刷新不会失效。除本书设置外，上述入口共用同一套业务表单外壳，仅默认资料范围不同；解析与保存合同见 `business-form-shell.md`。

## 资源边界

“创作资源”只保存可跨书复用的题材策略、推进方式、写法、质量规则和 AI 指令。人物、世界、剧情、章节、线索等正式小说内容必须进入某本书的“本书资料”。公共资源加入书籍后形成独立快照，不会随公共版本变化静默覆盖作品。

## 跨机器同步

导航与术语配置位于 `src/client/navigation.ts`，会随 Git 同步。数据库结构、内置数据和迁移 SQL 位于 `migrations/001_card_kernel.sql` 至 `migrations/034_scoped_field_definitions.sql`，数据说明见 `docs/data-model.md`。

作者实际填写的数据不进入 Git。换机器时应使用 PostgreSQL 逻辑备份，并连同受管附件和 manifest 一起迁移；不要复制正在运行的数据目录，也不要只同步代码后假定作品数据已经到位。完整流程见 `docs/transfer-backup-import-export.md` 与 `docs/private-runtime-runbook.md`。

## 当前未开放

任意添加字段／信息、关联资料编辑器、智能视图和三章生产闭环不属于本批实现，不能以占位菜单伪装为可用功能。普通创作页已经使用已发布规格生成统一动态表单，但内容规格设计仍只在高级设置中完成。
