# 开发交付、跨机器数据与恢复

## 实际交付边界

源码应用由本包 Node/Vite/Express 启动，数据库由现有 AGE＋pgvector Dockerfile 重建。没有完整应用容器、无需私有运行包 manifest；也不会连接旧桌面服务、旧模型配置或系统数据库。原 `scripts/start.ps1 / backup.ps1` 是发布运行包包装，**不能拿它们启动源码checkout**。

> 白话比喻：新店装修说明、账本与收货回单是三样东西。对应到系统：Dockerfile重建环境，PostgreSQL dump保存原事实，assets和ai-receipts保存附件与收到模型输出的证明。

> 速记方法：环境看源码，数据带库和件，回单只核对不重下单。

## 新机器与日常开发

要求 Node20.19+／22.12+、Docker Desktop Linux 容器。本批下列命令仅交付说明，没有安装、启动、构建、迁移或测试：

```powershell
# 所有命令在 new-design 内
npm ci --workspaces=false
node scripts/initialize-development.cjs
# 仅真正新机器：原配置、原容器及原卷均不存在，生成 .env 后按需编辑
node scripts/initialize-development.cjs --initialize-new
# 已有 runtime.json 的机器：保留原参数和密码，转写 .env
node scripts/initialize-development.cjs --import-runtime-json
./scripts/rebuild-development-image.ps1 -Build
./scripts/develop.ps1          # 仅计划
./scripts/develop.ps1 -Start   # 明确启动，会检查／应用已登记迁移
```

页面5273，API5301；旧5173／3000不作为独立入口。开发数据库由 `new-design/.env` 控制，样例见 `.env.example`，新环境建议端口15433。初始化独占创建文件且不输出密码；发现原配置、原容器或原卷则拒绝生成新凭据。旧 `.data/runtime.json` 只能通过显式 `--import-runtime-json` 转写，保留旧文件但启动和备份不再读取它；该操作不会连接数据库或修改密码。Windows 应限制环境文件访问权限，不能把密钥放进页面、Git或快照。

镜像重建只构建固定标签，不启动容器／挂卷。`npm run dev` 与显式`-Start`不是只读动作：服务可能初始化扩展与迁移，因此先备份已有数据。配置没有“完整App镜像”宣称，网络失败不删除卷。

### 宿主机数据目录与其他设备连接

`new-design/.env` 是数据库部署参数和凭据的唯一运行配置入口。启动与备份共用 `scripts/development/environment.cjs`；每次启动重新读取文件，并将解析结果传给带 `--env-file` 的 Compose，覆盖残留终端变量，避免应用连接参数与容器参数不同。修改后重启应用；运行中的连接池不会热切换。直接调用 Docker Compose 时仍遵循 Docker 自身的 shell 环境优先级，手工命令前应清除残留的同名变量。

本机部署示例（写入 `.env`，密码使用原值，不要照抄占位文字）：

```dotenv
NEW_DESIGN_DEV_DB_PORT=15433
NEW_DESIGN_DEV_DB_BIND_ADDRESS=0.0.0.0
NEW_DESIGN_DEV_DB_DATA_SOURCE=D:/infra/data/ai-novel-new-design/postgres17
NEW_DESIGN_DEV_DB_USER=new_design
NEW_DESIGN_DEV_DB_NAME=new_design
NEW_DESIGN_DEV_DB_PASSWORD='原数据库密码'
```

`NEW_DESIGN_DEV_DB_DATA_SOURCE=new-design-postgres-data` 代表原命名卷；绝对路径代表宿主机绑定目录。省略地址或数据源时保留回环监听与原命名卷；只有明确设置 `0.0.0.0` 才发布到所有 IPv4 网卡，应用仍通过 `127.0.0.1` 连接。数据库值使用单行写法，含 `#` 必须加引号，含 `$` 使用单引号字面值，不依赖变量展开、反引号或双引号反斜杠转义；这样可以避免 Node 与 Compose 的解析差异。账号、密码、库名和端口缺失时停止。

同一数据目录和数据库身份下，启动可按环境文件更新监听地址与端口。已有容器的数据目录或数据库身份不符时拒绝重建；没有容器而绑定目录非空时也拒绝作为新实例接管。已有数据改位置须先完成逻辑备份及验证，再单独执行受控迁移；修改 `.env` 本身不会搬数据或修改已有数据库密码。备份严格核对实际挂载、发布端口、镜像、Compose项目及数据库身份。运行中的 PostgreSQL 数据文件不能作为普通文件夹直接同步。

Windows 中镜像层仍由 Docker 数据磁盘管理（本机分类示例 `D:/infra/docker-storage`），数据库绑定目录位于 `D:/infra/data`，备份位于 `D:/infra/backups`；三者用途不同。`55432` 若处于 Windows 保留端口段，可用 `netsh interface ipv4 show excludedportrange protocol=tcp` 核对后选择空闲端口。其他设备用宿主机局域网 IP 和保存端口连接，仍需数据库密码及对应防火墙许可；Compose 监听成功不代表远端网络验证完成。

## 导出开发快照

先在原业务页保留所有草稿、核对未知请求；停止所有应用写入者（含另开的Node进程、后台处理器、其他机器连接），**数据库容器可继续运行**。工具不杀进程、不停止容器，不自动解决未知模型领取；工具已有监听检查仍检查5301／5174，不能把该检查当作所有写入者已停。使用5273或其他端口的页面及外部写入者须操作者自己确认停止。

