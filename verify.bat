@echo off
rem One-click self check. All Chinese output lives in scripts\verify.mjs,
rem because this batch file must stay pure ASCII to survive the Windows console codepage.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found on PATH.
  echo   Install Node.js 20 or newer, or run this from a machine that has it.
  echo.
  pause
  exit /b 1
)

node "scripts\verify.mjs"

echo.
pause
