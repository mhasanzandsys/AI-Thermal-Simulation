@echo off
title AI Thermal Simulator
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
echo Node version:
node -v
if not exist node_modules (
  echo.
  echo Installing dependencies - first run only, this can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
)
echo.
echo Starting API on http://localhost:4000 and web app on http://localhost:3000 ...
start "" cmd /c "timeout /t 15 /nobreak >nul && start http://localhost:3000"
call npm run dev
pause
