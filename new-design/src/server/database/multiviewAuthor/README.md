# 多维只读正本投影

`getBookMultiviewAuthorWorkspace(bookId)` 复用 bookViewStore 的正式卡片版本字段、compositionStore 的字典正本、treeResources 标签维度及 materialManagement 已存在的标签成员关系。不新建事实、成员副本或迁移。

像图书馆目录把同一本书列在多个主题下，分类不能变成另一本书。技术上返回原 cardId/typeVersionId，分组仅在客户端投影。速记：读取正本、精确版本、编辑归表单。

HTTP facade `multiviewAuthorRouter()` 提供 `GET /books/:id/multiview-author-workspace`。根负责 API 与顶层挂载。本模块没有模型/写入/恢复执行路由；未知保存结果须回统一编辑器读取原请求回执，不在筛选面板重新保存。
