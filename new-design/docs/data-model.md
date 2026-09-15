# 新设计第一阶段数据模型

本文是第一阶段 PostgreSQL 结构的数据字典。权威迁移位于 `../migrations/`：`001_card_kernel.sql` 建立卡片内核，`002_builtin_novel_cards.sql` 增加系统类型、排序和确定性初始数据；运行时直接执行这些 SQL，不在代码中维护第二份副本。

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
| `created_at` / `updated_at` | `timestamptz` | 非空 | 审计时间 |

> 🏠 **白话比喻**：`is_system` 像资料室里统一印好的标准表格，`sort_order` 像表格柜上的固定编号。对应到系统里：它们只负责标明产品预置身份和显示次序，实际字段仍由可版本化的 `draft_fields` / `card_type_versions` 管理。

> 🧠 **速记方法**：系统身份看 `is_system`，显示位置看 `sort_order`，业务结构看版本。三者分开，换机器初始化时既能保持顺序，也不会把界面顺序误当成数据关系。

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

`002_builtin_novel_cards.sql` 随代码同步并初始化以下 14 种已发布类型：作品约定、故事构思、世界观、人物、地点、势力、道具、事件、时间规则、线索与伏笔、卷规划、章节规划、场景规划、研究资料。

同时提供 4 张可直接修改的起步卡片：新书创作约定、核心故事构思、主世界观、主线时间规则。它们使用稳定 UUID，迁移通过 `ON CONFLICT` 保持幂等；已存在的同 ID 数据不会被启动过程反复插入。

> 🏠 **白话比喻**：迁移 SQL 像随工具箱附带的标准空白表和四张填写示例。对应到数据库里：新机器拉取仓库后能得到同一套类型与示例，但作者后来填写的真实内容仍需要数据库备份来搬家。

> 🧠 **速记方法**：Git 同步“表格模板”，数据库备份同步“已经填过的表格”。前者由迁移负责，后者不能靠复制运行中的数据目录。
