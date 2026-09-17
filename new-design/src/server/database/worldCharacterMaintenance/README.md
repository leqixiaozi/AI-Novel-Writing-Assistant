# 世界／人物专业维护

本模块是已有正本的只读组合视图，不创建世界、人物、关系、认知或状态副本。接口 `getWorldCharacterMaintenanceWorkspace(bookId,{mode,focusCardId?})` 在同一 PostgreSQL repeatable-read 只读事务中读取正式档案、字段扩展、关系版本、状态来源、认知与历史快照；HTTP `GET /books/:bookId/world-character/workspace`。

> 白话比喻：专业页面像把档案柜、关系账本和章节确认单摆在同一张桌上。对应到代码：所有栏目仍指向原资料版本和原账本，桌面不是另一套数据库。

> 速记方法：档案归档案，流水归结算，视图只查账。普通表单保存不会自动写状态或认知流水。

## 真实来源与恢复

- 字段来自已安装的真实类型版本及 `field_definitions/field_definition_versions` 本书／独立扩展。未知结构不转成自由 JSON 编辑；动机、声音、世界约束按正式字段分组显示，不用关键词猜业务。专业类别使用已登记内容类型稳定键，字段含义不按稳定键猜测。
- 关系使用 `relation_types/card_relations/card_relation_versions`，核对真实 revision、status、properties、端点与端点正式版本。结算能力和维度采用本书优先、系统逐维继承，派生只读维度不丢弃；未配置不自动启用或发布。配置按钮只承诺打开本书配置，没有暗示自动选中特定关系类型。
- 状态读取 `current_state_projections`，必须核对真实当前初始版本和值，或 active 流水、committed 结算及当前已采用、未归档正文。缓存没有来源或已 stale 时保留展示并标明不可作为当前状态。
- 认知读取原 claim、proposal、不可变 proposal version、active change 与投影。持有人、命题、stance/confidence 与真实来源逐项一致；引用正文时核对当前采用版本及锚点，AI 来源必须真实正文与锚点。纯人工无正文来源按原合同显示，不伪造正文证据；所信内容不等于客观真相，真相已变化单独标明。
- 快照显示原 `state_milestone_snapshots` 标签和来源，不用其覆盖当前状态。事实一致性只呈现原未解决冲突，不把没有记录当作模型检查通过。
- 有真实结算来源时使用确切 chapterDocument/session；状态对应唯一 session.settlement_id，认知对应唯一 settlement item 的 proposal 引用，不任取同正文另一个会话。`subject` 查询由 EditorForm/ItemReview 严格消费：只为真正空草稿选择实际 catalog 对象，已有填写不自动覆盖；只滚动实际匹配清单，不修改决策。
- 无来源会话时按钮明确进入原章节重新准备；缺初始状态必须在原章节确认页明确建立，不能将档案值冒充前值。已确认旧流水不提供直接覆盖操作。此视图不新增认知／事实自由编辑器；新认知／事实仍通过真实正文清单编辑审阅，不能把泛化导航当成直接修复历史事实。

> 白话比喻：缓存像收银台上次打印的小票。对应到代码：小票上的状态只有与原结算单和当前正文一致才可用；换正文不会让旧小票自动成为新事实。

> 速记方法：版本对、来源对、当前正文对，才显示“当前”；否则保留并核对。

## 界面与写入

`client/worldCharacterMaintenance` 提供 bookId-based 页面，左侧中文类型树／对象，右侧正式来源。编辑同一份档案复用 `BusinessFormWorkspace` 的正式字段、字典树、AI 候选、明确采用草稿、正常 `authorMaterials` 保存和原请求回执；不新增专业写入事实。切换对象遵循编辑器 locked/dirty/preserveDraft。来源按钮另开页，保留当前填写；网络读取失败只重读，不重发保存或模型。

frontend-design 指导采用既有中文业务表单、`--nd-paper/ink/line/soft/accent` 主题变量和左右结构；没有新增主题或图谱服务。语义图查询不依赖 AGE，关系以关系表真实数据呈现。

最多 300 档案、200 关系／状态／认知、100 快照／问题，任何截断明确显示，未展示不等于不存在。自定义尚未登记为世界／人物类别的资料仍可在全部本书资料中维护，不通过字段命名自动归类。

## 验证状态

新增世界一致性实际入口挂载于 world 视图，专属执行／原质量账本／修复草稿与正常保存凭证／明确复查由 `worldConsistency` 独立模块负责；本组合读取 façade 本身仍只读，不调用检查器。世界检查新增077及中央080由根注册，本 README 原“无新增迁移”只描述历史只读维护模块，不适用于新检查任务。详细范围见 [世界一致性边界](../worldConsistency/README.md)，新任务只编码和静态 review，未验收。

本轮仅编码和静态 review；没有新增迁移，没有运行数据库 getter、HTTP、模型、测试、构建或类型检查。用例 `tests/world-character-maintenance.unit.test.cjs` 仅编写。真实 PostgreSQL 范围／列合同、切版后可用性、中文值、来源对象消费、草稿恢复、主题／窄屏与 AI 来源留到全部授权任务编码结束后统一验证，不能宣称通过。
