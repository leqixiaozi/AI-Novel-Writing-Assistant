# PostgreSQL Outbox 与后台作业运行契约

## 定位

`030_postgres_outbox_job_runtime.sql` 在新设计唯一的 PostgreSQL 中建立可靠交接和通用后台作业运行底座，不引入 Redis、RabbitMQ 或第二份业务正本。026 重算、027 附件派生、028 AGE 投影、029 分块／嵌入／索引和 024 AI 任务仍由各自专业表保存业务状态与冻结输入；030 只保存事件投递、调度、租约、尝试、检查点和执行回执。

> 🏠 **白话比喻**：业务表像办公室里盖章生效的原件，Outbox 像同一张办公桌上的待寄信件箱，job 像快递公司的派送单。盖章和放信必须一次完成，避免文件生效了却没人收到通知；快递单丢了可以重派，但不能拿快递单改原件。对应到系统：业务事务与 Outbox 同事务提交，专业业务表是真相，通用 job 只负责可靠交接。

> 🧠 **速记方法**：**原件和信同桌提交，投递至少一次，副作用靠幂等；租约会过期，旧票不能签收**。

## 数据分层

| 表 | 职责 |
|---|---|
| `outbox_event_topics` | 服务端允许的事件主题、版本和小型载荷合同 |
| `background_job_handlers` | 固定 handler、job kind、专业 request kind 与重试／租约上限 |
| `outbox_consumers` | 消费者注册、并发上限和暂停状态 |
| `outbox_aggregate_sequences` | 对书籍聚合分配单调序号 |
| `outbox_events` | 不可变事件信封、聚合身份、顺序、幂等、trace/correlation/causation |
| `background_jobs` | 调度状态、优先级、下次运行时间、租约、fencing token 和专业 request 引用 |
| `background_job_attempts` | 每次领取与执行历史；完成后不可变 |
| `background_job_checkpoints` | 只追加的小型恢复检查点，不复制正文或大对象 |
| `background_job_results` | 幂等执行回执与专业结果引用 |
| `outbox_inbox_receipts` | `(consumer,event)` 唯一去重回执 |
| `background_job_replays` | 死信／失败／取消后的人工重放，新建事件和 job generation |
| `background_job_book_pauses` | 按书暂停或恢复领取 |
| `background_job_archive_policies` | 终态与死信保留周期、每批归档上限 |

## 原子性与专业账本边界

专业 request 插入后由 PostgreSQL `AFTER INSERT` 触发器在同一事务写 Outbox 和通用 job；任一步失败会让整个事务回滚，因此不会出现“专业请求成功但事件丢失”。正常写入标记为 `domain_store`，升级 030 时为尚未完成的 024、026—029 请求补登记并标记为 `migration_bridge`，便于追查来源。

通用 job 只保存 `specialized_request_kind + specialized_request_id`。实际输入、业务状态与结果采用仍由专业账本处理：

- `dependency_recompute_request` → 026
- `asset_derivation` → 027
- `graph_projection_request` → 028
- `embedding_chunking_request / embedding_request / embedding_index_generation` → 029
- `ai_task` → 024
- `backup_request` 仅保留禁用注册项，必须等专业备份账本存在后才能启用

## 领取、租约与恢复

领取事务先锁消费者配置，再使用 `FOR UPDATE SKIP LOCKED` 选择一个到期 job。按书籍和 handler 的 ordering key 会阻止同类较新任务越过仍未终结的旧任务；不同 handler 可以并行。消费者并发数、租约时长、最大尝试数和指数退避上限均来自服务端注册表。

每次领取同时产生随机 lease token、数据库只存 token 摘要，并递增 fencing token。heartbeat、checkpoint、complete、fail、release 与取消确认必须同时匹配 job、attempt、fencing token、lease token 摘要和未过期租约。租约过期后会追加 `lease_expired` 尝试结果并重新排队；旧 worker 的迟到操作返回冲突，不会写入新租约。

> 🏠 **白话比喻**：租约像仓库临时发给搬运工的取货票，fencing token 是不断增大的票号。工人拿着昨天的旧票回来，即使姓名正确，门卫也会因为票号落后拒绝签收。对应到系统：随机 token 证明持票，递增 fence 阻止旧 worker 覆盖新 worker。

> 🧠 **速记方法**：**锁消费者、跳过已锁行、领新票、续心跳；票过期就重领，旧票永不补签**。

## 投递语义与安全

系统明确采用“至少一次投递 + 幂等业务提交”，不宣称数据库天然 exactly once。producer 幂等键防止重复事件；consumer inbox 防止同一消费者重复确认；专业 handler 仍必须使用自己的版本、哈希或结果幂等键提交副作用。死信重放会建立新事件和新 job，不修改旧尝试。

事件 topic、版本、handler 和专业 request kind 全部来自服务端注册表。前端没有 enqueue、claim、heartbeat、complete 或 fail 接口，只能按书查询健康度／事件／job，或执行已登记的取消、重试、死信重放、消费者暂停和书籍暂停。消费者与书籍暂停均使用 revision 乐观锁；首次书籍状态读取返回 revision `0`，创建状态后每次修改都必须带回刚读取的 revision。payload、checkpoint 和 result metadata 递归拒绝正文、向量、二进制、提示词、密钥、token 与密码字段，错误摘要会脱敏并限制长度。

## 显式运行器

`BackgroundJobRunner` 只有调用 `start()` 后才轮询，导入模块不会自动运行。运行器只执行进程内显式注册的 `BackgroundHandlerKey`；停止时先停止领取，再等待当前 handler 结束，未开始的活动租约可以归还。当前独立服务装入 `publication.export`、`graph.project`、只核对已结束来源的 `ai.task` 和 `dependency.recompute`。图投影首次请求会建立世代；处理中断按书籍锁核对后恢复，归档书籍的待处理来源标为 superseded。AI handler 只补原任务回执，不调用模型；依赖 `manual_review` handler 只结束后台执行，原业务请求保留待作者复核。备份适配器、Embedding 和资产 handler 仍未接通。数据库中消费者标记为 `active` 不等于进程已加载 handler；运行维护诊断会据此显示受限及等待处理器的作业数。

## 跨机器同步

030 SQL、类型契约和本文随 Git 同步。运行中的 Outbox、job、attempt、checkpoint、receipt 与 dead-letter 历史属于 PostgreSQL 数据，换机器时必须随数据库逻辑备份恢复；只拉代码不会带走积压任务。

## Release Gate

- 在真实 PostgreSQL 执行 030 迁移与未完成请求补登记。
- 并发验证 `FOR UPDATE SKIP LOCKED`、消费者并发上限、同聚合顺序和跨书隔离。
- 验证租约过期重领、fencing token、旧 worker 迟到 complete/fail/heartbeat 拒绝。
- 验证重复 producer 事件、重复领取、重复业务提交与 inbox/result 幂等。
- 验证指数退避、最大尝试、失败、死信、取消、消费者暂停、按书暂停和恢复。
- 做进程崩溃、重启、优雅停机、长队列性能、归档、数据库备份与恢复演练。
- 串联真实 AGE、Embedding、附件派生、AI 和未来 backup handler；当前只完成受控运行壳，不能写成已通过。
