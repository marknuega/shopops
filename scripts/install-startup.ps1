# ============================================================
# Registers a Windows Scheduled Task that launches the ShopOps
# server automatically at system startup (before / without login).
#
# Run in an ELEVATED PowerShell (Run as Administrator):
#   powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
#
# Remove later with:
#   Unregister-ScheduledTask -TaskName "ShopOps Server" -Confirm:$false
# ============================================================

$ErrorActionPreference = "Stop"
$taskName = "ShopOps Server"
$root     = Split-Path -Parent $PSScriptRoot          # project root
$bat      = Join-Path $root "scripts\start-server.bat"
$node     = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $node) { Write-Error "Node.js not found on PATH. Install Node, then re-run."; exit 1 }
if (-not (Test-Path $bat)) { Write-Error "Missing $bat"; exit 1 }

# Action: run the .bat (which cd's to root and starts node)
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $root

# Trigger: at machine startup
$trigger = New-ScheduledTaskTrigger -AtStartup

# Settings: keep it running, restart on failure, no timeout
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)

# Run as SYSTEM so it starts without anyone logging in
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Description "ShopOps API + web server" | Out-Null

Write-Host "Registered scheduled task '$taskName' (starts at boot)." -ForegroundColor Green
Write-Host "Start it now with:  Start-ScheduledTask -TaskName `"$taskName`""
