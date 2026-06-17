@echo off
REM Double-click this to stop LinkedIn Post Studio.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
pause
