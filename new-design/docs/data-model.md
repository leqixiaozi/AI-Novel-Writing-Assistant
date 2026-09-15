# 新设计数据模型

本文是新设计 PostgreSQL 结构的数据字典。权威迁移位于 `../migrations/`：`001_card_kernel.sql` 建立卡片内核，`002_builtin_novel_cards.sql` 提供早期起步数据，`003_novel_card_catalog.sql` 收敛 19 类核心卡片和可组合语义能力，`004_xianxia_production_demo.sql` 提供原创仙侠样例，`005_card_composition_kernel.sql` 建立字典、关系、挂载和卡片组表单，`006_template_books.sql` 建立模板版本与独立书籍空间，`007_unified_book_creation.sql` 建立统一开书会话、AI 批次与来源追踪，`008_card_type_categories.sql` 建立六类目录树并补齐 29 种资料规格，`009_strategy_resources.sql` 建立创作策略公共资源与安装快照记录，`010_prompt_components.sql` 新增唯一的“提示词组件”资源类型及四条中性组件，`011_book_multiview.sql` 建立书籍六视图共用的时间、叙事位置、正文锚点、人物关系和视图配置，`012_book_change_sets.sql` 建立高影响修改的预览、确认与应用记录；运行时直接执行这些 SQL，不在代码中维护第二份副本。

## 跨机器同步原则

把 Git 仓库理解成“施工图纸”，把每台电脑上的 PostgreSQL 数据目录理解成“按图建成的房子”。图纸适合跨机器同步，建成后的房子不能把砖墙文件直接复制到另一台机器。对应到开发流程：迁移 SQL、数据字典和确定性基础数据进入 Git；PostgreSQL 二进制数据目录不进入 Git。

新机器拉取代码并首次打开“新设计”后，会按 `new_design.schema_migrations` 的记录顺序执行尚未应用的 SQL。默认空间使用固定 UUID，可在不同机器得到一致的基础身份。

用户创建的元卡片和卡片属于真实业务数据。它们需要使用 PostgreSQL 逻辑备份与恢复来迁移，不能复制正在运行的数据目录，也不能提交到 Git。第一阶段尚未提供备份/恢复界面；在该闭环完成前，不应宣称业务数据会自动跨机器同步。

## 关系概览

```text
card_spaces 1 ── n card_types 1 ── n card_type_versions
     │                 │                    │
     └────── 1 ── n cards 1 ── n card_versions

card_type_categories 1 ── n card_types

book_creation_sessions 1 ── n ai_generation_batches
          │             └── n book_content_sources
          └── 0..1 books 1 ── n card_field_origins

resource card/version 1 ── n resource_adoptions n ── 1 books
                                      └──────────── 1 target card

books 1 ── n book_view_configs
books 1 ── n book_change_sets
card 1 ── 0..1 story_time_positions
card 1 ── n narrative_placements n ── 1 chapter/scene card
card 1 ── n text_anchors n ── 1 chapter/scene card
character card n ── n character card（经 card_relations 的单条关系）
```

## `new_design.schema_migrations`

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `text` | 主键 | 已执行迁移编号，例如 `001_card_kernel` |
| `applied_at` | `timestamptz` | 非空 | 成功执行时间 |

运行时先读取这张表，只执行尚未登记的 SQL 文件；同一迁移不会在每次启动时重复执行。

## `new_design.card_spaces`

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 空间身份 |
| `space_key` | `text` | 唯一、非空 | 稳定空间标识 |
| `name` | `text` | 非空 | 展示名称 |
| `created_at` | `timestamptz` | 非空 | 创建时间 |

默认空间 `00000000-0000-4000-8000-000000000001` 保存结构设计中心的系统定义；每本书另有独立空间。公共策略和提示词组件分别使用 `resource_strategy` 与 `resource_prompt_components` 资源空间；资源空间可以复用默认空间的系统类型定义，但普通空间不能跨空间创建卡片。

