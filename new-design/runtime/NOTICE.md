# 私有运行包第三方组件说明

最终 Windows x64 安装包必须携带下列组件及其完整许可证文本；assembler 缺少任一许可证文件会失败：

- PostgreSQL 17.6：PostgreSQL License。
- Apache AGE 1.6.0（PG17 分支）：Apache License 2.0。
- pgvector 0.8.6：PostgreSQL License。
- PostgreSQL `pg_trgm` 1.6：随 PostgreSQL contrib 分发，PostgreSQL License。
- bsdtar/libarchive 3.7.7：BSD 2-Clause；作为固定归档打包／解包器。
- Node.js 24.19.0：Node.js 项目许可证；只从运行包 `bin/node.exe` 启动固定 CLI，不回退系统 Node.js。
- `@embedded-postgres/windows-x64` 17.6.0-beta.15 装配工具包：MIT；其 PostgreSQL 主体仍遵循 PostgreSQL License。

本仓库没有提交大型数据库二进制。发布流水线必须从显式的本地 staging 输入和逐文件 source manifest 装配；不能在运行时下载，也不能从系统 PATH、注册表或已安装 PostgreSQL 中拼装。

默认迁移逐项匹配 `src/server/database/migrations.ts` 的81项正式注册（最后083，编号并非连续）。20项未注册手动迁移作为文件交付到 `app/migrations/manual/`，不计入启动清单，不自动执行；source manifest与运行包校验均拒绝缺项、错名、重复或把手动迁移放入默认目录。102人物倾向、103公共标题、104本书历史均默认关闭，不安装作者库。新增手动迁移时须同步两处锁定清单。该清单校验不代表完整Windows运行包已装配或启用。

截至本合同落库时，仓库依赖只含 PostgreSQL 与 `pg_trgm`，没有匹配 PostgreSQL 17 的 `age.dll` 和 `vector.dll`。因此当前不能生成合格运行包，启动检查必须失败关闭。
