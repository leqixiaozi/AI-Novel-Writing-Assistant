# 新设计数据模型

本文是新设计 PostgreSQL 结构的数据字典。权威迁移位于 `../migrations/`：`001_card_kernel.sql` 至 `014_market_radar.sql` 建立卡片、书籍、研究与市场基础，`015_research_reference_packs.sql` 锁定研究参考包和开书预填，`016_chapter_body_versions.sql` 建立章节正文不可变版本与精确锚点，`017_canonical_facts.sql` 建立统一事实、证据、冲突和修正链，`018_state_settlements.sql` 建立可配置状态能力、初始状态、章节结算、当前投影、里程碑和数值语义映射，`019_state_proposal_before_guard.sql` 为已运行 `018` 的开发数据补齐提案前值并发保护，`020_knowledge_states.sql` 建立人物／读者知情状态、可编辑 AI 提案版本及研究候选版本；运行时直接执行这些 SQL，不在代码中维护第二份副本。

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

research_documents 1 ── n research_document_versions
research_records 1 ── n research_record_versions 1 ── n research_evidence
                                      │
                                      └─ n research_candidate_batches 1 ── n research_candidates
                                                                    └─ n research_candidate_versions
research_reference_packs 1 ── n research_reference_pack_versions 1 ── n research_reference_pack_items
book_creation_sessions 1 ── n book_creation_research_selections ── 1 research/pack exact version
books 1 ── n book_research_references ── 1 research/pack exact version
books 1 ── n chapter_documents 1 ── n chapter_body_versions
chapter_documents 1 ── n chapter_body_adoptions
chapter_body_versions 1 ── n chapter_text_anchors
books 1 ── n canonical_facts 1 ── n canonical_fact_evidence
canonical_facts n ── n canonical_fact_conflicts
canonical_facts 1 ── n canonical_fact_review_actions

books 1 ── n entity_initial_states 1 ── n entity_initial_state_versions
chapter_body_versions 1 ── n state_change_proposals
chapter_settlements 1 ── n state_changes
entity_initial_states + active state_changes ──> current_state_projections
books 1 ── n state_milestone_snapshots
state_value_mappings 1 ── n state_value_mapping_versions

