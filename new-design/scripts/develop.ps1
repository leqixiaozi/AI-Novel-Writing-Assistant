[CmdletBinding()]
param([switch]$Start)
$developmentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configPath = Join-Path $developmentRoot '.data/runtime.json'
Write-Output '源码开发入口：页面5273，API5301；数据库使用本包Dockerfile，不调用旧服务。'
Write-Output '计划：本包安装 npm ci --workspaces=false；新机器先运行 node scripts/initialize-development.cjs --initialize-new；然后 npm run dev。'
Write-Output '启动会检查原Docker数据库并应用本包已登记迁移；不是只读检查。启动前请先保存可恢复备份。'
if (-not $Start) { Write-Output '当前仅显示计划，没有安装、启动、迁移或数据库操作。显式添加 -Start 才启动。'; exit 0 }
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { Write-Error '开发配置不存在；原数据未改动。已有机器请恢复原配置，只有新机器使用初始化命令；不要生成新密码替换旧卷。'; exit 3 }
if ($env:NEW_DESIGN_DATABASE_URL) { Write-Error '开发入口拒绝外部数据库连接串；请使用原受控Docker运行配置。'; exit 3 }
Push-Location -LiteralPath $developmentRoot
$developmentModeBefore = $env:AI_NOVEL_NEW_DESIGN_DEV_RUNTIME
try { $env:AI_NOVEL_NEW_DESIGN_DEV_RUNTIME = '1'; & npm run dev; $developmentExit = $LASTEXITCODE } finally { $env:AI_NOVEL_NEW_DESIGN_DEV_RUNTIME = $developmentModeBefore; Pop-Location }
exit $developmentExit
