# ============================================================
# Registers a Windows Scheduled Task that serves the built ShopOps
# app (dist/) on port 4173 at every system startup — so the Tailscale
# Funnel / tunnel always has something to expose.
#
# Run in an ELEVATED PowerShell (Run as Administrator):
#   powershell -ExecutionPolicy Bypass -File scripts\install-app-startup.ps1
#
# Remove later with:
#   Unregister-ScheduledTask -TaskName "ShopOps App" -Confirm:$false
# ============================================================

$ErrorActionPreference = "Stop"
$taskName = "ShopOps App"
$root     = Split-Path -Parent $PSScriptRoot          # project root
$bat      = Join-Path $root "scripts\start-app.bat"
$node     = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $node) { Write-Error "Node.js not found on PATH. Install Node, then re-run."; exit 1 }
if (-not (Test-Path $bat)) { Write-Error "Missing $bat"; exit 1 }

$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Description "Serves the ShopOps built app on :4173" | Out-Null

Write-Host "Registered scheduled task '$taskName' (serves dist/ on :4173 at boot)." -ForegroundColor Green
Write-Host "Start it now with:  Start-ScheduledTask -TaskName `"$taskName`""