```powershell
# 父目录应已存在，目标目录必须全新；例中路径请换为自己的备份父目录
node scripts/development-data.cjs backup --package C:/Backups/new-design-20260917-01 --confirm-quiescent
node scripts/development-data.cjs verify --package C:/Backups/new-design-20260917-01
```

工具从 `.env` 核对原受控容器名／镜像／Compose项目／数据目录或卷／发布端口／DB用户名和库名，`pg_dump`经无shell Docker参数导出当前完整数据库，保留AGE/vector原结构。目录仅包含`database.dump`、`data/assets`、`data/ai-receipts`及SHA-256清单；不复制`.env`、`.data/runtime.json`、密钥环境、node_modules、浏览器本机布局或镜像层。metadata记录实际扩展和实际已应用迁移ID，不以源码registry数量冒充源库升级成功。

附件和原回复拒绝链接、重解析点、硬链接及非法路径；导出前后重新核对清单和文件hash，变化或失败不生成manifest、不自动删除部分产物，也不覆盖旧备份。附件单文件限50MiB，目录文件限100000；超限须先设计受控大文件备份，不能跳过文件假称完整。

> 白话比喻：搬家前让所有人暂停往箱子里加东西，再核对装箱前后的清单。对应到系统：这是一份**操作者确认静止**的开发快照，不是已经接入031跨模块冻结／原子发布运行时的完整备份服务。

> 速记方法：先停写、再导出、验清单、独立恢复；只验SHA不等于验恢复。

verify仅读本地文件、逐条hash和清单；不连接数据库、不调用模型，结果不证明逻辑恢复或应用继续写作成功。清单`restoreVerified:false`不会被文件校验擅自改成true。

## 隔离恢复演练（不覆盖开发库）

先verify备份。使用独立演练项目与55584临时PG，仅人工明确启动；确保该端口／项目未被其他演练使用。演练Compose不挂原开发卷，不运行应用或自动恢复模型任务：

```powershell
# 密码由你在本机安全地设置，不写进脚本或Git
docker compose -f docker/compose.restore-drill.yml -p new-design-restore-drill-20260917 up -d --wait
docker compose -f docker/compose.restore-drill.yml -p new-design-restore-drill-20260917 cp C:/Backups/new-design-20260917-01/database.dump postgres:/tmp/restore.dump
docker compose -f docker/compose.restore-drill.yml -p new-design-restore-drill-20260917 exec -T postgres pg_restore --list /tmp/restore.dump
docker compose -f docker/compose.restore-drill.yml -p new-design-restore-drill-20260917 exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges --username restore_drill --dbname restore_drill /tmp/restore.dump
docker compose -f docker/compose.restore-drill.yml -p new-design-restore-drill-20260917 exec -T postgres psql -X --set ON_ERROR_STOP=1 --username restore_drill --dbname restore_drill --command "SELECT id FROM new_design.schema_migrations ORDER BY id"
```

这里恢复**全新演练DB**，没有`--clean`、`DROP`、`TRUNCATE`或原卷移除。若项目已使用过、数据库已非空，先停止操作另选全新演练项目；不能反复恢复覆盖。tmpfs只为恢复演练，不承诺持久，不以它作为正式数据同步目标。

核对实际PostgreSQL主版本、AGE/vector扩展、迁移ID集合、书籍／正式资料／正文／采用／结算与来源完整性。附件在新普通暂存目录逐条核对SHA后，由操作者正式选择目标源码checkout；**不能覆盖已有附件或原回复**。正式换机须先保存目标备份，明确选择全新目标，再设计受控切换；本工具未提供破坏式恢复或031原子切换按钮。

原模型／图像回复凭证表示曾收到输出，local_receipt不证明数据库入库或候选采用。新机器只读核对原key与fullhash；不能改UUID、批量重置running或自动再请求模型。图投影／向量是可重建派生数据，但完整dump可能携带其历史；恢复后按原profile／连接版本重核对，不能默默用文字默认模型重索引。

## Git同步与隐私

Dockerfile、Compose、`.env.example`、SQL、源码和本说明进入Git；镜像无需提交。开发快照包含小说全文、附件、认知／事实与运行历史，加入Git前须人工确认授权和私人内容范围；脚本不自动stage或commit。`.env` 与旧 `.data/runtime.json` 由根现有ignore排除，不能把配置混进backups目录。清单SHA只验损坏，不加密；敏感作品使用权限受限或加密的外部备份，而不是公开仓库。

## 未完成步骤与恢复位置

| 阶段 | 保留内容 | 点击／执行位置 |
| --- | --- | --- |
| 新机器配置拒绝 | 原config、原容器和原卷未改 | 恢复原开发配置；不要删除卷重试初始化 |
| 镜像拉取或构建失败 | 原卷未挂载，数据未改 | 检查Docker Desktop／镜像源后明确运行重建包装 |
| 数据导出／复制／SHA失败 | 原库与原附件、部分新导出保留 | 停止全部写入者，核对原目标和权限，换全新备份目录 |
| 恢复演练失败 | 原开发库未接触，演练部分数据保留 | 停止继续恢复，核对版本／清单，使用新的隔离项目 |
| 原请求结果未确认 | 原key、输出凭证和草稿保留 | 原来源页只读核对；运行维护只导航，不重发模型 |

运行维护真实入口`/new-design/structure/maintenance`；模型配置`/new-design/structure/models`。本批仅编码与静态审阅，未生成真实备份、重建镜像、启动或恢复数据库。统一验证仍需演练上述受控流程，不能写“备份已验收”。
