# 开发交付、跨机器数据与恢复

## 2026-09-20 本机实际演练

本机新版 API 使用独立 PostgreSQL。已先停止新版写入者，在 `.codex-backups/new-design-live-20260920-001` 生成并校验完整开发快照（数据库和 8 份 AI 原回复凭证；本次无 `data/assets` 文件）。另起隔离 Compose 项目，用 `template0` 新建空数据库 `restore_full`，完整 `pg_restore` 成功；原 81 个默认迁移、42 部书及 12 份正文版本均可读。随后在隔离恢复库中一次事务验证 20 个默认关闭的手动迁移，成功后才在已备份、已停止新版 API 的作者新版库中安装：现有默认 81 项、手动 20 项，共 101 项。旧版库和旧版服务未操作。

2026-09-20 后续源码另增加 `106_world_usage_scope.sql` 和 `107_payoff_ledger_windows.sql` 两份手动结构。二者已纳入运行包手动文件清单，但不进入默认启动迁移。安装前在忽略目录 `.codex-backups/new-design-before-106-107-20260920/database.dump` 生成私有完整数据库备份，并在独立空库 `nd_before_106_107_verify_20260920` 完整还原，迁移／书籍／卡片／正文版本数量与源库一致（102／42／2078／12）。随后两份 SQL 和迁移记录在作者新版库单个事务中安装，世界范围能力行明确启用；安装后为 104 项迁移，书籍／卡片／正文版本数量仍为 42／2078／12。旧版库未操作。[入 Git 的新版数据库结构快照](../database/schema/README.md)从安装后的作者库导出并在另一空库还原核对；它不含小说正文、凭据行或其他表数据，不能代替上述私有完整备份。

2026-09-21 新增 `108_world_package_archive.sql` 手动迁移及世界样本归档／恢复接线，已在新建隔离库验证目录隐藏、导入与发布阻断、既有安装保留及保护失效时关闭写入；该迁移尚未在作者新版库安装，页面操作未进行作者验收。安装前仍须按本文备份与独立恢复演练；当前作者库的 104 项迁移状态不因源码新增文件而改变。

2026-09-21 新增 `109_comic_projects.sql` 手动迁移与独立漫画项目入口。隔离新库验证三种来源、小说已采用正文快照、重复请求恢复、HTTP 创建和来源不可改写；作者新版库尚未安装该迁移，也未进行作者页面操作。漫画的分集规划、分格、素材、图片生成与导出仍属后续阶段。此代码提交不改变作者库原有迁移数量；安装前须另做完整备份和独立恢复演练。

2026-09-21 新增 `110_comic_episodes.sql` 手动迁移与人工分集候选／明确采用。隔离新库验证多版本保留、修订冲突、原候选和原采用回执；本阶段尚未接 AI 大纲生成。作者新版库仍未安装 109／110，不以代码接线或隔离验证代替页面可用及作者验收。

2026-09-21 新增 `111_comic_panels.sql` 手动迁移与整话分格脚本候选／采用，已在隔离新库验证旧脚本保留、重写候选不覆盖采用、旧分集大纲的脚本阻断采用及 JSONB 对白写入。作者新版库仍未安装 109／110／111；当前无漫画图片生成或导出能力。

2026-09-21 新增 `112_comic_bibles.sql` 手动迁移与漫画角色／场景文字设定候选、采用和原请求核对。隔离库验证多版本保留、跨对象保护和保护触发器停用时停写保读。作者新版库尚未安装 109—112；图像、AI 和导出仍未启用。

2026-09-21 新增 `113_comic_source_bundle.sql` 手动迁移与漫画来源整理工作区。可人工整理梗概、节拍、角色线索为不可改写候选，明确采用后保留原文及旧版；隔离库验证重复请求、陈旧修订、HTTP 原回执和保护触发器失效时停写保读。作者新版库仍未安装 108—113；AI 来源提取、图片和导出未启用。安装须先完成作者库完整备份与独立恢复演练。

2026-09-21 对标旧版最新 `main` 后，新版独立补入 `114_comic_visual_assets.sql`：漫画角色／场景图片按候选版本、设定来源版本和显式采用流水保存，支持本地 PNG／JPEG／GIF／WebP 上传、精确版本读取和原请求核对；没有自动采用，也没有复用旧版漫画或短剧表。DeepSeek 官方端点的 `deepseek-flash`、`deepseek-pro`、v4 变体及 `deepseek-reasoner` 在结构化任务中显式关闭 thinking，其他兼容端点不受影响。

