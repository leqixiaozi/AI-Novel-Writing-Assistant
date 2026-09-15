# 新设计卡片内核

`new-design/` 是小说系统新增能力的独立演进边界，通过旧产品外壳挂载“新设计”入口，同时保持旧小说页面和 SQLite 业务不变。

## 当前职责

- `CardSpace` / `Book`：系统定义使用默认空间，每本书使用独立 PostgreSQL 空间。
- `CardType`：保存元卡片类型身份、说明、草稿字段与当前发布版本。
- `CardTypeVersion`：保存不可变的字段和表单展示定义。
- `Card`：保存固定标题、状态、并发修订号和 PostgreSQL JSONB 动态值。
- `CardVersion`：保存每次创建、编辑、归档和恢复后的完整快照。
- `Dictionary` / `RelationType` / `CardRelation`：保存稳定选项和带类型、方向、数量约束的关系。
- `CardGroupForm` / `CardMount`：用不可变表单版本组合多张卡片，局部字段不污染来源卡片。
- `TemplateGroup`：冻结类型、字典、关系、表单和菜单快照，并以只增不改规则同步到书籍。

这些对象全部存放在 PostgreSQL 的 `new_design` schema 中。模块不导入旧 Prisma/SQLite 模型，也不调用旧业务 Service。

建表 SQL、内置数据和跨机器同步口径见 `migrations/001_card_kernel.sql` 至 `migrations/006_template_books.sql` 与 `docs/data-model.md`。

## 内置创作卡片

首次初始化会得到 19 种已发布的通用小说卡片类型：人物、组织／势力、地点、道具、世界规则、事件、目标／任务、冲突、秘密／真相、线索／证据、伏笔、悬念／问题、剧情线、剧情节点／节拍、弧线／变化线、主题／命题、卷、章节和场景。类型还可声明正文承载、时间定位、状态变化、关系主体、生命周期、创作目标和正典事实七种组合能力，字段表单仍保持动态可扩展。

“我的书籍”内置原创仙侠项目《照骨山河》的 55 张生产样例，覆盖全部 19 类卡片，并完成第一卷前八章和第一章五场景的规划。事件规划表单可装配人物、地点、道具与剧情线。样例的来源分析、原创转化边界和卡片清单见 `docs/xianxia-production-demo.md`。

预置内容由版本化 SQL 管理并进入 Git，因此每台开发机器都能得到同一套基础数据。作者自行创建和填写的业务数据不进入 Git，仍需 PostgreSQL 备份与恢复。

新设计页面只使用主应用共享的语义主题变量，不固化单独配色；Ink、Paper、Night 以及它们的浅色/深色模式会共同作用于背景、卡片、边框、状态色和交互焦点。

## 运行

从仓库根目录运行：

```powershell
pnpm dev
```

浏览器进入 `http://localhost:5173/new-design`；桌面版从左侧底部可收起的“新设计”分组进入。API 统一挂载在 `/api/new-design`。

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

集成测试直接启动便携 PostgreSQL，覆盖类型发布、输入校验、卡片修订、归档/恢复、表单版本、关系与挂载、两本书隔离、模板安全追加及停库重启后的持久化读取。测试数据保留在被 `.gitignore` 排除的 `new-design/.data/integration-postgres/`，不会删除或重置已有用户数据库。

## 当前范围之外

本模块当前不包含关系图可视化、AGE、pgvector、旧数据迁移、备份恢复 UI 或数据库主版本升级。后续能力只能依赖本模块公开契约继续扩展，不能在菜单里放置未实现占位入口。
