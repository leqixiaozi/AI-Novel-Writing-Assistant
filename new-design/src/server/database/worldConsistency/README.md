# 世界一致性：原事实与质量账本

只读正式档案、不可变资料版本、本书字段扩展、正式关系版本及真实字典树；问题、证据、修复候选、采用和复查仍写原 `qualityAudits` 账本。`world_consistency_requests` 只保存技术冻结、原请求、真实执行与回复，不是问题或正文正本。077 是新增迁移，本文不代表已应用。

> 白话比喻：检查像拿档案柜里的原件复印件进行会审；问题写原检查单，修改仍回原档案柜。对应到代码：版本与字段哈希冻结来源，资料只经原 authorMaterials 正常保存，质量问题没有第二套存储。

> 速记方法：先冻结、再检查、候选进草稿、正常保存、核对凭证、覆盖原证据复查。

## 导出边界

应用 façade 在 `application/worldConsistency`，HTTP 模块 `http/worldConsistency`。读写使用同一新设计池；`withWorldConsistencyPool` 仅基础设施隔离，不暴露给 HTTP。原问题 getter 可在同一客户端只读事务读取，避免跨库或读到另一快照。

领取同原键完整 hash 后仅首次 winner 执行模型；已有请求只读原回执。专属 asset `new_design.world.consistency@v1`，专属 task `world_consistency`。拒绝自动重试与备用路线，不借组合合同或其他任务模型证明配置。真实默认及任务模型版本冻结在原 model snapshot；配置不等于模型验收。

证据必须真实 kind/id/version/field/spec/hash/valueHash；关系规格没有独立版本时明确 specVersionId=null，以真实完整规格 hash 冻结。按作者选择，不按英文字段键猜用途。修复限本次可编辑／可建议／可见的正式资料字段，不能改正文、关系事实或结算状态。字典 UUID、分支、深度、叶规则全部校验，不用同名选项替代。

## 修复和复查

原 candidate 精确基线 → 原 BusinessFormWorkspace 草稿（显式采用）→ 原正常保存 → 显式 `recordWorldRepairSaved`。验证真实 author write key、同书同卡、基线 revision+1、当前精确 card version、字段规格与实际修改值；相同AI修复值直接登记，人工改变值必须明确追加人工版。多个字段可进入同一草稿一次保存，逐候选核对同一真实回执；全部候选完成才 fixed。刷新后 `getWorldRepairNormalSaveReceipt` 仅查符合这些证明的真实原回执，不自动记录修复。

作者改变建议值时，正常保存仍在原表单完成。登记前须明确确认 `allowManualRevision:true`；sameTX 追加原 candidate 的 immutable `source=user/base_version_id=原AI版本`，保留原AI版，target／spec／before 不变，after 只取真实原正常保存回执，且不是未变化的前值。不接受客户端传 after 或借另一份资料凭证。GET 读正常保存凭证不等于采用或登记。

明确请求复查须 fixed，覆盖原问题全部对象／字段证据。输入冻结原问题版本、历史目录和原证据以及当前选中正式版本。`supports_verified` 不能同时有 findings，且同事务原问题仍 fixed 才记原 verified event；不是看见空列表就标通过。局部问题仅 completion_first/quality_debt，不全局阻断。

## 原请求恢复

- GET 只读原回执，不领取、不发送、不导入、不终止；阴性不证明未写或未调用。
- 原回复先单独保存，再同事务导入问题、原任务终态和原用量。导入失败保留原回复；作者可导入旧结果，不二次模型。
- 来源变化或原领取超期，不录入当前问题；迟到回复不能覆盖。已保存回复可显式保留并结束报告导入，不伪装未知、失败未发送或一致性通过。
- 真正超期且无已保存回复，可显式结束原尝试，保留未知发送／用量证据。费用缺价格不推测，未知 tokens 不填零。
- 只有初始纯准备事务同锁成功确认原 request 和原任务均不存在，且 COMMIT 未开始、ROLLBACK ACK，才返回 not_written。COMMIT 未确认、查询／锁失败、既有键冲突、模型及后续保存都 unknown。
- 修复登记另有专属纯DB证明：全局原登记 key 锁后成功确认原采用记录不存在，COMMIT 未开始且 ROLLBACK ACK，才标本次登记 not_written；明确原资料已正常保存而非模型未发送。原 `quality_fix_adoptions` 同事务保存完整登记输入／hash，既有不同输入永远 unknown。源页先 GET 精确原回执，作者确认后才按同原key／完整payload完成同一登记；GET 阴性不清键或自动重发，不再次保存资料或调用模型。
- 原凭证损坏／旧缺身份保持阻塞；维护入口仅导航，不承诺能查看或自动修复浏览器原存储。初始确已回滚但这个证明响应也丢失、GET 阴性且无 lease 时，当前没有安全自动解锁／重发入口。保留原键，不冒称全站恢复闭环。

> 白话比喻：原键像挂号小票；查不到小票不等于医生没接诊。对应到代码：只有精确成功回执或服务端明确事务证明才能作结论，不能因本次查询回滚就当原模型未发送。

> 速记方法：阴性不解锁；有回复不重算；超期不覆盖；修复不假采用。

卡片、关系、字段规格和字典树变化标原报告 stale；无实际变化不改历史。现上限整书目录300份资料／300条关系、5000字典节点；每次选择最多100份／100条，超过拒绝，不静默截断。冻结使用本书来源行 SHARE 锁，不加表级锁；并发锁顺序和触发链仍须统一真实 PG 验证。

原运行记录的来源精确带 `?check=<原请求 UUID>`；来源页单独只读核对该请求，即使当前资料目录不可读也不拿其他检查代替。原质量报告包含真实 `materialVersions`，原尝试结果版本是不可变报告 UUID，而不是提示词版本。数据库证据门禁同时校验本书原报告对象绑定、原已接收回复的字段／规格／前值；新证据形状明确要求字段非空，避免 PostgreSQL CHECK 的 NULL 结果被误当合格。

Manifest 的档案条目使用原依赖 resolver 的真实版本哈希，不用显示表单 hash 冒充它。原 legacy 关系依赖只能表示稳定关系对象，因此该条目诚实引用对象本身；不可变关系版本 UUID 和精确规格/值仍冻结在专属合同 const 与原报告 materialVersions，不能将 legacy 对象引用宣传为历史关系规格。实际来源变化继续标原报告 stale。

## 待统一验证

本任务只编码／静态 review，未安装、构建、类型检查、测试、HTTP GET、迁移或模型调用。中央 task/080/Prompt/API/router 与原 quality DTO 由根集成。用例已编写：`tests/world-consistency.unit.test.cjs`、`tests/world-consistency.postgres.test.cjs`；真实 PG guards、无重复调用、中文失败定位、正常表单修复、窄屏和全部主题尚未验收。模型回复在数据库保留前若连接失败仍只可核对／超期结束，不保证丢失进程内回复能重建；不会重调模型。