books 1 ── n epistemic_claims
epistemic_claims 1 ── n knowledge_state_proposals 1 ── n knowledge_state_proposal_versions
knowledge_state_proposals 1 ── 0..1 knowledge_state_changes
active knowledge_state_changes ──> current_knowledge_state_projections
```

## 研究与分析固定对象

`research_documents` 保存来源资料的稳定身份，`research_document_versions` 保存每次粘贴或导入后的不可变原文版本与内容哈希。`research_records` 保存用户可编辑的标题、标签、收藏、备注和归档状态；每次扫描、市场分析、拆书或稿件诊断都在 `research_record_versions` 新增运行版本，不覆盖上次报告。

运行版本冻结来源范围、模板版本、预算、提示词快照、模型快照、输入、结构结果与可读报告。`research_evidence` 把结论字段回指到原文片段；候选结果生成后立即进入 `research_candidate_batches` / `research_candidates`，不依赖第二次保存操作。初始内容和作者采用前的每次修改都追加到 `research_candidate_versions`，并通过 `revision` 阻止并发覆盖；只有作者明确采用后才由 `research_candidate_adoptions` 记录正式去向。`market_source_snapshots` / `market_ranking_items` 独立保存每次公开榜单扫描，单个平台失败也不会删除以前成功的快照。

`research_reference_packs` 只保存可编辑的包身份，发布时由 `research_reference_pack_versions` 和 `research_reference_pack_items` 冻结具体研究版本。`book_creation_research_selections` 在开书会话建立时锁定用户选择及完整预填快照；一本书再通过 `book_research_references` 固化精确的研究记录版本或参考包版本。以后重跑研究、重发参考包都不会偷偷改变既有会话或已开书内容。

预填按“类型 key + 标题”定位已有资料，只允许把研究候选写入空字符串、空数组、`null` 或缺失字段；非空字段会生成冲突说明并保持原值。这个规则像给已经填写过的纸质表格补空栏：空格可以代填，写过的格子必须保留原笔迹。对应到数据层：研究预填只能追加缺失值，不能覆盖模板、AI 草稿或作者确认内容。

> 🧠 **速记方法**：**选时冻结、空处可补、已有不动、建书留据**。

> 🏠 **白话比喻**：研究资料像送到编辑部的原稿，研究运行像编辑针对某一版原稿写的批注报告，参考包像把若干份报告封进一个有编号的档案袋。对应到系统里：原文版本、运行版本和参考包版本各自冻结，新的分析只能新增一版，不能在旧报告上涂改。

> 🧠 **速记方法**：**原文留底、运行增版、证据定位、采用过账、开书锁版**。分别对应资料版本、研究版本、证据锚点、候选采用记录和书籍引用快照。

### 章节正文版本与精确锚点

`chapter_documents` 是章节正文的稳定身份，绑定一本书中的章节卡并保存唯一逻辑顺序、并发修订号和 `adopted_version_id`。`chapter_body_versions` 只追加人工稿、AI 候选、修订或导入正文，保存父版本、生成所用基础版本、可选 AI 运行引用、创建者、完整正文和 SHA-256 哈希；正文内容写入后不更新。

采用正文时必须锁定章节档案并校验 `expectedRevision`，再在同一事务里切换正式版本指针并写入 `chapter_body_adoptions`。幂等键阻止重试产生重复采用；切回较早版本记作 `rollback`，再次指向同一版本记作 `readopt`。候选版本可以归档，但当前正式版本必须先切走。

`chapter_text_anchors` 绑定精确 `body_version_id`，同时保存字符起止、当时摘录和片段哈希。锚点不会随着正文切版漂移；当它绑定的版本不再是正式正文时，读取结果标记 `isStale=true`，但历史坐标仍可审计。

> 🏠 **白话比喻**：一章的多个正文版本像编辑桌上的几份校样，只有盖章那份才拿去印刷；便签贴在某一份校样的第几行，不会偷偷飞到新校样上。对应到系统里：候选版本只追加，正式采用靠唯一指针，文本锚点锁定具体版本。

> 🧠 **速记方法**：**多稿并存，一稿盖章；锚点跟稿，不跟章漂**。

### 统一事实、证据、冲突与修正链

`canonical_facts` 保存书籍范围内的主体、谓词、类型化值、可选对象卡片、有效故事时间、置信度、来源方式和审核状态。所有入口都只创建 `proposed`；AI 抽取不会直接产生 `confirmed`。事实值不原地编辑，需要修正时新增一条带 `supersedes_fact_id` 的提案，人工确认后旧事实才写入 `superseded_by_fact_id` 并转为 `superseded`。

`canonical_fact_evidence` 每行只能指向正文精确锚点、卡片版本或研究证据之一，并记录提取方式。章节采用其他正文版本时，旧正文上的证据写入 `stale_at/stale_reason`，相关未确认事实转为 `stale`，同时追加 `mark_stale` 审核记录；历史证据不删除。`canonical_fact_review_actions` 保存提案、确认、驳回、取代和陈旧传播，确认与驳回使用幂等键。

`canonical_fact_conflicts` 保存同一主体和谓词在重叠有效时间中出现不同值的冲突，任何一方都不会因此被自动覆盖。冲突只能由人工选择已确认事实解决，或明确忽略；修正事实正式确认时，可把它与被修正旧事实之间的冲突结清。

> 🏠 **白话比喻**：卡片像人物档案里的简介，事实库像法庭确认的案情记录；证词先登记，互相矛盾就挂起冲突，法官确认后才成为有效结论，后来翻案也要留下原判和新判。对应到系统里：卡片描述不是正典，AI 只提交证词，人工审核决定事实状态，修正通过新记录取代旧记录。

> 🧠 **速记方法**：**描述归卡片，事实先进提案；证据要挂号，冲突不覆盖，修正另开单**。

### 可配置状态、章节结算与投影

`state_type_capabilities` 和 `state_field_policies` 决定某类卡片是否必须、可以或禁止参加章节结算，并把字段分为不跟踪、直接跟踪、派生值或仅生命周期。`state_relation_capabilities` 和 `state_relation_dimensions` 对关系采用同样规则，并额外保存正向、反向或双向维度。默认人物、组织和道具为必结，地点可选；人物关系和事件—道具关系为必结；目标、冲突、秘密、线索、伏笔、悬念、剧情线和弧线使用轻量生命周期；世界、策略和参考资料默认禁用。

`entity_initial_states` 保存主体与状态键的稳定身份，`entity_initial_state_versions` 只追加每次初始值修订、哈希、可选确认事实来源和操作人。`state_change_proposals` 必须记录变化前值、变化后值、可选差量、原因、故事时间，并锁定章节正文版本；文本证据可进一步绑定 `chapter_text_anchors`，原因事件可绑定本书 `event` 卡片。AI、人工和导入都只能先写 `proposed`；采用前的用户修改会追加到 `state_change_proposal_versions`，主提案只保存当前可操作值与修订号。

`chapter_settlements` 是用户确认的一次章节入账，幂等键保证重复提交不会重复记账。只有当前已采用的正文版本可以提交；服务端会再次比较提案的变化前值与 `current_state_projections`，防止陈旧提案覆盖新状态。通过校验后，每项变化才追加到 `state_changes`。撤销把变化标为 `reverted`，采用其他正文把原结算与变化标为 `superseded/invalidated`；历史行全部保留。

`current_state_projections` 只保存从当前初始版本和全部有效变化重建出的查询结果，不是第二份正本。`state_milestone_snapshots` 可在初始、卷末、重大修订、正文切换或手工节点冻结一份投影照片。`state_value_mappings` 与不可变的 `state_value_mapping_versions` 保存数值区间的写作语义，并可锁定具体提示词组件卡片版本，避免提示词升级改变旧规则含义。

| 能力层 | 关键取值 | 默认用途 |
|---|---|---|
| 类型结算能力 | `disabled / optional / required` | 控制整类资料是否参与结算 |
| 字段策略 | `none / tracked / derived / lifecycle_only` | 控制具体状态键能否直接写入 |
| 状态模式 | `absolute / delta / derived / lifecycle` | 区分绝对值、差量、派生和生命周期 |
| 关系方向 | `forward / inverse / bidirectional` | 解释关系状态从哪一侧读取 |

> 🏠 **白话比喻**：章节结算像仓库交接班。AI 可以先填“谁领走了灯、谁受了伤”的待核单，但仓管员签字后才进入流水；库存看板随流水重算，退单或换掉本章正式稿时只作废对应流水，不撕掉原单。对应到系统里：提案、确认结算、只追加变化和可重建投影各司其职。

> 🧠 **速记方法**：**能力定范围，初值打底；提案对前值，确认才入账；历史不删除，投影随时算**。

### 人物、读者知情与误解状态

`epistemic_claims` 保存“被认知的命题”，包含可选主体卡、谓词、类型化值、对象卡和可选的已确认客观事实引用。它不声明持有者是否相信该命题，因此同一个世界事实、人物误解和读者已知内容可以同时存在，彼此不覆盖。

`knowledge_state_proposals` 保存人物或读者这一持有者的待审提案，`knowledge_state_proposal_versions` 保存每次姿态、置信度、获知方式、来源人物／事件、章节正文、精确锚点、故事时间和叙事位置修订。AI 输出一产生就写入 `proposed` 并保存第一个版本；用户可继续修改，确认或驳回。AI 提案必须绑定正文版本和精确锚点，只有当前采用正文上的提案才能确认。

确认后才向 `knowledge_state_changes` 追加有效流水，并重建 `current_knowledge_state_projections`。人物持有者使用本书人物卡 ID，读者持有者使用独立键；查询某个叙事位置时，只选择 `effective_narrative_order` 不晚于目标位置的最新有效流水。时间未知的记录仍可在当前认知中看到，但不会被猜测到任意历史位置。切换正式正文会把旧版本关联的流水和提案标为 `invalidated`，再重建投影，历史版本和审核动作全部保留。

| 维度 | 关键取值 | 含义 |
|---|---|---|
| 持有者 | `character / reader` | 人物所知与读者所知分账 |
| 认知姿态 | `knows / believes / suspects / misunderstands / unknown` | 区分知道、相信、怀疑、误解与未知 |
| 获知方式 | `witnessed / told / inferred / read / narration / assumed / forgotten / manual` | 记录信息怎样进入认知 |
| 时间 | 故事顺序／叙事顺序／系统创建时间 | 分开世界发生、读者看到和数据库修订 |

> 🏠 **白话比喻**：案卷真相、证人口供和观众看到的监控片段是三本账。对应到数据层：`canonical_facts` 管客观真相，人物 `knowledge_state_changes` 管角色口供，读者持有者管当前已揭示信息；即使证人说错，也不能改掉案卷真相。

> 🧠 **速记方法**：**真相一册，角色各册，读者另册；按章翻页，不看后页；时间不明，不替它编**。

### 市场雷达快照与市场信号

每次手动扫描先建立 `market_scan` 研究版本，再为每个公开榜单写一条 `market_source_snapshots`。同一次扫描中，番茄、起点、晋江的适配器彼此隔离：某个来源失败只把该快照记为 `failed`，其余成功来源继续写入 `market_ranking_items`。重试在同一研究记录下新增版本，旧版本和旧快照仍可按版本读取。

扫描本身不调用模型。作者勾选具体作品并点击“开始 AI 分析”后，系统才建立独立 `market_analysis` 运行；提示词、模型、预算、所选 item ID、结构结果和可读报告均随运行版本冻结。分析产生的 `market_signal` 先进入候选批次，只有作者逐条确认后，才在固定资源空间 `70000000-0000-4000-8000-000000000001` 创建卡片，并用 `research_candidate_adoptions` 与 `card_field_origins.source_kind = research` 留下来源。

`market_signal` 包含信号类型、摘要、热度、拥挤度、趋势、平台、受众、差异化、来源引用、观察日期和建议复核日期。没有跨期证据时趋势只能是不确定；榜单名次不能被解释为销量、收入或增长率。

> 🏠 **白话比喻**：扫描像每天拍下商场门口的客流牌，AI 分析像研究员拿着用户圈选的照片写观察，市场信号卡像负责人签字后放进选题档案的结论。对应到系统里：拍照不会自动请研究员，研究报告也不会未经确认就变成正式资源。

> 🧠 **速记方法**：**扫榜不耗模，圈选才分析，确认才入库**。

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

## 证据化拆书与候选采用

拆书不新增第二套分析表，而是复用 `013_research_foundation.sql` 的版本化对象：`research_documents` / `research_document_versions` 冻结输入正文，`research_records` / `research_record_versions` 冻结每次运行，`research_evidence` 保存字段级原文锚点，`research_candidate_batches` / `research_candidates` 保存尚未进入正式资料的候选，`research_candidate_adoptions` 保存作者决定。

每次运行的 `input_snapshot` 固定记录用途、深度、八个分析维度、目标表单、允许的发布类型与字段、证据要求和候选上限；`source_scope` 固定记录资料版本、全文或字符范围及来源 URL。重跑只追加 `research_record_versions`，旧报告、证据和候选不被覆盖。范围分析的 `start_offset` / `end_offset` 使用原始资料的绝对字符位置，摘录无法在所选文本中精确定位时必须改为 `low_confidence` 且位置留空。

候选采用在单个 PostgreSQL 事务中支持五种动作：`create_card` 新建到有效书籍、`merge_card` 按修订号合并同类型资料、`save_resource` 保存四类可复用创作策略、`reference_only` 仅留作参考、`ignore` 忽略。新建与合并都会在 `card_field_origins` 写入 `source_kind=research` 和精确 `research_record_version`；批量动作有一项失败时整体回滚。

> 🏠 **白话比喻**：拆书候选像编辑在样稿旁贴的便签，便签可以建议“新增人物”或“调整写法”，但没有主编签字就不能塞进正式书稿。对应到数据库：候选留在 `research_candidates`，作者动作写入 `research_candidate_adoptions` 后，才会创建或修订正式 `cards`。

> 🧠 **速记方法**：**原文锁版本，运行锁输入，证据锁位置，采用才入库**。

## 迁移规则

1. 每个迁移文件使用递增编号，应用后记录到 `new_design.schema_migrations`。
2. 已发布迁移文件不可改写；结构变化必须新增迁移。
3. 迁移默认只前进且非破坏。删列、改类型、清表或重建数据库必须先完成备份、恢复校验并取得明确授权。
4. 确定性基础数据使用稳定主键和 `ON CONFLICT`，确保多机初始化结果一致。

## 内置小说资料规格

`003_novel_card_catalog.sql` 将系统目录收敛为 19 种已发布核心类型：人物、组织／势力、地点、道具、世界规则、事件、目标／任务、冲突、秘密／真相、线索／证据、伏笔、悬念／问题、剧情线、剧情节点／节拍、弧线／变化线、主题／命题、卷、章节和场景。`008_card_type_categories.sql` 在不修改这 19 种类型及既有书籍快照的前提下，新增题材策略、推进模式、写法配置、质量规则、世界总览、能力／科技／修炼体系、种族、文化、宗教和参考资料，使小说资料目录达到 29 种类型；`010_prompt_components.sql` 另加 1 种 AI 资源类型，`014_market_radar.sql` 再加 1 种研究资源类型，系统定义总数为 31，但后两者都不会进入书籍模板。

迁移会为“通用长篇小说模板”发布一个新的不可变版本，把 29 种类型纳入后续新书；旧模板版本、旧书的 19 类型快照和《照骨山河》样例均保持原状。

秘密／真相保存作者侧唯一答案；线索／证据保存人物在故事内可发现的信息；悬念／问题保存读者等待回答的信息差；伏笔保存作者提前布置并计划回收的叙事动作。目标、冲突、剧情线、事件、场景、剧情节点和弧线也分别承担完成条件、持续对抗、跨事件因果链、世界内发生事实、具体时空行动、结构作用和跨阶段变化，不能互相替代。

关系、人物当前情绪／位置／伤势、道具当前持有者、事件时间、局部章节目标、字典选项、正文版本、AI 评价、任务日志、提示词、时间线和关系图不是独立核心卡片；它们应由关系、挂载、字段、版本或视图能力承载。

同时提供 4 张可直接修改的起步卡片：新书创作约定、核心故事构思、主世界观、主线时间规则。它们使用稳定 UUID，迁移通过 `ON CONFLICT` 保持幂等；已存在的同 ID 数据不会被启动过程反复插入。

`004_xianxia_production_demo.sql` 提供原创项目《照骨山河》的 55 张生产样例；`006_template_books.sql` 将这些卡片安装到真实的“照骨山河”书籍空间，并移除卡片标题里重复的书名前缀。样例覆盖全部 19 类核心卡片，并把第一卷前八章和第一章五个场景填到可直接进入正文生产的粒度。来源分析、原创边界和逐类数量见 `xianxia-production-demo.md`。

> 🏠 **白话比喻**：迁移 SQL 像随工具箱附带的标准空白表和四张填写示例。对应到数据库里：新机器拉取仓库后能得到同一套类型与示例，但作者后来填写的真实内容仍需要数据库备份来搬家。

> 🧠 **速记方法**：Git 同步“表格模板”，数据库备份同步“已经填过的表格”。前者由迁移负责，后者不能靠复制运行中的数据目录。