2026-09-21 新增 `115_creative_hub.sql` 手动迁移与新版独立创作中枢。会话可绑定新版作品、章节和正式任务投影；诊断只读取新版书架与运行记录，冻结原请求状态，并把迟到回复写回原 turn。提示词和输出合同仅允许查询状态、解释失败、分析影响和导航到已有页面，不提供业务写工具。一级菜单、持续会话列表、绑定编辑、历史回读、原请求恢复和来源导航已接线，切换会话只更新局部工作区和深链。迁移、保护触发器、同键冲突、归档和模型单次调用已在新建隔离库验证；未调用真实模型，作者库尚未安装 `115`，页面操作尚待作者验收。

安装前停止新版 API 与对比网关，在私有目录 `C:/obsidian_data/.codex-backups/new-design-before-108-114-20260921-001` 导出完整快照并通过文件 SHA 校验；随后在独立 tmpfs PostgreSQL 中从 `template0` 完整恢复，恢复库与作者库均为 104 项迁移、42 部书、2078 张卡和 12 份正文版本。`108`—`114` 又先在恢复副本中单事务安装成功，才在作者新版库以同一顺序单事务安装。安装后作者库为 111 项迁移，三项业务数量保持不变；旧版数据库和旧版服务均未操作。新版结构快照已另行导出并在空库还原核对；页面操作仍待作者验收。

漫画项目创建、分集、分格和角色／场景文字设定的浏览器原请求恢复已补齐输入快照；只有请求键而没有完整输入时不再重发，防止刷新后用新填写占用原键。原请求凭证仍只保留在本次浏览器会话，作者跨浏览器恢复和页面交互验收尚未完成。

八项经过隔离功能验证的能力开关已在新版作者库明确启用：世界包、公共人物资料／工作台、图片准备、人物创作倾向、公共标题和书内历史。资源补充下游闭合仍为关闭，数据库合同禁止直接开启。隔离验证 63 项通过，真实模型调用 0；新版 API 已重启，维护页按默认迁移口径显示 81/81，六个新增只读业务入口返回 200。原有 89 个活动 Outbox 作业中，10 个章节 AI 作业已只读核对专业账本及正文版本后补齐后台回执（8 成功、2 原业务失败，AI 尝试总数仍为 10）；64 个原图投影请求已处理（52 个有效来源完成、12 个已归档测试书来源标记为 superseded），首次建立产生的全量构建与恢复重放另记历史；15 个依赖后台作业按 `manual_review` 业务待判断结束自动执行，原依赖请求仍保持 pending，不能替作者判断是否使用旧上下文。图作业的原死信与重放失败保持历史记录，不视为活动队列。历史 AI 作业没有重新调用模型。开发快照是外部工具生成，不能代替应用内传输备份、正式升级执行器或跨机器应用验收。

随后针对模型凭据另存并校验 `.codex-backups/new-design-pre-model-credentials-20260920-001`，在隔离恢复库安装手动迁移 `105_database_model_credentials` 成功，再于新版作者库手动安装。当时默认 81 项、手动 21 项，共 102 项。原两份 MiniMax 凭据在新版数据库中保存 AES-256-GCM 密文，引用 ID 与已发布任务模型版本不变；无模型环境变量的新版 API 重启后，2/2 凭据、12/12 任务仍可用，目录接口不返回密钥。加密材料由私有数据库运行配置推导，不写入数据库或 Git；跨机器恢复还需保留匹配的私有运行配置，否则在模型设置重新录入密钥。数据库逻辑备份含凭据密文，仍应按密钥材料保护。未调用模型，也未验证跨机器解密。

