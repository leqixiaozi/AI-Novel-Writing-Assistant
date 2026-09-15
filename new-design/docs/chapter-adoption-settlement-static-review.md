# 正文采用与稳定结算静态审查

## 本轮范围

本轮遵循“开发优先、仅静态 review”：没有启动服务、浏览器或 PostgreSQL，没有执行迁移、测试、构建、AGE、pgvector、AI 和备份恢复。检查范围为 TypeScript 类型、JSON 语法、SQL／状态机／事务边界、路由、界面文案与无障碍结构。

## 审查结论

- 正文唯一正本仍是 `chapter_body_versions`；事实、知识和状态继续复用 017—020 的领域表。
- 首次采用在会话事务内写 `chapter_documents` 指针和 `chapter_body_adoptions`；稳定章节换稿停在 `impact_review_required`，不静默重算。
- 会话冻结准备、正文、计划、上下文、策略和依赖哈希；状态迁移受 SQL 触发器约束，审计事件和清单版本只追加。
- AI 返回必须匹配 task／attempt、合同、配方、上下文和路由，结果只进入候选清单并保留精确正文锚点。
- 默认策略不自动确认。重要／核心变化不会走低风险策略；人工决定支持纳入、不纳入和稍后处理。
- 稳定结算拒绝待确认／稍后处理项，并在单事务内提交各领域正式结果、检查点、图投影登记、语义分块请求和 Outbox 引用。
- 下一章接口只选前序 `stable` 检查点，不读取未采用正文和未确认提案。
- 章节树公开 `待结算／稳定章节／结算需处理／待看改稿影响`，中途关闭面板后可以继续同一会话。
- 运行包迁移范围同步为 001—040，SQL 和数据文档可随 Git 在多台开发机同步。

## 静态命令

```powershell
pnpm exec tsc -p new-design/tsconfig.server.json --noEmit
pnpm exec tsc -p new-design/tsconfig.client.json --noEmit
node -e "JSON.parse(require('fs').readFileSync('new-design/runtime/runtime-package.spec.json','utf8'))"
```

以上命令通过。它们不等同于运行时验收。

## 延后验证

发布前仍需在真实 PostgreSQL 17 上顺序执行 001—040，覆盖首次采用、零变化结算、多领域确认、事实冲突回滚、失败恢复、重复幂等键、旧章换稿边界、图／语义 Outbox、备份恢复与并发修订冲突；还需做多主题、键盘操作、窄屏和浏览器视觉回归。本轮按用户要求不执行这些动态项目。
