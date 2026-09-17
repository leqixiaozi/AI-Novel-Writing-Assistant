# 世界一致性应用 façade

协调原正式来源冻结、专属 PromptAsset、原 managed 模型快照、单次原 task/attempt、原质量账本及原表单保存证明。调用入口 `runWorldConsistency`；基础设施 `ExecutionDependencies` 仅服务器测试注入，HTTP 不能传 provider、凭据、endpoint、输出或执行替代。

> 白话比喻：应用层像会审主持人，只安排检查、留存回执、回原档案修复；不会把会审建议直接盖成正式档案。对应到代码：模型没有写资料权限，修复 façade 只返回草稿，原 authorMaterials 才保存。

> 速记方法：主持不改正本，模型不签采用；读回执不重跑。

读 workspace/by-key/result/repair draft/normal-save receipt/adoption receipt 均不执行模型。import-saved 仅导入精确旧回复；release-saved 保留已知旧回复结束导入；end-expired-unknown 只结束真实超期未知尝试。

公共 DTO：`common/worldConsistency`；HTTP：`http/worldConsistency`；详细原事实、失效和极端恢复边界见 `database/worldConsistency/README.md`。已编码，未运行验证。
