[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('start', 'stop', 'status', 'doctor', 'backup', 'upgrade')]
  [string]$Command,
  [switch]$Json,
  [switch]$Plain,
  [switch]$Quiet,
  [switch]$Plan,
  [ValidatePattern('^[a-f0-9]{64}$')]
  [string]$Confirm
)

$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$nodeExecutable = Join-Path $packageRoot 'bin\node.exe'
$cliEntry = Join-Path $packageRoot 'app\server\runtime\cli.js'
$manifestPath = Join-Path $packageRoot 'runtime-manifest.json'
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf) -or -not (Test-Path -LiteralPath $cliEntry -PathType Leaf) -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  [Console]::Error.WriteLine('新设计私有运行包不完整；不会回退到系统 Node.js 或 PostgreSQL。')
  exit 3
}
try {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  foreach ($lockedFile in @(@{ Path = 'bin/node.exe'; FullPath = $nodeExecutable }, @{ Path = 'app/server/runtime/cli.js'; FullPath = $cliEntry })) {
    $entry = @($manifest.files | Where-Object { $_.path -ceq $lockedFile.Path })
    $actual = Get-Item -LiteralPath $lockedFile.FullPath
    if ($entry.Count -ne 1 -or $actual.Length -ne $entry[0].byteSize -or (Get-FileHash -LiteralPath $lockedFile.FullPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry[0].sha256) {
      throw "integrity:$($lockedFile.Path)"
    }
  }
} catch {
  [Console]::Error.WriteLine('新设计私有运行入口完整性校验失败。')
  exit 3
}
$arguments = @($cliEntry, $Command)
if ($Json) { $arguments += '--json' }
if ($Plain) { $arguments += '--plain' }
if ($Quiet) { $arguments += '--quiet' }
if ($Plan) { $arguments += '--plan' }
if ($Confirm) { $arguments += @('--confirm', $Confirm) }
& $nodeExecutable @arguments
exit $LASTEXITCODE
