# 添加信息、字段作用域与版本

## 用户看到什么

作者在人物、世界、事件、章节等统一填写页使用“＋ 添加信息”，无需进入卡片类型设计器。第一步必须明确适用范围：

| 页面选项 | 内部作用域 | 保存位置 |
| --- | --- | --- |
| 本书所有同类资料 | `book_type` | 本书独立 `CardTypeVersion` 与适用的 `CardGroupFormVersion` |
| 仅当前资料 | `card` | 稳定字段定义、不可变字段版本及 `CardVersion` 对应的局部值 |
| 仅当前关联 | `card_mount` | U3 只预留数据合同；实际选择和编辑由 U4 提供 |

进入已有资料时默认推荐“仅当前资料”，但用户必须确认；系统不会把局部补充静默扩大到全书。

> 🏠 **白话比喻**：给整栋楼统一加“紧急联系人”要换一版物业登记表，只给 302 室加“宠物名字”则夹在该户档案里。对应到系统：前者发布书内类型／表单版本，后者只进入当前资料的局部字段和修订。

> 🧠 **速记方法**：**同类换表，单条夹页，关联留位；先选范围，再看影响。**

## 字段来源

- `core`：核心信息，系统定义且不可删除；必填核心信息不可隐藏。
- `template`：模板信息，开书时复制并记录模板、类型和表单来源版本；修改不回写公共模板。
- `book_extension`：本书新增，只改变当前书的内容规格和表单版本。
- `local_supplement`：仅此处补充，只属于当前资料或后续的当前关联，不污染来源对象。

页面使用“核心信息、模板信息、本书新增、仅此处补充”，并可展开查看适用范围、来源摘要和不可变版本历史。

## 稳定身份与不可变历史

`034_scoped_field_definitions.sql` 新增：

- `field_definitions`：字段稳定身份、服务端生成的 `field_key`、来源、作用域、状态、来源版本和修订号。
- `field_definition_versions`：字段名称、说明、类型、分组、必填、选项、默认值和高级能力的不可变快照。
- `field_option_definitions` / `field_option_versions`：选项 ID 与显示名称分离；改名不改变已保存值的身份。
- `field_scope_adoptions`：幂等键、采用动作、前后版本、预期修订和影响摘要。
- `card_version_local_values`：当前资料补充值，绑定确切 `CardVersion` 和字段版本。
- `card_mount_local_value_versions`：U4 的关联局部值不可变合同，本批不开放编辑入口。

改名不会改变 `field_key`；字段和选项只能隐藏／归档，历史版本禁止更新或删除。重复局部字段只给升级建议，不会自动扩大全书。模板同步只允许用户明确采用新增项，不自动删除、改名或提高必填级别。

## 新增与保存事务

本书级新增按固定锁顺序执行：锁书籍与当前内容类型 → 核对 `expectedTypeRevision` → 生成稳定字段／选项身份 → 新增不可变类型版本 → 新增适用表单版本 → 更新当前采用指针 → 写采用记录。冲突返回 `409`，不会覆盖其他窗口的新版本，也不会修改公共空间或其他书籍。

新增字段默认非必填。若设为必填且已有同类资料，影响预览必须显示资料数量，并要求安全默认值；逐条补齐尚未实现，因此页面不会假装支持。本批的默认值只参与当前规格读取和后续保存，不改写旧 `CardVersion`。

当前资料新增在同一事务中建立局部字段版本并追加一条 `CardVersion`；以后统一表单保存时，类型字段继续进入 `card_versions.values`，局部字段进入 `card_version_local_values`。渲染层合并显示，持久层保持分开。

## API

- `POST /api/new-design/books/:bookId/field-extensions/preview`：校验归属并返回影响数、是否需要默认值和当前类型修订。
- `POST /api/new-design/books/:bookId/field-extensions`：创建本书级字段扩展。
- `POST /api/new-design/books/:bookId/cards/:cardId/local-fields`：创建当前资料补充信息。
- `PATCH /api/new-design/books/:bookId/field-definitions/:fieldId`：修订当前资料补充信息；稳定 key 和选项 ID 不变。
- `GET /api/new-design/books/:bookId/field-definitions`：查询字段来源、作用域、当前版本和当前资料局部值。
- `GET /api/new-design/books/:bookId/field-definitions/:fieldId/history`：查询不可变历史。
- `POST /api/new-design/books/:bookId/field-definitions/:fieldId/archive`：隐藏／归档，不物理删除。

所有写接口在服务端校验书籍、空间、内容类型、资料或挂载归属；采用接口带幂等键和预期修订。浏览器不能提交自选 `field_key`。

## 跨机器同步

迁移 SQL、TypeScript 合同和本文档随 Git 同步。作者新增的书内字段、局部字段、值和版本属于 PostgreSQL 业务数据，必须随逻辑备份、受管附件和 manifest 一起迁移。

> 🏠 **白话比喻**：Git 带走的是空白表格的印刷版，数据库备份带走的是用户已经填写并签字的档案。对应到系统：只拉代码能得到 034 结构，不能得到另一台机器上的书内扩展和值。
