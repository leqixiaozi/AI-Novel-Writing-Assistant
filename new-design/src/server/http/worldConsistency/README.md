# 世界一致性 HTTP 边界

`worldConsistencyRouter()` 只暴露 `application/worldConsistency` façade。根负责在中央 router 挂载；HTTP 不能传执行器、连接、凭据、模型覆盖或基础设施 pool。

> 白话比喻：路由是窗口接件员，核对小票和材料格式，不冒充档案员改正本。对应到 HTTP：只有明确 POST 才执行该来源动作，GET 只读原请求，空查询不证明没有提交或没有模型调用。

> 速记方法：入口校格式、领域校原件、GET 不下结论、未知查原键。

路径前缀 `/books/:bookId/world-consistency`；书、原请求、候选、原键必须严格 UUID。`runs` 只接 common `WorldConsistencyInput`：完整原键、目录 hash、精确资料／关系 UUID 及可选原问题 UUID。没有执行覆盖字段。

- GET `workspace`、`by-key/:key`、`runs/:id`：原目录或原请求，只读。
- POST `runs`：同键同完整输入只返回既有原回执；只有真首次领取胜者执行一次原模型。
- POST `runs/:id/import-saved`：只导入原已保存模型回复；来源变更或原领取过期不创建当前问题。
- POST `runs/:id/release-saved`：保留原回复与用量，结束本次报告导入，不判检查通过。
- POST `runs/:id/end-expired-unknown`：原租约真正超期且没有已保存回复才显式结束，未知不变成未发送或零用量。
- GET `repairs/:id/draft`：原正式版本和字段规格匹配才提供同一表单草稿。
- GET `repairs/:id/normal-save-receipt`：只读真实正常保存凭证，不能因阴性制造保存证明。
- POST `repairs/:id/saved`：精确原正常保存键及登记键，可选明确 `allowManualRevision:true` 追加真实人工保存值的不可变原候选版；不接 after，不保存档案、不调用模型。完整输入／hash 保存在原 quality adoption，旧键不同输入拒绝。
- GET `repairs/:id/saved/by-key/:key`：只读原登记回执。

只有本次入口解析失败是中文 422；内部 Zod、数据库、模型回执错误不能冒充入口失败。GET 错误删除 mutationOutcome，不能以读取事务回滚为旧请求未写证明。初始准备只有原键／原任务确实不存在且提交未开始、回滚已确认的领域证明才可 `not_written`；其余未知保留原键与冻结输入。

恢复来源为本书世界维护，标签 `返回世界维护`。原运行记录 `source_route` 精确带 `?check=<原请求 UUID>`。当前仅编码／静态 review，未 HTTP 请求、测试、构建或迁移；中央注册与真实 guards 待整批统一验证。
