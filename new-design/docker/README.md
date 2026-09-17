# 开发数据库镜像重建

本包交付的是 **宿主 Node 应用＋Docker PostgreSQL17** 的开发方式，不是完整应用镜像或私有桌面运行包。`dev-postgres/Dockerfile` 将 AGE 1.7.0 与 pgvector 0.8.6 组合到同一 PostgreSQL17 镜像；原 `docker-compose.dev.yml` 管理现有受控开发卷。

> 白话比喻：Dockerfile 是厨房安装说明，数据卷是装菜谱的柜子。对应到系统：重建镜像不会搬走数据库；备份还须携带逻辑数据和受控附件。

> 速记方法：镜像重建环境，快照搬走内容。

从 `new-design/` 执行，下面命令在本批编码期间**未执行**：

```powershell
# 无副作用计划
./scripts/rebuild-development-image.ps1
# 明确重建镜像，不启动／迁移／挂卷
./scripts/rebuild-development-image.ps1 -Build
```

需要 Docker Desktop 的 Linux 容器、x86-64匹配架构、可访问两个基础镜像。标签版本固定但未锁 registry digest，不承诺位级复现；Docker Hub EOF 表示拉取／解析失败，不能靠清理数据卷修复。先检查网络和合法镜像源，再显式重建；不得用系统 PostgreSQL 或文字模型回退替代扩展／能力。

`compose.restore-drill.yml` 是另一个恢复演练目标：**55584＋tmpfs、无 container_name、无开发卷挂载、无应用服务**。必须使用独立明确项目名，不是把开发库改名；停止演练容器后临时内容不保证保留。恢复命令与数据范围见 [开发交付和同步](../docs/development-delivery.md)。

不提交镜像层、数据库密码、`.data/runtime.json` 或运行环境文件；Dockerfile与Compose本身可进入Git。此文件不表示已重建镜像或已执行恢复演练。
