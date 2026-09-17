$ErrorActionPreference = 'Stop'
$serverRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../server'))
$databasePath = Join-Path $serverRoot 'dev.db'
if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
    throw 'Existing legacy SQLite database is missing. Refusing to create a new database.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) {
    throw 'Port 3000 is already in use. Existing service was not stopped.'
}
# Process-only settings: no env file changes and no Prisma preparation scripts.
$env:AI_NOVEL_COMPARISON_STARTUP = '1'
$env:SQLITE_ENABLE_WAL = 'false'
$env:AI_NOVEL_DATABASE_MODE = 'sqlite'
$env:DATABASE_URL = 'file:' + $databasePath.Replace('\', '/')
$env:AI_NOVEL_RUNTIME = 'web'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:ALLOW_LAN = 'false'
Push-Location -LiteralPath $serverRoot
try {
    & node 'scripts/start-dev-api.cjs'
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
