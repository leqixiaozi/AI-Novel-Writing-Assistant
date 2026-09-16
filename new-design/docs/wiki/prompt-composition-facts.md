# 提示词组合、冻结预览与独立试运行事实

## 当前闭环

本功能只属于 `new-design/`：编辑组合 → 原子保存并启用 → 明确选择现有书籍及精确资料 → 查看完整受控请求 → 明确试运行 → 查看单次结果与恢复入口。旧项目只能作为阅读参考，不导入或调用旧实现。

组合不是新的作者资料类型。它复用新设计已有的配方、版本、槽位、组件引用、合同、上下文、模型快照、预览和 AiTask 账本。试运行结果不会创建或更新作者资料、正式规划、章节正文、采用记录或稳定事实；本轮没有“采用试运行结果”的隐式副作用。

## 配方保存与版本

`prompt_recipes` 保持唯一配方身份，`prompt_recipe_versions` 保存不可变版本，`prompt_recipe_slot_components` 引用组件精确 `cardId + versionId`，不把组件正文另建一份资源。新增引用 `enabled` 为不可变作者选择，旧行默认 true，不改旧正文。

> 🏠 白话比喻：配方像一张签字的菜谱，组件像指定批次的食材。对应到数据库：菜谱版本引用指定组件版本，换菜谱或食材必须保存新版本，不能改掉已经签字的历史。

> 🧠 速记方法：身份不变，版本新增；引用认精确批次，不认“现在最新”。

受控元数据位于版本 `variables_schema.x-new-design-composition`：格式版本、六任务键、中文变量标签/类型/默认值、明确书籍和资料来源、该版本名称与用途。变量 JSON Schema 真实表达已声明变量；稳定键拒绝系统保留名称，选择项不得重复，默认值必须符合类型。普通组件槽位为 `author_additions`，书内资料槽位为 `explicit_context`，二者都可为空。

目录会识别元数据、变量规格与槽位合同。包含未知旧配置的历史版本标记 `editable=false`，解释原因，禁止静默覆盖；原版本保持不变。

保存修订检查、范围锁、版本写入、引用写入、发布指针切换和发布回执在同一事务。请求键以完整校验输入哈希严格比较：同键同内容返回原版本；同键不同内容 409；迟到回执的 `active` 表示原版本当前是否仍启用，不会再次启用旧版本。

> 🏠 白话比喻：保存收据像快递单号，网络断开后查同一单号即可。对应到系统：`readCompositionSaveByRequest` 按原发布回执查询精确版本，不从目录猜新建 ID，也不再追加一版。

> 🧠 速记方法：丢回执先查原键，不确定时不重建请求。按键读取与写入共用事务锁，等待正在提交的原操作完成。

## 组件信任和明确上下文

组件必须属于提示词资源空间、类型 `prompt_component`、身份仍 active、精确版本真实属于该组件。启用的引用还要求其版本 `enabled=true`，任务适用范围与当前明确任务相符；空范围表示允许全部受控任务，不按文本关键词猜业务。停用引用留在版本里但不进入发送内容。

组件中的 `trust_level` 只作为资源元数据，不能授予系统指令权限。受控 PromptAsset 固定系统合同与动态输出 Schema，作者组件、变量、参考文本和选中资料都作为 user 数据补充；组件自称 system 也不会成为 system 消息。

> 🏠 白话比喻：门卫规则由物业签发，住户留言不能因为写了“物业命令”就变成门禁。对应到 AI：代码受控资产决定系统合同，普通组件始终是权限较低的用户补充数据。

> 🧠 速记方法：信任看来源授权，不看正文自称；数据不能自我升级成指令。

上下文必须明确选择已存在、active 的书籍，选中来源必须为该书空间内 active 资料的精确版本。不存在的书、跨书资料、归档资料、版本不属于身份均拒绝。保存/预览不自动扫描全书，也不因分类移动重解释引用。来源列表最多返回 200 项，并明确 `truncated`；当前精确版本 ID 与资料值由服务端读取。

`context_manifests` 与 entries 冻结实际书籍、任务合同、配方版本、精确来源、内容哈希、formal/reference 角色。formal 是作者明确采用的内容角色，不提升为系统指令。组件和书内资料分槽留痕。

## 真实合同和预览冻结

六任务固定为 directions、initial_content、form_assist、market_analysis、book_analysis、planning_candidate。服务端依据真实书籍/类型/字段/字典/榜单事实构建任务输入，并交受控 PromptAsset 严格验证；浏览器不能提交原始 taskInput、系统消息或输出 Schema。

本次已验证输入使用 JSON Schema `{type:'object', const:taskInput}` 真值冻结，不是空对象占位合同。输出规格来自对应受控资产的动态真实 Schema。任务合同身份为 `prompt_composition_<recipeId>_<taskType>`，沿用 `task_contracts` 与版本/发布回执，按真实输入和输出合同内容发布版本。

> 🏠 白话比喻：预览像寄件前拍照封箱，照片记录实际物品和包装说明。对应到请求：完整 messages、真实输入/输出规格、资产 ID/版本、变量、精确引用、上下文和模型版本都被冻结，不能拿之后的新配置冒充当时的箱子。

> 🧠 速记方法：先验输入，再冻合同，再封请求，最后执行。

完整冻结份保存在既有 `ai_run_previews.prompt_plan`，真实任务输入在 `input_snapshot`，二者及全部冻结引用纳入预览哈希。`readDebugPreviewByRequest` 支持丢失新建 ID 后用原请求键只读核对；同键不同原输入拒绝。

