# ============================================================
#  LinkedIn Post Studio — start everything after a reboot.
#  Right-click -> "Run with PowerShell", or:  ./start.ps1
# ============================================================
$ErrorActionPreference = "SilentlyContinue"
$proj = "e:\LinkedIn Project"
Set-Location $proj

Write-Host "1/4  Checking Docker..." -ForegroundColor Cyan
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "     Docker not running - launching Docker Desktop..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    Write-Host "     Waiting for Docker to be ready (this can take a minute)..."
    do {
        Start-Sleep -Seconds 3
        docker info *> $null
    } until ($LASTEXITCODE -eq 0)
}
Write-Host "     Docker is ready." -ForegroundColor Green

Write-Host "2/4  Starting Postgres + MinIO..." -ForegroundColor Cyan
docker compose up -d postgres minio minio-setup

Write-Host "3/4  Starting the web app (new window)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$proj'; npm run dev"

Write-Host "4/4  Starting the worker (new window)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$proj'; npm run worker:start"

Write-Host ""
Write-Host "All set. Open http://localhost:3000 in ~15 seconds." -ForegroundColor Green
Write-Host "(Two new windows are running the app + worker - keep them open.)"