运行包规格与校验清单现包含手动迁移 105，仍默认关闭、不会随启动自动应用。其清单单测 2 项通过；正式 Windows 二进制包、跨机器凭据解密和升级执行器仍待实际验证。

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
# 仅真正新机器：原config、原容器及原卷均不存在
node scripts/initialize-development.cjs --initialize-new
./scripts/rebuild-development-image.ps1 -Build
./scripts/develop.ps1          # 仅计划
./scripts/develop.ps1 -Start   # 明确启动，会检查／应用已登记迁移
```

页面5273，API5301；旧5173／3000不作为独立入口。开发数据库原默认55432。`.data/runtime.json` 仅本机保留，初始化只用独占创建、密码不输出，不读取／替换已有配置。发现原容器或原卷则拒绝初始化；原配置遗失时先恢复原配置，不生成新密码冒充空白机器。Windows应限制`.data`访问权限。新版模型凭据在数据库中加密保存，页面只在录入时发送密钥且不回显；不能把明文放进 Git、文档或诊断输出。

镜像重建只构建固定标签，不启动容器／挂卷。`npm run dev` 与显式`-Start`不是只读动作：服务可能初始化扩展与迁移，因此先备份已有数据。配置没有“完整App镜像”宣称，网络失败不删除卷。

## 导出开发快照

先在原业务页保留所有草稿、核对未知请求；停止所有应用写入者（含另开的Node进程、后台处理器、其他机器连接），**数据库容器可继续运行**。工具不杀进程、不停止容器，不自动解决未知模型领取；工具已有监听检查仍检查5301／5174，不能把该检查当作所有写入者已停。使用5273或其他端口的页面及外部写入者须操作者自己确认停止。

```powershell
# 父目录应已存在，目标目录必须全新；例中路径请换为自己的备份父目录
node scripts/development-data.cjs backup --package C:/Backups/new-design-20260917-01 --confirm-quiescent
node scripts/development-data.cjs verify --package C:/Backups/new-design-20260917-01
```

工具只核对原受控容器名／镜像／Compose项目／数据卷／本机端口／DB用户名和库名，`pg_dump`经无shell Docker参数导出当前完整数据库，保留AGE/vector原结构。目录仅包含`database.dump`、`data/assets`、`data/ai-receipts`及SHA-256清单；不复制`.data/runtime.json`、密钥环境、node_modules、浏览器本机布局或镜像层。metadata记录实际扩展和实际已应用迁移ID，不以源码registry数量冒充源库升级成功。

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
docker compose -f docker/compose.restore-drill.yml -p new-design-restore-drill-20260917 exec -T postgres createdb --username restore_drill --template template0 restore_full
docker compose -f docker/compose.restore-drill.yml -p new-design-restore-drill-20260917 exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges --username restore_drill --dbname restore_full /tmp/restore.dump
docker compose -f docker/compose.restore-drill.yml -p new-design-restore-drill-20260917 exec -T postgres psql -X --set ON_ERROR_STOP=1 --username restore_drill --dbname restore_full --command "SELECT id FROM new_design.schema_migrations ORDER BY id"
```

这里恢复**从 `template0` 创建的全新演练DB**，没有`--clean`、`DROP`、`TRUNCATE`或原卷移除。演练镜像自带 AGE 的 `ag_catalog`，直接恢复到预创建的 `restore_drill` 库会因重复 schema 失败。若项目已使用过、目标数据库已非空，先停止操作另选全新演练项目；不能反复恢复覆盖。tmpfs只为恢复演练，不承诺持久，不以它作为正式数据同步目标。

核对实际PostgreSQL主版本、AGE/vector扩展、迁移ID集合、书籍／正式资料／正文／采用／结算与来源完整性。附件在新普通暂存目录逐条核对SHA后，由操作者正式选择目标源码checkout；**不能覆盖已有附件或原回复**。正式换机须先保存目标备份，明确选择全新目标，再设计受控切换；本工具未提供破坏式恢复或031原子切换按钮。

原模型／图像回复凭证表示曾收到输出，local_receipt不证明数据库入库或候选采用。新机器只读核对原key与fullhash；不能改UUID、批量重置running或自动再请求模型。图投影／向量是可重建派生数据，但完整dump可能携带其历史；恢复后按原profile／连接版本重核对，不能默默用文字默认模型重索引。

## Git同步与隐私

Dockerfile、Compose、SQL、源码和本说明进入Git；镜像无需提交。开发快照包含小说全文、附件、认知／事实与运行历史，加入Git前须人工确认授权和私人内容范围；脚本不自动stage或commit。`.data/runtime.json`已经由根现有ignore排除，不能把该配置混进backups目录。清单SHA只验损坏，不加密；敏感作品使用权限受限或加密的外部备份，而不是公开仓库。

## 未完成步骤与恢复位置

| 阶段 | 保留内容 | 点击／执行位置 |
| --- | --- | --- |
| 新机器配置拒绝 | 原config、原容器和原卷未改 | 恢复原开发配置；不要删除卷重试初始化 |
| 镜像拉取或构建失败 | 原卷未挂载，数据未改 | 检查Docker Desktop／镜像源后明确运行重建包装 |
| 数据导出／复制／SHA失败 | 原库与原附件、部分新导出保留 | 停止全部写入者，核对原目标和权限，换全新备份目录 |
| 恢复演练失败 | 原开发库未接触，演练部分数据保留 | 停止继续恢复，核对版本／清单，使用新的隔离项目 |
| 原请求结果未确认 | 原key、输出凭证和草稿保留 | 原来源页只读核对；运行维护只导航，不重发模型 |

运行维护真实入口`/new-design/structure/maintenance`；模型配置`/new-design/structure/models`。本机开发快照、完整隔离恢复和手动迁移演练证据见文首；应用内正式备份、跨机器恢复与整套发布包仍待验。