## `new_design.card_types`

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 元卡片类型身份 |
| `space_id` | `uuid` | 外键、非空 | 所属空间 |
| `category_id` | `uuid` | 外键、可空 | 管理目录位置，不参与字段继承 |
| `type_key` | `text` | 空间内唯一 | 稳定类型标识 |
| `name` | `text` | 非空 | 类型名称 |
| `description` | `text` | 非空 | 用途说明 |
| `status` | `text` | `draft/published/archived` | 类型状态 |
| `revision` | `integer` | 正整数 | 并发写保护 |
| `current_version_id` | `uuid` | 可空 | 当前发布版本 |
| `draft_fields` | `jsonb` | 非空 | 当前可编辑草稿 |
| `is_system` | `boolean` | 非空 | 是否为随产品交付的内置类型 |
| `sort_order` | `integer` | 非空 | 类型列表中的稳定顺序 |
| `semantic_capabilities` | `jsonb` | 非空 | 类型可参与的通用创作流程能力 |
| `created_at` / `updated_at` | `timestamptz` | 非空 | 审计时间 |

> 🏠 **白话比喻**：`is_system` 像资料室里统一印好的标准表格，`sort_order` 像表格柜上的固定编号。对应到系统里：它们只负责标明产品预置身份和显示次序，实际字段仍由可版本化的 `draft_fields` / `card_type_versions` 管理。

> 🧠 **速记方法**：系统身份看 `is_system`，显示位置看 `sort_order`，业务结构看版本。三者分开，换机器初始化时既能保持顺序，也不会把界面顺序误当成数据关系。

`semantic_capabilities` 当前允许七种稳定能力：正文承载 `body_text`、时间定位 `timeline`、状态变化 `state_change`、关系主体 `relation_subject`、生命周期 `lifecycle`、创作目标 `creative_goal` 和正典事实 `canonical_fact`。能力只是组合标记，仙侠的境界、灵根、宗门等题材内容继续由模板字段扩展，不固化为底层类型。

> 🏠 **白话比喻**：语义能力像插座旁的功能图标，说明一件设备能否联网、定时或充电，但不决定设备外壳长什么样。对应到系统里：卡片字段仍可自由配置，组合表单只依据稳定能力判断它能参与哪些流程。

> 🧠 **速记方法**：**类型管“是什么”，能力管“能做什么”，字段管“具体填什么”**。

## `new_design.card_type_categories`

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 分类节点身份 |
| `category_key` | `text` | 唯一、非空 | 稳定分类标识 |
| `name` | `text` | 非空 | 用户可见名称 |
| `parent_id` | `uuid` | 自关联、可空 | 上级分类；当前六个系统分类均为根节点 |
| `sort_order` | `integer` | 非空 | 同级显示顺序 |
| `status` | `text` | `active/archived` | 分类状态 |
| `is_system` | `boolean` | 非空 | 是否为系统内置分类 |
| `revision` | `integer` | 正整数 | 并发写保护 |
| `created_at` / `updated_at` | `timestamptz` | 非空 | 审计时间 |

系统内置七类为创作策略、人物与组织、世界设定、剧情结构、篇章结构、参考资料和 AI 资源；前六类服务书籍资料，AI 资源只管理跨书复用的提示词组件。搜索树时保留命中叶子的祖先路径；分类节点不创建卡片实例，也不向子类型传递字段。

> 🏠 **白话比喻**：分类像档案柜上的抽屉标签，类型像抽屉里的空白表格。对应到系统里：移动抽屉只改变查找位置，不会改写表格上的栏目。

> 🧠 **速记方法**：**分类只导航，类型才定字段**。

## `new_design.card_type_versions`

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 类型版本身份 |
| `card_type_id` | `uuid` | 外键、非空 | 所属元卡片类型 |
| `version` | `integer` | 类型内唯一 | 从 1 递增的发布版本 |
| `fields` | `jsonb` | 非空 | 不可变字段与界面定义 |
| `created_at` | `timestamptz` | 非空 | 发布时间 |

`fields` 数组的每项包含：稳定 `key`、名称、解释、类型、必填、默认值、选项、分组和顺序。当前字段类型为短文本、长文本、数字、布尔、单选、多选和日期。

