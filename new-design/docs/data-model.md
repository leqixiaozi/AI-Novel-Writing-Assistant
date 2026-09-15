# 新设计第一阶段数据模型

本文是第一阶段 PostgreSQL 结构的数据字典。权威迁移位于 `../migrations/`：`001_card_kernel.sql` 建立卡片内核，`002_builtin_novel_cards.sql` 提供早期起步数据，`003_novel_card_catalog.sql` 收敛 19 类核心卡片和可组合语义能力，`004_xianxia_production_demo.sql` 提供可生产的原创仙侠样例；运行时直接执行这些 SQL，不在代码中维护第二份副本。

## 跨机器同步原则

把 Git 仓库理解成“施工图纸”，把每台电脑上的 PostgreSQL 数据目录理解成“按图建成的房子”。图纸适合跨机器同步，建成后的房子不能把砖墙文件直接复制到另一台机器。对应到开发流程：迁移 SQL、数据字典和确定性基础数据进入 Git；PostgreSQL 二进制数据目录不进入 Git。

新机器拉取代码并首次打开“新设计”后，会按 `new_design.schema_migrations` 的记录顺序执行尚未应用的 SQL。默认空间使用固定 UUID，可在不同机器得到一致的基础身份。

用户创建的元卡片和卡片属于真实业务数据。它们需要使用 PostgreSQL 逻辑备份与恢复来迁移，不能复制正在运行的数据目录，也不能提交到 Git。第一阶段尚未提供备份/恢复界面；在该闭环完成前，不应宣称业务数据会自动跨机器同步。

## 关系概览

```text
card_spaces 1 ── n card_types 1 ── n card_type_versions
     │                 │                    │
     └────── 1 ── n cards 1 ── n card_versions
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

第一阶段只写入默认空间：`00000000-0000-4000-8000-000000000001`。

## `new_design.card_types`

| 字段 | 类型 | 约束 | 含义 |
|---|---|---|---|
| `id` | `uuid` | 主键 | 元卡片类型身份 |
| `space_id` | `uuid` | 外键、非空 | 所属空间 |
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

## 迁移规则

1. 每个迁移文件使用递增编号，应用后记录到 `new_design.schema_migrations`。
2. 已发布迁移文件不可改写；结构变化必须新增迁移。
3. 迁移默认只前进且非破坏。删列、改类型、清表或重建数据库必须先完成备份、恢复校验并取得明确授权。
4. 确定性基础数据使用稳定主键和 `ON CONFLICT`，确保多机初始化结果一致。

## 内置小说卡片

`003_novel_card_catalog.sql` 将系统目录收敛为以下 19 种已发布核心类型：人物、组织／势力、地点、道具、世界规则、事件、目标／任务、冲突、秘密／真相、线索／证据、伏笔、悬念／问题、剧情线、剧情节点／节拍、弧线／变化线、主题／命题、卷、章节和场景。

秘密／真相保存作者侧唯一答案；线索／证据保存人物在故事内可发现的信息；悬念／问题保存读者等待回答的信息差；伏笔保存作者提前布置并计划回收的叙事动作。目标、冲突、剧情线、事件、场景、剧情节点和弧线也分别承担完成条件、持续对抗、跨事件因果链、世界内发生事实、具体时空行动、结构作用和跨阶段变化，不能互相替代。

关系、人物当前情绪／位置／伤势、道具当前持有者、事件时间、局部章节目标、字典选项、正文版本、AI 评价、任务日志、提示词、时间线和关系图不是独立核心卡片；它们应由关系、挂载、字段、版本或视图能力承载。

同时提供 4 张可直接修改的起步卡片：新书创作约定、核心故事构思、主世界观、主线时间规则。它们使用稳定 UUID，迁移通过 `ON CONFLICT` 保持幂等；已存在的同 ID 数据不会被启动过程反复插入。

`004_xianxia_production_demo.sql` 另提供原创项目《照骨山河》的 55 张生产样例，覆盖全部 19 类核心卡片，并把第一卷前八章和第一章五个场景填到可直接进入正文生产的粒度。来源分析、原创边界和逐类数量见 `xianxia-production-demo.md`。

> 🏠 **白话比喻**：迁移 SQL 像随工具箱附带的标准空白表和四张填写示例。对应到数据库里：新机器拉取仓库后能得到同一套类型与示例，但作者后来填写的真实内容仍需要数据库备份来搬家。

> 🧠 **速记方法**：Git 同步“表格模板”，数据库备份同步“已经填过的表格”。前者由迁移负责，后者不能靠复制运行中的数据目录。
