# 世界一致性检查与原资料修复

入口本书“世界维护”，原模块 `client/worldCharacterMaintenance` → `client/worldConsistency`。领域合同在 `common/worldConsistency`，执行和存储在 `application/worldConsistency` 与 `database/worldConsistency`，问题唯一正本仍是 `qualityAudits`。

> 白话比喻：先拿原档案的带日期复印件检查，发现问题回同一档案窗口办理更正，再拿新日期原件复查。对应到系统：冻结精确资料／关系／规格／字典版本，候选只入原表单草稿，原保存凭证证明修复，原质量报告记录复查。

> 速记方法：冻结不猜用途，候选不改事实，保存核原凭证，复查覆盖原证据。

077 增加原 quality 的资料绑定／字段证据／卡片修复采用与材料复查形状，新增 request 仅技术证据；080 与中央 task/Prompt 注册由根负责。旧正文门禁保留。资料及关系、真实规格、字典源变化时报告 stale，不据历史报告判当前世界通过；无变化不写失效历史。

复查必须正式修复已记录、全补丁完成、覆盖原问题全部证据，当前模型结果与原成功 attempt 冻结一致；局部质量债不会停止全书。未知原请求只读核对；已存回复可显式原结果导入或保留结束，超期未知可明确终止并保留未知用量，绝不自动重新调用。

限制和真实恢复缺口见 [数据库边界](../../src/server/database/worldConsistency/README.md)。本任务已编写 unit／隔离 PG 用例，尚未执行；静态 review 不等于门禁或模型验收。