## `new_design.cards`

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 卡片稳定身份 |
| `space_id` | `uuid` | 外键、非空 | 所属空间 |
| `card_type_id` | `uuid` | 外键、非空 | 元卡片类型 |
| `title` | `text` | 非空 | 卡片主标题 |
| `status` | `text` | `active/archived` | 使用或归档状态 |
| `revision` | `integer` | 正整数 | 并发写保护与当前修订号 |
| `type_version_id` | `uuid` | 外键、非空 | 本次保存采用的类型版本 |
| `current_version_id` | `uuid` | 可空 | 当前卡片快照 |
| `values` | `jsonb` | 非空 | 动态字段值 |
| `created_at` / `updated_at` | `timestamptz` | 非空 | 审计时间 |
| `archived_at` | `timestamptz` | 可空 | 归档时间 |

## `new_design.card_versions`

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 快照身份 |
| `card_id` | `uuid` | 外键、非空 | 所属卡片 |
| `revision` | `integer` | 卡片内唯一 | 快照修订号 |
| `type_version_id` | `uuid` | 外键、非空 | 校验该快照的类型版本 |
| `title` | `text` | 非空 | 标题快照 |
| `values` | `jsonb` | 非空 | 动态值快照 |
| `source` | `text` | `create/edit/archive/restore` | 形成原因 |
| `created_at` | `timestamptz` | 非空 | 快照时间 |

## 字典、关系与挂载

`dictionary_definitions` / `dictionary_items` 保存稳定字典和字典项，`relation_types` 保存允许的源类型、目标类型、方向、数量和关系属性，`card_relations` 保存真实关系；`card_mounts` 把引用卡片装入某个表单实例，并把“本事件目标、立场、结果”等局部值存在挂载上。

> 🏠 **白话比喻**：人物卡像演员档案，事件表单像某一场戏的通告单。“沈照微的性格”写回演员档案，“她在这场戏里的目标”只写在通告单上。对应到数据库：稳定事实进 `cards`，局部上下文进 `card_mounts.local_values`，不会污染来源卡片。

> 🧠 **速记方法**：**卡片管本人，关系管连线，挂载管本次用法**。

## 卡片组表单

`card_group_forms` 保存可编辑草稿，`card_group_form_versions` 保存不可变发布版本，`card_group_form_instances` 保存书内实际填写结果。表单定义包含分组、区块、主卡槽、引用槽、允许类型、最少/最多数量及局部字段。设计预览和实际填写均读取同一个发布定义。

> 🏠 **白话比喻**：表单版本像印刷好的装配清单；清单发布后不再改旧纸张，新要求要印 v2。对应到数据库：旧实例继续引用原 `form_version_id`，新实例可采用新版本。

> 🧠 **速记方法**：**草稿可改、发布冻结、实例认版本**。

## 模板组与书籍

`template_groups` / `template_group_versions` 把元卡片类型版本、字典、关系类型、卡片组表单和菜单配置冻结为模板快照。`books` 是固定聚合根，每本书拥有自己的 `card_spaces`；创建书籍时会复制模板快照，不使用前端假筛选。`book_template_syncs` 记录模板升级预览和应用结果。

模板同步只追加新的非必填稳定 `field_key`。模板删除或修改已有字段、本书已存在同键字段、新字段改成必填，都会成为冲突并跳过；同步不会清理、覆盖或回写书内内容。

> 🏠 **白话比喻**：模板像毛坯房图纸，书籍像按图交付后各自装修的住宅。图纸升级可以建议加一个空置储物柜，却不能进门拆掉住户的墙或覆盖家具。对应到数据库：书籍安装的是版本快照，升级只安全追加字段。

> 🧠 **速记方法**：**安装复制、书书隔离、升级只加不改**。

## 统一开书与 AI 来源追踪

`inspiration_candidates` 保存可跨机器初始化的“没有想法”候选；`book_creation_sessions` 保存一次开书从来源理解、方向确认、初始资料预览到书籍安装的状态；`ai_generation_batches` 保存每次 AI 调用的阶段、输入、输出、提示词版本、模型、重试来源和错误；`book_content_sources` 把完成后的书籍关联到真实入口与来源；`card_field_origins` 记录 AI 初始值或表单建议对应的卡片字段、生成批次和确认状态。

