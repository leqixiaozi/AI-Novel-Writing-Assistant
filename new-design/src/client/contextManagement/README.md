# 上下文作者输入与原请求核对

运行前确认页读取作者实际选择的已发布 `TaskContractVersion.inputSchema`，使用中文文本、数字、布尔、列表与对象控件；不根据字段英文键猜业务、不修改发布合同、不自动填默认值。固定输入只读核对，未匹配时保持阻断。缺中文 label 使用编号，精确技术路径在折叠高级区核对；对象引用、组合条件和未实现规格不冒充自由文本能力。

> 白话比喻：表单像按正式订单填写收货单，原请求凭证像收银小票。对应到代码：字段来自发布版本，提交前保存原输入、预览标识及同一个请求键；通信中断后按原小票查收银记录，不再付一次钱。
>
> 速记：先存凭证，再发请求；未知只查，不换键。回执为空不是“没付款”的证明。

`common/contextRunInput` 为前后端同一个安全解释／校验入口。未支持的 schema、未知历史字段、无效原 JSON 均保留，不截断或清空后运行。高级 JSON／检查点仍折叠保留，修改 JSON 不会绕过运行阻断。普通章来源从章节业务入口准备，不猜检查点中的正文／修订标识。

页面使用按 book scope 隔离的 sessionStorage 原凭证；未知时输入、任务、预算、预览提交及换书保持锁定。只调用 `getAiRunPreviewByRequest` 或 `getAiRunSubmissionByRequest` 只读核对；GET null、读取失败、存储凭证异常不解锁新请求。原链先冻结上下文／路由再写预览、先创建任务再记录提交，存在多段事务；任一写入后失败统一说明结果未知，不能把某段 ROLLBACK 当成整链没有写入。只读 by-key 读取原 `ai_run_previews/ai_run_submissions`，同 client 映射分区与任务，不另建状态表或内容相等回执。

知识来源静态核查：真正 `dependency_resource_states.state` 枚举包含 `fresh/recomputed`；`loadKnowledgeReferenceContext` 输出完整引用文本及显式 truncated，但当前仅 facade 导出、没有模型消费者调用，不能宣称 mount 自动注入。实际模型消费者是提示词组合 explicit 精确源冻结与统一表单 AI 显式知识提炼；它们独立重新核对源版本、hash、状态并保留完整正文。没有新增自动 RAG、语义检索执行器或新事实副本。

冻结预览通过同 reader 读取原 `taskContractVersionId` 精确版本及其配方对应的 input schema，不使用当前发布版本替代。`AiRunPreview.inputSchema` 可选仅为旧读取兼容；缺失、尚不支持或输入不匹配时，前端及提交创建任务前的服务端同 validator 均阻止执行。旧 ready 预览不能绕过新表单规则；历史已提交回执仍可只读查询。

7 项 `context-run-input.unit.test.cjs` 仅编写。中央 `getAiRunPreviewByRequest/getAiRunSubmissionByRequest` 与对应本书只读 HTTP 源码已静态核对接线；未运行测试／typecheck／构建／HTTP／迁移／模型，实际恢复与多主题／窄屏体验待最终统一验证。
