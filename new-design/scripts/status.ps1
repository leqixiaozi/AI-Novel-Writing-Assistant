param([switch]$Json, [switch]$Plain, [switch]$Quiet)
& (Join-Path $PSScriptRoot 'runtime.ps1') status -Json:$Json -Plain:$Plain -Quiet:$Quiet
exit $LASTEXITCODE