`book_creation_sessions.method` 支持 `blank`、`template`、`idea`、`inspiration`、`market`、`reference`、`continuation`。这些值只描述入口，不改变模板结构。会话通过 `template_version_id` 锁定同一个不可变模板版本，最终通过 `book_id` 指向统一的书籍聚合根。

`book_creation_sessions.status` 使用 `draft/generating/waiting_direction/review/creating/completed/failed`；`stage` 进一步标明理解来源、生成方向、等待确认、匹配字段、生成初始资料、预览和安装模板。失败保留 `last_failed_stage` 与 `error_message`，因此可以只重试当前阶段，也可以保留已有结果建立书籍。

`card_field_origins` 以 `card_id + field_key` 唯一定位字段来源，并保存 `origin`、`generation_batch_id`、`confirmation_status` 和 `source_payload`。写入 AI 建议前仍检查卡片 `revision`，避免覆盖作者在另一个页面已经保存的修改。

> 🏠 **白话比喻**：开书会话像医院挂号后的就诊单，入口只是“从哪个窗口来”；AI 批次像每次检查报告，最终都归入同一份病历。对应到系统里：七种入口共用一套书籍表单，生成记录和作者确认则分别留痕。

> 🧠 **速记方法**：**入口记来源，会话记进度，批次记生成，字段记归属**。

## 创作策略公共资源与安装快照

固定空间 `60000000-0000-4000-8000-000000000001`（`resource_strategy`）保存可跨书复用的题材策略、推进模式、写法配置和质量规则。`009_strategy_resources.sql` 使用稳定 UUID 初始化 12 项可生产资源：3 项题材策略、3 项推进模式、2 项写法配置和 4 项质量规则。资源本身继续使用 `cards` / `card_versions`，不建立四套重复事实表。

`resource_adoptions` 记录公共资源安装到书籍时的证据：

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 安装记录身份 |
| `resource_card_id` | `uuid` | 外键、非空 | 安装时采用的公共资源 |
| `resource_version_id` | `uuid` | 外键、非空 | 安装时采用的不可变资源版本 |
| `book_id` | `uuid` | 外键、非空 | 目标书籍 |
| `target_card_id` | `uuid` | 外键、非空 | 复制进本书空间后的独立卡片 |
| `action` | `text` | `install_snapshot` | 采用动作；当前只允许安装快照 |
| `snapshot` | `jsonb` | 非空 | 安装当时的类型、标题和字段值 |
| `created_at` | `timestamptz` | 非空 | 安装时间 |

安装会先按目标书籍同 `type_key` 的当前发布规格重新校验字段，再在一个事务中创建本书卡片、版本、字段来源和采用记录。之后公共资源与本书卡片各自编辑，互不回写；开书页选择的策略资源也走同一套事务安装，不通过前端临时拼接。

> 🏠 **白话比喻**：公共策略像文具店里的表格范本，安装到一本书时会复印一份放进这本书的档案袋。对应到数据库：`resource_card_id` 留下范本来源，`target_card_id` 是书内可独立修改的复印件，商店后来换新版不会改掉档案袋里的内容。

> 🧠 **速记方法**：**公共库管范本，采用表管凭证，本书卡管成品**。

## 提示词组件卡

`010_prompt_components.sql` 在根目录新增“AI 资源”分类，并新增唯一类型 `prompt_component`。它使用固定资源空间 `63000000-0000-4000-8000-000000000001` 保存组件实例，不进入“通用长篇小说模板”，因此新建书籍仍只安装 29 种小说资料规格。

提示词组件动态表单包含稳定组件键、组件类型、正文内容、适用任务族、资源绑定状态、覆盖／编辑策略、信任等级、启用状态和说明。组件类型覆盖角色职责、任务说明、业务约束、创作策略引用、写法引用、质量规则引用、上下文声明、输出要求、示例和临时补充。引用类组件当前只允许标记“待配方绑定”，不使用字符串伪造正式关系。

四条确定性演示组件为“长篇小说创作助手角色”“严格依据已确认事实”“只返回表单 Schema”和“避免擅自新增设定”。它们不绑定《照骨山河》或任何书籍，也不保存最终 Prompt、模型密钥和作品事实。