迁移 053 仅对 `source_kind='prompt_composition_debug'` 放宽 context_preview_id 和 model_route_snapshot_id 的非空要求。缺少默认模型或凭据时，仍保存真实合同和明确上下文，预览状态 blocked，可查看完整内容，但不能试运行。非 debug 旧范围维持两字段非空，debug ready 必须有模型快照，所有旧行保留。

ready 模型快照复用 `model_route_snapshots`，引用实际书籍与精确任务合同版本；该范围 `managed_task_key=NULL`。模型来源重建真实历史默认/任务版本、比较路由内容后，在同一预览事务写入快照和备用模型引用。不借环境模型、不改变作者模型设置。

## 单次运行与结果账本

`claimDebugRun` 锁定预览及请求键，检查预期 revision 和 ready 状态，同一事务创建既有 AiTask / step / attempt / event / submission，并将预览 CAS 到 submitted。一个预览只有一次领取、一个 initial attempt、max_attempts=1；相同领取回执返回 priorResult，不再次调用模型；不同请求键或内容 409。

调用前核对冻结哈希、真实输入、合同 Schema、精确配方/组件/资料、manifest 内容哈希和同范围模型快照。主执行入口还重建代码受控 PromptAsset，核对 messages/schema/metadata 完全一致才允许发送。当前发布指针变化不代替本次冻结版本；精确来源已归档则必须重新选择并预览。

> 🏠 白话比喻：试运行票像一次性检票码，刷新页面是在查询检票结果，不是再发一张票。对应到账本：submission 与预览唯一关联，同一请求重复只能读取原运行状态或结果。

> 🧠 速记方法：领取一次，查询多次；新实验必须明确生成新预览。

结果保存在 attempt 的 debug_result，真实调用元数据在 debug_execution，失败位置/保留结果/入口在 debug_failure。终止 attempt、step、task、追加状态 events 和 usage 共用一个事务；返回结果在该事务内读取，后续无关 GET 失败不重新解释已提交成功。

成功必须带结果和执行元数据，失败必须带恢复信息，均只能 running → terminal 单次写入。旧普通任务的状态规则及 finished immutable / delete / append-only 防护保留，普通任务不能写 debug 字段。调试取消/丢弃若由旧明确控制路径触发，也必须带失败说明，不能静默清空结果或自动再次请求；本页只提供成功/失败终止，不提供自动恢复模型执行。

分项 token 上游未报告时 input_tokens / output_tokens 保持 NULL，total/knownTokens 不冒充任何分项。成本/币种未测量时保持 NULL；fallback provider/model 与实际 trace 保存，不能把首选路由当备用调用。调用前失败执行元数据为 NULL，usage provider/model 标为 not_invoked，分项 token/cost NULL，不声称已经发送模型。预算 unknown 不等于零花费或已确认在预算内。

## 失败后在哪里恢复

| 情况 | 留下什么 | 实际恢复入口 |
| --- | --- | --- |
| 保存/预览回执丢失 | 旧版本、当前输入与原请求键 | 按原请求核对服务器结果；未核对前不新建请求 |
| 默认模型/凭据未配置 | blocked 真实合同、完整消息、精确上下文 | 打开模型设置；保存并启用后回组合页生成新预览 |
| 快照/底座故障 | 已保存组合、未发送的输入或冻结旧预览 | 打开运行维护；恢复后回来源页核对 |
| 已领取仍 running | 原预览、合同、上下文、领取账本 | 返回提示词组合并读取试运行结果；不自动重发 |
| 模型/结构失败 | failedStep、失败回复状态、trace/未知计量、正本不变 | 保留合法模型设置/运行维护入口，其他返回原 previewId 组合页 |
| 结果入库未确认 | 原运行标识、旧预览；模型可能已经结束 | 先读取原结果，禁止把数据库失败当模型失败再次调用 |

进程中断后 running 记录不伪装 succeeded/failed，也不自动重试。界面明确提示查询原结果；确认旧运行后，作者可以明确新建预览进行另一场实验。模型配置恢复入口只接受固定 models/maintenance 路由和匹配中文标签，其他恢复固定回组合页，不接受任意导航地址。

## 职责文件和接口

`server/database/promptComposition/` 对外 facade：getCompositionCatalog、getCompositionSources、saveComposition、readCompositionSaveByRequest、loadCompositionRecipeVersion、saveDebugPreview、readDebugPreview、readDebugPreviewByRequest、claimDebugRun、finishDebugRun、readDebugResult。合法新预览无 submission 时 readDebugResult 返回 null，而非页面加载失败。

生产由模块管理 BEGIN/COMMIT/ROLLBACK；内部注入 client 时调用方拥有事务边界，必须负责事务与错误回滚。内部隔离 schema 必须符合 model_route_test_* 且有注入客户端，HTTP 不接受 schema 参数。

`tests/prompt-composition.postgres.test.cjs` 只在唯一隔离 schema 建立新的空结构和夹具，LIKE INCLUDING ALL 不复制生产行；显式建立必要外键、唯一性和完整生产 guard 函数/触发器，函数 lookup 也改到隔离 namespace。试验默认路由只属于夹具，作者默认身份/版本/修订前后只读比对。夹具保留归档，不执行 drop/delete/truncate，删除覆盖仅只读检查触发器事件和函数拒绝分支，不声称实际执行删除验收；不可变 UPDATE 用 savepoint 验证并回滚。

PG 用例证明事务和门禁，不表示真实模型调用、模型质量或 UI 验收。类型检查、单元／PG／HTTP、真实模型和用户操作必须分别报告；实际阶段证据见 [组合验证](../prompt-composition-review.md)。

关联：[受控 PromptAsset](controlled-prompt-assets.md)、[模型路由事实](model-route-persistence.md)。
