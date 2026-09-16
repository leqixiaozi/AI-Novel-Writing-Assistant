# 当前原批统一验证

日期：2026-09-17。范围仅 `new-design/`，分支 `codex/new-design-card-kernel`。本记录接在[历史失败与静态修复记录](current-batch-failure-static-review.md)之后；保留历史失败，不把修复前结果覆盖成通过。下一批计划不属于本次验证。

## 当前结论

原授权批次编码及逐项静态 review 完成后，已完成本批统一代码级验证、集中修复及最后复测：本包依赖安装、双端类型／构建通过；明确选择的 53 份单位／局部 HTTP／独立边界文件 380/380 通过；13 份真实 PG／HTTP 文件 63/63 通过，均 0 失败、0 跳过。独立空库增量迁移最终 72/72 通过（编号跳过 064，包含必要修复 072／073）。这不是整产品、真实模型、界面或用户开发库升级验收通过。

> 白话比喻：隔离数据库像另开一本练习账本，测试写错也不会改到正式账本。对应本次验证：测试容器、端口、数据库和内存数据目录独立，开发数据库不参加迁移和测试。

> 速记方法：先验身份，再写练习账；桩测合同，不算真实模型。

## 已执行检查与历史失败

| 检查 | 实际结果 | 说明 |
| --- | --- | --- |
| 本包 `npm ci --ignore-scripts --workspaces=false --no-audit --no-fund` | 通过 | 初次因 5194 客户端占用 Rollup 原生文件而 EPERM；只停止该客户端后重试，未停止 5173、5301 或开发数据库。按本包现有锁安装，无升级替代版本 |
| `npm run build` | 最终通过 | 初次客户端时间值类型包含禁止的 migration 作者输入；修为作者合同后，server tsc、client tsc、Vite 构建均通过 |
| 明确选择 53 份单位／局部 HTTP／边界文件 | 最终 380/380 通过，0 跳过 | 首轮 373 通过、7 失败；集中修复陈旧任务数、正文 guard 断言、向量实际开关依据、SQL 函数定位和组合路由常量注入。未删除安全负向断言 |
| 独立空库完整注册迁移 | 70/70 通过 | 编号跳过 064；不是“071 条”。迁移驱动初次模块扩展名、AGE 系统目录空库识别、026 自登记幂等问题修复后续跑，原 SQL 不因此放宽 |
| 12 份明确选择的真实 PG／HTTP 文件 | 首次实际执行 55 检查：52 通过、3 失败 | 失败为两个根场景：旧导演 HTTP 用例缺原请求合同；真实开书 AI 已明确采用批次被正式安装误拒绝。集中修复中 |

先前未开启 PG 开关的一次检查只有 1 通过、11 跳过，不算 12 项通过。重新明确开启后才得到上表 55 项结果。原始日志保存在本机 `.data/unified-validation/`，不加入 Git；此文档保存可同步的结果与边界。

单位选择为全部 47 份 `*.unit.test.cjs` 加 `creation-source-http`、`creation-preparation-http`、`chapter-settlement-editing-http`、`settlement-relation-configuration-http`、`prompt-composition-http` 和 `standalone-boundary`。这是受控单位／注入依赖与本地 HTTP 验证，不是在线模型验收，也不等于浏览器交互通过。

## PostgreSQL 实际隔离目标

- 容器：`ai-novel-new-design-test-20260917-unified`，标记 `ai-novel.validation=unified-20260917`。
- 镜像：`ai-novel/new-design-postgres-dev:pg17-age1.7-vector0.8.6`，本机已有镜像，未在线重建。
- 端口：仅 `127.0.0.1:55583`；数据库：`new_design_unified_20260917`。
- 数据：`/var/lib/postgresql/data` 独立 tmpfs，Docker Mounts 为 `[]`，没有命名卷或宿主机目录。
- 数据库自证：`current_database()`、`new_design.validation_scope`、数据目录和服务端端口全部核对后才返回 Pool。
- 扩展实查：AGE 1.7.0、pgvector 0.8.6、pg_trgm 1.6。

`tests/unifiedPostgres/connection.cjs` 硬校验上述身份，不能传入开发连接串。测试命令预加载 `bootstrap.cjs`，仅在测试进程注入受控 Pool；生产 runtime 未修改，测试内禁止启动、停止或查询开发运行包。迁移命令为 `node scripts/validate-isolated-postgres.cjs`，只接受已验证的隔离目标，不能用于正式开发库迁移。

PG 命令明确使用 `AI_NOVEL_NEW_DESIGN_DEV_RUNTIME=1` 解除用例 skip，但数据库连接仍必须先经过测试专属 bootstrap。禁止单独开启此变量盲跑默认 runtime：生产开发路径会使用固定开发容器与数据卷。旧 `postgres.integration.test.cjs` 会启动／停止原 runtime，未纳入本次运行。最终增加第 13 份 `knowledge-index.postgres.test.cjs`；命令如下。

