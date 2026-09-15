param([switch]$Json, [switch]$Plain, [switch]$Quiet)
& (Join-Path $PSScriptRoot 'runtime.ps1') doctor -Json:$Json -Plain:$Plain -Quiet:$Quiet
exit $LASTEXITCODE
