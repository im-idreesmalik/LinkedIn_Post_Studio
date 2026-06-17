# ============================================================
#  LinkedIn Post Studio — stop everything.
#  Right-click -> "Run with PowerShell", or:  ./stop.ps1
#  (Your data is kept; this only stops the running processes.)
# ============================================================
$ErrorActionPreference = "SilentlyContinue"
Set-Location "e:\LinkedIn Project"

Write-Host "Stopping app + worker (node)..." -ForegroundColor Cyan
Stop-Process -Name node -Force -ErrorAction SilentlyContinue

Write-Host "Stopping Postgres + MinIO containers (data is preserved)..." -ForegroundColor Cyan
docker compose stop

Write-Host "Stopped. Run ./start.ps1 to bring it back up." -ForegroundColor Green
