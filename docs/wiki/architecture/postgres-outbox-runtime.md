# PostgreSQL Outbox 与后台运行边界

## 长期结论

新设计使用唯一 PostgreSQL 同时提交业务记录与 Outbox 事件。Outbox 是交接信封，不是事实正本；通用 job 是调度单，不复制专业 request 的冻结输入。系统采用至少一次投递，所有业务副作用必须通过专业账本的版本、哈希和幂等键再次确认。

> 🏠 **白话比喻**：盖章合同是业务原件，桌边待寄箱是 Outbox，快递单是 job。合同和信一起交给前台，快递可以重复派送，但收件部门要按单号避免重复入账。对应到系统：PostgreSQL 保证原件与事件原子提交，inbox 与专业结果幂等负责防止重复副作用。

> 🧠 **速记方法**：**同库同事务，至少投一次；通用只调度，专业来入账**。

## 不可破坏的边界

- topic、版本、handler 和专业 request kind 必须来自服务端注册表，不能从客户端接收 SQL、命令、模块路径或脚本。
- 026—029 与 024 继续保存各自业务状态，030 只能引用它们，不能另建正文、向量、图关系、附件派生或 AI 结果正本。
- 领取必须使用数据库行锁和 `SKIP LOCKED`；每次领取生成新 attempt、随机租约 token 摘要和递增 fencing token。
- 迟到 worker 即使知道旧 token，也不能在 fence 落后或租约过期时 complete、fail、heartbeat 或保存 checkpoint。
- 重试追加新 attempt；死信重放追加新事件和新 job generation。任何恢复动作都不能删除或改写旧历史。
- payload、checkpoint 和结果元数据只保存小型引用，不保存正文、向量、二进制、提示词正文或密钥。
- 按书查询和运维动作必须保持 book scope；消费者全局开关属于受限运维能力。

## 运行器边界

运行器显式启动和停止，导入模块不产生后台循环。当前 handler 注册表只是白名单和参数合同，真实 AGE、Embedding、附件、AI 与备份处理器必须在后续批次逐个接入，并继续以专业账本作为最终提交闸门。

完整字段与 Release Gate 见 [`new-design/docs/outbox-runtime.md`](../../../new-design/docs/outbox-runtime.md)。
