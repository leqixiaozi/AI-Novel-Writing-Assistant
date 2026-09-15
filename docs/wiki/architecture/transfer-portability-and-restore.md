# 可移植传输与恢复边界

## 背景

小说资料会在多台机器之间开发。只同步 Git 能得到结构和内置数据，不能得到作者填写的 PostgreSQL 数据；只复制数据库又会漏掉受管附件。更危险的是直接把外来包覆盖当前目录，一次损坏就可能同时丢掉旧数据和导入数据。

## 决策

完整备份的唯一口径是“PostgreSQL 逻辑数据 + 受管附件 + manifest”。所有导入和恢复先 dry-run，再进入全新 staging，通过校验后显式发布。AGE、pgvector、缓存和运行队列属于可重建派生层。

> 🏠 **白话比喻**：这套流程像海关入境。包裹先在检查区拆箱、核对清单和处理重名，不能从货车直接倒进家里的柜子。对应到系统：dry-run 是查验，staging 是隔离仓，publish 才是正式入库。

> 🧠 **速记方法**：**先验包，再解冲突；新仓落地，验完切换**。

## 当前规则

- 复用 PostgreSQL Outbox 与 `backup.run`，不建立平行队列。
- 客户端只提交上传票据和固定 profile，不提交路径、命令、环境、表名或工具参数。
- 单书提供 `compact_continue` 与 `full_audit`；模板和资源用稳定 key/version 跨机器映射。
- 未知格式、未知必需能力和不可用验证均失败关闭。
- 整库恢复没有普通路由，只允许本机维护模式的高权限合同。
- 包路径必须是安全相对路径，符号链接、重解析点、大小写碰撞与压缩炸弹一律拒绝。
- SHA-256 只校验完整性，不能代替加密和访问控制。
- 失败或取消会废弃 staging，不能覆盖当前数据库或附件。

## 示例

- 推荐：先导出 `compact_continue`，在另一台机器上传后查看 dry-run 冲突，再明确确认导入。
- 禁止：把 `C:\作品\data`、`../../data`、数据库连接串或 `pg_restore` 参数放进 API 请求或 manifest。
- 推荐：目标机器缺少包声明的 capability 时停止，升级程序注册后再重新预检。

## 失败模式

- 只同步 Git：能看到表结构，实际作品内容缺失。
- 只复制运行目录：数据库与附件一致性未知，运行中复制还可能得到半套快照。
- 校验和正确但内容泄露：说明误把完整性当成保密性，应检查存储权限和加密边界。
- dry-run 通过但直接覆盖当前目录：违反 staging 发布合同，必须阻止上线。
- 后台显示成功但没有 ready manifest/package：作业完成门禁不完整，不能生成成功回执。

## 相关模块

- `new-design/migrations/031_transfer_backup_import_export.sql`
- `new-design/src/server/transfers/`
- `new-design/src/server/database/outbox/`
- `new-design/docs/transfer-backup-import-export.md`

## 来源文档

- 备份、恢复与可移植导入导出：`../../../new-design/docs/transfer-backup-import-export.md`
