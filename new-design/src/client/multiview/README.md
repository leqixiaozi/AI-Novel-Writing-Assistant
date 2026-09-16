# 多维资料查看

本模块把本书正式资料投影为字典节点、分支、后代和标签维度列表。像用不同索引查同一本词典，索引改变，正文仍是同一份资料。判断规则：视图只筛选与分组，修改只交给统一本书表单。

`MultiviewAuthorPanel` 接收 `workspace`、`view`、`typeKeys`，由外层传 `onSelectCard` 和统一编辑器 `editor` 插槽。外层必须通过 `disabled` 锁定忙/未知保存状态，并传 `dirty` 与同步 `onPreserveDraft`；保存失败或草稿不能持久化时返回 false，面板禁止换选。编辑器应使用现有 DynamicForm 第三阶段 AI 辅助，而不是面板直接调用模型或创建正式事实。

实际挂载在 `BookViewsPage`，原章节、故事时间、线索、正式状态与质量专用区保留。统一 `BusinessFormWorkspace` 接收 `initialCardId?:string`、`embedded?:boolean`、`onEditorStateChange?:({dirty,locked,preserveDraft:()=>boolean})=>void`、`onSaved?:()=>Promise<void>`；同时消费本书资料 URL 的 strict selected UUID，核对实际 workspace.bookId/spaceId 和 card/type 后打开，不自动改选外书或失效资料。编辑器保存走 authorMaterials 新原请求凭证，首次 POST/PATCH 前保留 requestKey，重载仅 GET 原回执核对；保存成功后的来源刷新失败继续展示成功凭证。

查看状态使用按书籍隔离的版本化 sessionStorage，保留搜索、筛选模式、分组以及各视图选中资料。它像书签，记录翻到哪里，不是另一份小说资料。速记：条件能恢复，正文不复制。外层切换视图时必须先保留编辑器草稿；未知业务请求只读核对原凭证，不因切换视图生成新请求。

字典筛选精确绑定资料自身正式类型版本和字段，不能把旧版本同名字段混在一起。整条分支含自身；仅后代排除自身。同树所选节点为或，不同字段/标签维度为且。多值资料可显示在多个组，所有组仍引用同一个 cardId。当前筛选隐藏选中资料时保留原选中位置，不自动改选其他资料。

失败区使用实际内容类型/运行维护导航，返回来源后只读刷新；导航不提交保存或重发 AI。页面视觉验收由用户完成。阶段测试仅编写，待全部剩余功能编码完成后统一执行。
