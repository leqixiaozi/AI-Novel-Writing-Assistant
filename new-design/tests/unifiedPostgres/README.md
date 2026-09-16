# 统一验证的 PostgreSQL 隔离入口

## 为什么单独注入

生产开发 runtime 使用固定容器、固定端口、固定命名卷；仅改测试 schema、数据目录或 Compose project 不能保证不会启动或迁移作者开发库。这里的注入只属于 Node 测试进程，不改变生产启动路径。

> 白话比喻：不同文件夹像正式账本里的不同页，并不等于另一本账本。对应这里：随机 schema 只能隔离行与表，完整容器、数据目录和数据库身份才把测试与开发库隔开。

> 速记方法：容器、端口、库名、目录四重核对；写之前再查库内身份。

## 当前受控身份

`connection.cjs` 固定检查容器 `ai-novel-new-design-test-20260917-unified`、镜像、验证标签、仅本机端口 `55583`、空 Mounts、PGDATA tmpfs，并通过 SQL 检查 `new_design_unified_20260917`、scope、目录及服务端端口。没有参数接受任意 URL 或开发库。任何核对失败立即停止，不自动创建替代库或回退。

`bootstrap.cjs` 在加载测试前注入该 Pool，并禁止公开 runtime 启停／诊断方法。必须明确选择已审阅的测试文件：内部词法绑定的旧启动方法不受导出替换保护，所以旧 `postgres.integration.test.cjs` 不可运行。不得对测试目录使用无选择通配执行。

知识流水线夹具必须在文件创建及获取 Pool 前断言该 preload 已加载；漏写 `--require` 时立即拒绝，不能进入开发 runtime。正向切片复制本包原编译产物到唯一临时 appRoot，原文件与回复适配器自然落该根下，不修改适配器路径，不复制开发附件。随机空 schema 复用原真实表约束、FK 和触发器，每次连接获取独立物理 client，因此并发领取不是同一连接上的串行假象。实际约束与函数路径在复制前核对，避免夹具 schema 设置掩盖生产错误。

## 使用与数据生命周期

1. 只读核对当前 `connection.cjs` 中全部身份，与真实专属测试容器一致。
2. 已有编译输出后，运行 `node scripts/validate-isolated-postgres.cjs` 应用完整原迁移链；无业务表的空库才允许初始化，已有受控 ledger 可继续。
3. 使用 `node --require ./tests/unifiedPostgres/bootstrap.cjs --test` 后跟明确的用例文件；需要解除 skip 时，只在该子进程设置 `AI_NOVEL_NEW_DESIGN_DEV_RUNTIME=1`。
4. 检查测试输出中真实 pass、fail、skip；受控 fetcher 只验证合同与真实数据库行为，不代表在线模型生成。

所有 fixture 保留在测试 tmpfs 内，不做 DROP、TRUNCATE 或开发数据删除。停止／重启专属容器会失去测试数据，应先保存非敏感验收结论；本入口不会自行清理容器或卷。重新执行必须重新核对身份，不把此脚本改造成用户开发库迁移工具。

当前真实执行结果、端口和未验收边界见[统一验证记录](../../docs/current-batch-unified-validation.md)。
正向文件、向量和回复恢复的补验记录见[知识索引核验](../../docs/knowledge-index-pipeline-review.md)。