> 🏠 **白话比喻**：提示词组件像工具墙上的螺丝刀、扳手和量尺，每件工具有固定编号和用途，但把哪些工具按什么顺序装进作业箱，要由另一张受控清单决定。对应到系统里：组件卡保存可复用指令零件；任务合同、提示词配方、槽位顺序、模型路由和运行快照仍是固定系统对象。

> 🧠 **速记方法**：**组件是零件，配方是装配单，任务合同是验收标准**。

## 书籍基础多视图

`011_book_multiview.sql` 为每本书安装章节、线索／伏笔、角色、事件／时间、世界和资源六种基础视图。视图不拥有作品事实：右侧共用检查器继续编辑 `cards`，人物连线继续写入 `card_relations`，其余投影使用下列固定对象：

| 表 | 唯一口径 | 保存内容 |
|---|---|---|
| `story_time_positions` | `space_id + card_id` | 事件在故事世界中的开始／结束顺序、显示名称和不确定性 |
| `narrative_placements` | 活跃的 `space_id + subject_card_id + role` | 事件、线索或伏笔在哪一章／场景出现、埋设或揭示 |
| `text_anchors` | `space_id + subject_card_id + role` | 对象在正文内的可读落点说明 |
| `book_view_configs` | `book_id + view_key` | 只保存分组、排序、显示、展开和默认范围等界面配置 |

人物关系使用 `character_relationship` 关系类型。一对人物只保存一条 `card_relations`，属性内分别记录正向与反向称谓；从另一人物进入角色视图时交换显示称谓，不创建反向重复行。所有写入都校验书籍空间、卡片状态、允许类型与 `revision`。归档对象、跨书对象、非法类型、过期修订和结束早于开始的故事时间会返回可直接理解的错误。

> 🏠 **白话比喻**：同一场足球赛可以出现在赛程表、球队页面和球员履历里，但不能为了每个页面各记一场比赛。对应到系统里：事件卡是比赛事实，故事时间是开赛时间，叙事位置是它被写进哪一章；六个页面只换观察角度。

> 🧠 **速记方法**：**卡片管“是什么”，时间管“何时发生”，叙事位置管“何时讲”，锚点管“文中哪里”，视图配置只管“怎么摆”**。

## 高影响修改预览与统一应用

`012_book_change_sets.sql` 新增 `book_change_sets`。故事时间、叙事章节、人物关系以及线索／伏笔的埋设、揭示和正文锚点，不再通过公开接口直接保存：客户端先提交目标值生成影响预览，作者确认后，服务端在一个事务中重新检查修订号并统一应用。普通卡片标题和动态字段仍沿用即时保存。

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 一次影响预览的稳定身份 |
| `book_id` | `uuid` | 外键、非空 | 所属书籍 |
| `operation_key` | `text` | 四种固定操作 | `story_time`、`narrative_placement`、`character_relation` 或 `clue_lifecycle` |
| `input` | `jsonb` | 非空 | 经服务端 Schema 校验的待应用输入及基础修订号 |
| `impacts` | `jsonb` | 非空 | 面向作者展示的原值、新值和保持不变项 |
| `base_revisions` | `jsonb` | 非空 | 预览时读取到的各对象修订号审计快照 |
| `status` | `text` | `previewed/applied/dismissed` | 预览处理状态；同一记录只允许应用一次 |
| `created_at` / `applied_at` | `timestamptz` | 创建非空、应用可空 | 预览与实际应用时间 |

应用时会锁住对应变更集，并由各语义对象的写入函数再次核对 `revision`。如果预览后其他页面已经改过同一对象，本次应用整体回滚并要求刷新，不会用旧预览覆盖新事实。`clue_lifecycle` 同时涉及两条叙事位置和两条正文锚点，四项要么全部成功，要么全部不写。

> 🏠 **白话比喻**：改人物备注像在档案封面补一个电话号码，可以直接保存；挪章节、改人物连线或移动伏笔落点像装修时挪一堵墙，施工前要先看影响清单，确认后一次做完。对应到数据库：普通字段直接修订 `cards`，结构性修改先写 `book_change_sets`，再在单个事务中落到时间、位置、关系和锚点表。

