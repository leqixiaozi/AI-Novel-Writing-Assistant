# Windows 私有 PostgreSQL 运行时手册

## 交付状态

本批建立了 Windows x64 私有运行包、启停、诊断、备份入口和升级／恢复维护边界。运行时不会下载组件，不扫描系统 `PATH` 或注册表，也不接受系统数据库连接串。

当前仓库依赖中只有 PostgreSQL 17.6 与 `pg_trgm`，没有已经验收的 PG17 `age.dll`、`vector.dll` 和完整许可证输入，因此**尚未装配合格的 `runtime-package`**。缺少任一文件或 SHA-256 不一致时，`start` 必须失败关闭，不能假装启动成功。

> 🏠 **白话比喻**：运行包像一只封条完好的工具箱，manifest 是逐件点名的装箱单。少一把扳手或封条编号不对，就不开工；不会临时去邻居家借一把来源不明的工具。对应到系统：只信任固定目录和逐文件哈希，不回退到机器上碰巧安装的 PostgreSQL。

> 🧠 **速记方法**：**先验箱、再验地、后起库；少一件就停，不向系统借。**

## 锁定组合

| 组件 | 锁定版本 | 发布输入 |
|---|---:|---|
| 应用 | 0.1.0 | server/client 编译产物与 001—043 SQL |
| Node.js | 24.19.0 | `bin/node.exe`，仅用于固定 CLI 入口 |
| PostgreSQL | 17.6 | `@embedded-postgres/windows-x64@17.6.0-beta.15` 的受控输入 |
| Apache AGE | 1.6.0 / PG17 | `PG17/v1.6.0-rc0` 对应发布输入 |
| pgvector | 0.8.6 / PG17 | `v0.8.6` 对应发布输入 |
| pg_trgm | 1.6 / PG17 | PostgreSQL contrib |
| bsdtar/libarchive | 3.7.7 | 固定归档执行器 |

AGE 的 PG17 1.6.0 发布说明明确没有升级脚本，因此不能把 AGE 原地升级当作默认方案；版本变化必须走新世代 staging 与重建验证。pgvector 0.8.6 和 PG17 构建依据以其官方仓库为准。参考：[Apache AGE Releases](https://github.com/apache/age/releases)、[pgvector CHANGELOG](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md)、[PostgreSQL 17 pg_trgm](https://www.postgresql.org/docs/17/pgtrgm.html)。

## 最终安装包结构

```text
runtime-package/
├─ runtime-manifest.json
├─ bin/                 node、postgres、initdb、pg_ctl、pg_isready、pg_dump、pg_restore、psql、bsdtar
├─ lib/                 PostgreSQL 依赖 DLL、age.dll、vector.dll
├─ share/extension/     AGE、vector、pg_trgm control 与 SQL
├─ licenses/            全部许可证与 NOTICE
└─ app/
   ├─ server/           编译后的服务端与 runtime/cli.js
   ├─ client/           客户端静态产物
   ├─ scripts/          start/stop/status/doctor/backup/upgrade PowerShell 入口
   └─ migrations/       连续的 001—043
```

发布阶段使用 `node scripts/assemble-runtime.cjs --source-root <受控目录> --source-manifest <清单> --output-root <空目录>`。assembler 只复制 source manifest 白名单文件，核对组件组合、大小、SHA-256、路径、许可证和迁移连续性；输出目录非空时拒绝覆盖。

## 用户数据目录

安装程序目录只放可替换的程序。数据位于宿主提供的 `AI_NOVEL_APP_DATA_DIR/new-design`，桌面宿主未提供时使用 `%LOCALAPPDATA%/AI-Novel-Writing-Assistant-v2/new-design`：

```text
new-design/
├─ bootstrap/           带格式版本和 checksum 的本机状态
├─ credentials/         随机数据库用户、库名和口令；收紧 Windows ACL
├─ locks/               单实例管理锁
├─ database/generations/每次升级／恢复使用独立数据世代
├─ attachments/         受管附件正本
├─ backups/             已完成备份产物
├─ imports/             隔离导入输入
├─ logs/                轮转、脱敏日志
└─ runtime/             仅短期 passfile 等临时文件
```

覆盖安装和默认卸载都不得删除该目录。数据库、附件和备份必须分别管理；不能复制运行中的数据目录当作跨机器备份。

## 脚本入口

在最终包的 `app/scripts` 下运行：

```powershell
.\start.ps1
.\stop.ps1
.\status.ps1 -Json
.\doctor.ps1
.\backup.ps1
.\upgrade.ps1 -Plan
```

公共输出支持 `-Json`、`-Plain` 或 `-Quiet`，三者互斥。脚本不接受 data dir、端口、SQL、外部程序或任意命令。`upgrade -Plan` 只读取固定的同级 `runtime-package.next`；真正升级还要求本机确认摘要、031 完整备份、`full_restore` dry-run 和宿主维护执行器。当前执行器未接入时明确返回不可用，并保留旧程序、旧数据和备份。

`start.ps1` 负责私有数据库、扩展和迁移就绪；桌面宿主还必须用 `startNewDesignRuntimeServices(handlers)` 注册并持有 030 runner 生命周期。没有加载任何 handler 时该入口拒绝把“完整应用运行时”标记为 ready；这项宿主接线仍需随最终桌面包做动态验收。

退出码：`0` 成功、`2` 用法错误、`3` 运行包或执行器不可用、`4` 本机确认失败、`5` 状态冲突、`6` 其他运行错误。

## 启停与恢复规则

启动顺序是：互斥锁 → manifest/逐文件哈希 → 目录与磁盘 → 随机凭据和 ACL → `initdb` → 本机 SCRAM → `pg_ctl` → PID/start time/data dir/instance token → `pg_isready` → AGE/vector/pg_trgm → 001—043 → 030 runner。任一步失败都不得继续可写。

停止先把 worker 标为 draining 并归还租约，再关闭连接池，最后 `pg_ctl ... -m fast`。只有运行实例 token、数据世代、PID、启动时间与 `postmaster.pid` 全部一致时才执行；陈旧 PID 不会触发 `kill`。

整库恢复没有普通 HTTP 接口。维护执行器必须按“停写与排空 → 新 staging 恢复数据库和附件 → manifest/checksum/schema 校验 → 重建 AGE/pgvector → 原子切换 → 重启”执行，失败调用旧世代回滚。数据库自动降级不支持。

## 已完成的静态审查

| 项目 | 状态 |
|---|---|
| TypeScript server/client `--noEmit` | 已执行 |
| runtime/source manifest JSON 结构与版本锁 | 已审查 |
| 001—043 连续性、调用链、固定路径与参数白名单 | 已审查 |
| PID/start time/data dir/instance token 防误杀 | 已审查 |
| 凭据不进入 API、manifest、URL 和命令行 | 已审查 |
| PowerShell 与 Node 脚本静态语法 | 已执行 |
| `git diff --check` 与文档一致性 | 已执行 |

## Release Gate：尚未动态验证

发布前必须逐项完成：干净 Windows x64 离线安装与完整二进制/许可证装配；安装器／运行包代码签名和本地篡改模型；首次 `initdb`；随机凭据 ACL 的最小读取权限；本机监听和端口冲突；AGE/vector/pg_trgm 创建与 `LOAD`；001—043 实库迁移；启动、停止、异常退出、重复启动和错误 PID 防误杀；030 runner 租约恢复与停机排空；031 数据库＋附件联合备份和恢复；同主版本与跨主版本升级及失败回滚；覆盖安装和卸载保留数据；长路径、中文用户目录、杀毒与受限权限；磁盘不足；大书性能；安全与日志脱敏。
