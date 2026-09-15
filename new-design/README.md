# 新设计卡片内核

`new-design/` 是小说系统新增能力的独立演进边界。第一阶段只实现基础卡片纵向切片，并通过旧产品外壳挂载一个“新设计”入口。

## 当前职责

- `CardSpace`：用默认空间隔离第一阶段数据，为后续书籍与模板空间预留边界。
- `CardType`：保存元卡片类型身份、说明、草稿字段与当前发布版本。
- `CardTypeVersion`：保存不可变的字段和表单展示定义。
- `Card`：保存固定标题、状态、并发修订号和 PostgreSQL JSONB 动态值。
- `CardVersion`：保存每次创建、编辑、归档和恢复后的完整快照。

这些对象全部存放在 PostgreSQL 的 `new_design` schema 中。模块不导入旧 Prisma/SQLite 模型，也不调用旧业务 Service。

建表 SQL 和跨机器同步口径见 `migrations/001_card_kernel.sql` 与 `docs/data-model.md`。

## 运行

从仓库根目录运行：

```powershell
pnpm dev
```

浏览器进入 `http://localhost:5173/new-design`；桌面版从左侧“创作 → 新设计”进入。API 统一挂载在 `/api/new-design`。

首次访问时会启动随依赖锁定的 PostgreSQL 17.6 Windows x64 运行文件。默认数据位置：

- 桌面版：`%LOCALAPPDATA%/AI-Novel-Writing-Assistant-v2/new-design/`
- 仓库开发：`new-design/.data/`
- 自定义：设置 `NEW_DESIGN_DATA_DIR`

运行时只监听 `127.0.0.1`，从 `55432-55532` 选择可用端口。首次初始化生成随机数据库密码，数据目录、日志和运行配置均位于应用安装目录之外。检测到已有数据但配置丢失或损坏时会停止，不会自动重置数据。

如 CI 已提供真实 PostgreSQL，可设置 `NEW_DESIGN_DATABASE_URL`。该选项仍只连接 PostgreSQL，不提供 SQLite、Mock 或内存回退。

## 验证

```powershell
pnpm --filter @ai-novel/new-design test
pnpm --filter @ai-novel/new-design test:integration
pnpm --filter @ai-novel/client build
```

集成测试直接启动便携 PostgreSQL，覆盖类型发布、输入校验、卡片修订、可选字段演进、归档/恢复及停库重启后的持久化读取。测试数据保留在被 `.gitignore` 排除的 `new-design/.data/integration-postgres/`，不会删除或重置已有用户数据库。

## 第一阶段之外

本模块当前不包含卡片组表单、拖拽、模板组、书籍开书、卡片关系、AGE、pgvector、旧数据迁移、备份恢复 UI 或数据库主版本升级。后续能力只能依赖本模块公开契约继续扩展。