```powershell
# 工作目录 new-design；先核对容器身份，再执行指定用例，不使用 tests/* 通配运行。
$env:AI_NOVEL_NEW_DESIGN_DEV_RUNTIME='1'
node --require ./tests/unifiedPostgres/bootstrap.cjs --test --test-concurrency=1 --test-reporter=spec `
  tests/chapter-settlement-editing.postgres.test.cjs tests/context-author.postgres.test.cjs `
  tests/creation-director.postgres.test.cjs tests/creation-production.postgres.test.cjs `
  tests/creation-review-ai.postgres.test.cjs tests/form-ai-blank.postgres.test.cjs `
  tests/form-ai.postgres.test.cjs tests/independent-http.postgres.test.cjs `
  tests/model-routing.postgres.test.cjs tests/prompt-composition.postgres.test.cjs `
  tests/prompt-management.postgres.test.cjs tests/research-adoption.postgres.test.cjs `
  tests/knowledge-index.postgres.test.cjs
```

测试数据保留在专用 tmpfs 中；重启／停止该容器会丢失练习数据。本次未执行 DROP、TRUNCATE、卷删除或开发库重建。已有开发库 `55432`、旧壳 `5173` 和 API `5301` 不因本次验证重启或应用新迁移。

## 未执行及保留风险

- 真实文字／向量模型：未获得本轮明确的可用专属版本、凭据与安全执行目标；未调用真实模型，不把受控 fetcher 桩与账本检查称为实际生成／费用验证。
- 用户开发数据库：070／071 等新迁移尚未在用户库应用；隔离库通过不代表当前开发 API 自动升级安全，不盲目重启服务触发迁移。
- UI：交用户体验；未运行浏览器、截图、输入法、跨段撤销、长文、窄屏或主题交互验收。
- 构建：Vite JS 输出约 1,760 kB（gzip 518 kB），有 chunk 超过 500 kB 的提示；构建通过不证明页面性能已合格。Zod 注释和 Tiptap `use client` 提示未阻止构建。
- 打包／发布：未执行；本地视觉维护不包含尚未接入的图像生成，隔离下一批继续待明确派发。
- 数据备份：本次没有产生新的开发库备份，不声称已经重新备份；已有备份及 Dockerfile 同步按既有文档与受管文件处理，不提交运行数据目录、凭据或镜像二进制。

## 集中修复与复测

1. 已修复正式开书误拒已采用 AI 来源：原 `review` 门禁保留，只额外接受同会话 `applied/review_adopted` 且不可变原采用回执精确匹配批次、审阅对象、内容类型、字段键和值的来源。实际服务端编译通过；`creation-review-ai.postgres.test.cjs` 隔离 PG 单项 6/6 通过，最终五阶段累计与四层正式安装完成，新增改值、无回执已采用批次及跨会话伪来源均 409。测试模型仍是明示受控 fetcher，阶段调用数保持 5，未重新生成。
2. 旧导演 HTTP 用例已按真实受控合同改造：真实 store／HTTP／执行器，仅 provider fetcher 为明示桩；五阶段候选保持未采用，方向及候选明确采用，保存／接管／采用／开书均核对原 key 回执。保留人工内容、同 key 改内容 409、失败不泄密和迟到结果保护。单项 1/1 通过；迟到结果按真实保存合同为 503／unknown 并返回精确来源页，原批次为 ended_unknown，不放宽为“任意非 200”。
3. 测试隔离驱动经独立静态复核，补 ledger 完整 ID 集合与原 registry 比较，不仅比较条数；实际再次只在原独立目标核对，70/70 通过，扩展版本不变。
4. 新增知识语义设置真实 PG 用例首轮连接 4 子项通过，但规格创建 42P01，两个依赖子项明确跳过。根因是 070 的会话 search_path 未固定到函数；072 固定四个原函数路径，隔离库迁移 71/71 通过。复测再发现 42702：profile_id 参数与表列同名；073 保留原函数签名及全部冻结约束，仅限定原参数并固定路径，不重写历史 070。独立静态交叉 review 通过，服务端编译通过，迁移最终 72/72 通过。知识单项最终 8/8 通过：连接发布、trim／完整 hash、并发原 key、八种改内容冲突、历史回执、精确规格 FK／原 key、跨书拒绝及错误连接／未解析来源无尝试写入；无实际模型请求。
5. 上述编码修复全部结束后，最后集中复测：53 份安全文件 380/380（9.7 秒），13 份真实 PG／HTTP 文件 63/63（33.7 秒），0 失败、0 跳过。日志分别为本机 `unit-allfix-final.log`、`postgres-postfix-final.log`；不把重复定向执行相加制造新检查数量。双端完整构建成功证据复用，之后仅服务端／SQL 修复，服务端已重新编译；客户端没有后续代码改动，不重复 Vite 构建。

正向管理文件解析→source prepare、实际 claim 租约竞争、持久 provider 回复→pgvector 分代仍未获得本批真实 PG 运行覆盖。相关单位合同通过不填补此缺口，真实模型也未调用。`pg@8` 提示某些既有 fixture 单连接并发 query 的弃用警告，未导致失败，不声称未来 pg@9 兼容。

5194 Vite 客户端已恢复，实际监听正常；只恢复客户端，不重启 API 或迁移用户库。

Git：本轮阶段提交边界仅 `new-design/`，提交结果以 Git 历史及交接为准；原根目录 5 个未跟踪 PNG 不 stage。当前分支无 upstream，远端无同名分支，首次推送会包含既有完整历史，其中含非新设计路径及既有私有数据库备份类别。未读取／输出该备份或凭据内容。讨论任务已明确要求暂缓 push，等待用户决定并核对敏感数据边界；不清理／重写历史、不造发布分支、不 force、不合并主分支。阶段记录与 README 只更新本包既有交付面，根发布文档不属于本轮授权修改范围。
