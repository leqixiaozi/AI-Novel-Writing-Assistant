[CmdletBinding()]
param([switch]$Build)
$developmentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dockerSource = Join-Path $developmentRoot 'docker/dev-postgres'
$dockerRecipe = Join-Path $dockerSource 'Dockerfile'
$developmentTag = 'ai-novel/new-design-postgres-dev:pg17-age1.7-vector0.8.6'
Write-Output "仅重建镜像 $developmentTag；不启动容器、不挂数据卷、不迁移数据库。"
Write-Output 'Dockerfile使用AGE 1.7.0 / PostgreSQL17与pgvector 0.8.6，目标需Docker Linux容器及可访问镜像源。'
if (-not $Build) { Write-Output '当前仅显示计划；显式添加 -Build 才执行镜像构建。'; exit 0 }
if (-not (Test-Path -LiteralPath $dockerRecipe -PathType Leaf)) { Write-Error 'Dockerfile缺失，未构建；请恢复本包docker/dev-postgres源码。'; exit 3 }
& docker build --build-arg 'POSTGRES_MAJOR=17' --tag $developmentTag --file $dockerRecipe $dockerSource
if ($LASTEXITCODE -ne 0) { Write-Error '镜像重建失败，原容器与数据库未修改；请检查Docker Desktop及镜像源网络，修正后明确重建。不使用系统PostgreSQL回退。'; exit $LASTEXITCODE }
