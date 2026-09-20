# 新设计开发入口

本文件仅适用于 `new-design/`。先遵守仓库根目录 `AGENTS.md`，通过根目录 `AGENTS.local.md` 的映射读取 `personal-dev-workflow` Skill；同一会话已读且未变可复用。再按需读取专项 Skill。同目录 `AGENTS.local.md` 记录新版的本机环境入口，不放宽授权；缺失时按根目录规则处理。

## 对标与系统边界

- 范围从 `src/client/navigation.ts` 和实际路由确定，覆盖新版菜单、子页面、书内入口及可见操作。旧版页面和业务流程是参考，旧版 `client/`、`server/`、`shared/` 业务代码只读。
- 新版前端通过 `src/client/api.ts` 调用 `src/server/http/` 下的 `/api/new-design` 接口；业务、模型、数据库和运行记录只使用新版来源。共用页面壳仅承担展示与导航，不能调用旧版业务或复用旧版状态充当新版结果。
- 新版以卡片及版本、来源、候选采用、结算记录实现业务；不要按旧版表结构复制底层。数据库结构以 `migrations/` 和 `src/server/database/migrations.ts` 为准，业务含义按需读 `docs/data-model.md`。

## 定向入口

| 任务 | 先读 |
| --- | --- |
| 项目文档与开发约定 | `../doc/README.md`，按任务进入产品、架构或开发规范 |
| 页面与功能对标 | `src/client/navigation.ts`、目标页面、`docs/legacy-page-replication-progress.md` 的相关行 |
| API 接线 | `src/client/api.ts` 的目标方法、`src/server/http/` 对应路由和 `src/server/database/` 对应业务模块 |
| 新旧展示入口 | `docs/comparison-entry.md`、`scripts/comparison/`；旧版业务代码仍只读 |
| 数据与启动 | `../doc/20架构/database.md`、`docs/data-model.md`、`docs/development-delivery.md` 的相关章节及当前迁移清单 |

## 修改与验证

- 先确认目标操作的用户可见结果，再追踪页面、API、业务记录和恢复回执；区分代码接线、隔离验证、作者环境生效与页面验收。未知请求不得换键重发模型，候选不得自动冒充正式采用。
- 仅在对应节点使用项目原生命令：服务端 `npm run build:server`，客户端 `npm run typecheck:client` 或 `npm run build:client`，跨系统边界 `npm run check:boundary`，功能测试选受影响用例。已有等价证据可复用；不自动全量测试或 Review。
- `npm run dev:server` 会连接新版数据库、检查默认迁移并启动后台处理器；`npm run dev:compare` 只启动对照前端，不启动两套 API。启动、迁移、模型调用和作者数据写入分别按任务授权与备份条件执行，不以页面返回 200 当成功能验收。
- 编辑只改新版及已明确需要的共用展示入口。提交前核差异和旧版目录状态；不得夹带用户的其他修改、缓存、凭据或运行数据。
