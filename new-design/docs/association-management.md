# 关联资料与局部信息

## 用户体验

作者仍在人物、世界、事件、章节等业务表单中工作。只有当前已发布创作表单声明了关联资料位置时，页面才显示对应区域；作者不需要理解挂载、关系边或 JSON。

每个关联位置显示名称、所在表单分区、关系规则、已加入数量和上限。作者可以：

- 按标题或内容类型检索当前书籍中仍在使用、类型相符且尚未选中的资料。
- 直接打开与普通资料一致的动态表单，新建正式资料并在同一事务加入当前位置。
- 查看或编辑来源资料；弹窗不会清空主表单尚未保存的内容。
- 为本次关联填写局部信息，或用与“＋ 添加信息”一致的字段构建器增加一项仅此关联可用的信息。
- 调整同一位置内的顺序、查看关联记录、移除关联，并在来源更新后明确采用最新版本。

搜索无结果时页面建议更换标题／类型词或直接新建。已归档来源保留显示和历史但只读；移除关联会提前说明来源资料不会删除，局部信息离开当前表单但历史仍保留。

> 🏠 **白话比喻**：编辑活动方案时，可以从公司通讯录选择嘉宾，也可以先新增联系人再加入活动；“这次负责开场”只属于这场活动。对应到系统：来源资料是独立 `Card`，表单里的选择是 `card_mount`，本次职责是挂载局部值。

> 🧠 **速记方法**：**先找正本，再放位置；本次备注，留在本次。**

## 单一写入边界

同一个用户动作只能走一条写入路径：

| 用户动作 | 唯一写入目标 |
| --- | --- |
| 在创作表单加入、移除、排序资料 | `card_mounts` 当前状态 + 新的 `card_mount_versions` |
| 保存“仅当前关联”信息 | 挂载版本 + `card_mount_local_value_versions` |
| 修改来源资料 | `cards` 当前状态 + 新的 `card_versions` |
| 建立独立人物／事件等业务关系 | `card_relations` + `card_relation_versions` |

表单关联即使引用了已发布关系规则，也只用该规则校验允许类型和方向，不同时创建 `card_relations`。旧的组合表单保存入口也已改为只写挂载版本，不再删除挂载或归档业务关系。

> 🏠 **白话比喻**：会议签到表和公司组织关系表都可能出现同两个人，但签到不能顺便把两人改成上下级。对应到系统：`card_mount` 负责“这张表用了谁”，`card_relation` 负责“业务上是什么关系”，两本账必须分开写。

> 🧠 **速记方法**：**一次动作一本账：表单写挂载，业务写关系。**

## 校验与并发

服务端重新校验书籍空间、主资料、已发布表单版本、关联位置、允许类型、关系方向、最小／最大数量、自关联、重复关联、来源状态和局部字段归属。客户端提交的名称或类型不能替代服务端判断。

新增、移除、恢复、排序、采用最新来源和局部信息写入都有幂等键。表单实例和挂载各自使用修订号；过期写入返回 `409`。页面不会清空搜索、新建表单、来源编辑或局部信息草稿，作者可刷新比较后重试。

“新建并加入”在一个事务中先创建正式 `Card` 与初始 `CardVersion`，再建立挂载和挂载版本；任一步失败都会整体回滚，不留下孤立资料。移除只结束挂载，不删除来源；恢复接口继续遵守重复和数量上限。

## 来源版本与依赖

每个挂载锁定加入时采用的 `source_card_version_id`。来源资料后来修改时，页面显示“来源有更新”，原挂载仍可重放；作者点击“采用最新来源”后才追加一个挂载版本。每个挂载版本通过 026 依赖账本登记“来源资料版本 → 挂载版本”的软依赖，不直接写 Apache AGE。

反向引用查询汇总有效挂载与有效业务关系。它只回答“这条资料当前被多少处引用”，不会成为删除或级联改写的借口。

## API

- `GET /api/new-design/books/:bookId/cards/:cardId/associations`
- `GET /api/new-design/books/:bookId/cards/:cardId/association-candidates`
- `POST /api/new-design/books/:bookId/cards/:cardId/associations`
- `POST /api/new-design/books/:bookId/cards/:cardId/associations/create`
- `POST /api/new-design/books/:bookId/cards/:cardId/associations/reorder`
- `POST /api/new-design/books/:bookId/associations/:mountId/remove`
- `POST /api/new-design/books/:bookId/associations/:mountId/restore`
- `POST /api/new-design/books/:bookId/associations/:mountId/refresh-source`
- `PATCH /api/new-design/books/:bookId/associations/:mountId/local-values`
- `POST /api/new-design/books/:bookId/associations/:mountId/local-fields`
- `GET /api/new-design/books/:bookId/associations/:mountId/history`

## 跨机器同步

迁移 SQL、类型合同、API、界面和本文档随 Git 同步。作者已经建立的来源资料、关联、业务关系、局部信息和全部历史必须通过 PostgreSQL 逻辑备份迁移；附件仍需与数据库备份和 manifest 一起搬运，不能复制运行中的数据库目录。

> 🏠 **白话比喻**：Git 带走空白表格和填写规则，数据库备份带走已经签字的通讯录与会议名单。对应到系统：另一台机器只拉代码能获得 035 结构，不能获得作者实际建立的关联和值。

> 🧠 **速记方法**：**代码同步规则，备份同步作品；附件跟清单一起走。**
