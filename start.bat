@echo off
REM Double-click this to start LinkedIn Post Studio.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
echo.
echo Open http://localhost:3000 in your browser.
pause