> 🧠 **速记方法**：**小事实直接存，结构改动先预览；确认一次，全成或全不成**。

### 类型去重口径

- 题材、推进、写法和质量继续复用 `genre_strategy`、`progression_mode`、`writing_config`、`quality_rule`，不复制正文到提示词组件。
- 人物、组织、世界、地点和事件继续复用既有正式小说卡；公共入口只是视图与作用域，不新增“基础角色”或“历史事件”同义类型。
- 时间线由 `event` 的时间字段、章节／场景挂载和关系投影形成；本阶段不新增 `timeline` 或 `timeline_definition`。
- 参考长文、RAG 分块、向量、召回轨迹、图片二进制、标题生成批次、运行／重试／错误日志都不是普通卡片。

## 迁移规则

1. 每个迁移文件使用递增编号，应用后记录到 `new_design.schema_migrations`。
2. 已发布迁移文件不可改写；结构变化必须新增迁移。
3. 迁移默认只前进且非破坏。删列、改类型、清表或重建数据库必须先完成备份、恢复校验并取得明确授权。
4. 确定性基础数据使用稳定主键和 `ON CONFLICT`，确保多机初始化结果一致。

## 内置小说资料规格

`003_novel_card_catalog.sql` 将系统目录收敛为 19 种已发布核心类型：人物、组织／势力、地点、道具、世界规则、事件、目标／任务、冲突、秘密／真相、线索／证据、伏笔、悬念／问题、剧情线、剧情节点／节拍、弧线／变化线、主题／命题、卷、章节和场景。`008_card_type_categories.sql` 在不修改这 19 种类型及既有书籍快照的前提下，新增题材策略、推进模式、写法配置、质量规则、世界总览、能力／科技／修炼体系、种族、文化、宗教和参考资料，使小说资料目录达到 29 种类型；`010_prompt_components.sql` 另加 1 种 AI 资源类型，系统定义总数为 30，但它不会进入书籍模板。

迁移会为“通用长篇小说模板”发布一个新的不可变版本，把 29 种类型纳入后续新书；旧模板版本、旧书的 19 类型快照和《照骨山河》样例均保持原状。

秘密／真相保存作者侧唯一答案；线索／证据保存人物在故事内可发现的信息；悬念／问题保存读者等待回答的信息差；伏笔保存作者提前布置并计划回收的叙事动作。目标、冲突、剧情线、事件、场景、剧情节点和弧线也分别承担完成条件、持续对抗、跨事件因果链、世界内发生事实、具体时空行动、结构作用和跨阶段变化，不能互相替代。

关系、人物当前情绪／位置／伤势、道具当前持有者、事件时间、局部章节目标、字典选项、正文版本、AI 评价、任务日志、提示词、时间线和关系图不是独立核心卡片；它们应由关系、挂载、字段、版本或视图能力承载。

同时提供 4 张可直接修改的起步卡片：新书创作约定、核心故事构思、主世界观、主线时间规则。它们使用稳定 UUID，迁移通过 `ON CONFLICT` 保持幂等；已存在的同 ID 数据不会被启动过程反复插入。

`004_xianxia_production_demo.sql` 提供原创项目《照骨山河》的 55 张生产样例；`006_template_books.sql` 将这些卡片安装到真实的“照骨山河”书籍空间，并移除卡片标题里重复的书名前缀。样例覆盖全部 19 类核心卡片，并把第一卷前八章和第一章五个场景填到可直接进入正文生产的粒度。来源分析、原创边界和逐类数量见 `xianxia-production-demo.md`。

> 🏠 **白话比喻**：迁移 SQL 像随工具箱附带的标准空白表和四张填写示例。对应到数据库里：新机器拉取仓库后能得到同一套类型与示例，但作者后来填写的真实内容仍需要数据库备份来搬家。

> 🧠 **速记方法**：Git 同步“表格模板”，数据库备份同步“已经填过的表格”。前者由迁移负责，后者不能靠复制运行中的数据目录。
