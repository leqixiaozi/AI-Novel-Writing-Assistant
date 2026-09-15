param([switch]$Json, [switch]$Plain, [switch]$Quiet, [switch]$Plan, [ValidatePattern('^[a-f0-9]{64}$')][string]$Confirm)
$arguments = @('upgrade')
if ($Json) { $arguments += '-Json' }
if ($Plain) { $arguments += '-Plain' }
if ($Quiet) { $arguments += '-Quiet' }
if ($Plan) { $arguments += '-Plan' }
if ($Confirm) { $arguments += @('-Confirm', $Confirm) }
& (Join-Path $PSScriptRoot 'runtime.ps1') @arguments
exit $LASTEXITCODE
